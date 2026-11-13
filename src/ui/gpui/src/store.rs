//! What the view itself remembers between runs: the saved servers and the
//! chosen theme. Small JSON files in the data directory.
//!
//! The engine has no notion of a saved server - in the web UI they live in
//! the view's storage too - so this is the view's to keep.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::engine::{SavedServer, VoiceSettings};

/// One saved identity, as it is written to disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StoredServer {
    id: String,
    label: String,
    host: String,
    port: u16,
    username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    certificate: Option<String>,
    #[serde(default)]
    favorite: bool,
}

impl From<&SavedServer> for StoredServer {
    fn from(server: &SavedServer) -> Self {
        Self {
            id: server.id.to_string(),
            label: server.label.to_string(),
            host: server.host.to_string(),
            port: server.port,
            username: server.username.to_string(),
            certificate: server.certificate.as_ref().map(ToString::to_string),
            favorite: server.favorite,
        }
    }
}

impl From<StoredServer> for SavedServer {
    fn from(server: StoredServer) -> Self {
        Self {
            id: server.id.into(),
            label: server.label.into(),
            host: server.host.into(),
            port: server.port,
            username: server.username.into(),
            certificate: server.certificate.map(Into::into),
            favorite: server.favorite,
        }
    }
}

/// The view's settings.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Settings {
    /// The theme's catalogue id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    /// `light` or `dark`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// The chosen microphone; absent for the system's default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_device: Option<String>,
    /// The chosen speaker; absent for the system's default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_device: Option<String>,
    /// How the microphone is used; absent until it has been changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<VoiceSettings>,
    /// The push-to-talk key, as GPUI names it (`f9`, `space`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push_to_talk_key: Option<String>,
    /// The key held to whisper, named the same way.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whisper_key: Option<String>,
    /// The saved identity to connect as at launch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_connect: Option<String>,
    /// The people kept as friends.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub friends: Vec<Friend>,
}

/// Somebody kept as a friend: their certificate's hash, and what was known
/// of them when they were added.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Friend {
    pub hash: String,
    /// The name they had.
    pub name: String,
    /// What the server they were on is called.
    #[serde(default)]
    pub server: String,
}

/// The files, in one directory.
#[derive(Debug, Clone)]
pub(crate) struct Store {
    dir: PathBuf,
}

impl Store {
    /// A store keeping its files in `dir`, which is created when first
    /// written to.
    pub(crate) fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// The saved servers; none if the file is missing or unreadable.
    pub(crate) fn servers(&self) -> Vec<SavedServer> {
        read::<Vec<StoredServer>>(&self.dir.join("servers.json"))
            .unwrap_or_default()
            .into_iter()
            .map(Into::into)
            .collect()
    }

    /// Replace the saved servers.
    ///
    /// # Errors
    ///
    /// When the file cannot be written.
    pub(crate) fn save_servers(&self, servers: &[SavedServer]) -> std::io::Result<()> {
        let stored: Vec<StoredServer> = servers.iter().map(Into::into).collect();
        write(&self.dir, "servers.json", &stored)
    }

    /// The settings; the defaults if the file is missing or unreadable.
    pub(crate) fn settings(&self) -> Settings {
        read(&self.dir.join("view.json")).unwrap_or_default()
    }

    /// Replace the settings.
    ///
    /// # Errors
    ///
    /// When the file cannot be written.
    pub(crate) fn save_settings(&self, settings: &Settings) -> std::io::Result<()> {
        write(&self.dir, "view.json", settings)
    }
}

fn read<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Write `value` to `dir/name` by way of a temporary file, so a crash
/// mid-write leaves the old file rather than half of the new one.
fn write<T: Serialize>(dir: &Path, name: &str, value: &T) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(value).map_err(std::io::Error::other)?;
    let partial = dir.join(format!("{name}.partial"));
    std::fs::write(&partial, text)?;
    std::fs::rename(partial, dir.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("fancy-gpui-store-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn server(id: &str, certificate: Option<&str>) -> SavedServer {
        SavedServer {
            id: id.to_owned().into(),
            label: "Home".into(),
            host: "example.org".into(),
            port: 64738,
            username: "Alex".into(),
            certificate: certificate.map(|label| label.to_owned().into()),
            favorite: true,
        }
    }

    #[test]
    fn servers_come_back_as_they_were_saved() {
        let dir = scratch("servers");
        let store = Store::new(&dir);
        assert!(store.servers().is_empty(), "nothing saved yet");
        store
            .save_servers(&[server("a", Some("alex")), server("b", None)])
            .expect("the directory is writable");
        let saved = Store::new(&dir).servers();
        assert_eq!(saved.len(), 2);
        assert_eq!(saved[0].id.as_ref(), "a");
        assert_eq!(
            saved[0].certificate.as_ref().map(AsRef::as_ref),
            Some("alex")
        );
        assert!(saved[0].favorite);
        assert_eq!(saved[1].certificate, None);
        assert!(!dir.join("servers.json.partial").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn settings_round_trip_and_a_damaged_file_reads_as_defaults() {
        let dir = scratch("settings");
        let store = Store::new(&dir);
        assert_eq!(store.settings(), Settings::default());
        let chosen = Settings {
            theme: Some("rose".to_owned()),
            mode: Some("light".to_owned()),
            input_device: None,
            output_device: Some("USB Headset".to_owned()),
            voice: Some(VoiceSettings {
                push_to_talk: true,
                threshold: 0.02,
                noise_suppression: false,
                automatic_gain: true,
                input_volume: 1.2,
                output_volume: 0.8,
                bitrate_bps: 40_000,
                voice_over_tcp: true,
            }),
            push_to_talk_key: Some("f9".to_owned()),
            whisper_key: Some("f10".to_owned()),
            auto_connect: None,
            friends: vec![Friend {
                hash: "abc".to_owned(),
                name: "Rin".to_owned(),
                server: "magical.rocks".to_owned(),
            }],
        };
        store
            .save_settings(&chosen)
            .expect("the directory is writable");
        assert_eq!(store.settings(), chosen);
        std::fs::write(dir.join("view.json"), "{ not json").expect("writable");
        assert_eq!(store.settings(), Settings::default());
        let _ = std::fs::remove_dir_all(dir);
    }
}
