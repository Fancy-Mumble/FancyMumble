//! Taking in what another install of this application holds.
//!
//! Two views of the engine keep their files apart: each writes identities
//! and message keys, and two programs writing one such directory is how a
//! key is lost. Somebody who comes to one view from the other still wants
//! their servers and who they are on them. This reads the other install's
//! directory, and writes only into this one's.
//!
//! What crosses is what an identity's export file carries: the
//! certificate, its key, and the seed its message keys come from. The
//! state of sealed conversations stays where it is. Two installs that both
//! advanced the same ratchet would each lose what the other received.

use std::path::Path;

use serde::Deserialize;

use crate::state::pchat::IdentityStore;

/// The file the web view keeps its saved servers in, and the key they are
/// under in it.
const SERVERS_FILE: &str = "servers.json";

/// What an install holds that another can take in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Held {
    /// Its saved servers, in the order it lists them.
    pub servers: Vec<HeldServer>,
    /// The labels of its certificates.
    pub certificates: Vec<String>,
}

/// One saved way onto a server: an address and who to arrive as.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct HeldServer {
    /// What the user calls it.
    #[serde(default)]
    pub label: String,
    /// The server's host name.
    pub host: String,
    /// The server's port.
    pub port: u16,
    /// The name to arrive under.
    #[serde(default)]
    pub username: String,
    /// The label of the certificate to arrive with, if any.
    #[serde(default, rename = "cert_label")]
    pub certificate: Option<String>,
    /// Whether it is marked a favourite.
    #[serde(default)]
    pub favorite: bool,
}

/// The saved servers as the web view's store writes them: one object,
/// with the list under one key.
#[derive(Debug, Default, Deserialize)]
struct StoredServers {
    #[serde(default)]
    servers: Vec<serde_json::Value>,
}

/// What the install whose data directory is `dir` holds. A directory
/// that is not there, or holds nothing that can be read, holds nothing.
#[must_use]
pub fn held_in(dir: &Path) -> Held {
    let servers = std::fs::read_to_string(dir.join(SERVERS_FILE))
        .ok()
        .and_then(|text| serde_json::from_str::<StoredServers>(&text).ok())
        .unwrap_or_default()
        .servers
        .into_iter()
        // One entry that cannot be read does not cost the others.
        .filter_map(|entry| serde_json::from_value::<HeldServer>(entry).ok())
        .filter(|server| !server.host.is_empty())
        .collect();
    Held {
        servers,
        certificates: IdentityStore::new(dir.to_path_buf()).list_labels(),
    }
}

/// Take the certificates `labels` of the install at `from` into the one at
/// `into`. A label `into` already has is left as it is: what is there may
/// be registered somewhere, and is never written over. Says which were
/// taken.
///
/// # Errors
///
/// When one of them could not be read or written; those before it have
/// been taken.
pub fn take_certificates(
    from: &Path,
    into: &Path,
    labels: &[String],
) -> Result<Vec<String>, String> {
    let (source, target) = (
        IdentityStore::new(from.to_path_buf()),
        IdentityStore::new(into.to_path_buf()),
    );
    let have = target.list_labels();
    let mut taken = Vec::new();
    for label in labels.iter().filter(|label| !have.contains(label)) {
        let bundle = source.export_bundle(label)?;
        target.import_bundle(&bundle, label)?;
        taken.push(label.clone());
    }
    Ok(taken)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]

    use super::*;

    /// An install with two certificates and a store of saved servers, one
    /// of them unreadable.
    fn other_install() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let store = IdentityStore::new(dir.path().to_path_buf());
        store.generate_cert("sebi").unwrap();
        store.generate_cert("guest").unwrap();
        std::fs::write(
            dir.path().join(SERVERS_FILE),
            r#"{"servers":[
                {"id":"1","label":"Home","host":"magical.rocks","port":64738,
                 "username":"Sebi","cert_label":"sebi","favorite":true,"last_joined":17},
                {"id":"2","label":"Old","host":"kumo.jp","port":64739,"username":"s"},
                {"id":"3","label":"Broken","port":"not a port"}
            ]}"#,
        )
        .unwrap();
        dir
    }

    #[test]
    fn an_install_says_what_it_holds_and_nothing_is_nothing() {
        let other = other_install();
        let held = held_in(other.path());
        assert_eq!(held.servers.len(), 2, "the unreadable one is left out");
        let home = &held.servers[0];
        assert_eq!((home.host.as_str(), home.port), ("magical.rocks", 64738));
        assert_eq!(home.certificate.as_deref(), Some("sebi"));
        assert!(home.favorite);
        assert_eq!(held.servers[1].certificate, None, "an older entry");
        let mut labels = held.certificates.clone();
        labels.sort();
        assert_eq!(labels, ["guest", "sebi"]);

        let nowhere = tempfile::tempdir().unwrap();
        assert_eq!(held_in(&nowhere.path().join("absent")), Held::default());
    }

    #[test]
    fn a_certificate_is_taken_whole_and_never_over_one_that_is_there() {
        let other = other_install();
        let here = tempfile::tempdir().unwrap();
        // This install already has a "guest" of its own.
        let mine = IdentityStore::new(here.path().to_path_buf());
        mine.generate_cert("guest").unwrap();
        let (own_guest, _) = mine.load_cert("guest");

        let labels = held_in(other.path()).certificates;
        let taken = take_certificates(other.path(), here.path(), &labels).unwrap();
        assert_eq!(taken, ["sebi"]);

        let theirs = IdentityStore::new(other.path().to_path_buf());
        assert_eq!(mine.load_cert("sebi"), theirs.load_cert("sebi"));
        assert!(mine.load_cert("sebi").0.is_some());
        assert_eq!(mine.load_cert("guest").0, own_guest, "left as it was");
        // Nothing was written into the install it came from.
        assert_eq!(held_in(other.path()).certificates.len(), 2);
        // A second time there is nothing left to take.
        let again = take_certificates(other.path(), here.path(), &labels).unwrap();
        assert!(again.is_empty());
    }
}
