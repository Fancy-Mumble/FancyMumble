//! Which install of the client this is, as a server is told at login.
//!
//! Starling lets one account be online from several devices at once, and tells
//! them apart by a device id and secret sent in `Authenticate` (fork fields
//! 1001-1003). The same id reconnecting replaces its own ghost; a different one
//! is another device and stays. The owner sees each in their device list and
//! can sign any of them out.
//!
//! # One key per install, one device per server
//!
//! The install holds a single random key, `device.key` in the app data
//! directory, and derives a *different* id and secret for every server from
//! it. The same id everywhere would let servers that compare notes follow one
//! install between them. The same secret everywhere would be worse: a known
//! device stands in for the second factor on Starling, so any operator could
//! replay the secret this install sent them to skip that factor on another
//! server where the same account lives.
//!
//! The key is per install, not per identity: a linked device copies the
//! certificate and the chat seed, which is the person, and keeps its own key,
//! which is the device.

use std::path::Path;

use sha2::{Digest as _, Sha256};

/// Where the install's key lives, under the app data directory.
const KEY_FILE: &str = "device.key";

/// What the client says at login about the device it is running on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeviceCredentials {
    /// Stable for this install and this server, meaningless anywhere else.
    pub id: String,
    /// Proves the id was not copied off another session.
    pub secret: String,
    /// What the owner sees in their device list.
    pub name: String,
}

/// The credentials for `host:port`, creating the install's key on first use.
///
/// `None` only when the key can neither be read nor written, in which case
/// the client logs in the way it always did, as no device in particular.
pub(crate) fn credentials_for(data_dir: &Path, host: &str, port: u16) -> Option<DeviceCredentials> {
    let key = load_or_generate_key(data_dir)
        .inspect_err(|e| tracing::warn!("no device key, logging in without one: {e}"))
        .ok()?;
    Some(derive(&key, host, port))
}

/// The id and secret `key` gives for `host:port`.
///
/// The host is lower-cased so `Example.org` and `example.org` are one device,
/// and nothing else is normalised: an address and a name for the same server
/// are two devices to it, which costs a second entry in the owner's list and
/// nothing more.
pub(crate) fn derive(key: &[u8; 32], host: &str, port: u16) -> DeviceCredentials {
    let target = format!("{}:{port}", host.trim().to_ascii_lowercase());
    let tagged = |tag: &str| {
        let mut hasher = Sha256::new();
        hasher.update(tag.as_bytes());
        hasher.update([0]);
        hasher.update(key);
        hasher.update(target.as_bytes());
        fancy_utils::hex::bytes_to_hex(&hasher.finalize())
    };
    let mut id = tagged("fancy-device-id-v1");
    id.truncate(32);
    DeviceCredentials {
        id,
        secret: tagged("fancy-device-secret-v1"),
        name: device_name(),
    }
}

/// This install's key, generated from the OS generator the first time.
fn load_or_generate_key(data_dir: &Path) -> Result<[u8; 32], String> {
    let path = data_dir.join(KEY_FILE);
    if let Ok(data) = std::fs::read(&path)
        && let Ok(key) = <[u8; 32]>::try_from(data.as_slice())
    {
        return Ok(key);
    }
    let key: [u8; 32] = rand::random();
    std::fs::create_dir_all(data_dir).map_err(|e| format!("create {}: {e}", data_dir.display()))?;
    std::fs::write(&path, key).map_err(|e| format!("write {}: {e}", path.display()))?;
    tracing::info!("generated this install's device key");
    Ok(key)
}

/// A name the owner will recognise, e.g. `Windows (DESKTOP-4F2)`.
///
/// The operating system always, the machine's name where the platform will
/// say it. The owner can rename it from their device list, and that name wins.
fn device_name() -> String {
    let os = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        "android" => "Android",
        "ios" => "iOS",
        other => other,
    };
    let host = ["COMPUTERNAME", "HOSTNAME"]
        .iter()
        .find_map(|var| std::env::var(var).ok())
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty());
    match host {
        Some(host) => format!("{os} ({host})"),
        None => os.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_install_is_a_different_device_to_every_server() {
        let key = [7_u8; 32];
        let here = derive(&key, "voice.example.org", 64738);
        let there = derive(&key, "other.example.org", 64738);
        assert_ne!(here.id, there.id);
        assert_ne!(
            here.secret, there.secret,
            "a secret shown to one server must not open another"
        );
        assert_eq!(here, derive(&key, "Voice.Example.org ", 64738));
        assert_ne!(here.id, derive(&key, "voice.example.org", 64739).id);
    }

    #[test]
    fn two_installs_are_two_devices_on_one_server() {
        assert_ne!(derive(&[1; 32], "a", 1).id, derive(&[2; 32], "a", 1).id);
    }

    #[test]
    fn the_shape_is_one_the_server_accepts() {
        // Starling takes ids of up to 64 of [A-Za-z0-9_-] and secrets of 32 to
        // 256 characters; anything else is treated as no device at all.
        let device = derive(&[9; 32], "a", 1);
        assert_eq!(device.id.len(), 32);
        assert!(device.id.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(device.secret.len(), 64);
    }

    #[test]
    fn the_key_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("fancy-device-key-{}", rand::random::<u64>()));
        let first = load_or_generate_key(&dir).expect("generated");
        let again = load_or_generate_key(&dir).expect("read back");
        assert_eq!(first, again);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
