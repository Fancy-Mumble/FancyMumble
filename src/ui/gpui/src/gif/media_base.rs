//! The address a server serves its own copies of GIFs from.
//!
//! A picture from there reaches nobody but the server already being
//! talked to, so it is shown without asking. Only an address shaped like
//! one is believed, `http(s)://host[:port]/path?` and nothing more, and a
//! picture only by that exact start: believing `https://` would be
//! believing the whole web (`isMediaBase` in the web client's
//! `remoteMedia.ts`).

use std::str::FromStr;

use url::Url;

/// A server's announced address for its own copies of GIFs.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct MediaBase(String);

/// What a server announced was not shaped like such an address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NotABase;

impl std::fmt::Display for NotABase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("not the address of a server's own pictures")
    }
}

impl FromStr for MediaBase {
    type Err = NotABase;

    fn from_str(base: &str) -> Result<Self, Self::Err> {
        if !base.ends_with('?') {
            return Err(NotABase);
        }
        let url = Url::parse(base).map_err(|_| NotABase)?;
        let shaped = matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some_and(|host| !host.is_empty())
            && url.query().is_none_or(str::is_empty)
            && url.fragment().is_none()
            && format!("{}{}?", url.origin().ascii_serialization(), url.path()) == base;
        if shaped {
            Ok(Self(base.to_owned()))
        } else {
            Err(NotABase)
        }
    }
}

impl MediaBase {
    /// Whether the picture at `url` is served from here.
    pub(crate) fn serves(&self, url: &str) -> bool {
        url.trim().starts_with(&self.0)
    }

    /// The address itself.
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_address_shaped_like_a_base_is_believed() {
        for base in [
            "https://chat.example.org/gif?",
            "http://127.0.0.1:8080/media/gifs?",
        ] {
            assert!(base.parse::<MediaBase>().is_ok(), "{base}");
        }
        for base in [
            "",
            "https://",
            "https://chat.example.org/gif",
            "https://chat.example.org/gif?u=1",
            "https://user@chat.example.org/gif?",
            "https://CHAT.example.org/gif?",
            "ftp://chat.example.org/gif?",
            "https://chat.example.org/a/../gif?",
        ] {
            assert_eq!(base.parse::<MediaBase>(), Err(NotABase), "{base}");
        }
    }

    #[test]
    fn a_picture_is_served_from_it_by_the_exact_start_of_its_address() {
        let base: MediaBase = "https://chat.example.org/gif?".parse().expect("a base");
        assert!(base.serves("https://chat.example.org/gif?u=abc&s=1"));
        assert!(!base.serves("https://chat.example.org/gifx?u=abc"));
        assert!(!base.serves("https://chat.example.org.evil/gif?u=abc"));
        assert!(!base.serves("https://static.klipy.com/cat.gif"));
    }
}
