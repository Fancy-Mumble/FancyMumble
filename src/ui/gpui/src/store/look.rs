//! How the conversation and the window around it are drawn: the parts of
//! the web client's personalization record, and of its preferences, that
//! this client draws too.
//!
//! The names are the web client's (`bubbleStyle`, `compactMode`,
//! `serverSwitcher`...), written the way this file writes names, and so are
//! the values: bringing the web client's choices over is a mapping, not a
//! translation.

use serde::{Deserialize, Serialize};

/// The shape a message is drawn in.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BubbleStyle {
    /// Every message on a rounded plate; the user's own on the right.
    #[default]
    Bubbles,
    /// One river down the left, with no plates.
    Flat,
    /// Dense lines: the time and the name run into what was said.
    Compact,
}

impl BubbleStyle {
    /// Every style, in the order they are offered.
    pub(crate) const ALL: [Self; 3] = [Self::Bubbles, Self::Flat, Self::Compact];
}

/// How the people in a channel are shown in the channel column.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ChannelViewer {
    /// By name, a row each, under their channel.
    #[default]
    Flat,
    /// Their faces stacked on the channel's own row.
    Modern,
    /// The web client's older design's tree, which the web client's
    /// Nebula and this client draw as `Flat`. Kept so that such a record
    /// is read, not lost.
    Classic,
}

impl ChannelViewer {
    /// The two this client draws, in the order they are offered.
    pub(crate) const OFFERED: [Self; 2] = [Self::Flat, Self::Modern];

    /// What is drawn for this choice.
    pub(crate) const fn drawn(self) -> Self {
        match self {
            Self::Modern => Self::Modern,
            Self::Flat | Self::Classic => Self::Flat,
        }
    }
}

/// Where the servers are listed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ServerSwitcher {
    /// The rail down the window's leading edge.
    #[default]
    Rail,
    /// Tabs in the band across the top.
    Titlebar,
    /// Both.
    Both,
}

impl ServerSwitcher {
    /// Every choice, in the order they are offered.
    pub(crate) const ALL: [Self; 3] = [Self::Rail, Self::Titlebar, Self::Both];

    /// Whether the rail is drawn.
    pub(crate) const fn rail(self) -> bool {
        !matches!(self, Self::Titlebar)
    }

    /// Whether the band carries the servers as tabs.
    pub(crate) const fn tabs(self) -> bool {
        !matches!(self, Self::Rail)
    }
}

/// How much of the client is offered: the web client's user mode.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum UserMode {
    /// What most people want.
    #[default]
    Normal,
    /// Finer settings besides.
    Expert,
    /// And what only helps whoever works on the client.
    Developer,
}

impl UserMode {
    /// Whether the finer settings are offered.
    pub(crate) fn expert(self) -> bool {
        self >= Self::Expert
    }

    /// Whether what helps a developer is offered.
    pub(crate) fn developer(self) -> bool {
        self == Self::Developer
    }
}

/// How messages are drawn: one value the conversation reads once.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Look {
    /// The shape each message is drawn in.
    #[serde(default)]
    pub bubble_style: BubbleStyle,
    /// No faces beside what is said, and the rows closer together.
    #[serde(default)]
    pub compact_mode: bool,
    /// The actions under every message, not only the one pointed at.
    #[serde(default)]
    pub always_show_message_actions: bool,
    /// How the people in a channel are shown in the column.
    #[serde(default)]
    pub channel_viewer_style: ChannelViewer,
}

impl Look {
    /// Whether the column of faces is left out and the rows drawn closer:
    /// compact mode and the compact style ask the same of a row.
    pub(crate) const fn dense(&self) -> bool {
        self.compact_mode || matches!(self.bubble_style, BubbleStyle::Compact)
    }

    /// Whether what is said stands on a plate.
    pub(crate) const fn carded(&self) -> bool {
        matches!(self.bubble_style, BubbleStyle::Bubbles)
    }

    /// Whether the name and time run into what was said.
    pub(crate) const fn inline_name(&self) -> bool {
        matches!(self.bubble_style, BubbleStyle::Compact)
    }
}

/// How many pictures the shelf of chat backgrounds keeps, as the web
/// client keeps them (`CHAT_BG_RECENTS_MAX`).
pub(crate) const CHAT_BG_RECENTS_MAX: usize = 5;

/// A picture kept on the shelf of chat backgrounds: its file, under the
/// data directory, and where in it the subject is, from the left and from
/// the top, as shares of its width and height.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct ChatBackground {
    pub file: String,
    #[serde(default = "middle")]
    pub focus_x: f32,
    #[serde(default = "middle")]
    pub focus_y: f32,
}

const fn middle() -> f32 {
    0.5
}

impl ChatBackground {
    /// `file`, with its subject in the middle.
    pub(crate) fn new(file: impl Into<String>) -> Self {
        Self {
            file: file.into(),
            focus_x: middle(),
            focus_y: middle(),
        }
    }
}

/// The picture behind the conversation, and the shelf it is chosen from.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Backgrounds {
    /// The pictures kept, the one chosen last first.
    #[serde(
        default,
        rename = "chat_bg_recents",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub recents: Vec<ChatBackground>,
    /// Which of them is behind the conversation; none for the window's
    /// own ground.
    #[serde(default, rename = "chat_bg", skip_serializing_if = "Option::is_none")]
    pub shown: Option<String>,
}

impl Backgrounds {
    pub(crate) fn is_empty(&self) -> bool {
        self.recents.is_empty() && self.shown.is_none()
    }

    /// The picture behind the conversation, if one is.
    pub(crate) fn current(&self) -> Option<&ChatBackground> {
        let shown = self.shown.as_ref()?;
        self.recents.iter().find(|entry| &entry.file == shown)
    }

    /// Put `entry` first on the shelf and behind the conversation. What
    /// falls off the end is returned: its file is no longer wanted.
    pub(crate) fn remember(&mut self, entry: ChatBackground) -> Vec<ChatBackground> {
        self.recents.retain(|kept| kept.file != entry.file);
        self.shown = Some(entry.file.clone());
        self.recents.insert(0, entry);
        self.recents
            .split_off(self.recents.len().min(CHAT_BG_RECENTS_MAX))
    }

    /// Show the picture in `file`, which is on the shelf; none shows none.
    pub(crate) fn show(&mut self, file: Option<&str>) {
        self.shown = file
            .filter(|file| self.recents.iter().any(|entry| entry.file == *file))
            .map(ToOwned::to_owned);
    }

    /// Take `file` off the shelf, and from behind the conversation if it
    /// is there. Whether it was on the shelf.
    pub(crate) fn forget(&mut self, file: &str) -> bool {
        let before = self.recents.len();
        self.recents.retain(|entry| entry.file != file);
        if self.shown.as_deref() == Some(file) {
            self.shown = None;
        }
        self.recents.len() != before
    }

    /// Set the subject of the picture shown, kept with it on the shelf.
    pub(crate) fn focus(&mut self, x: f32, y: f32) {
        let Some(shown) = self.shown.clone() else {
            return;
        };
        if let Some(entry) = self.recents.iter_mut().find(|entry| entry.file == shown) {
            entry.focus_x = x.clamp(0.0, 1.0);
            entry.focus_y = y.clamp(0.0, 1.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shelf_keeps_the_last_five_newest_first_and_lets_go_of_the_rest() {
        let mut shelf = Backgrounds::default();
        let mut gone = Vec::new();
        for n in 1..=7 {
            gone.extend(shelf.remember(ChatBackground::new(format!("{n}.jpg"))));
        }
        let files: Vec<&str> = shelf
            .recents
            .iter()
            .map(|entry| entry.file.as_str())
            .collect();
        assert_eq!(files, ["7.jpg", "6.jpg", "5.jpg", "4.jpg", "3.jpg"]);
        assert_eq!(shelf.shown.as_deref(), Some("7.jpg"));
        let gone: Vec<&str> = gone.iter().map(|entry| entry.file.as_str()).collect();
        assert_eq!(gone, ["1.jpg", "2.jpg"]);
        // Chosen again: back to the front, not twice on the shelf.
        assert!(shelf.remember(ChatBackground::new("4.jpg")).is_empty());
        assert_eq!(shelf.recents[0].file, "4.jpg");
        assert_eq!(shelf.recents.len(), 5);
    }

    #[test]
    fn the_focus_travels_with_its_picture_and_forgetting_the_one_shown_shows_none() {
        let mut shelf = Backgrounds::default();
        let _ = shelf.remember(ChatBackground::new("a.jpg"));
        shelf.focus(0.2, 1.4);
        let _ = shelf.remember(ChatBackground::new("b.jpg"));
        shelf.show(Some("a.jpg"));
        let current = shelf.current().expect("a is shown");
        assert_eq!((current.focus_x, current.focus_y), (0.2, 1.0));
        shelf.show(Some("not on the shelf"));
        assert!(shelf.current().is_none());
        shelf.show(Some("b.jpg"));
        assert!(shelf.forget("b.jpg"));
        assert!(shelf.shown.is_none() && shelf.recents.len() == 1);
        assert!(!shelf.forget("b.jpg"));
    }

    #[test]
    fn the_web_clients_names_and_values_are_read() {
        let look: Look = serde_json::from_str(
            r#"{"bubble_style":"compact","compact_mode":true,"channel_viewer_style":"classic"}"#,
        )
        .expect("a look");
        assert_eq!(look.bubble_style, BubbleStyle::Compact);
        assert!(look.dense() && look.inline_name() && !look.carded());
        assert_eq!(look.channel_viewer_style.drawn(), ChannelViewer::Flat);
        let switcher: ServerSwitcher = serde_json::from_str(r#""titlebar""#).expect("a place");
        assert!(switcher.tabs() && !switcher.rail());
        let mode: UserMode = serde_json::from_str(r#""developer""#).expect("a mode");
        assert!(mode.expert() && mode.developer());
    }
}
