//! Bringing over what the web client on this computer holds: its saved
//! servers and the certificates they are arrived with.
//!
//! The two clients keep their files apart on purpose (see `paths`), so
//! somebody who has used the other one opens this one to an empty list.
//! This reads the other's directory and writes only this one's: nothing is
//! moved, and nothing here is written over.

use mumble_tauri_lib::engine_api::carry::{Held, HeldServer};

use crate::engine::{CarryOver, SavedServer};

/// What another install holds that this client does not.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct New {
    /// The servers not saved here under the same address and name.
    pub servers: Vec<HeldServer>,
    /// The certificates not held here under the same label.
    pub certificates: Vec<String>,
}

impl New {
    /// What of `held` is new to a client that has `saved` and holds
    /// `certificates`.
    pub(crate) fn of(held: &Held, saved: &[SavedServer], certificates: &[String]) -> Self {
        let known = |server: &HeldServer| {
            saved.iter().any(|saved| {
                saved.host.as_ref().eq_ignore_ascii_case(&server.host)
                    && saved.port == server.port
                    && saved.username.as_ref() == server.username
            })
        };
        Self {
            servers: held
                .servers
                .iter()
                .filter(|server| !known(server))
                .cloned()
                .collect(),
            certificates: held
                .certificates
                .iter()
                .filter(|label| !certificates.contains(label))
                .cloned()
                .collect(),
        }
    }

    /// How much there is to bring over, if there is anything.
    pub(crate) fn counted(&self) -> Option<CarryOver> {
        let carry = CarryOver {
            servers: self.servers.len(),
            certificates: self.certificates.len(),
        };
        (carry.servers + carry.certificates > 0).then_some(carry)
    }
}

/// `server` as this client saves one. `nth` tells apart those brought over
/// in one go, and `now` those of one go from those of another.
pub(crate) fn as_saved(server: HeldServer, nth: usize, now: u128) -> SavedServer {
    let label = if server.label.is_empty() {
        server.host.clone()
    } else {
        server.label
    };
    SavedServer {
        id: format!("carried-{now:x}-{nth:x}").into(),
        label: label.into(),
        host: server.host.into(),
        port: server.port,
        username: server.username.into(),
        certificate: server.certificate.map(Into::into),
        favorite: server.favorite,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn held(host: &str, username: &str, certificate: Option<&str>) -> HeldServer {
        HeldServer {
            label: String::new(),
            host: host.to_owned(),
            port: 64738,
            username: username.to_owned(),
            certificate: certificate.map(ToOwned::to_owned),
            favorite: true,
        }
    }

    #[test]
    fn only_what_is_not_here_already_is_brought_over() {
        let other = Held {
            servers: vec![
                held("magical.rocks", "Sebi", Some("sebi")),
                held("Kumo.JP", "s", None),
                held("magical.rocks", "Guest", None),
            ],
            certificates: vec!["sebi".to_owned(), "guest".to_owned()],
        };
        let saved = [as_saved(held("kumo.jp", "s", None), 0, 1)];
        let new = New::of(&other, &saved, &["guest".to_owned()]);
        let who: Vec<_> = new
            .servers
            .iter()
            .map(|server| server.username.as_str())
            .collect();
        assert_eq!(
            who,
            ["Sebi", "Guest"],
            "another name on a server is another way in"
        );
        assert_eq!(new.certificates, ["sebi"]);
        assert_eq!(
            new.counted(),
            Some(CarryOver {
                servers: 2,
                certificates: 1
            })
        );
        assert_eq!(New::default().counted(), None, "nothing to offer");
    }

    #[test]
    fn a_server_brought_over_keeps_who_to_arrive_as() {
        let saved = as_saved(held("magical.rocks", "Sebi", Some("sebi")), 2, 0xabc);
        assert_eq!(saved.id.as_ref(), "carried-abc-2");
        assert_eq!(
            saved.label.as_ref(),
            "magical.rocks",
            "named after its host"
        );
        assert_eq!(saved.certificate.as_ref().map(AsRef::as_ref), Some("sebi"));
        assert!(saved.favorite);
    }
}
