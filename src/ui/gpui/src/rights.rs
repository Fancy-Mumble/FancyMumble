//! What the server lets the local user do in a channel.
//!
//! A server answers per channel, with Mumble's permission bits. The view
//! offers what they allow and leaves out the rest: an entry whose every use
//! would be refused is worse than no entry.

/// One thing a server grants or withholds, as Mumble's bit for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Right(u32);

impl Right {
    /// Change the channel itself: its name, description, password, rules.
    pub(crate) const WRITE: Self = Self(0x1);
    /// Mute, deafen or raise somebody who is in the channel.
    pub(crate) const MUTE_DEAFEN: Self = Self(0x10);
    /// Move somebody into the channel.
    pub(crate) const MOVE: Self = Self(0x20);
    /// Make a channel inside it that stays.
    pub(crate) const MAKE_CHANNEL: Self = Self(0x40);
    /// Make a channel inside it that goes when it empties.
    pub(crate) const MAKE_TEMPORARY: Self = Self(0x400);
    /// Delete what others said in it, where the server keeps that.
    pub(crate) const DELETE_MESSAGE: Self = Self(0x1000);
    /// Kick somebody off the server. Asked of the root.
    pub(crate) const KICK: Self = Self(0x1_0000);
    /// Ban somebody, and read the bans. Asked of the root.
    pub(crate) const BAN: Self = Self(0x2_0000);
    /// Register somebody else, and read who is registered. Asked of the root.
    pub(crate) const REGISTER: Self = Self(0x4_0000);
    /// Register oneself. Asked of the root.
    pub(crate) const SELF_REGISTER: Self = Self(0x8_0000);
    /// Remove somebody's comment or picture. Asked of the root.
    pub(crate) const RESET_CONTENT: Self = Self(0x10_0000);
    /// Send a voice message in the channel.
    pub(crate) const SEND_VOICE_MESSAGE: Self = Self(0x200_0000);
}

/// What the server last said the local user may do in a channel; nothing
/// is known until it has answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Rights(Option<u32>);

impl Rights {
    /// Everything: what the demo's user has.
    pub(crate) const ALL: Self = Self(Some(u32::MAX));

    /// The rights `bits` spell, as the server sent them.
    pub(crate) const fn new(bits: Option<u32>) -> Self {
        Self(bits)
    }

    /// Exactly `rights`, known.
    #[cfg(test)]
    pub(crate) fn only(rights: &[Right]) -> Self {
        Self(Some(rights.iter().fold(0, |bits, right| bits | right.0)))
    }

    /// Whether the server has said `right` is held. Until it answers,
    /// nothing is.
    pub(crate) const fn has(self, right: Right) -> bool {
        match self.0 {
            Some(bits) => bits & right.0 != 0,
            None => false,
        }
    }

    /// Whether `right` is held as far as is known: also while the server
    /// has not answered. For what the web UI offers in that time too.
    pub(crate) const fn may(self, right: Right) -> bool {
        match self.0 {
            Some(bits) => bits & right.0 != 0,
            None => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Right, Rights};

    #[test]
    fn nothing_is_held_until_the_server_has_answered_and_then_what_it_said() {
        let unknown = Rights::default();
        assert!(!unknown.has(Right::WRITE));
        assert!(unknown.may(Right::WRITE), "offered until refused");
        let mover = Rights::new(Some(0x20));
        assert!(mover.has(Right::MOVE) && mover.may(Right::MOVE));
        assert!(!mover.has(Right::WRITE) && !mover.may(Right::WRITE));
        assert!(Rights::ALL.has(Right::BAN));
        assert_eq!(Rights::only(&[Right::MOVE]), mover);
    }
}
