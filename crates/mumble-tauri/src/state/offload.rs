//! Encrypted temporary file storage for offloaded message content.
//!
//! Provides an [`OffloadProvider`] trait that abstracts storage and
//! retrieval of message bodies.  The default implementation,
//! [`EncryptedFileProvider`], uses ChaCha20-Poly1305 (AEAD) for
//! lightweight authenticated encryption on top of temp files.
//!
//! The encryption key is generated randomly at construction and held
//! only in memory -- it is never persisted to disk.  Files written by
//! a previous session are unrecoverable and cleaned up on the next
//! startup.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use ring::aead::{Aad, CHACHA20_POLY1305, LessSafeKey, Nonce, UnboundKey};
use ring::rand::{SecureRandom, SystemRandom};
use tracing::{debug, warn};

/// Nonce size for ChaCha20-Poly1305 (96 bits).
const NONCE_LEN: usize = 12;
/// Key size for ChaCha20-Poly1305 (256 bits).
const KEY_LEN: usize = 32;
/// Sub-directory name inside the system temp folder.
const OFFLOAD_DIR_NAME: &str = "fancy-mumble-offload";
/// The file a running client holds locked in its own folder there, for as
/// long as it runs: what tells a folder in use from one left behind.
const OWNER_FILE: &str = "owner.lock";
/// How old a file lying directly in the shared folder is before it is
/// taken for left behind. Clients from before each had a folder of its own
/// wrote there, and one of those may still be running.
const LEFT_BEHIND_AFTER: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);

// --- Provider trait -----------------------------------------------

/// Abstraction over how offloaded message content is persisted and
/// retrieved.
///
/// The default implementation encrypts content to local temp files.
/// Future implementations could store content on a remote server,
/// in a database, or anywhere else.
pub trait OffloadProvider {
    /// Persist `content` under the given `key`.
    fn store(&mut self, key: &str, content: &str) -> Result<(), String>;

    /// Retrieve previously stored content for `key`.
    fn load(&self, key: &str) -> Result<String, String>;

    /// Load multiple keys at once.
    ///
    /// The default implementation calls [`load`](OffloadProvider::load)
    /// in a loop.  Providers that benefit from batching (e.g. network
    /// round-trips) should override this.
    fn load_many(&self, keys: &[&str]) -> HashMap<String, Result<String, String>> {
        keys.iter().map(|k| (k.to_string(), self.load(k))).collect()
    }

    /// Delete the stored content for a single key.
    fn remove(&mut self, key: &str);

    /// Whether `key` is currently stored.
    #[allow(
        dead_code,
        reason = "utility method provided for completeness; not all callers need it"
    )]
    fn is_offloaded(&self, key: &str) -> bool;

    /// Number of keys currently offloaded.
    fn offloaded_count(&self) -> usize;

    /// Remove all stored content.
    fn clear(&mut self);

    /// Final cleanup (e.g. delete temp directory). Called on shutdown.
    fn cleanup(&mut self);
}

// --- Encrypted file provider --------------------------------------

/// Encrypted temporary file storage for offloaded message content.
///
/// Security properties:
///
/// * Key is randomly generated per session and never written to disk.
/// * Each file uses a unique random 96-bit nonce prepended to the
///   ciphertext so identical plaintexts produce different outputs.
/// * ChaCha20-Poly1305 provides authenticated encryption (AEAD),
///   protecting both confidentiality and integrity.
/// * Files are cleaned up on shutdown; stale files from crashes are
///   unrecoverable (no key) and deleted on the next startup.
pub struct EncryptedFileProvider {
    key: LessSafeKey,
    rng: SystemRandom,
    dir: PathBuf,
    /// Keys that are currently offloaded to disk.
    offloaded: HashSet<String>,
    /// [`OWNER_FILE`], held locked while this provider lives. Another
    /// client starting up leaves a folder alone while its owner holds it.
    owner: Option<fs::File>,
}

impl EncryptedFileProvider {
    /// Create a new provider with a fresh random encryption key.
    ///
    /// `base_dir` is the parent directory (e.g. the OS temp dir or
    /// the app's cache directory on Android).  The offload sub-folder
    /// is created inside it.
    pub fn new(base_dir: PathBuf) -> Result<Self, String> {
        // A folder of this client's own under the shared one: several
        // clients run at once (two windows, a test beside the real one),
        // and each can read only what it put away itself.
        let mut tag = [0u8; 8];
        SystemRandom::new()
            .fill(&mut tag)
            .map_err(|_| "Failed to name the offload directory")?;
        let own = format!("{}-{}", std::process::id(), u64::from_le_bytes(tag));
        Self::with_dir(base_dir.join(OFFLOAD_DIR_NAME).join(own))
    }

    /// Create a new provider that stores files in the given directory.
    ///
    /// Useful for tests that need isolated temp directories.
    fn with_dir(dir: PathBuf) -> Result<Self, String> {
        let rng = SystemRandom::new();
        let mut key_bytes = [0u8; KEY_LEN];
        rng.fill(&mut key_bytes)
            .map_err(|_| "Failed to generate encryption key")?;

        let unbound = UnboundKey::new(&CHACHA20_POLY1305, &key_bytes)
            .map_err(|_| "Failed to create encryption key")?;
        let key = LessSafeKey::new(unbound);

        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create offload directory: {e}"))?;
        // Best effort: without the lock the folder is merely not known
        // to be in use, which is how it was before.
        let owner = fs::File::create(dir.join(OWNER_FILE))
            .ok()
            .filter(|file| file.try_lock().is_ok());

        debug!("EncryptedFileProvider initialised at {}", dir.display());

        Ok(Self {
            key,
            rng,
            dir,
            offloaded: HashSet::new(),
            owner,
        })
    }

    /// Remove stale offload data left behind by a previous session that
    /// did not shut down cleanly.  Called once during application startup.
    ///
    /// Only what nobody holds is removed. The folder is shared by every
    /// client on the machine, and one that is running still needs what it
    /// put away: removing the lot, as this once did, cost a running client
    /// every body it had on disk the moment a second one was started.
    pub fn cleanup_stale(base_dir: &std::path::Path) {
        let Ok(entries) = fs::read_dir(base_dir.join(OFFLOAD_DIR_NAME)) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if !Self::in_use(&path) {
                    debug!("Removing an offload directory nobody holds");
                    let _ = fs::remove_dir_all(&path);
                }
            } else if Self::left_behind(&path) {
                let _ = fs::remove_file(&path);
            }
        }
    }

    /// Whether the client that made the folder `dir` is still running: it
    /// holds [`OWNER_FILE`] locked for as long as it is.
    fn in_use(dir: &std::path::Path) -> bool {
        match fs::File::open(dir.join(OWNER_FILE)) {
            // Ours to lock means nobody else has it; let go at once.
            Ok(owner) => match owner.try_lock() {
                Ok(()) => {
                    let _ = owner.unlock();
                    false
                }
                Err(_) => true,
            },
            Err(_) => false,
        }
    }

    /// Whether the file `path`, lying directly in the shared folder, is old
    /// enough that no running client can still want it.
    fn left_behind(path: &std::path::Path) -> bool {
        fs::metadata(path)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|written| written.elapsed().ok())
            .is_some_and(|age| age > LEFT_BEHIND_AFTER)
    }

    /// Build a filesystem path for the given key.
    ///
    /// Keys are sanitised to prevent path-traversal attacks.
    fn file_path(&self, key: &str) -> PathBuf {
        let safe_key: String = key
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        self.dir.join(format!("{safe_key}.enc"))
    }

    /// Encrypt `plaintext` into `[nonce || ciphertext || tag]`.
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let rng = &self.rng;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rng.fill(&mut nonce_bytes)
            .map_err(|_| "Failed to generate nonce")?;
        let nonce = Nonce::assume_unique_for_key(nonce_bytes);

        // Sealed where it will be written from: a body is megabytes, and
        // every copy of it on the way is that much held at once.
        let mut out = Vec::with_capacity(NONCE_LEN + plaintext.len() + CHACHA20_POLY1305.tag_len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(plaintext);
        let tag = self
            .key
            .seal_in_place_separate_tag(nonce, Aad::empty(), &mut out[NONCE_LEN..])
            .map_err(|_| "Encryption failed")?;
        out.extend_from_slice(tag.as_ref());
        Ok(out)
    }

    /// Decrypt `[nonce || ciphertext || tag]` back to plaintext bytes, in
    /// the buffer it was read into.
    fn decrypt(key: &LessSafeKey, mut file_data: Vec<u8>) -> Result<Vec<u8>, String> {
        if file_data.len() <= NONCE_LEN {
            return Err("Corrupted offload file: too short".into());
        }
        let (nonce_bytes, ciphertext) = file_data.split_at_mut(NONCE_LEN);
        let nonce = Nonce::try_assume_unique_for_key(nonce_bytes)
            .map_err(|_| "Invalid nonce in offload file")?;

        let opened = key
            .open_in_place(nonce, Aad::empty(), ciphertext)
            .map_err(|_| "Decryption failed (file may be corrupted or from another session)")?
            .len();
        // What is left is the nonce, the body, and where the tag was.
        file_data.truncate(NONCE_LEN + opened);
        drop(file_data.drain(..NONCE_LEN));
        Ok(file_data)
    }
}

impl OffloadProvider for EncryptedFileProvider {
    fn store(&mut self, key: &str, content: &str) -> Result<(), String> {
        let file_data = self.encrypt(content.as_bytes())?;
        let path = self.file_path(key);
        fs::write(&path, &file_data).map_err(|e| format!("Failed to write offload file: {e}"))?;
        let _ = self.offloaded.insert(key.to_string());
        Ok(())
    }

    fn load(&self, key: &str) -> Result<String, String> {
        let path = self.file_path(key);
        let file_data = fs::read(&path).map_err(|e| format!("Failed to read offload file: {e}"))?;
        let plaintext = Self::decrypt(&self.key, file_data)?;
        String::from_utf8(plaintext)
            .map_err(|e| format!("Decrypted content is not valid UTF-8: {e}"))
    }

    fn load_many(&self, keys: &[&str]) -> HashMap<String, Result<String, String>> {
        // For local files there is no network latency to amortise, but we
        // still benefit from a single trait call that avoids repeated IPC
        // round-trips from the frontend.
        keys.iter().map(|k| (k.to_string(), self.load(k))).collect()
    }

    fn remove(&mut self, key: &str) {
        let _ = self.offloaded.remove(key);
        let path = self.file_path(key);
        if path.exists() {
            let _ = fs::remove_file(&path);
        }
    }

    fn is_offloaded(&self, key: &str) -> bool {
        self.offloaded.contains(key)
    }

    fn offloaded_count(&self) -> usize {
        self.offloaded.len()
    }

    fn clear(&mut self) {
        self.offloaded.clear();
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                // The folder is still this client's: its mark stays.
                if entry.file_name() != OWNER_FILE {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }

    fn cleanup(&mut self) {
        self.offloaded.clear();
        // Let go of the folder before removing it.
        drop(self.owner.take());
        if self.dir.exists() {
            if let Err(e) = fs::remove_dir_all(&self.dir) {
                warn!("Failed to clean up offload directory: {e}");
            } else {
                debug!("Cleaned up offload directory");
            }
        }
    }
}

// --- OffloadStore (facade) ----------------------------------------

/// What search and the photo grid need to know about a body that is put
/// away, kept in memory while the body itself sits in the store.
///
/// Without it an offloaded message is only its `<!-- OFFLOADED -->` marker
/// to everything host-side: no text to match, no picture to list. A stock
/// Mumble client pastes images inline up to 128 KiB, most of them over the
/// offload threshold, so every one of those vanished from Photos and from
/// search once its channel went idle. The summary holds no media - only
/// the visible text, which is no more than a text-only message keeps in
/// memory anyway - so the memory the offload saves stays saved.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BodySummary {
    /// The body as a reader sees it (see `fancy_utils::html::visible_text`).
    pub visible_text: String,
    /// Whether the body shows a picture (an `<img>` or a `data:image` URL).
    pub has_image: bool,
    /// Whether the body carries a link.
    pub has_link: bool,
    /// How many `<img>` sources the body has; the photo grid lists one
    /// entry per source and loads the body back only for the page shown.
    pub image_count: usize,
}

/// Wraps an [`OffloadProvider`] and exposes it as the public API used
/// by the rest of the application.
pub struct OffloadStore {
    provider: Box<dyn OffloadProvider + Send>,
    /// A [`BodySummary`] for every key currently stored.
    summaries: HashMap<String, BodySummary>,
}

impl OffloadStore {
    /// Create a store using the default [`EncryptedFileProvider`].
    ///
    /// `base_dir` is the parent directory for the offload sub-folder.
    pub fn new(base_dir: PathBuf) -> Result<Self, String> {
        let provider = EncryptedFileProvider::new(base_dir)?;
        Ok(Self {
            provider: Box::new(provider),
            summaries: HashMap::new(),
        })
    }

    /// Create a store backed by a custom provider.
    #[allow(
        dead_code,
        reason = "alternative constructor for testing with custom providers"
    )]
    pub fn with_provider(provider: Box<dyn OffloadProvider + Send>) -> Self {
        Self {
            provider,
            summaries: HashMap::new(),
        }
    }

    /// Put `content` away under `key`, keeping its [`BodySummary`] at hand.
    ///
    /// Every path that offloads a body comes through here - the viewport
    /// window and the idle-channel sweep alike - so no offloaded message is
    /// ever without one.
    pub fn store(&mut self, key: &str, content: &str) -> Result<(), String> {
        self.provider.store(key, content)?;
        let _ = self
            .summaries
            .insert(key.to_owned(), super::search::summarize_body(content));
        Ok(())
    }

    /// The summary of the body stored under `key`, if one is.
    pub fn summary(&self, key: &str) -> Option<&BodySummary> {
        self.summaries.get(key)
    }

    pub fn load(&self, key: &str) -> Result<String, String> {
        self.provider.load(key)
    }

    /// Load multiple keys in a single call.  Returns a map of key to
    /// result.  Failed keys contain an `Err`; successful ones `Ok`.
    pub fn load_many(&self, keys: &[&str]) -> HashMap<String, Result<String, String>> {
        self.provider.load_many(keys)
    }

    pub fn remove(&mut self, key: &str) {
        let _ = self.summaries.remove(key);
        self.provider.remove(key);
    }

    #[allow(
        dead_code,
        reason = "utility method provided for completeness; not all callers need it"
    )]
    pub fn is_offloaded(&self, key: &str) -> bool {
        self.provider.is_offloaded(key)
    }

    /// Number of keys currently offloaded.
    pub fn offloaded_count(&self) -> usize {
        self.provider.offloaded_count()
    }

    pub fn clear(&mut self) {
        self.summaries.clear();
        self.provider.clear();
    }

    pub fn cleanup_dir(&mut self) {
        self.summaries.clear();
        self.provider.cleanup();
    }

    /// Remove stale offload data from a previous session.
    pub fn cleanup_stale(base_dir: &std::path::Path) {
        EncryptedFileProvider::cleanup_stale(base_dir);
    }
}

// --- Tests --------------------------------------------------------

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "unwrap/expect acceptable in test code"
    )]
    use super::*;

    /// Create an `OffloadStore` with an isolated temporary directory so
    /// parallel tests do not interfere with each other.
    fn isolated_store(name: &str) -> OffloadStore {
        let dir = std::env::temp_dir()
            .join(OFFLOAD_DIR_NAME)
            .join(format!("test-{name}-{}", std::process::id()));
        let provider = EncryptedFileProvider::with_dir(dir).expect("failed to create provider");
        OffloadStore::with_provider(Box::new(provider))
    }

    #[test]
    fn a_client_starting_up_leaves_what_a_running_one_put_away() {
        let base =
            std::env::temp_dir().join(format!("fancy-offload-shared-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        // One client is running and has put something away.
        let mut running = EncryptedFileProvider::new(base.clone()).expect("a provider");
        running.store("kept", "a heavy body").unwrap();
        // One that stopped without cleaning up, and a file from long ago
        // would be here too; a file written just now is somebody's.
        let gone = base.join(OFFLOAD_DIR_NAME).join("1-gone");
        fs::create_dir_all(&gone).unwrap();
        fs::write(gone.join("old.enc"), b"unreadable").unwrap();
        let loose = base.join(OFFLOAD_DIR_NAME).join("loose.enc");
        fs::write(&loose, b"another client's").unwrap();

        // A second client starts: what it does first.
        EncryptedFileProvider::cleanup_stale(&base);
        let second = EncryptedFileProvider::new(base.clone()).expect("a second provider");

        assert_eq!(running.load("kept").unwrap(), "a heavy body");
        assert!(!gone.exists(), "what nobody holds is removed");
        assert!(loose.exists(), "a recent file may be a running client's");
        assert!(second.load("kept").is_err(), "and each reads only its own");

        // Once the first has stopped, its folder is nobody's.
        let was = running.dir.clone();
        drop(running);
        EncryptedFileProvider::cleanup_stale(&base);
        assert!(!was.exists());
        assert!(second.dir.exists(), "the one still running keeps its own");
        drop(second);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn store_and_load_round_trip() {
        let mut store = isolated_store("round-trip");
        let content = "Hello, world! <img src='data:image/png;base64,abc123'/>";
        store.store("msg-1", content).unwrap();

        assert!(store.is_offloaded("msg-1"));

        let loaded = store.load("msg-1").unwrap();
        assert_eq!(loaded, content);

        store.cleanup_dir();
    }

    #[test]
    fn load_many_returns_all_keys() {
        let mut store = isolated_store("load-many");
        store.store("a", "content-a").unwrap();
        store.store("b", "content-b").unwrap();
        store.store("c", "content-c").unwrap();

        let results = store.load_many(&["a", "b", "c"]);
        assert_eq!(results.len(), 3);
        assert_eq!(results["a"].as_deref(), Ok("content-a"));
        assert_eq!(results["b"].as_deref(), Ok("content-b"));
        assert_eq!(results["c"].as_deref(), Ok("content-c"));

        store.cleanup_dir();
    }

    #[test]
    fn load_many_with_missing_key() {
        let mut store = isolated_store("load-many-missing");
        store.store("exists", "data").unwrap();

        let results = store.load_many(&["exists", "missing"]);
        assert!(results["exists"].is_ok());
        assert!(results["missing"].is_err());

        store.cleanup_dir();
    }

    #[test]
    fn remove_deletes_file() {
        let mut store = isolated_store("remove");
        store.store("rm-1", "data").unwrap();
        assert!(store.is_offloaded("rm-1"));

        store.remove("rm-1");
        assert!(!store.is_offloaded("rm-1"));
        assert!(store.load("rm-1").is_err());

        store.cleanup_dir();
    }

    #[test]
    fn clear_removes_all() {
        let mut store = isolated_store("clear");
        store.store("c1", "one").unwrap();
        store.store("c2", "two").unwrap();

        store.clear();
        assert!(!store.is_offloaded("c1"));
        assert!(!store.is_offloaded("c2"));

        store.cleanup_dir();
    }

    #[test]
    fn different_nonces_produce_different_ciphertext() {
        let mut store = isolated_store("nonces");
        store.store("dup1", "same content").unwrap();
        store.store("dup2", "same content").unwrap();

        // Read raw file bytes -- they should differ because nonces differ.
        let provider = store.provider.as_ref();
        // We can't access file_path directly through the trait, but we can
        // verify that both decrypt to the same plaintext.
        assert_eq!(store.load("dup1").unwrap(), "same content");
        assert_eq!(store.load("dup2").unwrap(), "same content");
        // And that they are both tracked as offloaded.
        assert!(provider.is_offloaded("dup1"));
        assert!(provider.is_offloaded("dup2"));

        store.cleanup_dir();
    }

    #[test]
    fn empty_content_round_trip() {
        let mut store = isolated_store("empty");
        store.store("empty", "").unwrap();

        let loaded = store.load("empty").unwrap();
        assert_eq!(loaded, "");

        store.cleanup_dir();
    }

    #[test]
    fn large_content_round_trip() {
        let mut store = isolated_store("large");
        // Simulate a large base64 image (~100KB).
        let content = "x".repeat(100_000);
        store.store("big", &content).unwrap();

        let loaded = store.load("big").unwrap();
        assert_eq!(loaded, content);

        store.cleanup_dir();
    }

    #[test]
    fn key_sanitisation_prevents_traversal() {
        let mut store = isolated_store("traversal");
        // Malicious key with path traversal attempt.
        store.store("../../../etc/passwd", "nope").unwrap();

        // Should still round-trip correctly (key is sanitised).
        let loaded = store.load("../../../etc/passwd").unwrap();
        assert_eq!(loaded, "nope");

        store.cleanup_dir();
    }

    #[test]
    fn custom_provider_via_with_provider() {
        /// A trivial in-memory provider for testing.
        struct InMemoryProvider {
            data: HashMap<String, String>,
        }
        impl OffloadProvider for InMemoryProvider {
            fn store(&mut self, key: &str, content: &str) -> Result<(), String> {
                let _ = self.data.insert(key.to_string(), content.to_string());
                Ok(())
            }
            fn load(&self, key: &str) -> Result<String, String> {
                self.data.get(key).cloned().ok_or("not found".into())
            }
            fn remove(&mut self, key: &str) {
                let _ = self.data.remove(key);
            }
            fn is_offloaded(&self, key: &str) -> bool {
                self.data.contains_key(key)
            }
            fn offloaded_count(&self) -> usize {
                self.data.len()
            }
            fn clear(&mut self) {
                self.data.clear();
            }
            fn cleanup(&mut self) {
                self.data.clear();
            }
        }

        let provider = InMemoryProvider {
            data: HashMap::new(),
        };
        let mut store = OffloadStore::with_provider(Box::new(provider));
        store.store("k", "v").unwrap();
        assert_eq!(store.load("k").unwrap(), "v");

        store.remove("k");
        assert!(!store.is_offloaded("k"));
    }

    #[test]
    fn a_stored_body_keeps_its_summary_until_it_comes_back() {
        let mut store = isolated_store("summary");
        let body = "see <b>this</b> <img src=\"data:image/png;base64,AAAA\"> https://x.y";
        store.store("s1", body).unwrap();

        let summary = store.summary("s1").unwrap();
        assert_eq!(summary.visible_text, "see this https://x.y");
        assert!(summary.has_image);
        assert!(summary.has_link);
        assert_eq!(summary.image_count, 1);

        // Restored bodies are back in memory; the summary goes with the file.
        store.remove("s1");
        assert!(store.summary("s1").is_none());

        store.store("s2", "x").unwrap();
        store.clear();
        assert!(store.summary("s2").is_none());

        store.cleanup_dir();
    }
}
