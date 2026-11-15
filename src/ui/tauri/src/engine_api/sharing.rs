//! What the server connected to lets a shared file be: the web client's
//! `fileServerConfig.canShareFilesPublic` and `deleteOnTtl`, which decide
//! whether its tray offers a link and a lifetime or one locked choice.

use super::EngineHandle;

/// What a shared file may be on this server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileSharing {
    /// Whether a file may be shared by a link (and by a link and password).
    pub by_link: bool,
    /// Whether a share may be given a lifetime.
    pub expiring: bool,
}

impl FileSharing {
    /// What a server's file plugin says of itself on connecting, as the web
    /// client reads it: a link unless it says not (`can_share_files_public
    /// !== false`), a lifetime only where it says so (`!!delete_on_ttl`).
    #[must_use]
    pub fn told(told: &[u8]) -> Self {
        let told: serde_json::Value = serde_json::from_slice(told).unwrap_or_default();
        Self {
            by_link: told.get("can_share_files_public").and_then(serde_json::Value::as_bool) != Some(false),
            expiring: told.get("delete_on_ttl").and_then(serde_json::Value::as_bool) == Some(true),
        }
    }
}

impl EngineHandle {
    /// What a shared file may be on the server connected to. A server that
    /// keeps files the canon way takes both a link and a lifetime with every
    /// upload (`canonFileServerConfig`); one whose plugin keeps them says.
    pub fn file_sharing(&self) -> FileSharing {
        let told = self
            .state
            .get_plugin_broadcasts()
            .into_iter()
            .rev()
            .find(|told| told.data_id == "fancy-file-server-config");
        told.map_or(
            FileSharing {
                by_link: true,
                expiring: true,
            },
            |told| FileSharing::told(&told.data),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plugin_says_what_it_allows_as_the_web_client_reads_it() {
        assert_eq!(
            FileSharing::told(br#"{"can_share_files_public":false,"delete_on_ttl":false}"#),
            FileSharing { by_link: false, expiring: false }
        );
        assert_eq!(
            FileSharing::told(br#"{"delete_on_ttl":true}"#),
            FileSharing { by_link: true, expiring: true }
        );
        assert_eq!(FileSharing::told(b"{}"), FileSharing { by_link: true, expiring: false });
    }
}
