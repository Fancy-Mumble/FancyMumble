//! What the view itself remembers between runs: the saved servers and the
//! chosen theme. Small JSON files in the data directory.
//!
//! The engine has no notion of a saved server - in the web UI they live in
//! the view's storage too - so this is the view's to keep.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::engine::{SavedServer, VoiceSettings};

mod logs;
mod look;
mod reset;
mod shortcuts;
mod told;
mod walls;

pub(crate) use logs::{LOG_LEVELS, LogChoices};
pub(crate) use shortcuts::{Bindings, Bound, accelerator, gpui_keys};
pub(crate) use told::{Enabled, WelcomeDisplay, WelcomesSeen};
pub(crate) use look::{
    BubbleStyle, CHAT_BG_RECENTS_MAX, ChannelViewer, ChatBackground, Backgrounds, Look,
    ServerSwitcher, UserMode,
};

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
    /// Whether channels with nobody in them are left out of the column.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hide_empty: bool,
    /// Whether the member list leaves out the registered people who are
    /// not on.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hide_offline: bool,
    /// What is kept from others and from servers.
    #[serde(default, skip_serializing_if = "Privacy::is_default")]
    pub privacy: Privacy,
    /// The people kept as friends.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub friends: Vec<Friend>,
    /// Where the window was left.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<Placed>,
    /// Where each window beside the main one was left, by its name.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub asides: std::collections::BTreeMap<String, Placed>,
    /// How what is read is set: the size of message text, and the clock.
    #[serde(default, skip_serializing_if = "Format::is_default")]
    pub format: Format,
    /// The emoji used last, the newest first: what the picker opens on.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent_emoji: Vec<String>,
    /// A Klipy key of the user's own, for searching GIFs where the server
    /// has no GIF service: with it, Klipy learns what is searched for and
    /// the user's address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub klipy_key: Option<String>,
    /// The name a server is first joined under, set on the Profile page:
    /// the web UI's `defaultUsername`. Absent, a new server's form starts
    /// with no name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// The hosts whose links open without being asked about.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub trusted_hosts: Vec<String>,
    /// Whether the voice keys are bound with the system, to work while
    /// another program has the keyboard.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub global_keys: bool,
    /// Whether a lost connection is left lost, not tried again.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stay_disconnected: bool,
    /// Whether bringing the web client's servers over was declined: it is
    /// offered once, not at every launch.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub carry_declined: bool,
    /// How far the picture behind a conversation is washed out with the
    /// window's colour, from not at all to wholly; absent for the usual.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wall_wash: Option<f32>,
    /// How far that picture is blurred, in pixels; absent for sharp.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wall_blur: Option<u8>,
    /// The sounds that say something happened: whether, which, how loud.
    #[serde(default, skip_serializing_if = "crate::sounds::Sounds::is_usual")]
    pub sounds: crate::sounds::Sounds,
    /// How loud each person is played here, by the hash of their
    /// certificate, where that is not as they are sent.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub volumes: std::collections::BTreeMap<String, f32>,
    /// The language the view is in; absent for English.
    #[serde(default, skip_serializing_if = "crate::words::Language::is_english")]
    pub language: crate::words::Language,
    /// What the voice gate was last calibrated for: the microphone and the
    /// filters before the gate, as the Voice page fingerprints them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate_calibrated_for: Option<String>,
    /// How the noise suppressor is tuned, by knob; absent for as it comes.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub denoiser_knobs: std::collections::BTreeMap<String, f32>,
    /// How messages and the channel column are drawn.
    #[serde(default, flatten)]
    pub look: Look,
    /// Where the servers are listed.
    #[serde(default, skip_serializing_if = "is_default")]
    pub server_switcher: ServerSwitcher,
    /// How much of the client is offered.
    #[serde(default, skip_serializing_if = "is_default")]
    pub user_mode: UserMode,
    /// The pictures kept for behind the conversation, and which is.
    #[serde(default, flatten)]
    pub chat_backgrounds: Backgrounds,
    /// How far that picture is darkened, from not at all to black; absent
    /// for the usual.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_bg_dim: Option<f32>,
    /// The keys chosen for what the window does, where not the defaults.
    #[serde(default, skip_serializing_if = "Bindings::is_default")]
    pub shortcuts: Bindings,
    /// Whether the system's notifications are shown.
    #[serde(default, skip_serializing_if = "Enabled::is_on")]
    pub enable_notifications: Enabled,
    /// When the server's welcome message is shown.
    #[serde(default, skip_serializing_if = "is_default")]
    pub welcome_message_display: WelcomeDisplay,
    /// The welcome messages closed, for "once".
    #[serde(default, skip_serializing_if = "WelcomesSeen::is_empty")]
    pub welcome_seen: WelcomesSeen,
    /// Whether a message to an encrypted channel also goes out as a plain
    /// placeholder; off, as in the web client, until switched on.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub enable_dual_path: bool,
    /// How the log is kept.
    #[serde(default, flatten)]
    pub logs: LogChoices,
    /// Whether leaving a server is asked about first.
    #[serde(default, skip_serializing_if = "Enabled::is_on")]
    pub show_disconnect_warning: Enabled,
    /// Whether what identifies a server or a person's connection is kept
    /// off the screen, and the system's notifications with it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub streamer_mode: bool,
}


/// Whether `value` is its type's default: left out of the file.
fn is_default<T: Default + PartialEq>(value: &T) -> bool {
    *value == T::default()
}

/// Where the window is, and how large: its place when it does not fill the
/// screen, and whether it does.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub(crate) struct Placed {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub maximized: bool,
}

/// What the user keeps to themselves. Everything is told and asked until
/// it is switched off, so each field says what is withheld.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Privacy {
    /// Others are not told when the user is writing.
    #[serde(default)]
    pub hide_writing: bool,
    /// Others are not told what the user has read.
    #[serde(default)]
    pub hide_reading: bool,
    /// The server is not asked what lies behind a link.
    #[serde(default)]
    pub leave_links: bool,
}

/// How what is read is set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Format {
    /// How large message text is.
    #[serde(default)]
    pub text: TextSize,
    /// Which clock times are read on.
    #[serde(default)]
    pub hours: Hours,
    /// The size "large" stands for, in pixels, where it was set a pixel
    /// at a time; absent for the usual sixteen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size_custom_px: Option<u8>,
    /// Whether times are read on the local clock; on UTC where not.
    #[serde(default = "local_time", skip_serializing_if = "Clone::clone")]
    pub convert_to_local_time: bool,
    /// How dates are written.
    #[serde(default, skip_serializing_if = "is_default")]
    pub date_format: crate::formats::DateFormat,
    /// How numbers are written.
    #[serde(default, skip_serializing_if = "is_default")]
    pub number_format: crate::formats::NumberFormat,
}

impl Default for Format {
    fn default() -> Self {
        Self {
            text: TextSize::default(),
            hours: Hours::default(),
            font_size_custom_px: None,
            convert_to_local_time: local_time(),
            date_format: crate::formats::DateFormat::default(),
            number_format: crate::formats::NumberFormat::default(),
        }
    }
}

/// Times are read on the local clock until told otherwise.
const fn local_time() -> bool {
    true
}

impl Format {
    fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// The smallest and the largest size message text can be set in, a
    /// pixel at a time.
    pub(crate) const CUSTOM_PX: (u8, u8) = (10, 24);

    /// How large message text is set, in pixels: "large" is whatever size
    /// was set a pixel at a time, as the web client reads it.
    pub(crate) fn text_px(&self) -> f32 {
        match self.text {
            TextSize::Large => f32::from(self.custom_px()),
            size => size.px(),
        }
    }

    /// The size "large" stands for, in pixels.
    pub(crate) fn custom_px(&self) -> u8 {
        self.font_size_custom_px.unwrap_or(16)
    }

    /// How dates and numbers are written, as this says.
    pub(crate) fn formats(&self) -> crate::formats::Formats {
        crate::formats::Formats {
            date: self.date_format,
            number: self.number_format,
        }
    }
}

/// How large message text is set: the web UI's three sizes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TextSize {
    Small,
    #[default]
    Medium,
    Large,
}

impl TextSize {
    /// Every size, smallest first.
    pub(crate) const ALL: [Self; 3] = [Self::Small, Self::Medium, Self::Large];

    /// The size in pixels.
    pub(crate) const fn px(self) -> f32 {
        match self {
            Self::Small => 12.0,
            Self::Medium => 14.0,
            Self::Large => 16.0,
        }
    }
}

/// Which clock a time of day is read on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Hours {
    /// As the system has it, where it says (Windows' Region setting);
    /// elsewhere as the language writes times.
    #[default]
    Auto,
    /// Twelve hours, with which half of the day.
    Twelve,
    /// Twenty-four hours.
    TwentyFour,
}

impl Hours {
    /// Every choice, in the order they are offered.
    pub(crate) const ALL: [Self; 3] = [Self::Auto, Self::Twelve, Self::TwentyFour];

    /// The clock this choice comes to, where the system says it uses one
    /// (`system`, whether that is the 24-hour one) or else the language
    /// does: English counts twelve, the others twenty-four.
    pub(crate) fn in_force(self, system: Option<bool>, language: crate::words::Language) -> Self {
        match (self, system) {
            (Self::Auto, Some(true)) => Self::TwentyFour,
            (Self::Auto, Some(false)) => Self::Twelve,
            (Self::Auto, None) if language == crate::words::Language::English => Self::Twelve,
            (Self::Auto, None) => Self::TwentyFour,
            (chosen, _) => chosen,
        }
    }
}

impl Privacy {
    fn is_default(&self) -> bool {
        *self == Self::default()
    }
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

    /// Where the last livery of each server is kept.
    pub(crate) fn liveries(&self) -> crate::livery::Shelf {
        crate::livery::Shelf::new(self.dir.join("liveries"))
    }
}

/// The file the picture behind a conversation was kept in before there
/// was a shelf of them: read once, and put on the shelf.
const WALLPAPER: &str = "wallpaper.jpg";

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
                ..VoiceSettings::default()
            }),
            push_to_talk_key: Some("f9".to_owned()),
            whisper_key: Some("f10".to_owned()),
            auto_connect: None,
            hide_empty: true,
            hide_offline: true,
            sounds: serde_json::from_str(r#"{"masterEnabled":true}"#).expect("sounds"),
            privacy: Privacy {
                hide_reading: true,
                ..Privacy::default()
            },
            wall_wash: Some(0.5),
            wall_blur: Some(8),
            window: Some(Placed {
                x: -1200.0,
                y: 40.0,
                width: 1100.0,
                height: 700.0,
                maximized: true,
            }),
            asides: [(
                "stream".to_owned(),
                Placed {
                    x: 40.0,
                    y: 60.0,
                    width: 960.0,
                    height: 540.0,
                    maximized: false,
                },
            )]
            .into(),
            friends: vec![Friend {
                hash: "abc".to_owned(),
                name: "Rin".to_owned(),
                server: "magical.rocks".to_owned(),
            }],
            format: Format {
                text: TextSize::Large,
                hours: Hours::Twelve,
                font_size_custom_px: Some(20),
                convert_to_local_time: false,
                date_format: crate::formats::DateFormat::Ymd,
                number_format: crate::formats::NumberFormat::SpaceComma,
            },
            recent_emoji: vec!["🎉".to_owned()],
            klipy_key: Some("a-key".to_owned()),
            display_name: Some("Alex".to_owned()),
            trusted_hosts: vec!["example.org".to_owned()],
            global_keys: true,
            stay_disconnected: true,
            carry_declined: true,
            volumes: [("abc".to_owned(), 0.5)].into(),
            language: crate::words::Language::German,
            gate_calibrated_for: Some("mic|true".to_owned()),
            denoiser_knobs: [("strength".to_owned(), 0.7)].into(),
            look: Look {
                bubble_style: BubbleStyle::Flat,
                compact_mode: true,
                always_show_message_actions: true,
                channel_viewer_style: ChannelViewer::Modern,
            },
            server_switcher: ServerSwitcher::Both,
            user_mode: UserMode::Expert,
            chat_backgrounds: Backgrounds {
                recents: vec![ChatBackground::new("walls/a.jpg")],
                shown: Some("walls/a.jpg".to_owned()),
            },
            chat_bg_dim: Some(0.25),
            shortcuts: {
                let mut keys = Bindings::default();
                let _ = keys.set(Bound::VoicePriority, Some("F8"));
                keys
            },
            enable_notifications: Enabled(false),
            welcome_message_display: WelcomeDisplay::Always,
            enable_dual_path: true,
            logs: LogChoices {
                log_level: Some("debug".to_owned()),
                log_to_file: false,
                auto_zip_logs: false,
                terminal_logging: true,
            },
            show_disconnect_warning: Enabled(false),
            streamer_mode: true,
            welcome_seen: {
                let mut seen = WelcomesSeen::default();
                seen.note("example.org:64738", 1);
                seen
            },
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
