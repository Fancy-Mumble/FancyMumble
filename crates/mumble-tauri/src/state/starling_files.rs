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
//! A grant is good for one object until it expires. Handing that to the
//! webview would mean the URL crossing the IPC boundary, sitting in a JS
//! variable while a file dialog is open, and being re-sent on a retry after it
//! has expired. Keeping both halves in the backend means the frontend asks to
//! share a file and finds out whether it worked, which is all it ever needed
//! to know.
//!
//! # Why a download grant is kept
//!
//! Reading is not writing: an upload grant is spent by the PUT it authorises,
//! but a GET grant is only a signature over `(method, key, expiry)` that the
//! listener re-checks per request. So one download URL answers as many
//! requests as fit inside its lifetime - which is what makes playing a video
//! affordable, because a player asking for the next few hundred kilobytes of
//! it should not cost a round trip over the control connection each time.

use std::collections::HashMap;
use std::sync::Arc;
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

/// Now, on the clock a grant's expiry is written against.
fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

/// Why one attempt at a span did not produce bytes.
enum MediaFetch {
    /// The file server would not answer this URL. Worth one more attempt with
    /// a freshly signed one; the link may simply have aged out.
    Refused,
    /// Anything else, said in the words it will be logged with.
    Failed(String),
}

impl std::fmt::Display for MediaFetch {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused => formatter.write_str("the file server refused this link"),
            Self::Failed(why) => formatter.write_str(why),
        }
    }
}

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
    /// Download URLs already minted, by key, with when each stops working.
    ///
    /// Per session because a grant is signed by the server that issued it, so
    /// disconnecting or switching servers drops the lot with the state it
    /// lives in.
    download_urls: HashMap<String, CachedGrant>,
}

/// One signed download URL, and the moment it stops being one.
struct CachedGrant {
    url: String,
    expires_at_ms: u64,
}

/// How much life a cached grant needs left before it is worth reusing.
///
/// A URL that expires mid-transfer fails the request that was using it, and a
/// player treats that as the file having gone away rather than retrying. The
/// margin is generous because minting a fresh one costs one round trip.
const GRANT_REUSE_MARGIN_MS: u64 = 30_000;

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

    /// A download URL for `key` that still has enough life left to use.
    fn cached_download_url(&self, key: &str, now_ms: u64) -> Option<String> {
        self.download_urls
            .get(key)
            .filter(|grant| grant.expires_at_ms > now_ms.saturating_add(GRANT_REUSE_MARGIN_MS))
            .map(|grant| grant.url.clone())
    }

    /// Drop a cached URL the file server has since refused.
    ///
    /// A signed URL can stop working before the moment it said it would - a
    /// server restarted onto a new signing key, a clock further off than the
    /// margin allows - and a cache that keeps handing one out turns a
    /// recoverable refusal into a video that never plays again.
    fn forget_download_url(&mut self, key: &str) {
        let _ = self.download_urls.remove(key);
    }

    /// Keep a freshly minted download URL for the next request for the same
    /// object, and drop any that have since expired.
    fn remember_download_url(&mut self, key: &str, url: &str, expires_at_ms: u64, now_ms: u64) {
        self.download_urls
            .retain(|_, grant| grant.expires_at_ms > now_ms);
        let _ = self.download_urls.insert(
            key.to_owned(),
            CachedGrant {
                url: url.to_owned(),
                expires_at_ms,
            },
        );
    }
}

/// A password share's link, and the password that opens it.
///
/// Carried from the card that asked the user for it, because this is the one
/// download the session cannot authorise on its own.
#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct PasswordShare {
    /// The share's own address, from the marker in the message.
    pub url: String,
    pub password: String,
}

/// What the caller gets back once a file has actually landed.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct SharedUpload {
    /// The stored key, which is what a download is later asked for by.
    pub key: String,
    /// The bytes that arrived.
    pub size: u64,
    /// When the share stops answering, in unix seconds; `0` for never.
    ///
    /// Seconds because that is what every card in the client already renders
    /// an expiry in, and the plugin path has always answered in.
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
    /// The link this share can be reached at by anyone holding it.
    ///
    /// Empty for a session share, which has no such address. Unlike the URL
    /// the bytes went up through, this one does not expire, so it is the one
    /// that can be put in a message and still work next week.
    #[serde(rename = "shareUrl")]
    pub share_url: String,
}

impl AppState {
    /// Share one local file with a channel, over the canon handshake.
    ///
    /// Two round trips and a transfer: ask for a URL, wait for it, then move
    /// the bytes. The channel is told the file exists by the server once the
    /// upload lands - this does not announce anything itself, because a client
    /// that announced its own uploads could announce files it never sent.
    #[allow(
        clippy::too_many_arguments,
        reason = "one upload, and every one of these is a property of it"
    )]
    pub async fn starling_upload_file(
        &self,
        file_path: String,
        channel_id: u32,
        mime_type: Option<String>,
        upload_id: String,
        visibility: fancy::files::Visibility,
        ttl_seconds: u64,
        password: String,
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
                visibility,
                ttl_seconds,
                password,
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
            share_url: grant.share_url,
            expires_at: grant.share_expires_at_ms / 1000,
        })
    }

    /// A URL the bytes of one shared object can be fetched from.
    ///
    /// Kept inside the backend: a signed URL put into the DOM outlives the
    /// render that used it, sitting in the page and still valid for anything
    /// that can read the document. Callers here are the download commands and
    /// the `fancy-media` protocol handler, none of which hand it any further.
    ///
    /// Reused while one is still good, so streaming a video does not put a
    /// control-connection round trip in front of every range request.
    pub(crate) async fn starling_download_url(&self, key: &str) -> Result<String, String> {
        if let Some(url) = self.cached_download_url(key) {
            return Ok(url);
        }
        // One ask at a time for one object. A player opens several connections
        // at once and every one of them wants this URL before any of them has
        // it; letting each ask separately multiplies a single question by the
        // number of connections, and the control plane answers questions at a
        // limited rate.
        let gate = self.download_url_gate(key);
        let _held = gate.lock().await;
        // Whoever held the gate first has usually just answered it.
        if let Some(url) = self.cached_download_url(key) {
            return Ok(url);
        }

        let now = epoch_ms();
        let request_id = uuid::Uuid::new_v4().to_string();
        let (handle, waiting) = self.expect_grant(&request_id)?;
        if let Err(error) = handle
            .send(command::SendFancyFileDownload {
                request_id: request_id.clone(),
                key: key.to_owned(),
            })
            .await
        {
            self.forget_file_request(&request_id);
            return Err(format!("Failed to ask for a download URL: {error}"));
        }
        let grant = self.wait_for_grant(&request_id, waiting).await?;
        let url = grant.url.clone();
        let _ = self.with_starling_files(|files| {
            files.remember_download_url(key, &url, grant.expires_at_ms, now);
        });
        Ok(url)
    }

    /// The URL a media element should be pointed at for one shared object.
    ///
    /// Brings the loopback origin up on first use. The URL is only an address:
    /// it carries this run's token, while the signed URL the bytes actually
    /// come from is minted per request and never leaves the backend.
    pub(crate) async fn starling_media_url(
        &self,
        key: String,
        app_handle: tauri::AppHandle,
    ) -> Result<String, String> {
        let mut running = self.media_server.lock().await;
        if running.is_none() {
            *running = Some(super::media_server::start(app_handle).await?);
        }
        running
            .as_ref()
            .map(|server| server.url_for(&key))
            .ok_or_else(|| "the media origin is not running".to_owned())
    }

    /// Fetch one span of one shared object, for the loopback media origin.
    ///
    /// The range is passed through rather than interpreted: the file server
    /// decides what it can answer, and its `Content-Range` is what tells the
    /// player how long the object really is. A `None` range asks for the whole
    /// object, which is what a request with no `Range` header deserves.
    pub(crate) async fn starling_media_range(
        &self,
        key: &str,
        range: Option<&str>,
    ) -> Result<super::media_server::FetchedSpan, String> {
        match self.fetch_media_range(key, range).await {
            Err(MediaFetch::Refused) => {
                // The URL this was holding is no longer one the file server
                // will answer. Mid-playback that is a video that stops for
                // good, so the cached grant goes and a fresh one is asked for
                // once - and only once, because a second refusal is the file
                // being gone rather than the link being stale.
                let _ = self.with_starling_files(|files| files.forget_download_url(key));
                self.fetch_media_range(key, range)
                    .await
                    .map_err(|error| error.to_string())
            }
            other => other.map_err(|error| error.to_string()),
        }
    }

    /// One attempt at one span.
    async fn fetch_media_range(
        &self,
        key: &str,
        range: Option<&str>,
    ) -> Result<super::media_server::FetchedSpan, MediaFetch> {
        let url = self
            .starling_download_url(key)
            .await
            .map_err(MediaFetch::Failed)?;
        let mut request = self.http_client.get(&url);
        if let Some(range) = range {
            request = request.header(reqwest::header::RANGE, range);
        }
        let response = request
            .send()
            .await
            .map_err(|e| MediaFetch::Failed(format!("download request failed: {e}")))?;
        let status = response.status();
        // What a stale signed URL looks like, and the one failure worth trying
        // again with a fresh one.
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::NOT_FOUND {
            return Err(MediaFetch::Refused);
        }
        // A range nobody can satisfy is an answer, not a failure: the length
        // it carries is what stops a player seeking into nothing forever.
        if !status.is_success() && status != reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            return Err(MediaFetch::Failed(format!("download failed: {status}")));
        }
        // A server that ignores `Range` answers a request for the first
        // megabyte of a film with the whole film. Handing that on would spend
        // the file - repeatedly, once per piece the player asks for - so it is
        // refused instead, and the card falls back to naming the file and
        // offering to save it.
        if range.is_some() && status == reqwest::StatusCode::OK {
            return Err(MediaFetch::Failed(
                "this server does not serve ranges, so it cannot stream".to_owned(),
            ));
        }
        let header = |name: reqwest::header::HeaderName| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
        };
        let content_type = header(reqwest::header::CONTENT_TYPE);
        let content_range = header(reqwest::header::CONTENT_RANGE);
        let bytes = response
            .bytes()
            .await
            .map_err(|e| MediaFetch::Failed(format!("download body: {e}")))?;
        Ok(super::media_server::FetchedSpan {
            status: status.as_u16(),
            content_type,
            content_range,
            bytes: bytes.to_vec(),
        })
    }

    /// Fetch one shared object and hand it back as base64.
    ///
    /// For the callers that want the whole thing in one piece - a file the
    /// webview is about to decode itself. Anything that plays rather than
    /// decodes should be pointed at the `fancy-media` scheme instead, which
    /// moves the same bytes a range at a time.
    pub async fn starling_download_to_base64(&self, key: String) -> Result<String, String> {
        let url = self.starling_download_url(&key).await?;
        let response = self
            .http_client
            .get(&url)
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
        share: Option<PasswordShare>,
    ) -> Result<u64, String> {
        let url = match share {
            Some(share) => self.redeem_share(&share).await?,
            None => self.starling_download_url(&key).await?,
        };
        let response = self
            .http_client
            .get(&url)
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

    /// Trade a share's password for a URL that will hand over its bytes.
    ///
    /// A password share is sealed with a key derived from the password, so the
    /// signed route every other download uses would hand back ciphertext: the
    /// server cannot open its own object, which is the point of the mode. The
    /// two steps here are the same two the password page in a browser takes -
    /// post the password for a single-use ticket, then spend it.
    async fn redeem_share(&self, share: &PasswordShare) -> Result<String, String> {
        #[derive(serde::Deserialize)]
        struct Ticket {
            ticket: String,
        }

        let response = self
            .http_client
            .post(&share.url)
            .bearer_auth(&share.password)
            .send()
            .await
            .map_err(|e| format!("could not reach the share: {e}"))?;
        if response.status() == reqwest::StatusCode::FORBIDDEN {
            return Err("wrong password".to_owned());
        }
        if !response.status().is_success() {
            let status = response.status();
            return Err(format!("the share refused the password: {status}"));
        }
        let ticket: Ticket = response
            .json()
            .await
            .map_err(|e| format!("could not read the share's answer: {e}"))?;
        // The separator is always `?`: a share URL is the object's address and
        // carries no query of its own.
        Ok(format!("{}?ticket={}", share.url, ticket.ticket))
    }

    /// Ask for the caller's own uploads, or for every one of them.
    ///
    /// The answer arrives as the `starling-files-managed` event rather than as
    /// a return value: the same event serves a refresh nobody asked for, and a
    /// dashboard that only learned about files by calling would not see one
    /// another operator had just removed.
    pub async fn starling_manage_files(
        &self,
        everyone: bool,
        limit: u32,
    ) -> Result<String, String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone().ok_or("Not connected")?
        };
        let request_id = uuid::Uuid::new_v4().to_string();
        handle
            .send(command::SendFancyFileManage {
                request_id: request_id.clone(),
                audience: if everyone {
                    fancy::files::Audience::Everyone
                } else {
                    fancy::files::Audience::Mine
                },
                limit,
            })
            .await
            .map_err(|e| format!("Failed to ask for the file list: {e}"))?;
        Ok(request_id)
    }

    /// Ask for one stored file to be removed.
    pub async fn starling_forget_file(&self, key: String) -> Result<String, String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone().ok_or("Not connected")?
        };
        let request_id = uuid::Uuid::new_v4().to_string();
        handle
            .send(command::SendFancyFileForget {
                request_id: request_id.clone(),
                key,
            })
            .await
            .map_err(|e| format!("Failed to ask for the file to be removed: {e}"))?;
        Ok(request_id)
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

    /// A cached download URL for `key`, if one is still worth using.
    fn cached_download_url(&self, key: &str) -> Option<String> {
        let now = epoch_ms();
        self.with_starling_files(|files| files.cached_download_url(key, now))
            .flatten()
    }

    /// The gate that serialises asking for one object's download URL.
    fn download_url_gate(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = match self.download_url_locks.lock() {
            Ok(locks) => locks,
            // A poisoned map is not worth failing a preview over: an
            // unshared gate only means two asks instead of one.
            Err(poisoned) => poisoned.into_inner(),
        };
        Arc::clone(
            locks
                .entry(key.to_owned())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
        )
    }

    /// Run something against this session's file state, if it can be locked.
    ///
    /// `None` when the lock is poisoned, which every caller here treats the
    /// same way as a cache miss: the grant is simply asked for again.
    fn with_starling_files<T>(&self, act: impl FnOnce(&mut StarlingFiles) -> T) -> Option<T> {
        let session = self.inner.snapshot();
        let mut state = session.lock().ok()?;
        Some(act(&mut state.starling_files))
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
    fn a_download_url_is_reused_until_it_is_nearly_spent() {
        // The whole reason streaming is affordable: a player asks for the next
        // piece of a video every second or so, and each ask would otherwise be
        // a round trip over the control connection.
        let mut files = StarlingFiles::default();
        let now = 1_000_000;
        files.remember_download_url("7/clip.mp4", "https://files/clip?sig=a", now + 900_000, now);

        assert_eq!(
            files.cached_download_url("7/clip.mp4", now).as_deref(),
            Some("https://files/clip?sig=a"),
        );
        assert_eq!(
            files.cached_download_url("7/other.mp4", now),
            None,
            "a grant is for one object"
        );
    }

    #[test]
    fn a_grant_close_to_expiry_is_not_handed_out_again() {
        // A URL that dies mid-transfer fails the request using it, and a
        // player reads that as the file having gone away rather than retrying.
        let mut files = StarlingFiles::default();
        let now = 1_000_000;
        files.remember_download_url("7/clip.mp4", "https://files/clip?sig=a", now + 5_000, now);

        assert_eq!(files.cached_download_url("7/clip.mp4", now), None);
    }

    #[test]
    fn remembering_one_grant_forgets_the_grants_that_have_run_out() {
        // Otherwise the map is a list of every file looked at this session.
        let mut files = StarlingFiles::default();
        files.remember_download_url("old", "https://files/old", 500, 0);
        files.remember_download_url("new", "https://files/new", 2_000_000, 1_000_000);

        assert!(!files.download_urls.contains_key("old"));
        assert!(files.download_urls.contains_key("new"));
    }

    #[test]
    fn a_refused_link_is_dropped_so_the_next_ask_mints_a_fresh_one() {
        // Without this a link the server has stopped honouring is handed out
        // for the rest of its stated lifetime, and a video that stops partway
        // through never plays again.
        let mut files = StarlingFiles::default();
        let now = 1_000_000;
        files.remember_download_url("7/clip.mp4", "https://files/clip?sig=a", now + 900_000, now);
        assert!(files.cached_download_url("7/clip.mp4", now).is_some());

        files.forget_download_url("7/clip.mp4");

        assert_eq!(files.cached_download_url("7/clip.mp4", now), None);
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
