//! A ban as somebody writes one: an address with how much of it counts, and
//! how long it lasts.
//!
//! The wire carries every address in sixteen bytes, an IPv4 one behind
//! ninety-six fixed bits, and counts the bits that matter over all sixteen:
//! one IPv4 address is 128 there, not 32. Counted the short way and sent as
//! it is, a ban on one IPv4 address covers every IPv4 address there is, so
//! the count is turned at the boundary and nowhere else.

use std::net::IpAddr;

use gpui::SharedString;

use crate::engine::Ban;

/// The fixed bits every IPv4 address is carried behind.
const V4_PREFIX: u32 = 96;

/// The fewest bits a server lets a ban count.
const FEWEST_BITS: u32 = 8;

/// How many bits an address of this kind has.
fn width(address: IpAddr) -> u32 {
    match address {
        IpAddr::V4(_) => 32,
        IpAddr::V6(_) => 128,
    }
}

fn is_v4(address: &str) -> bool {
    matches!(address.parse(), Ok(IpAddr::V4(_)))
}

/// The bits of `address` that count, from the wire's count of them.
pub(crate) fn bits_from_wire(address: &str, wire: u32) -> u32 {
    if is_v4(address) {
        wire.saturating_sub(V4_PREFIX)
    } else {
        wire
    }
}

/// The wire's count of the `bits` of `address` that count.
pub(crate) fn bits_to_wire(address: &str, bits: u32) -> u32 {
    if is_v4(address) {
        bits.min(32) + V4_PREFIX
    } else {
        bits.min(128)
    }
}

impl Ban {
    /// The address as it is written: alone when all of it counts, with the
    /// bits that do after a stroke when it is a network.
    pub(crate) fn written(&self) -> String {
        let whole = self.address.parse().map_or(128, width);
        if self.mask >= whole {
            self.address.to_string()
        } else {
            format!("{}/{}", self.address, self.mask)
        }
    }

    /// Whether it covers every address of its kind: what a ban counted the
    /// short way and sent as it was comes back as.
    pub(crate) fn covers_everybody(&self) -> bool {
        self.mask == 0
    }
}

/// How long `secs` is, written the way [`seconds`] reads it; nothing for a
/// ban that is for good.
pub(crate) fn lasting(secs: u32) -> String {
    match secs {
        0 => String::new(),
        secs if secs % 86_400 == 0 => format!("{}d", secs / 86_400),
        secs if secs % 3600 == 0 => format!("{}h", secs / 3600),
        secs if secs % 60 == 0 => format!("{}m", secs / 60),
        secs => format!("{secs}s"),
    }
}

/// The seconds `written` says: a number and what it counts (`30m`, `12h`,
/// `7d`, `2w`), or nothing for good.
///
/// # Errors
///
/// When it is neither.
pub(crate) fn seconds(written: &str) -> Result<u32, &'static str> {
    const HOW: &str = "How long is a number and a unit, like 30m, 12h or 7d; empty is for good.";
    let written = written.trim();
    if written.is_empty() {
        return Ok(0);
    }
    let unit = written.chars().next_back().ok_or(HOW)?;
    let each: u32 = match unit.to_ascii_lowercase() {
        's' => 1,
        'm' => 60,
        'h' => 3600,
        'd' => 86_400,
        'w' => 7 * 86_400,
        _ => return Err(HOW),
    };
    let count = written
        .strip_suffix(unit)
        .and_then(|count| count.trim().parse::<u32>().ok())
        .filter(|count| *count > 0)
        .ok_or(HOW)?;
    count
        .checked_mul(each)
        .ok_or("That is longer than a server can count; leave it empty for good.")
}

/// What the form's fields hold.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Entered {
    pub name: String,
    /// One address, or a network with its bits after a stroke.
    pub address: String,
    pub reason: String,
    /// A certificate's hash.
    pub hash: String,
    /// How long, as [`seconds`] reads it.
    pub lasts: String,
}

impl Entered {
    /// What the form holds when it opens on `ban`.
    pub(crate) fn of(ban: &Ban) -> Self {
        Self {
            name: ban.name.to_string(),
            address: ban.written(),
            reason: ban.reason.to_string(),
            hash: ban.hash.to_string(),
            lasts: lasting(ban.duration_secs),
        }
    }

    /// The ban this describes, having started at `start` (empty for one the
    /// server is to start now).
    ///
    /// # Errors
    ///
    /// With what is wrong with it, in words for whoever entered it.
    pub(crate) fn ban(&self, start: SharedString) -> Result<Ban, &'static str> {
        const ADDRESS: &str = "The address is an IP address, like 203.0.113.7, \
                               or a network, like 203.0.113.0/24.";
        let (address, bits) = match self.address.trim().split_once('/') {
            Some((address, bits)) => (address.trim(), Some(bits.trim())),
            None => (self.address.trim(), None),
        };
        if address.is_empty() {
            return Err("Enter the address to ban.");
        }
        let parsed: IpAddr = address.parse().map_err(|_| ADDRESS)?;
        let whole = width(parsed);
        let mask = match bits {
            None => whole,
            Some(bits) => bits
                .parse::<u32>()
                .ok()
                .filter(|bits| *bits <= whole)
                .ok_or(ADDRESS)?,
        };
        if mask < FEWEST_BITS {
            return Err("At least 8 bits of the address have to count.");
        }
        let hash = self.hash.trim();
        if !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("A certificate's hash is hexadecimal digits only.");
        }
        Ok(Ban {
            // As the server will write it back, so the two compare equal.
            address: parsed.to_string().into(),
            mask,
            name: self.name.trim().to_owned().into(),
            hash: hash.to_ascii_lowercase().into(),
            reason: self.reason.trim().to_owned().into(),
            start,
            duration_secs: seconds(&self.lasts)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entered(address: &str, lasts: &str) -> Entered {
        Entered {
            address: address.to_owned(),
            lasts: lasts.to_owned(),
            ..Entered::default()
        }
    }

    #[test]
    fn the_wire_counts_an_ipv4_address_behind_ninety_six_bits() {
        assert_eq!(bits_to_wire("203.0.113.7", 32), 128);
        assert_eq!(bits_to_wire("203.0.113.0", 24), 120);
        assert_eq!(bits_from_wire("203.0.113.7", 128), 32);
        assert_eq!(bits_from_wire("203.0.113.0", 120), 24);
        // An IPv6 address is counted as it is.
        assert_eq!(bits_to_wire("2001:db8::1", 64), 64);
        assert_eq!(bits_from_wire("2001:db8::1", 128), 128);
        // Counted the short way and sent as it was: none of it counts.
        assert_eq!(bits_from_wire("203.0.113.7", 32), 0);
        assert_eq!(bits_to_wire("203.0.113.7", 0), 96);
    }

    #[test]
    fn a_ban_is_made_of_what_was_entered() {
        let one = entered(" 203.0.113.7 ", "").ban("".into()).expect("a ban");
        assert_eq!((one.address.as_ref(), one.mask), ("203.0.113.7", 32));
        assert_eq!(one.duration_secs, 0);
        assert_eq!(one.written(), "203.0.113.7");
        let network = entered("203.0.113.0/24", "7d")
            .ban("".into())
            .expect("a ban");
        assert_eq!((network.mask, network.duration_secs), (24, 7 * 86_400));
        assert_eq!(network.written(), "203.0.113.0/24");
        let six = entered("2001:DB8::1", "").ban("".into()).expect("a ban");
        assert_eq!((six.address.as_ref(), six.mask), ("2001:db8::1", 128));
        // What it opens on is what it makes.
        assert_eq!(Entered::of(&network).ban("".into()), Ok(network));
    }

    #[test]
    fn what_is_not_a_ban_is_said_to_be_wrong() {
        for (address, lasts) in [
            ("", ""),
            ("mumble.example.org", ""),
            ("203.0.113.7/33", ""),
            ("203.0.113.7/0", ""),
            ("203.0.113.7/x", ""),
            ("203.0.113.7", "7"),
            ("203.0.113.7", "d"),
            ("203.0.113.7", "0d"),
            ("203.0.113.7", "99999999w"),
        ] {
            assert!(
                entered(address, lasts).ban("".into()).is_err(),
                "{address} {lasts}"
            );
        }
        let hashed = Entered {
            hash: "not a hash".to_owned(),
            ..entered("203.0.113.7", "")
        };
        assert!(hashed.ban("".into()).is_err());
    }

    #[test]
    fn how_long_is_written_the_way_it_is_read() {
        for (secs, written) in [
            (0, ""),
            (90, "90s"),
            (1800, "30m"),
            (7200, "2h"),
            (3 * 86_400, "3d"),
            (14 * 86_400, "14d"),
        ] {
            assert_eq!(lasting(secs), written);
            assert_eq!(seconds(written), Ok(secs));
        }
        assert_eq!(seconds("2w"), Ok(14 * 86_400));
        assert_eq!(seconds(" 12 H "), Ok(12 * 3600));
    }
}
