//! The sounds that say something happened: which there are, which of them
//! each kind of happening plays and how loud, and playing one.
//!
//! The sounds and what each happening plays unless told otherwise are the
//! web client's (`ui/src/core/features/notifications/sounds.ts`), and what
//! is chosen is kept under the names it keeps them under. Off until asked
//! for, as there.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Something that happened and can be heard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Event {
    /// Somebody said something in a channel.
    Message,
    /// Somebody wrote to the user alone.
    Direct,
    /// A message names the user.
    Mention,
    /// Somebody arrived on the server.
    Arrived,
    /// Somebody left it.
    Left,
    /// Somebody came into the channel the user is in.
    Joined,
    /// Somebody went out of it.
    Parted,
    /// Somebody began to share their screen.
    StreamStart,
    /// Somebody began to talk.
    Talking,
    /// The user's own microphone was muted.
    Muted,
}

impl Event {
    /// Every one, in the order the settings list them.
    pub(crate) const ALL: [Self; 10] = [
        Self::Message,
        Self::Direct,
        Self::Mention,
        Self::Arrived,
        Self::Left,
        Self::Joined,
        Self::Parted,
        Self::StreamStart,
        Self::Talking,
        Self::Muted,
    ];

    /// What it is kept under, and what it is called.
    pub(crate) const fn wording(self) -> (&'static str, &'static str) {
        match self {
            Self::Message => ("chatMessage", "A message in a channel"),
            Self::Direct => ("directMessage", "A message to you alone"),
            Self::Mention => ("mention", "A message that names you"),
            Self::Arrived => ("userJoin", "Somebody arrives on the server"),
            Self::Left => ("userLeave", "Somebody leaves the server"),
            Self::Joined => ("userJoinChannel", "Somebody comes into your channel"),
            Self::Parted => ("userLeaveChannel", "Somebody goes out of your channel"),
            Self::StreamStart => ("streamStart", "Somebody begins to share their screen"),
            Self::Talking => ("voiceActivity", "Somebody begins to talk"),
            Self::Muted => ("selfMuted", "Your microphone is muted"),
        }
    }

    /// What it plays until told otherwise.
    fn usual(self) -> Chosen {
        let (enabled, sound, volume) = match self {
            Self::Message => (true, "dragon-3", 0.5),
            Self::Direct => (true, "univ-033", 0.7),
            Self::Mention => (true, "univ-09", 0.7),
            Self::Arrived => (true, "univ-036", 0.4),
            Self::Left => (true, "univ-040", 0.4),
            Self::Joined => (true, "univ-036", 0.5),
            Self::Parted => (true, "univ-040", 0.5),
            Self::StreamStart => (true, "univ-051", 0.5),
            Self::Talking => (false, NONE, 0.3),
            Self::Muted => (true, "univ-057", 0.4),
        };
        Chosen {
            enabled,
            sound: sound.to_owned(),
            volume,
        }
    }
}

/// The name of playing nothing.
const NONE: &str = "none";

/// A sound: what it is kept under, what it is called, and its file.
#[derive(Clone, Copy)]
pub(crate) struct Sound {
    pub id: &'static str,
    /// What it is called; the settings list sounds by id for now.
    #[cfg_attr(not(test), expect(dead_code, reason = "named only by the tests until a view shows it"))]
    pub name: &'static str,
    file: &'static [u8],
}

impl std::fmt::Debug for Sound {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Sound")
            .field("id", &self.id)
            .finish_non_exhaustive()
    }
}

impl PartialEq for Sound {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

macro_rules! sound {
    ($id:literal, $name:literal, $file:literal) => {
        Sound {
            id: $id,
            name: $name,
            file: include_bytes!(concat!(
                "../../../../crates/mumble-tauri/ui/src/core/assets/",
                $file
            )),
        }
    };
}

/// Every sound there is, in the order they are offered.
pub(crate) const SOUNDS: [Sound; 7] = [
    sound!(
        "dragon-3",
        "Chime",
        "dragon-studio-new-notification-3-398649.mp3"
    ),
    sound!(
        "univ-033",
        "Bubble",
        "universfield-new-notification-033-480571.mp3"
    ),
    sound!(
        "univ-036",
        "Pop",
        "universfield-new-notification-036-485897.mp3"
    ),
    sound!(
        "univ-040",
        "Ding",
        "universfield-new-notification-040-493469.mp3"
    ),
    sound!(
        "univ-051",
        "Ping",
        "universfield-new-notification-051-494246.mp3"
    ),
    sound!(
        "univ-057",
        "Drop",
        "universfield-new-notification-057-494255.mp3"
    ),
    sound!(
        "univ-09",
        "Bell",
        "universfield-new-notification-09-352705.mp3"
    ),
];

/// What one kind of happening plays.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Chosen {
    pub enabled: bool,
    /// A sound's name, or `none`.
    pub sound: String,
    /// From nothing to as loud as the file is.
    pub volume: f32,
}

impl Chosen {
    /// The sound it names, if it names one.
    pub(crate) fn sound(&self) -> Option<&'static Sound> {
        SOUNDS.iter().find(|sound| sound.id == self.sound)
    }

    /// The same, playing the sound offered after the one it plays: round
    /// through every sound, and through none.
    #[must_use]
    #[cfg(test)]
    pub(crate) fn next(mut self) -> Self {
        let at = SOUNDS.iter().position(|sound| sound.id == self.sound);
        let next = match at {
            None => SOUNDS.first(),
            Some(at) => SOUNDS.get(at + 1),
        };
        next.map_or(NONE, |sound| sound.id)
            .clone_into(&mut self.sound);
        self
    }
}

/// What is played for what, as the user has it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Sounds {
    /// Whether anything is played at all.
    #[serde(default, rename = "masterEnabled")]
    pub on: bool,
    /// What was changed from the usual, by the name of what happens.
    #[serde(default)]
    events: BTreeMap<String, Chosen>,
}

impl Sounds {
    /// Whether nothing was ever changed: what is not worth writing down.
    pub(crate) fn is_usual(&self) -> bool {
        *self == Self::default()
    }

    /// What `event` plays.
    pub(crate) fn of(&self, event: Event) -> Chosen {
        self.events
            .get(event.wording().0)
            .cloned()
            .unwrap_or_else(|| event.usual())
    }

    /// Have `event` play what `change` makes of what it plays.
    pub(crate) fn change(&mut self, event: Event, change: impl FnOnce(Chosen) -> Chosen) {
        let chosen = change(self.of(event));
        let key = event.wording().0;
        if chosen == event.usual() {
            let _ = self.events.remove(key);
        } else {
            let _ = self.events.insert(key.to_owned(), chosen);
        }
    }

    /// What to play now that `event` happened, and how loud: nothing while
    /// sounds are off, or this one is, or it plays none.
    pub(crate) fn heard(&self, event: Event) -> Option<(&'static Sound, f32)> {
        if !self.on {
            return None;
        }
        let chosen = self.of(event);
        let sound = chosen.sound().filter(|_| chosen.enabled)?;
        Some((sound, chosen.volume.clamp(0.0, 1.0)))
    }
}

/// Play `sound` at `volume`, on the system's own way out, and come back at
/// once. Best effort: with nothing to play on, nothing is heard.
pub(crate) fn play(sound: &'static Sound, volume: f32) {
    // What a test would have heard, kept for it to look at.
    #[cfg(test)]
    PLAYED.with_borrow_mut(|played| played.push(sound.id));
    // Not under test, nor in a run kept silent (`crate::silence`).
    if crate::silence::everything() {
        return;
    }
    // A thread for as long as the sound lasts: the way out is opened for
    // it and closed after it, so that nothing is held open in between.
    let spawned = std::thread::Builder::new()
        .name("sound".to_owned())
        .spawn(move || {
            if let Err(error) = sounded(sound, volume) {
                tracing::debug!(sound = sound.id, %error, "a sound was not played");
            }
        });
    if let Err(error) = spawned {
        tracing::debug!(%error, "no thread to play a sound on");
    }
}

#[cfg(test)]
thread_local! {
    static PLAYED: std::cell::RefCell<Vec<&'static str>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// The sounds this thread would have played, by id, under test.
#[cfg(test)]
pub(crate) fn played() -> Vec<&'static str> {
    PLAYED.with_borrow(Clone::clone)
}

/// Play `sound` to its end.
fn sounded(sound: &'static Sound, volume: f32) -> Result<(), Box<dyn std::error::Error>> {
    let out = rodio::DeviceSinkBuilder::open_default_sink()?;
    let player = rodio::Player::connect_new(out.mixer());
    player.set_volume(volume);
    player.append(rodio::Decoder::try_from(std::io::Cursor::new(sound.file))?);
    player.sleep_until_end();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_heard_until_sounds_are_turned_on() {
        let mut sounds = Sounds::default();
        assert!(sounds.is_usual());
        assert_eq!(sounds.heard(Event::Mention), None);
        sounds.on = true;
        let (sound, volume) = sounds.heard(Event::Mention).expect("a sound");
        assert_eq!((sound.name, volume), ("Bell", 0.7));
        // Somebody beginning to talk plays nothing unless asked to.
        assert_eq!(sounds.heard(Event::Talking), None);
    }

    #[test]
    fn what_a_happening_plays_is_changed_and_only_the_change_is_kept() {
        let mut sounds = Sounds {
            on: true,
            ..Sounds::default()
        };
        sounds.change(Event::Message, |chosen| Chosen {
            enabled: false,
            ..chosen
        });
        assert_eq!(sounds.heard(Event::Message), None);
        assert_eq!(sounds.events.len(), 1);
        // Put back as it was, it is not kept at all.
        sounds.change(Event::Message, |chosen| Chosen {
            enabled: true,
            ..chosen
        });
        assert!(sounds.events.is_empty());
        // Kept the way the web client keeps it.
        sounds.change(Event::Direct, |chosen| Chosen {
            volume: 0.2,
            ..chosen
        });
        let written = serde_json::to_string(&sounds).expect("written");
        assert_eq!(
            written,
            r#"{"masterEnabled":true,"events":{"directMessage":{"enabled":true,"sound":"univ-033","volume":0.2}}}"#
        );
        assert_eq!(
            serde_json::from_str::<Sounds>(&written).expect("read"),
            sounds
        );
    }

    #[test]
    fn the_sounds_are_gone_through_one_after_another_and_through_none() {
        let mut chosen = Event::Message.usual();
        let mut seen = vec![chosen.sound.clone()];
        for _ in 0..=SOUNDS.len() {
            chosen = chosen.next();
            seen.push(chosen.sound.clone());
        }
        assert_eq!(seen.first(), Some(&"dragon-3".to_owned()));
        assert_eq!(seen.get(6), Some(&"univ-09".to_owned()));
        assert_eq!(seen.get(7), Some(&NONE.to_owned()), "after the last, none");
        assert_eq!(seen.get(8), Some(&"dragon-3".to_owned()), "and round");
        let none = Chosen {
            sound: NONE.to_owned(),
            ..chosen
        };
        assert_eq!(none.sound(), None);
    }

    #[test]
    fn every_sound_is_a_file_that_can_be_played() {
        for sound in &SOUNDS {
            let decoded = rodio::Decoder::try_from(std::io::Cursor::new(sound.file));
            assert!(decoded.is_ok(), "{}", sound.id);
        }
        // Every happening's usual sound is one of them, or none.
        for event in Event::ALL {
            let usual = event.usual();
            assert!(usual.sound == NONE || usual.sound().is_some(), "{event:?}");
        }
    }
}
