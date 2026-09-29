//! The signal-bridge add-on: fetching the AGPL bridge library on demand.
//!
//! Installers do not carry the bridge, for the same licence boundary the
//! Flatpak extension and the AUR split package draw. A user who needs a
//! `SignalV1` channel downloads it from the GitHub release the client was
//! built against (tag `signal-bridge-v<version>`), and it lands in
//! `<app data>/addons/signal-bridge/<version>/`, where the loader looks.
//!
//! The library is loaded into this process, so nothing is written to disk
//! before its minisign signature checks out against the updater's public
//! key: the same key, and the same check, that guards the app's own updates.

use std::path::Path;

use futures_util::StreamExt;

use super::signal_bridge::LIB_NAME;

/// Where the release assets are published.
const RELEASES_URL: &str = "https://github.com/Fancy-Mumble/FancyMumble/releases/download";

/// Refuse anything bigger: the bridge is a few MB, and a response that keeps
/// going is not one.
const MAX_ASSET_BYTES: u64 = 64 * 1024 * 1024;

/// The bridge version this client was built against (see build.rs).
pub(crate) const VERSION: &str = env!("SIGNAL_BRIDGE_VERSION");

/// The release asset for this platform, `None` where no build is published.
pub(crate) fn asset_name() -> Option<&'static str> {
    if VERSION.is_empty() {
        return None;
    }
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("signal_bridge-windows-x86_64.dll"),
        ("linux", "x86_64") => Some("libsignal_bridge-linux-x86_64.so"),
        ("macos", "aarch64") => Some("libsignal_bridge-macos-aarch64.dylib"),
        _ => None,
    }
}

fn asset_url(asset: &str) -> String {
    format!("{RELEASES_URL}/signal-bridge-v{VERSION}/{asset}")
}

/// Download, verify and install the bridge into `dir`.
///
/// `pubkey` is the updater's base64-wrapped minisign public key, as it sits
/// in `tauri.conf.json`. `on_progress` gets `(received, total)` per chunk.
pub(crate) async fn install(
    dir: &Path,
    pubkey: &str,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    let asset = asset_name().ok_or("no signal bridge download for this platform")?;
    let url = asset_url(asset);
    let client = reqwest::Client::builder()
        .user_agent(concat!("FancyMumble/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("could not create HTTP client: {e}"))?;

    let signature = client
        .get(format!("{url}.sig"))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| format!("could not fetch the signature: {e}"))?
        .text()
        .await
        .map_err(|e| format!("could not read the signature: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| format!("could not download the signal bridge: {e}"))?;
    let total = response.content_length();
    if total.is_some_and(|t| t > MAX_ASSET_BYTES) {
        return Err("the signal bridge download is unexpectedly large".into());
    }

    let mut data = Vec::with_capacity(usize::try_from(total.unwrap_or(0)).unwrap_or(0));
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
        data.extend_from_slice(&chunk);
        if data.len() as u64 > MAX_ASSET_BYTES {
            return Err("the signal bridge download is unexpectedly large".into());
        }
        on_progress(data.len() as u64, total);
    }

    verify_signature(&data, &signature, pubkey)?;
    write_library(dir, &data).map_err(|e| format!("could not install the signal bridge: {e}"))?;
    remove_other_versions(dir);
    Ok(())
}

/// Check `data` against a Tauri-style signature: both the key and the
/// signature are minisign text, base64-wrapped once more. Mirrors what
/// `tauri-plugin-updater` does with an update package.
fn verify_signature(data: &[u8], signature: &str, pubkey: &str) -> Result<(), String> {
    use base64::Engine;
    use minisign_verify::{PublicKey, Signature};

    let unwrap = |b64: &str| -> Result<String, String> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("malformed base64: {e}"))?;
        String::from_utf8(bytes).map_err(|e| format!("malformed text: {e}"))
    };
    let key = PublicKey::decode(&unwrap(pubkey)?).map_err(|e| format!("bad public key: {e}"))?;
    let sig = Signature::decode(&unwrap(signature)?)
        .map_err(|e| format!("bad signature on the signal bridge download: {e}"))?;
    key.verify(data, &sig, true)
        .map_err(|e| format!("the signal bridge download failed verification: {e}"))
}

/// Write via a temporary file and a rename, so a crash mid-write never
/// leaves a truncated library where the loader will find it.
fn write_library(dir: &Path, data: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let part = dir.join(format!("{LIB_NAME}.part"));
    std::fs::write(&part, data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755))?;
    }
    std::fs::rename(&part, dir.join(LIB_NAME))
}

/// Drop add-ons for other bridge versions. Best effort: on Windows one this
/// process has loaded cannot be deleted, and the next install retries it.
fn remove_other_versions(dir: &Path) {
    let (Some(parent), Some(own)) = (dir.parent(), dir.file_name()) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name() != own && entry.path().is_dir() {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A throwaway key made with `cargo tauri signer generate` (empty
    // password), and its signature over `SIGNED`, from `cargo tauri signer
    // sign`. Nothing is signed with it but this fixture.
    const TEST_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY4NUE4MjhCQUNFQkZEM0MKUldROC9ldXNpNEphYVBpSVlobW5oV3Yydm83eXFSTUdzRVd5aTNQMXNGSFZPTkJCYmROOExvMTMK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVROC9ldXNpNEphYUdOTDVYTDVNR21GWm9mbCtMa1c2UldYQTBtcC80WGlIRndyNnRUdHZlMWkyOFJrYnQ0VS9mdnhUVWlLbmE3dWhKenVNa1dqQUFCTVN0b2c2bkhEOGd3PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkwNzA0NzA2CWZpbGU6Zml4dHVyZS5iaW4Kc2E1NERDb3BvMDdmd0ZkTTlSeENGVUhJeXFBYnV4Z3loZWowL3UvZUdITnZCVG1hQ3ExVDB3N3hGTWxPelZRU3lyelFpMkhiWUczT0x5V2ZYNkZLQVE9PQo=";
    const SIGNED: &[u8] = b"signal bridge fixture\n";

    #[test]
    fn accepts_the_signed_bytes() {
        assert_eq!(
            verify_signature(SIGNED, TEST_SIGNATURE, TEST_PUBKEY),
            Ok(())
        );
    }

    #[test]
    fn rejects_tampered_bytes() {
        assert!(verify_signature(b"signal bridge fixturE\n", TEST_SIGNATURE, TEST_PUBKEY).is_err());
    }

    #[test]
    fn rejects_a_signature_from_another_key() {
        let updater_key = include_str!("../../../tauri.conf.json")
            .lines()
            .find_map(|l| l.trim().strip_prefix("\"pubkey\": \""))
            .and_then(|rest| rest.strip_suffix("\","))
            .expect("tauri.conf.json carries the updater pubkey");
        assert!(verify_signature(SIGNED, TEST_SIGNATURE, updater_key).is_err());
    }

    #[test]
    fn rejects_garbage_signatures() {
        assert!(verify_signature(SIGNED, "not base64!", TEST_PUBKEY).is_err());
        assert!(verify_signature(SIGNED, "", TEST_PUBKEY).is_err());
    }

    #[test]
    fn replaces_other_versions_but_keeps_its_own() {
        let root = std::env::temp_dir().join(format!("bridge-addon-{}", std::process::id()));
        let old = root.join("0.0.1");
        let own = root.join("0.1.0");
        std::fs::create_dir_all(&old).expect("mkdir old");
        write_library(&own, b"lib").expect("write");
        remove_other_versions(&own);
        assert!(!old.exists());
        assert_eq!(std::fs::read(own.join(LIB_NAME)).expect("read"), b"lib");
        assert!(!own.join(format!("{LIB_NAME}.part")).exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
