//! Keys that go to one person: the web client's user shortcuts
//! (`userShortcuts`), with its names for each part, so a kept list reads
//! the same in both.

use serde::{Deserialize, Serialize};

/// A key bound to one person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserShortcut {
    /// Tells it from the others, for changing or removing it.
    pub id: String,
    /// The key, as the web client writes a shortcut; empty for none yet.
    #[serde(default)]
    pub hotkey: String,
    /// What they were called when it was made.
    pub user_name: String,
    /// Their certificate's hash: they are found by it on any server.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_hash: Option<String>,
    /// Without a certificate, the server they are found on, by address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    /// What that server is called, for saying so.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_label: Option<String>,
}

/// One of the people on a server, as a shortcut looks for them.
pub(crate) struct Someone<'a> {
    pub session: u32,
    pub name: &'a str,
    pub hash: Option<&'a str>,
}

impl UserShortcut {
    /// Who of `people`, on the server at `server`, this goes to: by
    /// certificate on any server, else by name on the one it was made on.
    pub(crate) fn find<'a>(
        &self,
        people: impl IntoIterator<Item = Someone<'a>>,
        server: &str,
    ) -> Option<u32> {
        let mut people = people.into_iter();
        match &self.user_hash {
            Some(hash) => people.find(|someone| someone.hash == Some(hash.as_str())),
            None if self.server_id.as_deref() == Some(server) => {
                people.find(|someone| someone.name == self.user_name)
            }
            None => None,
        }
        .map(|someone| someone.session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shortcut(hash: Option<&str>, server: Option<&str>) -> UserShortcut {
        UserShortcut {
            id: "a".to_owned(),
            hotkey: "Ctrl+Alt+1".to_owned(),
            user_name: "Rin".to_owned(),
            user_hash: hash.map(ToOwned::to_owned),
            server_id: server.map(ToOwned::to_owned),
            server_label: None,
        }
    }

    fn people() -> Vec<Someone<'static>> {
        vec![
            Someone {
                session: 2,
                name: "Rin",
                hash: Some("abc"),
            },
            Someone {
                session: 3,
                name: "Rin",
                hash: None,
            },
        ]
    }

    #[test]
    fn found_by_certificate_anywhere_and_by_name_only_where_it_was_made() {
        assert_eq!(shortcut(Some("abc"), None).find(people(), "any:1"), Some(2));
        assert_eq!(shortcut(Some("zzz"), None).find(people(), "any:1"), None);
        assert_eq!(
            shortcut(None, Some("home:1")).find(people(), "home:1"),
            Some(2)
        );
        assert_eq!(
            shortcut(None, Some("home:1")).find(people(), "other:1"),
            None
        );
    }

    #[test]
    fn the_web_clients_names_are_read() {
        let read: UserShortcut = serde_json::from_str(
            r#"{"id":"x","hotkey":"Ctrl+1","userName":"Rin","userHash":"abc","serverLabel":"Home"}"#,
        )
        .expect("a shortcut");
        assert_eq!(read.user_hash.as_deref(), Some("abc"));
        assert_eq!(read.server_label.as_deref(), Some("Home"));
    }
}
