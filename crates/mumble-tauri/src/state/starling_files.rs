//! Sharing files with a server that speaks the canon rather than the plugin.
//!
//! The plugin path in [`super::file_server`] talks to an axum API that runs
//! inside the Mumble server process and hands the client a base URL and a
//! token on connect. Starling has no plugin: the same conversation happens
//! over the control connection as outer type 1009, and the answer to "where do
//! I put this" is a short-lived signed URL rather than a standing credential.
//!
//! The *behaviour* is the plugin's, deliberately: pick a file, watch a
//! progress bar, and everyone in the channel sees it land. What changes is
//! only who authorises the transfer and for how long.
//!
//! # Why the handshake lives here and not in the frontend
//!
//! A grant is good for one object, once, for about a minute. Handing that to
//! the webview would mean the URL crossing the IPC boundary, sitting in a JS
//! variable while a file dialog is open, and being re-sent on a retry after it
//! has expired. Keeping both halves in the backend means the frontend asks to
//! share a file and finds out whether it worked, which is all it ever needed
//! to know.

use std::collections::HashMap;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use futures_util::StreamExt as _;
use mumble_protocol::client::ClientHandle;
use mumble_protocol::command;
use mumble_protocol::proto::fancy;
use serde::Serialize;
use tokio::io::AsyncWriteExt as _;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use super::AppState;

/// How long to wait for a server to answer a request for a URL.
///
/// Generous, because the answer queues behind whatever else the control
/// connection is carrying. Short enough that a server which does not do
/// files at all leaves the composer waiting for a moment, not forever.
const GRANT_TIMEOUT: Duration = Duration::from_secs(15);

/// What the server said about one request for a URL.
#[derive(Debug)]
pub(crate) enum GrantOutcome {
    /// Here is where to put it, or get it.
    Granted(Box<fancy::files::Grant>),
    /// It said no, and this is the sentence to show for it.
    Refused(String),
}

/// In-flight file requests, and what this server has shown it can do.
#[derive(Default)]
pub(crate) struct StarlingFiles {
    /// Waiters keyed by the `request_id` they were sent with.
    ///
    /// Keyed rather than a queue because uploads overlap: dropping three files
    /// on the composer means three grants in flight, and answering the wrong
    /// one would write each file to another's key.
    waiters: HashMap<String, oneshot::Sender<GrantOutcome>>,
    /// Whether this server has ever answered a files frame.
    ///
    /// `None` until the probe resolves either way. A server without the
    /// service never answers at all, so absence is the only signal there is -
    /// which is why the probe is a listing, not an upload: it is free, it
    /// answers even for an empty channel, and a wrong guess costs nothing.
    available: Option<bool>,
}

impl StarlingFiles {
    /// Register a waiter for `request_id` and hand back its receiver.
    pub(crate) fn expect(&mut self, request_id: &str) -> oneshot::Receiver<GrantOutcome> {
        let (tx, rx) = oneshot::channel();
        let _ = self.waiters.insert(request_id.to_owned(), tx);
        rx
    }

    /// Resolve the waiter for `request_id`, if one is still listening.
    pub(crate) fn resolve(&mut self, request_id: &str, outcome: GrantOutcome) {
        if let Some(waiter) = self.waiters.remove(request_id) {
            let _ = waiter.send(outcome);
        }
    }

    /// Give up on a request whose answer never came.
    pub(crate) fn forget(&mut self, request_id: &str) {
        let _ = self.waiters.remove(request_id);
    }

    /// Note that this server does - or does not - do files.
    pub(crate) fn set_available(&mut self, available: bool) {
        self.available = Some(available);
    }

    /// What the probe found, or `None` while it is still out.
    pub(crate) fn available(&self) -> Option<bool> {
        self.available
    }
}

/// What the caller gets back once a file has actually landed.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct SharedUpload {
    /// The stored key, which is what a download is later asked for by.
    pub key: String,
    /// The bytes that arrived.
    pub size: u64,
}

impl AppState {
    /// Share one local file with a channel, over the canon handshake.
    ///
    /// Two round trips and a transfer: ask for a URL, wait for it, then move
    /// the bytes. The channel is told the file exists by the server once the
    /// upload lands - this does not announce anything itself, because a client
    /// that announced its own uploads could announce files it never sent.
    pub async fn starling_upload_file(
        &self,
        file_path: String,
        channel_id: u32,
        mime_type: Option<String>,
        upload_id: String,
        app_handle: tauri::AppHandle,
    ) -> Result<SharedUpload, String> {
        let file = tokio::fs::File::open(&file_path)
            .await
            .map_err(|e| format!("open file: {e}"))?;
        let size = file
            .metadata()
            .await
            .map_err(|e| format!("stat file: {e}"))?
            .len();
        let filename = std::path::Path::new(&file_path).file_name().map_or_else(
            || "file".to_owned(),
            |name| name.to_string_lossy().into_owned(),
        );
        let content_type = mime_type.unwrap_or_else(|| "application/octet-stream".to_owned());

        let request_id = uuid::Uuid::new_v4().to_string();
        let (handle, waiting) = self.expect_grant(&request_id)?;
        if let Err(error) = handle
            .send(command::SendFancyFileUpload {
                request_id: request_id.clone(),
                channel_id,
                filename,
                content_type,
                size,
            })
            .await
        {
            self.forget_file_request(&request_id);
            return Err(format!("Failed to ask for an upload URL: {error}"));
        }
        let grant = self.wait_for_grant(&request_id, waiting).await?;

        // Registered before the bytes move, so an upload the user cancels
        // mid-transfer actually stops.
        let cancel = CancellationToken::new();
        if !upload_id.is_empty() {
            if let Ok(mut map) = self.upload_cancels.lock() {
                let _ = map.insert(upload_id.clone(), cancel.clone());
            }
        }

        let body = reqwest::Body::wrap_stream(super::file_server::build_progress_stream(
            file,
            size,
            upload_id.clone(),
            app_handle,
        ));
        let send = self
            .http_client
            .put(&grant.url)
            .header(reqwest::header::CONTENT_LENGTH, size)
            .body(body)
            .send();

        let response = tokio::select! {
            result = send => result.map_err(|e| format!("upload request failed: {e}"))?,
            () = cancel.cancelled() => return Err("upload cancelled".to_owned()),
        };
        if !upload_id.is_empty() {
            if let Ok(mut map) = self.upload_cancels.lock() {
                let _ = map.remove(&upload_id);
            }
        }

        if !response.status().is_success() {
            let status = response.status();
            return Err(format!("upload failed: {status}"));
        }
        Ok(SharedUpload {
            key: grant.key,
            size,
        })
    }

    /// Fetch one shared object and hand it back as base64.
    ///
    /// Base64 rather than the URL because a signed URL put into the DOM
    /// outlives the render that used it: it would sit in the page, still
    /// valid, for anything that can read the document. This way it never
    /// leaves the backend.
    pub async fn starling_download_to_base64(&self, key: String) -> Result<String, String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (handle, waiting) = self.expect_grant(&request_id)?;
        if let Err(error) = handle
            .send(command::SendFancyFileDownload {
                request_id: request_id.clone(),
                key,
            })
            .await
        {
            self.forget_file_request(&request_id);
            return Err(format!("Failed to ask for a download URL: {error}"));
        }
        let grant = self.wait_for_grant(&request_id, waiting).await?;

        let response = self
            .http_client
            .get(&grant.url)
            .send()
            .await
            .map_err(|e| format!("download request failed: {e}"))?;
        if !response.status().is_success() {
            let status = response.status();
            return Err(format!("download failed: {status}"));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("download body: {e}"))?;
        Ok(STANDARD.encode(bytes))
    }

    /// Fetch one shared object straight to a path on disk.
    ///
    /// Separate from [`Self::starling_download_to_base64`] rather than a
    /// wrapper around it: base64 through the IPC boundary costs a third more
    /// bytes and holds the whole object in memory twice, which is fine for a
    /// thumbnail and not for the video somebody just shared. Returns the size
    /// written.
    pub async fn starling_download_to_file(
        &self,
        key: String,
        dest_path: String,
    ) -> Result<u64, String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (handle, waiting) = self.expect_grant(&request_id)?;
        if let Err(error) = handle
            .send(command::SendFancyFileDownload {
                request_id: request_id.clone(),
                key,
            })
            .await
        {
            self.forget_file_request(&request_id);
            return Err(format!("Failed to ask for a download URL: {error}"));
        }
        let grant = self.wait_for_grant(&request_id, waiting).await?;

        let response = self
            .http_client
            .get(&grant.url)
            .send()
            .await
            .map_err(|e| format!("download request failed: {e}"))?;
        if !response.status().is_success() {
            let status = response.status();
            return Err(format!("download failed: {status}"));
        }

        let mut file = tokio::fs::File::create(&dest_path)
            .await
            .map_err(|e| format!("create file: {e}"))?;
        let mut written: u64 = 0;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download body: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("write file: {e}"))?;
            written += chunk.len() as u64;
        }
        file.flush().await.map_err(|e| format!("write file: {e}"))?;
        Ok(written)
    }

    /// Ask what has been shared in a channel.
    ///
    /// The answer arrives as the `starling-file-listing` event, which is also
    /// what the availability probe watches for.
    pub async fn starling_list_files(&self, channel_id: u32, limit: u32) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone().ok_or("Not connected")?
        };
        handle
            .send(command::SendFancyFileList { channel_id, limit })
            .await
            .map_err(|e| format!("Failed to request the file listing: {e}"))
    }

    /// Whether this server has shown it does files, as far as anyone knows yet.
    pub fn starling_files_available(&self) -> Option<bool> {
        let session = self.inner.snapshot();
        let state = session.lock().ok()?;
        state.starling_files.available()
    }

    /// Register a waiter for `request_id`, and hand back the connection to
    /// send its request on.
    ///
    /// Registered *before* the request goes out. Registering after would be a
    /// race the fast path loses: a server on the same machine can answer
    /// before this task is scheduled again, and the grant would arrive with
    /// nobody listening for it.
    fn expect_grant(
        &self,
        request_id: &str,
    ) -> Result<(ClientHandle, oneshot::Receiver<GrantOutcome>), String> {
        let session = self.inner.snapshot();
        let mut state = session.lock().map_err(|e| e.to_string())?;
        let handle = state.conn.client_handle.clone().ok_or("Not connected")?;
        let waiting = state.starling_files.expect(request_id);
        Ok((handle, waiting))
    }

    /// Wait for the answer to a request already sent.
    async fn wait_for_grant(
        &self,
        request_id: &str,
        waiting: oneshot::Receiver<GrantOutcome>,
    ) -> Result<fancy::files::Grant, String> {
        match tokio::time::timeout(GRANT_TIMEOUT, waiting).await {
            Ok(Ok(GrantOutcome::Granted(grant))) => Ok(*grant),
            Ok(Ok(GrantOutcome::Refused(reason))) => Err(reason),
            Ok(Err(_)) => {
                self.forget_file_request(request_id);
                Err("the connection dropped while waiting for a file URL".to_owned())
            }
            Err(_) => {
                self.forget_file_request(request_id);
                // Silence is what a server without the service sounds like, so
                // it is recorded as one: the composer then says so up front
                // instead of making the next upload sit through this again.
                self.note_files_unanswered();
                Err("this server did not answer the file request".to_owned())
            }
        }
    }

    /// Record that a request went unanswered, unless something has already
    /// proved the service is there.
    fn note_files_unanswered(&self) {
        let session = self.inner.snapshot();
        if let Ok(mut state) = session.lock() {
            if state.starling_files.available().is_none() {
                state.starling_files.set_available(false);
            }
        };
    }

    /// Stop listening for one request's answer.
    fn forget_file_request(&self, request_id: &str) {
        let session = self.inner.snapshot();
        if let Ok(mut state) = session.lock() {
            state.starling_files.forget(request_id);
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_request_is_answered_on_its_own_channel() {
        // Three files dropped at once is the ordinary case, and answering the
        // wrong waiter would write each file to another one's key.
        let mut files = StarlingFiles::default();
        let first = files.expect("r1");
        let mut second = files.expect("r2");

        files.resolve(
            "r1",
            GrantOutcome::Granted(Box::new(fancy::files::Grant {
                key: "3/a/one.png".to_owned(),
                ..Default::default()
            })),
        );
        let Ok(GrantOutcome::Granted(grant)) = first.blocking_recv() else {
            panic!("the first request is answered");
        };
        assert_eq!(grant.key, "3/a/one.png");
        assert!(
            second.try_recv().is_err(),
            "the second is still waiting for its own grant"
        );
    }

    #[test]
    fn an_answer_nobody_is_waiting_for_is_dropped() {
        // A late grant for an upload the user cancelled, or one from a server
        // answering twice. Neither is a reason to panic on a missing key.
        let mut files = StarlingFiles::default();
        files.resolve("gone", GrantOutcome::Refused("too large".to_owned()));

        let waiting = files.expect("r1");
        files.forget("r1");
        files.resolve("r1", GrantOutcome::Refused("too late".to_owned()));
        assert!(
            waiting.blocking_recv().is_err(),
            "a forgotten waiter hears nothing"
        );
    }
}
