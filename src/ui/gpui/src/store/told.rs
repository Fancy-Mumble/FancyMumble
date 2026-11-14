//! What the user is told, and how: the system's notifications, and the
//! server's welcome message, as the web client's preferences name them
//! (`enableNotifications`, `welcomeMessageDisplay`).

use serde::{Deserialize, Serialize};

/// Something that is on until switched off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct Enabled(pub bool);

impl Default for Enabled {
    fn default() -> Self {
        Self(true)
    }
}

impl Enabled {
    pub(crate) fn is_on(&self) -> bool {
        self.0
    }
}

/// When the server's welcome message is shown, once connected.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WelcomeDisplay {
    /// Never.
    Hide,
    /// Once for each server and message, until closed; remembered across
    /// launches.
    #[default]
    Once,
    /// At every connection.
    Always,
}

impl WelcomeDisplay {
    /// Every choice, in the order they are offered.
    pub(crate) const ALL: [Self; 3] = [Self::Hide, Self::Once, Self::Always];
}

/// The welcome messages closed, each as its server's address and a
/// fingerprint of its text: what "once" does not show again.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct WelcomesSeen(Vec<String>);

/// How many closed welcomes are remembered: the oldest go first.
const SEEN_MOST: usize = 64;

impl WelcomesSeen {
    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    fn key(server: &str, fingerprint: u64) -> String {
        format!("{server}#{fingerprint:016x}")
    }

    /// Whether the message of `fingerprint` on `server` was closed.
    pub(crate) fn has(&self, server: &str, fingerprint: u64) -> bool {
        let key = Self::key(server, fingerprint);
        self.0.contains(&key)
    }

    /// Note that it was.
    pub(crate) fn note(&mut self, server: &str, fingerprint: u64) {
        if self.has(server, fingerprint) {
            return;
        }
        self.0.push(Self::key(server, fingerprint));
        let over = self.0.len().saturating_sub(SEEN_MOST);
        let _ = self.0.drain(..over);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_closed_welcome_is_remembered_by_its_server_and_text_and_the_oldest_go() {
        let mut seen = WelcomesSeen::default();
        seen.note("example.org:64738", 7);
        assert!(seen.has("example.org:64738", 7));
        assert!(!seen.has("example.org:64738", 8), "another message");
        assert!(!seen.has("other.org:64738", 7), "another server");
        for n in 0..SEEN_MOST as u64 {
            seen.note("many", n);
        }
        assert!(!seen.has("example.org:64738", 7), "pushed out");
        assert_eq!(seen.0.len(), SEEN_MOST);
        let display: WelcomeDisplay = serde_json::from_str(r#""always""#).expect("a choice");
        assert_eq!(display, WelcomeDisplay::Always);
    }
}
