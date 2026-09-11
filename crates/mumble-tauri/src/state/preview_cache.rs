//! The cards this client has already been given, kept so rejoining a channel
//! does not ask for them again.
//!
//! A preview is fetched by the server and never by the viewer - that is the
//! whole point of the feature, and [`link_preview`](super::handler::link_preview)
//! says why. What it left open is that the *answer* was never kept anywhere.
//! The store keyed cards by message id and dropped them on disconnect, so
//! rejoining a channel meant re-asking for every link in the history, and the
//! server (before it grew a cache of its own) went back out to every one of
//! those hosts.
//!
//! For a persistent channel that is the wrong shape twice over. The history is
//! the client's own: for `pchat` the server holds ciphertext it cannot read,
//! and the plaintext lives here, beside this file, in
//! [`local_cache`](super::local_cache). A card belongs with the message it
//! describes, and a message that is cached locally should not need a server
//! round-trip to draw.
//!
//! # Keyed by the URL that was asked for
//!
//! Not the URL the answer came back with. Those differ whenever a link
//! redirects: a card for `https://t.co/abc` reports the page it *ended up* on,
//! and a cache filed under that would never be found again by the only string a
//! client ever looks up - the one in the message text.
//!
//! When the two differ the card is filed under **both**, because both are real
//! questions somebody may ask later, and a redirect target pasted directly is
//! the same page.
//!
//! # Encrypted, with the same key material as the messages
//!
//! The URLs somebody has in their history is exactly as revealing as the
//! history, so this file gets what that file gets: AES-256-GCM under a key
//! derived from the identity seed by HKDF, with its own info string so the two
//! keys are not the same key. Where there is no seed - a client with no
//! identity - the cache still works, in memory, and simply does not outlive the
//! process.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use ring::aead::{AES_256_GCM, Aad, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use ring::hkdf::{self, HKDF_SHA256, Salt};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use tracing::debug;

use super::handler::link_preview::LinkEmbed;

/// File name for the encrypted local preview cache.
const CACHE_FILE: &str = "link_preview_cache.enc";

/// HKDF info string for deriving the cache encryption key.
///
/// Different from the message cache's, so that two files encrypted with the
/// same seed are not encrypted with the same key.
const HKDF_INFO: &[u8] = b"fancy-mumble-link-preview-cache-v1";

/// How long a card is drawn without asking again.
///
/// Longer than the server's own six hours, and deliberately: the server's clock
/// bounds how stale a *fetch* may be, and this one bounds how often a client
/// that already has the answer bothers to ask. A day means a channel someone
/// opens every morning costs nothing, while a page that changed is still picked
/// up well inside the week.
const TTL: Duration = Duration::from_secs(24 * 3600);

/// How many cards are kept. The oldest go first.
///
/// Chosen against the thing it bounds: this is a *person's* reading history, not
/// a server's, and a thousand distinct links is already more than most accounts
/// will accumulate between cache clears.
const MAX_ENTRIES: usize = 1024;

/// How many bytes of card are kept.
///
/// The cap that actually binds, because an entry count does not: a card carries
/// a thumbnail and a favicon as base64 data URLs, so the same thousand entries
/// can be a hundred kilobytes or fifty megabytes.
const MAX_BYTES: usize = 32 * 1024 * 1024;

/// How long [`PreviewCache::save_if_due`] lets changes sit unwritten.
///
/// The same bargain [`local_cache`](super::local_cache) makes: short enough
/// that an abrupt end loses little, long enough that a channel full of links
/// does not re-encrypt the whole file per card.
const SAVE_INTERVAL: Duration = Duration::from_secs(30);

/// Custom key type for HKDF output (32 bytes for AES-256).
struct CacheKeyLen;

impl hkdf::KeyType for CacheKeyLen {
    fn len(&self) -> usize {
        32
    }
}

/// One card, and when it was given to us.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct CachedPreview {
    /// The card exactly as the frontend receives it, so a hit and a fresh
    /// answer are the same event with the same shape.
    pub embed: LinkEmbed,
    /// Milliseconds since the epoch, for the TTL and for eviction order.
    pub stored_at_ms: u64,
}

/// The cards already fetched, by the URL that was asked for.
pub(crate) struct PreviewCache {
    cards: HashMap<String, CachedPreview>,
    /// The key and the file, or `None` for a client with no identity seed - the
    /// cache is then in-memory and does not outlive the process.
    at_rest: Option<AtRest>,
    /// Set by `insert`, cleared by a successful `save_if_due`.
    dirty: bool,
    /// When the throttled save last ran. Starts at construction so a
    /// freshly-loaded cache does not write itself straight back out.
    last_save: Instant,
}

/// What is needed to keep the cache across restarts.
struct AtRest {
    key: LessSafeKey,
    path: PathBuf,
}

impl std::fmt::Debug for PreviewCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PreviewCache")
            .field("cards", &self.cards.len())
            .field("persistent", &self.at_rest.is_some())
            .finish()
    }
}

impl PreviewCache {
    /// A cache that lives only as long as the process.
    ///
    /// What a client with no identity seed gets. It still removes the re-ask on
    /// rejoin *within* a session, which is the case that repeats most.
    pub fn in_memory() -> Self {
        Self {
            cards: HashMap::new(),
            at_rest: None,
            dirty: false,
            last_save: Instant::now(),
        }
    }

    /// Give an in-memory cache a file to live in, and read back what is in it.
    ///
    /// Called when an identity seed becomes known, which is on connect - later
    /// than the cache itself, because a client accumulates cards whether or not
    /// it ever loads an identity.
    ///
    /// Idempotent for the same identity: re-attaching the directory already in
    /// use does nothing, so a reconnect does not re-read the file over cards
    /// collected since. A **different** identity is a different person's reading
    /// history, so the old file is written out and the cards are dropped rather
    /// than carried across.
    ///
    /// # Errors
    ///
    /// When the key cannot be derived, or the existing file cannot be read.
    pub fn attach(&mut self, identity_dir: &Path, seed: &[u8; 32]) -> Result<(), String> {
        let path = identity_dir.join(CACHE_FILE);
        if self.at_rest.as_ref().is_some_and(|at| at.path == path) {
            return Ok(());
        }
        if self.at_rest.is_some() {
            // Written before the swap: whatever is held belongs to the identity
            // being left, and this is the last chance to keep it.
            if let Err(e) = self.save() {
                debug!("could not write the outgoing preview cache: {e}");
            }
            self.cards.clear();
        }
        self.at_rest = Some(AtRest {
            key: Self::derive_key(seed)?,
            path,
        });
        // Whatever this client collected before the identity arrived is kept:
        // those cards are this same person's, and `load` merges rather than
        // replaces for exactly that reason.
        self.load()
    }

    /// Derive the AES-256-GCM key from the identity seed via HKDF-SHA256.
    fn derive_key(seed: &[u8; 32]) -> Result<LessSafeKey, String> {
        let salt = Salt::new(HKDF_SHA256, &[]);
        let prk = salt.extract(seed);
        let okm = prk
            .expand(&[HKDF_INFO], CacheKeyLen)
            .map_err(|_| "HKDF expand failed".to_string())?;
        let mut key_bytes = [0u8; 32];
        okm.fill(&mut key_bytes)
            .map_err(|_| "HKDF fill failed".to_string())?;
        let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
            .map_err(|_| "AES-256-GCM key creation failed".to_string())?;
        Ok(LessSafeKey::new(unbound))
    }

    /// The card for `url`, if one is held and still inside its TTL.
    pub fn get(&self, url: &str, now_ms: u64) -> Option<LinkEmbed> {
        let entry = self.cards.get(&normalise(url))?;
        if now_ms.saturating_sub(entry.stored_at_ms) >= ttl_ms() {
            return None;
        }
        Some(entry.embed.clone())
    }

    /// Keep `embed` as the answer to `asked`.
    ///
    /// Filed under `asked` and, when the card came back naming a different page,
    /// under that page too: a link that redirects is two strings for one answer,
    /// and both are ones somebody may paste.
    pub fn insert(&mut self, asked: &str, embed: &LinkEmbed, now_ms: u64) {
        let entry = CachedPreview {
            embed: embed.clone(),
            stored_at_ms: now_ms,
        };
        let asked_key = normalise(asked);
        if let Some(landed) = embed.url.as_deref() {
            let landed_key = normalise(landed);
            if landed_key != asked_key {
                let _ = self.cards.insert(landed_key, entry.clone());
            }
        }
        let _ = self.cards.insert(asked_key, entry);
        self.dirty = true;
        self.evict(now_ms);
    }

    /// Keep the cache inside both caps: expired entries first, then the oldest.
    fn evict(&mut self, now_ms: u64) {
        let ttl = ttl_ms();
        self.cards
            .retain(|_, entry| now_ms.saturating_sub(entry.stored_at_ms) < ttl);
        while self.cards.len() > MAX_ENTRIES || self.weight() > MAX_BYTES {
            let Some(oldest) = self
                .cards
                .iter()
                .min_by_key(|(_, entry)| entry.stored_at_ms)
                .map(|(url, _)| url.clone())
            else {
                return;
            };
            let _ = self.cards.remove(&oldest);
        }
    }

    /// Roughly what the cache costs to keep, dominated by the two data URLs a
    /// card carries.
    fn weight(&self) -> usize {
        self.cards.values().map(|entry| entry.embed.weight()).sum()
    }

    /// How many cards are held.
    #[cfg(test)]
    fn len(&self) -> usize {
        self.cards.len()
    }

    // -- Persistence --------------------------------------------------

    /// Write the cache out if it has changed and the last write is at least
    /// [`SAVE_INTERVAL`] old. Returns whether it wrote.
    pub fn save_if_due(&mut self) -> bool {
        if !self.dirty || self.last_save.elapsed() < SAVE_INTERVAL {
            return false;
        }
        // Stamped before the attempt, and left stamped if it fails: a disk that
        // cannot be written to must not turn every later insert into another
        // failing write.
        self.last_save = Instant::now();
        self.dirty = false;
        if let Err(e) = self.save() {
            self.dirty = true;
            debug!("periodic preview cache save failed: {e}");
            return false;
        }
        true
    }

    /// Save the cache to an AES-256-GCM encrypted file on disk.
    ///
    /// A no-op for an in-memory cache.
    ///
    /// # Errors
    ///
    /// When the cache cannot be serialised, encrypted or written.
    pub fn save(&self) -> Result<(), String> {
        let Some(ref at_rest) = self.at_rest else {
            return Ok(());
        };
        let json = serde_json::to_vec(&self.cards).map_err(|e| format!("serialize cache: {e}"))?;
        let encrypted = encrypt(&at_rest.key, &json)?;
        std::fs::write(&at_rest.path, &encrypted).map_err(|e| format!("write cache: {e}"))?;
        debug!(path = ?at_rest.path, cards = self.cards.len(), "saved local preview cache");
        Ok(())
    }

    /// Load the cache from the encrypted file on disk.
    ///
    /// # Errors
    ///
    /// When the file cannot be read, decrypted or parsed.
    pub fn load(&mut self) -> Result<(), String> {
        let Some(ref at_rest) = self.at_rest else {
            return Ok(());
        };
        if !at_rest.path.exists() {
            debug!(path = ?at_rest.path, "no local preview cache found");
            return Ok(());
        }
        let encrypted = std::fs::read(&at_rest.path).map_err(|e| format!("read cache: {e}"))?;
        let json = decrypt(&at_rest.key, &encrypted)?;
        let path = at_rest.path.clone();
        let stored: HashMap<String, CachedPreview> =
            serde_json::from_slice(&json).map_err(|e| format!("deserialize cache: {e}"))?;
        // Merged, not assigned. `attach` reads the file *after* the client has
        // been running, so anything already held was collected this session and
        // is newer than what is on disk; assigning would throw it away.
        for (url, entry) in stored {
            match self.cards.get(&url) {
                Some(held) if held.stored_at_ms >= entry.stored_at_ms => {}
                _ => {
                    let _ = self.cards.insert(url, entry);
                }
            }
        }
        // A file left on disk for a week must not come back as a screenful of
        // stale cards.
        self.evict(now_ms());
        debug!(
            ?path,
            cards = self.cards.len(),
            "loaded local preview cache"
        );
        Ok(())
    }
}

/// One card answered from this client's own cache.
///
/// Returned by the command rather than pushed as an event: the card is already
/// here, and a hit that arrives asynchronously is a card that still pops in a
/// frame late.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct CachedHit {
    /// The URL the caller asked about, which is the string it will file the
    /// card under.
    pub requested_url: String,
    /// The card, in the shape the frontend already knows.
    pub embed: LinkEmbed,
}

/// The cards this client holds, and the questions it is still waiting on.
///
/// The two belong together because neither is useful alone: a card can only be
/// filed under the URL that was asked for, and the reply does not carry it.
pub(crate) struct Previews {
    /// What has already been answered.
    pub cache: PreviewCache,
    /// URLs asked for and not yet answered, by request id.
    ///
    /// Emptied as answers arrive, so "one left" is a real statement about what
    /// an unattributable card must be answering. See [`Self::attribute`].
    pending: HashMap<String, Vec<String>>,
}

/// How many requests may be outstanding before the oldest are forgotten.
///
/// A request whose answer never comes - a server that drops it, a connection
/// that ends mid-flight - would otherwise sit here for the life of the process.
/// Forgetting one costs only the attribution of a redirected card.
const MAX_PENDING: usize = 256;

impl Default for Previews {
    fn default() -> Self {
        Self {
            cache: PreviewCache::in_memory(),
            pending: HashMap::new(),
        }
    }
}

impl std::fmt::Debug for Previews {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Previews")
            .field("cache", &self.cache)
            .field("pending", &self.pending.len())
            .finish()
    }
}

impl Previews {
    /// Record that `urls` were asked about under `request_id`.
    pub fn asked(&mut self, request_id: &str, urls: &[String]) {
        if urls.is_empty() {
            return;
        }
        // Oldest-first is not knowable from a `HashMap`, and a precise LRU here
        // would be bookkeeping for a case that only costs an attribution. Above
        // the cap, clear the lot: every entry in it is a request whose answers
        // have not arrived, and the next ones re-populate it.
        if self.pending.len() >= MAX_PENDING {
            self.pending.clear();
        }
        let _ = self.pending.insert(request_id.to_owned(), urls.to_vec());
    }

    /// Which URL an answer under `request_id` was asked with.
    ///
    /// Exact whenever the card names a URL that was asked for, which is every
    /// link that did not redirect. Where it does not - a shortener reports the
    /// page behind it - one outstanding question means the answer is
    /// unambiguous; several mean it is not, and the card is filed under where
    /// it landed instead. That degrades to a miss on the next join, and a miss
    /// now costs a round-trip rather than a fetch: the server keeps its own
    /// cache, keyed on the same string this client asked with.
    pub fn attribute(&mut self, request_id: &str, landed: Option<&str>) -> Option<String> {
        let outstanding = self.pending.get_mut(request_id)?;
        let asked = match landed.map(normalise) {
            Some(ref landed_key) if outstanding.iter().any(|url| &normalise(url) == landed_key) => {
                let at = outstanding
                    .iter()
                    .position(|url| &normalise(url) == landed_key)?;
                outstanding.remove(at)
            }
            _ if outstanding.len() == 1 => outstanding.remove(0),
            _ => return None,
        };
        if outstanding.is_empty() {
            let _ = self.pending.remove(request_id);
        }
        Some(asked)
    }

    /// Forget every outstanding question.
    ///
    /// Called when the connection ends: those answers are not coming, and an
    /// entry that outlives its connection would attribute a later card to a
    /// question nobody is waiting on. The **cache** deliberately survives - it
    /// is the client's own copy, and re-asking for it on every reconnect is the
    /// behaviour this module exists to remove.
    pub fn forget_pending(&mut self) {
        self.pending.clear();
    }
}

/// [`TTL`] in milliseconds.
fn ttl_ms() -> u64 {
    u64::try_from(TTL.as_millis()).unwrap_or(u64::MAX)
}

/// Milliseconds since the epoch.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// Lowercase the scheme and host, drop the fragment, leave everything else
/// byte-for-byte.
///
/// The same timid rule the server's cache uses, and for the same reason: these
/// are the only two rewrites that cannot change which document is meant, and a
/// wrong hit is a card for a page nobody linked. The cost of a miss is a
/// request the client was making anyway.
fn normalise(url: &str) -> String {
    /// What separates a scheme from the authority that follows it.
    const SEPARATOR: &str = "://";

    let without_fragment = url.split_once('#').map_or(url, |(head, _)| head);
    let trimmed = without_fragment.trim();
    let Some((scheme, after_scheme)) = trimmed.split_once(SEPARATOR) else {
        return trimmed.to_owned();
    };
    // The authority runs to the first `/` or `?`: a URL with a query and no
    // path would otherwise have its query lowercased, and a query is often an
    // identifier.
    let authority_end = after_scheme.find(['/', '?']).unwrap_or(after_scheme.len());
    let (authority, tail) = after_scheme.split_at(authority_end);
    let mut out = String::with_capacity(trimmed.len());
    out.push_str(&scheme.to_lowercase());
    out.push_str(SEPARATOR);
    out.push_str(&authority.to_lowercase());
    out.push_str(tail);
    out
}

/// Encrypt plaintext with AES-256-GCM. Output: `[12-byte nonce][ciphertext+tag]`.
fn encrypt(key: &LessSafeKey, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| "RNG failed".to_string())?;

    let mut in_out = plaintext.to_vec();
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    key.seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| "AES-GCM seal failed".to_string())?;

    let mut result = Vec::with_capacity(NONCE_LEN + in_out.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&in_out);
    Ok(result)
}

/// Decrypt data produced by [`encrypt`]. Expects `[12-byte nonce][ciphertext+tag]`.
fn decrypt(key: &LessSafeKey, data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < NONCE_LEN {
        return Err("cache file too short".to_string());
    }
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let mut nonce_array = [0u8; NONCE_LEN];
    nonce_array.copy_from_slice(nonce_bytes);
    let nonce = Nonce::assume_unique_for_key(nonce_array);
    let mut in_out = ciphertext.to_vec();
    let plaintext = key
        .open_in_place(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| "AES-GCM open failed".to_string())?;
    Ok(plaintext.to_vec())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    fn embed(url: &str) -> LinkEmbed {
        LinkEmbed {
            url: Some(url.to_owned()),
            title: Some("A page".to_owned()),
            ..LinkEmbed::default()
        }
    }

    #[test]
    fn a_stored_card_is_found_by_the_url_that_was_asked_for() {
        let mut cache = PreviewCache::in_memory();
        cache.insert("https://example.com/a", &embed("https://example.com/a"), 0);
        let hit = cache.get("https://example.com/a", 1_000).unwrap();
        assert_eq!(hit.title.as_deref(), Some("A page"));
    }

    #[test]
    fn a_redirect_is_found_under_both_spellings() {
        // The failure this rules out: a card filed only under where it landed
        // is never found again, because the only string a client looks up is
        // the one in the message text.
        let mut cache = PreviewCache::in_memory();
        cache.insert("https://t.co/abc", &embed("https://example.com/real"), 0);
        assert!(cache.get("https://t.co/abc", 0).is_some(), "as asked");
        assert!(
            cache.get("https://example.com/real", 0).is_some(),
            "and as it landed, which somebody may paste directly"
        );
    }

    #[test]
    fn a_card_stops_being_drawn_once_its_day_is_up() {
        let mut cache = PreviewCache::in_memory();
        cache.insert("https://example.com/a", &embed("https://example.com/a"), 0);
        assert!(cache.get("https://example.com/a", ttl_ms() - 1).is_some());
        assert!(cache.get("https://example.com/a", ttl_ms()).is_none());
    }

    #[test]
    fn the_host_case_and_the_fragment_are_not_part_of_the_question() {
        let mut cache = PreviewCache::in_memory();
        cache.insert("https://Example.COM/a", &embed("https://Example.COM/a"), 0);
        assert!(cache.get("https://example.com/a#section", 0).is_some());
    }

    #[test]
    fn the_path_and_the_query_are() {
        let mut cache = PreviewCache::in_memory();
        cache.insert("https://example.com/A", &embed("https://example.com/A"), 0);
        assert!(cache.get("https://example.com/a", 0).is_none());
        cache.insert(
            "https://example.com/w?v=one",
            &embed("https://example.com/w?v=one"),
            0,
        );
        assert!(cache.get("https://example.com/w?v=two", 0).is_none());
    }

    #[test]
    fn the_oldest_card_goes_when_the_cache_is_full() {
        let mut cache = PreviewCache::in_memory();
        for at in 0..=MAX_ENTRIES {
            let url = format!("https://example.com/{at}");
            cache.insert(&url, &embed(&url), at as u64);
        }
        assert!(cache.len() <= MAX_ENTRIES);
        assert!(
            cache.get("https://example.com/0", 1).is_none(),
            "and it is the oldest that went"
        );
    }

    #[test]
    fn a_saved_cache_comes_back_with_its_cards() {
        let dir = std::env::temp_dir().join(format!("preview-cache-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let seed = [7u8; 32];

        let mut writing = PreviewCache::in_memory();
        writing.attach(&dir, &seed).unwrap();
        writing.insert(
            "https://example.com/a",
            &embed("https://example.com/a"),
            now_ms(),
        );
        writing.save().unwrap();

        let mut reading = PreviewCache::in_memory();
        reading.attach(&dir, &seed).unwrap();
        assert!(
            reading.get("https://example.com/a", now_ms()).is_some(),
            "the cards survive a restart, which is the whole point"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cache_written_under_another_seed_is_not_readable() {
        let dir = std::env::temp_dir().join(format!("preview-seed-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let mut writing = PreviewCache::in_memory();
        writing.attach(&dir, &[7u8; 32]).unwrap();
        writing.insert(
            "https://example.com/a",
            &embed("https://example.com/a"),
            now_ms(),
        );
        writing.save().unwrap();

        let mut reading = PreviewCache::in_memory();
        assert!(
            reading.attach(&dir, &[9u8; 32]).is_err(),
            "the URLs somebody has read are as revealing as the history"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_in_memory_cache_saves_and_loads_without_complaining() {
        // A client with no identity seed still gets the within-session half.
        let mut cache = PreviewCache::in_memory();
        cache.insert("https://example.com/a", &embed("https://example.com/a"), 0);
        assert!(cache.save().is_ok());
        assert!(cache.load().is_ok());
        assert!(cache.get("https://example.com/a", 0).is_some());
    }
}
