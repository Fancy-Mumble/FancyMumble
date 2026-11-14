//! Whisper and shout targets, as the web client keeps them
//! (`whisperTargets`): each a name, a key, and who it reaches, people by
//! certificate where they have one, or a channel (the one picked, or
//! whichever one the user is in), widened to its links and sub-channels and
//! narrowed to a group if wanted.
//!
//! What a target means is kept, not the sessions it reached: a session
//! number is good for one connection. [`WhisperBinding::reach`] turns it
//! into sessions against who is there now.

use serde::{Deserialize, Serialize};

/// A person a whisper reaches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct WhisperUser {
    /// What they were called when they were picked; who is meant where
    /// there is no certificate.
    pub name: String,
    /// Their certificate's hash, which outlives a session and a name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

/// Whether a target whispers to people or shouts to a channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WhisperKind {
    #[default]
    Users,
    Channel,
}

/// Which channel a shout goes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChannelMode {
    /// The one picked.
    #[default]
    Fixed,
    /// Whichever one the user is in when the key goes down.
    Current,
}

/// One whisper or shout target and its key.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub(crate) struct WhisperBinding {
    /// Tells it from the others.
    pub id: String,
    /// The key, as a shortcut is written; empty for none yet.
    #[serde(default)]
    pub hotkey: String,
    /// What the user called it.
    pub name: String,
    #[serde(default)]
    pub kind: WhisperKind,
    #[serde(default)]
    pub users: Vec<WhisperUser>,
    #[serde(default)]
    pub channel_mode: ChannelMode,
    /// The channel picked, where it is fixed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<u32>,
    /// What it was called when it was picked, to say so.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_name: Option<String>,
    #[serde(default)]
    pub links: bool,
    #[serde(default)]
    pub children: bool,
    /// Only the members of this group; empty for everybody.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

/// Who is on the server now, as a target is resolved against it.
pub(crate) struct Roster<'a> {
    /// Each person's session, name and certificate's hash.
    pub people: Vec<(u32, &'a str, Option<&'a str>)>,
    pub channels: Vec<u32>,
    /// The channel the user is in.
    pub current: Option<u32>,
}

/// The most targets a server has slots for, past the one this client's
/// whisper from a person's menu holds.
pub(crate) const MOST_TARGETS: usize = 29;

impl WhisperBinding {
    /// A new target called `name`, reaching nobody and bound to nothing.
    pub(crate) fn new(id: String, name: String) -> Self {
        Self {
            id,
            name,
            ..Self::default()
        }
    }

    /// The slot the target at `at` in the list has: the first holds the
    /// whisper chosen from a person's menu, so the list starts at the
    /// second. None past the server's thirty.
    pub(crate) fn slot(at: usize) -> Option<u8> {
        (at < MOST_TARGETS).then(|| u8::try_from(at + 2).unwrap_or(u8::MAX))
    }

    /// Whether it can be kept: it has a name, and reaches somebody or some
    /// channel.
    pub(crate) fn complete(&self) -> bool {
        !self.name.trim().is_empty()
            && match self.kind {
                WhisperKind::Users => !self.users.is_empty(),
                WhisperKind::Channel => {
                    self.channel_mode == ChannelMode::Current || self.channel_id.is_some()
                }
            }
    }

    /// Who it reaches against `roster`; none where it reaches nobody, which
    /// sends nothing at all rather than to the channel.
    pub(crate) fn reach(&self, roster: &Roster<'_>) -> Option<mumble_tauri_lib::engine_api::whisper::WhisperReach> {
        use mumble_tauri_lib::engine_api::whisper::WhisperReach;
        let group = self
            .group
            .as_deref()
            .map(str::trim)
            .filter(|group| !group.is_empty())
            .map(str::to_owned);
        match self.kind {
            WhisperKind::Users => {
                let sessions: Vec<u32> = self
                    .users
                    .iter()
                    .filter_map(|user| {
                        roster
                            .people
                            .iter()
                            .find(|(_, name, hash)| match &user.hash {
                                Some(wanted) => *hash == Some(wanted.as_str()),
                                None => *name == user.name,
                            })
                            .map(|(session, _, _)| *session)
                    })
                    .collect();
                (!sessions.is_empty()).then(|| WhisperReach {
                    sessions,
                    group,
                    ..WhisperReach::default()
                })
            }
            WhisperKind::Channel => {
                let channel = match self.channel_mode {
                    ChannelMode::Current => roster.current,
                    ChannelMode::Fixed => self.channel_id.filter(|id| roster.channels.contains(id)),
                }?;
                Some(WhisperReach {
                    sessions: Vec::new(),
                    channel: Some(channel),
                    group,
                    links: self.links,
                    children: self.children,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roster() -> Roster<'static> {
        Roster {
            people: vec![(2, "Rin", Some("abc")), (3, "Rin", None), (4, "Flora", Some("def"))],
            channels: vec![0, 1, 2],
            current: Some(1),
        }
    }

    #[test]
    fn people_are_found_by_certificate_and_only_without_one_by_name() {
        let mut target = WhisperBinding::new("a".into(), "Team".into());
        target.users = vec![
            WhisperUser { name: "Somebody".into(), hash: Some("abc".into()) },
            WhisperUser { name: "Flora".into(), hash: None },
        ];
        let reach = target.reach(&roster()).expect("somebody");
        assert_eq!(reach.sessions, [2, 4]);
        target.users = vec![WhisperUser { name: "Rin".into(), hash: Some("gone".into()) }];
        assert!(target.reach(&roster()).is_none(), "reaches nobody: sends nothing");
    }

    #[test]
    fn a_shout_follows_the_current_channel_or_keeps_to_its_own() {
        let mut target = WhisperBinding::new("b".into(), "Shout".into());
        target.kind = WhisperKind::Channel;
        target.channel_mode = ChannelMode::Current;
        target.links = true;
        target.group = Some(" admin ".into());
        let reach = target.reach(&roster()).expect("a channel");
        assert_eq!((reach.channel, reach.links, reach.group.as_deref()), (Some(1), true, Some("admin")));
        target.channel_mode = ChannelMode::Fixed;
        target.channel_id = Some(9);
        assert!(target.reach(&roster()).is_none(), "a channel that is gone");
        assert!(!WhisperBinding::new("c".into(), " ".into()).complete());
        assert_eq!(WhisperBinding::slot(0), Some(2));
        assert_eq!(WhisperBinding::slot(29), None);
    }
}
