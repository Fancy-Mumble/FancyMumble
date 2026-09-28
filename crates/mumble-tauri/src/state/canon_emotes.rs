//! Server emotes on a server that keeps them itself.
//!
//! The plugin's emotes lived in its own `SQLite` table with the bytes in the row
//! and reached the client as a one-shot `fancy-server-emotes` broadcast. These
//! are named public objects in the server's own `srv/emotes/` namespace
//! (`STORAGE-UNIFICATION.md` D2), so an emote is a URL an `<img>` can use and
//! the set arrives on the files envelope - on request, and again whenever it
//! changes, which is what lets a deleted emote actually disappear.

use mumble_protocol::command;
use mumble_protocol::proto::fancy;
use tokio::sync::oneshot;

use super::AppState;

/// How long to wait for the server's answer.
///
/// The same reasoning as a file grant: an answer that has not come in this
/// long is a server that does not keep emotes, and the caller needs to hear
/// that rather than wait.
const EMOTE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// One emote as the frontend sees it.
#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct CanonEmote {
    pub shortcode: String,
    /// Where to fetch the image. A plain URL needing no signature, because an
    /// `<img>` cannot sign a request.
    pub url: String,
    #[serde(rename = "aliasEmoji")]
    pub alias_emoji: String,
    pub description: String,
}

/// In-flight emote requests.
#[derive(Default)]
pub(crate) struct CanonEmotes {
    /// Everyone waiting for the next listing.
    ///
    /// A list rather than one slot, and not keyed by `request_id`: every asker
    /// wants the same thing - the whole set - so one answer serves all of
    /// them. A single slot meant a second request replaced the first, and the
    /// first then reported a dropped connection for an answer that did arrive.
    /// It also lets the unsolicited broadcast, which carries no `request_id`
    /// at all, satisfy whoever happened to be asking.
    waiters: Vec<oneshot::Sender<Vec<CanonEmote>>>,
}

impl CanonEmotes {
    /// Register interest in the next listing.
    pub(crate) fn expect(&mut self) -> oneshot::Receiver<Vec<CanonEmote>> {
        let (tx, rx) = oneshot::channel();
        self.waiters.push(tx);
        rx
    }

    /// Hand a listing to everyone waiting.
    pub(crate) fn resolve(&mut self, emotes: Vec<CanonEmote>) {
        for waiter in self.waiters.drain(..) {
            let _ = waiter.send(emotes.clone());
        }
    }
}

impl AppState {
    /// Ask the server for its emotes.
    ///
    /// # Errors
    ///
    /// A message when nothing answered, which is what a server that keeps no
    /// emotes of its own sounds like.
    pub async fn canon_emotes(&self) -> Result<Vec<CanonEmote>, String> {
        let (handle, waiting) = {
            let session = self.inner.snapshot();
            let mut state = session.lock().map_err(|e| e.to_string())?;
            let handle = state.conn.client_handle.clone().ok_or("Not connected")?;
            (handle, state.canon_emotes.expect())
        };
        handle
            .send(command::SendFancyEmoteQuery {
                request_id: uuid::Uuid::new_v4().to_string(),
            })
            .await
            .map_err(|error| format!("could not ask for the emotes: {error}"))?;
        match tokio::time::timeout(EMOTE_TIMEOUT, waiting).await {
            Ok(Ok(emotes)) => Ok(emotes),
            Ok(Err(_)) => Err("the connection dropped while waiting for the emotes".to_owned()),
            Err(_) => Err("this server does not keep its own emotes".to_owned()),
        }
    }

    /// Add or replace one emote, and answer with the set as it now stands.
    ///
    /// The image is read here and `PUT` to the URL the server grants, the same
    /// two-step every upload takes: the bytes never cross the control
    /// connection.
    ///
    /// # Errors
    ///
    /// The server's refusal - which is where a session without `ManageEmotes`
    /// lands - or a message when the upload failed.
    pub async fn add_canon_emote(
        &self,
        shortcode: String,
        alias_emoji: String,
        description: String,
        file_path: String,
    ) -> Result<Vec<CanonEmote>, String> {
        let bytes = tokio::fs::read(&file_path)
            .await
            .map_err(|error| format!("could not read the image: {error}"))?;
        let filename = std::path::Path::new(&file_path).file_name().map_or_else(
            || "emote.png".to_owned(),
            |n| n.to_string_lossy().into_owned(),
        );
        let content_type = mime_of(&filename);

        let request_id = uuid::Uuid::new_v4().to_string();
        let (handle, waiting) = self.expect_grant(&request_id)?;
        handle
            .send(command::SendFancyEmoteUpload {
                request_id: request_id.clone(),
                shortcode,
                filename,
                content_type,
                size: bytes.len() as u64,
                alias_emoji,
                description,
            })
            .await
            .map_err(|error| format!("could not ask to add the emote: {error}"))?;
        let grant = self.wait_for_grant(&request_id, waiting).await?;

        let sent = self
            .http_client
            .put(&grant.url)
            .body(bytes)
            .send()
            .await
            .map_err(|error| format!("uploading the emote failed: {error}"))?;
        if !sent.status().is_success() {
            return Err(format!("uploading the emote failed: {}", sent.status()));
        }
        // The server binds the shortcode once the bytes are down and then tells
        // everybody, so the listing that follows is the new set.
        self.canon_emotes().await
    }

    /// Remove one emote.
    ///
    /// # Errors
    ///
    /// As [`AppState::add_canon_emote`].
    pub async fn remove_canon_emote(&self, shortcode: String) -> Result<Vec<CanonEmote>, String> {
        let (handle, waiting) = {
            let session = self.inner.snapshot();
            let mut state = session.lock().map_err(|e| e.to_string())?;
            let handle = state.conn.client_handle.clone().ok_or("Not connected")?;
            (handle, state.canon_emotes.expect())
        };
        handle
            .send(command::SendFancyEmoteForget {
                request_id: uuid::Uuid::new_v4().to_string(),
                shortcode,
            })
            .await
            .map_err(|error| format!("could not ask to remove the emote: {error}"))?;
        match tokio::time::timeout(EMOTE_TIMEOUT, waiting).await {
            Ok(Ok(emotes)) => Ok(emotes),
            Ok(Err(_)) => Err("the connection dropped while removing the emote".to_owned()),
            Err(_) => Err("the server did not answer".to_owned()),
        }
    }
}

/// One listing, as the frontend sees it.
pub(crate) fn emotes_of(listing: &fancy::files::Emotes) -> Vec<CanonEmote> {
    listing
        .emotes
        .iter()
        .map(|emote| CanonEmote {
            shortcode: emote.shortcode.clone(),
            url: emote.url.clone(),
            alias_emoji: emote.alias_emoji.clone(),
            description: emote.description.clone(),
        })
        .collect()
}

/// What an image is, from its name.
///
/// Guessed from the extension rather than sniffed, because the server stores
/// what it is told and the browser trusts the stored value; a wrong guess is a
/// picture that will not render, which is visible immediately.
fn mime_of(filename: &str) -> String {
    let extension = filename
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
    .to_owned()
}
