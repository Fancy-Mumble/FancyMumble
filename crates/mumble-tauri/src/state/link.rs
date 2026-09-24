//! Linking a device: moving this account onto another device with a code.
//!
//! # The flow
//!
//! On the device already signed in, [`AppState::begin_device_link`] makes a
//! random code and derives three things from it: a device id and secret, and
//! a key. It registers the device (`ADD_DEVICE`) and leaves the identity - the
//! certificate, its key, the chat seed, and the password if one is saved -
//! sealed under the key in the account's records at `link/<device id>`. The
//! code is then shown as a `fancy://link/...` link and a QR code.
//!
//! On the new device, [`AppState::start_device_link`] reads the link, and the
//! next login to that server presents the derived id and secret. Starling
//! admits a device registered ahead on its first login with nothing else (see
//! its `devices.rs`), which is the only way in for a device that has no
//! certificate yet. [`AppState::finish_device_link`] then opens the parcel,
//! stores the identity, and deletes the parcel; the frontend reconnects with
//! the identity it now has.
//!
//! # What the server sees
//!
//! The id and the secret, which it needs, and the sealed parcel, which it
//! cannot open: the key is derived from the code under a different tag and
//! never leaves the two devices. The code is as good as the account for the
//! ten minutes the server honours it, which is why it is shown only on the
//! owner's own screen and withdrawn when the panel closes.
//!
//! The new device keeps the linked id for this server from then on (see
//! [`super::device::remember_link`]), so it stays the device its owner's list
//! already shows rather than turning up a second time under an id of its own.

use std::sync::Mutex;

use base64::Engine as _;
use ring::aead::{AES_256_GCM, Aad, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use sha2::{Digest as _, Sha256};

use super::AppState;
use super::pchat::IdentityStore;

/// How many random bytes a code carries: 128 bits, 26 characters of base32.
const CODE_BYTES: usize = 16;

/// Bound into every seal, so a parcel is only ever opened as one.
const AAD: &[u8] = b"fancy-device-link-v1";

/// Where a parcel waits in the account's records.
fn parcel_key(device_id: &str) -> String {
    format!("link/{device_id}")
}

/// A link, read.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub(crate) struct LinkTarget {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(skip)]
    code: [u8; CODE_BYTES],
}

/// What the device already signed in shows its owner.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkOffer {
    /// `fancy://link/<code>?server=<host:port>&user=<name>`, for the QR code.
    pub link: String,
    /// The code alone, grouped for reading aloud or typing.
    pub code: String,
    /// Which device row this link will become, to withdraw it.
    pub device_id: String,
}

/// What the new device ends up holding.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedIdentity {
    /// The identity label it was stored under.
    pub label: String,
    /// The account's password, when the other device had it saved.
    pub password: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
}

/// The id, secret and key a code stands for.
struct Derived {
    device_id: String,
    secret: String,
    key: [u8; 32],
}

fn derive(code: &[u8; CODE_BYTES]) -> Derived {
    let tagged = |tag: &str| {
        let mut hasher = Sha256::new();
        hasher.update(tag.as_bytes());
        hasher.update([0]);
        hasher.update(code);
        let digest: [u8; 32] = hasher.finalize().into();
        digest
    };
    let mut device_id = fancy_utils::hex::bytes_to_hex(&tagged("fancy-link-id-v1"));
    device_id.truncate(32);
    Derived {
        device_id,
        secret: fancy_utils::hex::bytes_to_hex(&tagged("fancy-link-secret-v1")),
        key: tagged("fancy-link-key-v1"),
    }
}

const BASE32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// The code as the owner reads it: base32 in groups of four.
fn code_text(code: &[u8; CODE_BYTES]) -> String {
    let mut symbols = String::new();
    let (mut buffer, mut bits) = (0_u32, 0_u32);
    for byte in code {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            symbols.push(char::from(BASE32[((buffer >> bits) & 31) as usize]));
        }
    }
    if bits > 0 {
        symbols.push(char::from(BASE32[((buffer << (5 - bits)) & 31) as usize]));
    }
    symbols
        .as_bytes()
        .chunks(4)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect::<Vec<_>>()
        .join("-")
}

/// A typed or pasted code back to its bytes. Case, dashes and spaces are
/// forgiven, and so are the letters people read for digits.
fn parse_code(text: &str) -> Option<[u8; CODE_BYTES]> {
    let mut out = Vec::with_capacity(CODE_BYTES);
    let (mut buffer, mut bits) = (0_u32, 0_u32);
    for c in text.chars().filter(|c| !matches!(c, '-' | ' ')) {
        let c = match c.to_ascii_uppercase() {
            '0' => 'O',
            '1' => 'I',
            '8' => 'B',
            other => other,
        };
        let value = BASE32.iter().position(|&s| char::from(s) == c)? as u32;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    <[u8; CODE_BYTES]>::try_from(out.as_slice()).ok()
}

/// The `fancy://link/...` link for a code.
fn link_for(host: &str, port: u16, username: &str, code: &[u8; CODE_BYTES]) -> String {
    let server = if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("server", &server)
        .append_pair("user", username)
        .finish();
    format!("fancy://link/{}?{query}", code_text(code))
}

/// Read a link, accepting both the ways URL parsers split `fancy://link/<code>`.
pub(crate) fn parse_link(link: &str) -> Result<LinkTarget, String> {
    let url = url::Url::parse(link.trim()).map_err(|_| "that is not a link".to_owned())?;
    if url.scheme() != "fancy" {
        return Err("that is not a Fancy Mumble link".to_owned());
    }
    let segments: Vec<&str> = url
        .host_str()
        .into_iter()
        .chain(url.path().split('/'))
        .filter(|s| !s.is_empty())
        .collect();
    let (Some(&"link"), Some(code)) = (segments.first(), segments.get(1)) else {
        return Err("that is not a device link".to_owned());
    };
    let code = parse_code(code).ok_or("the code in that link is damaged")?;
    let query = |name: &str| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
            .unwrap_or_default()
    };
    let (host, port) = split_server(&query("server")).ok_or("the link names no server")?;
    let username = query("user");
    if username.trim().is_empty() {
        return Err("the link names no account".to_owned());
    }
    Ok(LinkTarget {
        host,
        port,
        username,
        code,
    })
}

/// `host:port` or `[v6]:port` into its parts. The port is required: a link
/// is made by a client that knew exactly where it was connected.
fn split_server(server: &str) -> Option<(String, u16)> {
    let server = server.trim();
    let (host, port) = match server.strip_prefix('[') {
        Some(rest) => rest.split_once("]:")?,
        None => server.rsplit_once(':')?,
    };
    if host.is_empty() {
        return None;
    }
    Some((host.to_owned(), port.parse().ok()?))
}

fn seal(key: &[u8; 32], plaintext: &[u8]) -> Result<String, String> {
    let sealing = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, key).map_err(|_| "could not use the link key".to_owned())?,
    );
    // One key per code and one parcel per key, so a random nonce is never
    // reused under a key.
    let nonce_bytes: [u8; NONCE_LEN] = rand::random();
    let mut data = plaintext.to_vec();
    sealing
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(AAD),
            &mut data,
        )
        .map_err(|_| "could not seal the identity".to_owned())?;
    let mut out = nonce_bytes.to_vec();
    out.extend_from_slice(&data);
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

fn open(key: &[u8; 32], sealed: &str) -> Result<Vec<u8>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(sealed.trim())
        .map_err(|_| "the parcel is damaged".to_owned())?;
    if bytes.len() < NONCE_LEN {
        return Err("the parcel is damaged".to_owned());
    }
    let (nonce, data) = bytes.split_at(NONCE_LEN);
    let nonce: [u8; NONCE_LEN] = nonce.try_into().map_err(|_| "the parcel is damaged")?;
    let opening = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, key).map_err(|_| "could not use the link key".to_owned())?,
    );
    let mut data = data.to_vec();
    let plain = opening
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(AAD),
            &mut data,
        )
        .map_err(|_| "the code does not open this parcel".to_owned())?;
    Ok(plain.to_vec())
}

/// The parcel's contents.
#[derive(serde::Serialize, serde::Deserialize)]
struct Parcel {
    identity: serde_json::Map<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password: Option<String>,
}

/// A label for the linked identity that no identity on this device has yet.
///
/// Never the label it had on the other device: `default` there is quite
/// likely `default` here as well, and importing over it would replace this
/// device's own identity with no way back.
fn fresh_label(store: &IdentityStore, username: &str, host: &str) -> String {
    let base: String = format!("{username}@{host}")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .take(56)
        .collect();
    let taken = |label: &str| store.identity_dir(label).exists();
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|label| !taken(label))
        .unwrap_or(base)
}

/// The link the new device is completing, between reading it and opening the
/// parcel. One at a time: a second link read before the first finished
/// replaces it.
static PENDING: Mutex<Option<LinkTarget>> = Mutex::new(None);

impl AppState {
    /// Offer this account to a new device: register it, leave it the sealed
    /// identity, and hand back the link to show.
    ///
    /// `password` is the account's password when this device has it saved;
    /// it travels in the parcel so the new device can sign in as this one
    /// does. The acknowledgement of the registration arrives as an ordinary
    /// `account-ack`.
    ///
    /// # Errors
    ///
    /// When not connected, when this session has no identity to copy, or
    /// when the parcel could not be stored.
    pub async fn begin_device_link(&self, password: Option<String>) -> Result<LinkOffer, String> {
        let (host, port, username, label) = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            (
                state.server.host.clone(),
                state.server.port,
                state.conn.own_name.clone(),
                state.cert_label.clone(),
            )
        };
        let label = label.ok_or("this connection has no identity to copy to another device")?;
        let app = self.app_handle().ok_or("App not initialized")?;
        let store = IdentityStore::new(crate::e2e_data_dir(&app)?);
        let parcel = Parcel {
            identity: store.export_bundle(&label)?,
            password: password.filter(|p| !p.is_empty()),
        };
        let plaintext = serde_json::to_vec(&parcel).map_err(|e| e.to_string())?;

        let code: [u8; CODE_BYTES] = rand::random();
        let derived = derive(&code);
        let sealed = seal(&derived.key, &plaintext)?;

        self.update_account_settings(
            "add_device".to_owned(),
            Some("New device".to_owned()),
            None,
            Some(derived.device_id.clone()),
            Some(derived.secret),
        )
        .await?;
        let _ = self
            .record_put(parcel_key(&derived.device_id), sealed)
            .await?;

        Ok(LinkOffer {
            link: link_for(&host, port, &username, &code),
            code: code_text(&code),
            device_id: derived.device_id,
        })
    }

    /// Withdraw a link nobody completed: the parcel goes, and so does the
    /// device it would have become.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn cancel_device_link(&self, device_id: String) -> Result<(), String> {
        let removed = self.record_remove(parcel_key(&device_id)).await;
        self.update_account_settings(
            "remove_device".to_owned(),
            None,
            None,
            Some(device_id),
            None,
        )
        .await?;
        removed.map(|_| ())
    }

    /// Read a link on the new device, and log in as the device it names from
    /// the next connect to its server on.
    ///
    /// # Errors
    ///
    /// When the link cannot be read, or the app data directory is missing.
    pub fn start_device_link(&self, link: String) -> Result<LinkTarget, String> {
        let target = parse_link(&link)?;
        let derived = derive(&target.code);
        let app = self.app_handle().ok_or("App not initialized")?;
        super::device::remember_link(
            &crate::e2e_data_dir(&app)?,
            &target.host,
            target.port,
            &derived.device_id,
            &derived.secret,
        )?;
        if let Ok(mut pending) = PENDING.lock() {
            *pending = Some(target.clone());
        }
        Ok(target)
    }

    /// Open the parcel on the new device, now signed in as the linked device,
    /// and store the identity in it.
    ///
    /// # Errors
    ///
    /// When no link is in progress, the parcel is missing or will not open,
    /// or the identity could not be written.
    pub async fn finish_device_link(&self) -> Result<LinkedIdentity, String> {
        let target = PENDING
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("no device link is in progress")?;
        let derived = derive(&target.code);
        let stored = self.record_get(parcel_key(&derived.device_id)).await?;
        let sealed = stored
            .value
            .filter(|_| stored.found)
            .ok_or("the other device has withdrawn this link, or it has expired")?;
        let parcel: Parcel = serde_json::from_slice(&open(&derived.key, &sealed)?)
            .map_err(|_| "the parcel is damaged".to_owned())?;

        let app = self.app_handle().ok_or("App not initialized")?;
        let store = IdentityStore::new(crate::e2e_data_dir(&app)?);
        let label = fresh_label(&store, &target.username, &target.host);
        store.import_bundle(&parcel.identity, &label)?;
        // Used once. Left behind, it would be a copy of the identity waiting
        // in the account for anyone who ever saw the code.
        let _ = self.record_remove(parcel_key(&derived.device_id)).await;
        if let Ok(mut pending) = PENDING.lock() {
            *pending = None;
        }
        Ok(LinkedIdentity {
            label,
            password: parcel.password,
            host: target.host,
            port: target.port,
            username: target.username,
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]

    use super::*;

    const CODE: [u8; CODE_BYTES] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

    #[test]
    fn a_code_reads_back_however_it_was_typed() {
        let text = code_text(&CODE);
        assert_eq!(parse_code(&text), Some(CODE));
        assert_eq!(
            parse_code(&text.to_lowercase().replace('-', " ")),
            Some(CODE)
        );
        assert_eq!(parse_code("not a code"), None);
        assert_eq!(parse_code(&text[..10]), None, "a truncated code is refused");
    }

    #[test]
    fn a_link_round_trips_including_an_ipv6_server() {
        for host in ["voice.example.org", "::1"] {
            let link = link_for(host, 64738, "Ada Lovelace", &CODE);
            let target = parse_link(&link).unwrap();
            assert_eq!(target.host, host);
            assert_eq!(target.port, 64738);
            assert_eq!(target.username, "Ada Lovelace");
            assert_eq!(target.code, CODE);
        }
        assert!(parse_link("fancy://invite/abc?server=a:1").is_err());
        assert!(parse_link("https://example.org").is_err());
    }

    #[test]
    fn the_server_learns_the_id_and_secret_and_not_the_key() {
        let derived = derive(&CODE);
        assert_eq!(derived.device_id.len(), 32);
        assert_eq!(derived.secret.len(), 64);
        assert!(
            !derived
                .secret
                .contains(&fancy_utils::hex::bytes_to_hex(&derived.key))
        );
        assert_ne!(derive(&[0; CODE_BYTES]).device_id, derived.device_id);
    }

    #[test]
    fn a_parcel_opens_with_its_code_and_nothing_else() {
        let key = derive(&CODE).key;
        let sealed = seal(&key, b"identity").unwrap();
        assert_eq!(open(&key, &sealed).unwrap(), b"identity");
        assert!(open(&derive(&[9; CODE_BYTES]).key, &sealed).is_err());
    }

    #[test]
    fn a_linked_identity_never_lands_on_one_already_here() {
        let dir = tempfile::tempdir().unwrap();
        let store = IdentityStore::new(dir.path().to_path_buf());
        let first = fresh_label(&store, "ada", "voice.example.org");
        // `@` is not a label character (`validate_cert_label`), so it is replaced.
        assert_eq!(first, "ada_voice.example.org");
        std::fs::create_dir_all(store.identity_dir(&first)).unwrap();
        assert_eq!(
            fresh_label(&store, "ada", "voice.example.org"),
            "ada_voice.example.org-2"
        );
        assert_eq!(fresh_label(&store, "a d/a", "h"), "a_d_a_h");
    }
}
