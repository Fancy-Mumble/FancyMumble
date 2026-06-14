//! File-server (mumble-file-server plugin) HTTP client for the Tauri backend.
//!
//! The mumble-file-server plugin runs inside the Mumble server process and
//! exposes an axum HTTP API at a base URL advertised to clients on connect
//! via a `fancy-file-server-config` `PluginData` message. The frontend caches
//! that config and passes the relevant credentials per request to the
//! commands defined here, keeping the backend stateless.
//!
//! HTTP surface (see `mumble-file-server::http`):
//! * `POST   /files`   multipart upload (auth: `?session=&token=`)
//! * `POST   /files/{id}/auth`   exchange password / session JWT for a
//!   single-use ticket (Bearer header)
//! * `GET    /files/{id}?ex=&is=&hm=&ticket=`   download

use std::path::PathBuf;
use std::time::Duration;

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use futures_util::StreamExt as _;
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;

use super::AppState;

const USER_AGENT: &str = concat!("FancyMumble/", env!("CARGO_PKG_VERSION"));

/// Build a persistent [`reqwest::Client`] for file-server HTTP operations.
/// Only a connection timeout is set; individual upload/download requests impose
/// no total-request deadline because file sizes are unbounded.
///
/// Idle connection pooling is disabled (`pool_max_idle_per_host(0)`): the
/// file-server commonly sits behind Docker Desktop's port proxy (vpnkit),
/// which silently drops idle TCP connections after a short, unpredictable
/// window. A pooled keep-alive connection that the proxy has already torn down
/// would be reused on the next request and fail mid-flight with the opaque
/// `error sending request` (and a streaming upload that cannot be retried would
/// hang at "99%" waiting for a response that never arrives). Opening a fresh
/// connection per request sidesteps that entirely; the extra localhost
/// handshake is negligible at the file-server's request rate.
pub(super) fn new_http_client() -> Client {
    Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(5))
        .pool_max_idle_per_host(0)
        .build()
        .unwrap_or_else(|e| panic!("build HTTP client: {e}"))
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileAccessMode {
    /// Anyone with the signed link can download.
    Public,
    /// Requires a shared password.
    Password,
    /// Requires a Mumble session JWT and channel membership.
    Session,
}

impl FileAccessMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Password => "password",
            Self::Session => "session",
        }
    }
}

/// Request payload for [`AppState::upload_bytes`].
///
/// Identical to [`UploadRequest`] but carries the file content as an
/// in-memory UTF-8 string instead of a local file path.  Used by the live-doc
/// export flow where the markdown content lives entirely in memory and there
/// is no disk file to reference.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadBytesRequest {
    /// Base URL advertised by the file-server config (no trailing slash).
    pub base_url: String,
    /// Caller's Mumble session id.
    pub session: u32,
    /// Per-session upload token from the file-server config.
    pub upload_token: String,
    /// Channel id the upload is associated with.
    pub channel_id: u32,
    /// File name to advertise to the server.
    pub filename: String,
    /// MIME type of the content (e.g. `"text/markdown"`).
    pub mime_type: String,
    /// File content as a UTF-8 string.
    pub content: String,
    /// Access mode for the resulting file.
    pub mode: FileAccessMode,
    /// Required when `mode == Password`.
    #[serde(default)]
    pub password: Option<String>,
}

/// Request payload for [`AppState::upload_binary`].
///
/// Like [`UploadBytesRequest`] but carries the file content as a standard
/// base64 string, so binary files (e.g. a `.glb` 3D model selected in the
/// webview) survive the JSON IPC hop intact.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadBinaryRequest {
    /// Base URL advertised by the file-server config (no trailing slash).
    pub base_url: String,
    /// Caller's Mumble session id.
    pub session: u32,
    /// Per-session upload token from the file-server config.
    pub upload_token: String,
    /// Channel id the upload is associated with.
    pub channel_id: u32,
    /// File name to advertise to the server.
    pub filename: String,
    /// MIME type of the content (e.g. `"model/gltf-binary"`).
    pub mime_type: String,
    /// Standard-base64-encoded file bytes.
    pub content_base64: String,
    /// Access mode for the resulting file.
    pub mode: FileAccessMode,
    /// Required when `mode == Password`.
    #[serde(default)]
    pub password: Option<String>,
}

/// Request payload for [`AppState::upload_file`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    /// Base URL advertised by the file-server config (no trailing slash).
    pub base_url: String,
    /// Caller's Mumble session id.
    pub session: u32,
    /// Per-session upload token from the file-server config.
    pub upload_token: String,
    /// Channel id the upload is associated with.
    pub channel_id: u32,
    /// Local absolute file path to upload.
    pub file_path: PathBuf,
    /// File name to advertise to the server (defaults to file's basename).
    #[serde(default)]
    pub filename: Option<String>,
    /// MIME type override.
    #[serde(default)]
    pub mime_type: Option<String>,
    /// Access mode for the resulting file.
    pub mode: FileAccessMode,
    /// Required when `mode == Password`.
    #[serde(default)]
    pub password: Option<String>,
    /// Requested file lifetime in seconds, chosen by the uploader.  `Some(0)`
    /// means "no expiry"; `None` means "use the server default".  Clamped to
    /// the server's configured maximum.
    #[serde(default)]
    pub ttl_seconds: Option<u64>,
    /// Opaque identifier echoed back in `upload-progress` Tauri events.
    /// Empty string means progress events are not emitted.
    #[serde(default)]
    pub upload_id: String,
}

/// Response payload from a successful upload (mirrors the server's JSON shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UploadResponse {
    /// Random file id (also embedded in `download_url`).
    pub file_id: String,
    /// Full shareable download URL with `?ex=&is=&hm=` parameters.
    pub download_url: String,
    /// Access mode for this file.
    pub access_mode: FileAccessMode,
    /// Unix-seconds expiry, or `None` if TTL disabled.
    pub expires_at: Option<u64>,
    /// File size in bytes.
    pub size_bytes: u64,
}

/// Credential bundle for authenticated downloads.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DownloadCredential {
    /// `mode=password`: the shared password (plaintext, base64-url encoded
    /// before being sent in the `Authorization: Bearer` header).
    Password { value: String },
    /// `mode=session`: the session JWT issued by the file-server plugin
    /// (sent verbatim in `Authorization: Bearer`).
    Session { value: String },
}

/// Request payload for [`AppState::download_file`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    /// Full signed download URL returned by [`UploadResponse::download_url`].
    pub url: String,
    /// Local absolute path to write the downloaded blob to.
    pub dest_path: PathBuf,
    /// Optional credentials for non-public files.
    #[serde(default)]
    pub credential: Option<DownloadCredential>,
}

/// Request payload for [`AppState::download_to_base64`].
///
/// Downloads a (possibly access-controlled) file into memory and returns its
/// bytes as standard base64 - used to render inline resources (e.g. a 3D
/// model) in the webview without exposing the file-server origin to a direct,
/// CORS-blocked browser fetch.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadBytesRequest {
    /// Full signed download URL returned by [`UploadResponse::download_url`].
    pub url: String,
    /// Optional credentials for non-public (session / password) files.
    #[serde(default)]
    pub credential: Option<DownloadCredential>,
    /// Reject downloads larger than this many bytes (0 = no limit) so a huge
    /// blob can't be base64-marshalled across the IPC boundary.
    #[serde(default)]
    pub max_bytes: u64,
}

/// Request payload for the per-user private storage commands.
///
/// Private storage is a generic key/value namespace on the file-server
/// scoped to the caller's cert hash and restricted to registered users.
/// The live-doc sidebar uses it under a fixed key, but the file-server
/// has no knowledge of that.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateStorageRequest {
    /// Base URL advertised by the file-server config (no trailing slash).
    pub base_url: String,
    /// Session JWT from the file-server config (proves identity + `reg`).
    pub session_jwt: String,
    /// Storage key (opaque).
    pub key: String,
    /// Value to store (UTF-8); only used by the put command.
    #[serde(default)]
    pub value: Option<String>,
}

/// Request payload for the admin "list all files" dashboard command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminListRequest {
    /// Base URL advertised by the file-server config (no trailing slash).
    pub base_url: String,
    /// Caller's session JWT; the server checks it grants admin (Write on root).
    pub session_jwt: String,
}

/// Request payload for the admin "delete a file" dashboard command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminDeleteRequest {
    /// Base URL advertised by the file-server config (no trailing slash).
    pub base_url: String,
    /// Caller's session JWT (admin-gated server-side).
    pub session_jwt: String,
    /// Opaque id of the file to delete.
    pub file_id: String,
}

/// Request payload for the admin "delete a document" dashboard command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminDeleteDocumentRequest {
    /// Base URL advertised by the file-server config (no trailing slash).
    pub base_url: String,
    /// Caller's session JWT (admin-gated server-side).
    pub session_jwt: String,
    /// Stable document name to delete (the live-doc `DocKey` filename).
    pub name: String,
}

/// Request payload for the admin "preview a file" dashboard command, which
/// streams a file's raw bytes back as base64 for inline rendering.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminPreviewRequest {
    /// Base URL advertised by the file-server config (no trailing slash).
    pub base_url: String,
    /// Caller's session JWT (admin-gated server-side).
    pub session_jwt: String,
    /// Opaque id of the file to fetch.
    pub file_id: String,
    /// Reject previews larger than this many bytes (0 = no limit).
    #[serde(default)]
    pub max_bytes: u64,
}

#[derive(Debug, Deserialize)]
struct AuthResponse {
    ticket: String,
}

#[derive(Debug, Deserialize)]
struct ServerErrorBody {
    error: String,
}

fn detect_filename(req: &UploadRequest) -> String {
    req.filename
        .clone()
        .or_else(|| {
            req.file_path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "upload.bin".to_owned())
}

async fn read_error_body(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if let Ok(parsed) = serde_json::from_str::<ServerErrorBody>(&body) {
        format!("{} - {}", status, parsed.error)
    } else if body.is_empty() {
        status.to_string()
    } else {
        format!("{status} - {body}")
    }
}

fn parse_file_id_from_url(url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    let segments: Vec<_> = parsed
        .path_segments()
        .ok_or("url has no path segments")?
        .filter(|s| !s.is_empty())
        .collect();
    let mut iter = segments.iter().rev();
    let last = iter.next().ok_or("url path is empty")?;
    let parent = iter.next().ok_or("url path missing /files/{id}")?;
    if *parent != "files" {
        return Err("url is not a /files/{id} download URL".to_owned());
    }
    Ok((*last).to_owned())
}

/// Drives the upload-progress Tauri event stream. Runs as a spawned task so
/// that Tauri's IPC emit never blocks the body-stream poll path.
async fn emit_progress_events(
    upload_id: String,
    file_size: u64,
    app_handle: tauri::AppHandle,
    mut rx: mpsc::UnboundedReceiver<u64>,
) {
    let mut last_pct: u8 = u8::MAX;
    while let Some(bytes_sent) = rx.recv().await {
        let pct = ((bytes_sent as f64 / file_size as f64) * 100.0).min(99.0) as u8;
        if pct != last_pct {
            last_pct = pct;
            let _ = app_handle.emit(
                "upload-progress",
                serde_json::json!({
                    "uploadId": upload_id,
                    "bytesSent": bytes_sent,
                    "totalBytes": file_size,
                }),
            );
        }
    }
}

fn build_progress_stream(
    file: tokio::fs::File,
    file_size: u64,
    upload_id: String,
    app_handle: tauri::AppHandle,
) -> impl futures_util::Stream<Item = Result<tokio_util::bytes::Bytes, std::io::Error>> {
    let tx = if !upload_id.is_empty() && file_size > 0 {
        let (tx, rx) = mpsc::unbounded_channel::<u64>();
        drop(tokio::spawn(emit_progress_events(upload_id, file_size, app_handle, rx)));
        Some(tx)
    } else {
        drop(upload_id);
        drop(app_handle);
        None
    };

    // 64 KiB read chunks dramatically reduce spawn_blocking overhead on
    // Windows compared to ReaderStream's default 8 KiB.
    let mut bytes_accumulated: u64 = 0;
    ReaderStream::with_capacity(file, 64 * 1024).inspect(move |r| {
        match r {
            Ok(chunk) => {
                if let Some(tx) = tx.as_ref() {
                    bytes_accumulated += chunk.len() as u64;
                    let _ = tx.send(bytes_accumulated);
                }
                tracing::trace!(
                    chunk_bytes = chunk.len(),
                    sent = bytes_accumulated,
                    total = file_size,
                    "upload stream chunk"
                );
            }
            Err(e) => {
                tracing::error!(error = %e, sent = bytes_accumulated, "upload stream read error");
            }
        }
    })
}

fn build_upload_form(req: &UploadRequest, body: reqwest::Body, file_size: u64) -> Form {
    let filename = detect_filename(req);
    let mime = req
        .mime_type
        .clone()
        .unwrap_or_else(|| "application/octet-stream".to_owned());
    let part = Part::stream_with_length(body, file_size)
        .file_name(filename)
        .mime_str(&mime)
        .unwrap_or_else(|_| Part::text("invalid mime"));
    let mut form = Form::new()
        .part("file", part)
        .text("channel_id", req.channel_id.to_string())
        .text("mode", req.mode.as_str().to_owned());
    if let Some(pw) = req.password.clone() {
        form = form.text("password", pw);
    }
    if let Some(ttl) = req.ttl_seconds {
        form = form.text("ttl_seconds", ttl.to_string());
    }
    form
}

async fn obtain_ticket(
    client: &Client,
    url: &reqwest::Url,
    file_id: &str,
    cred: &DownloadCredential,
) -> Result<String, String> {
    let mut auth_url = url.clone();
    auth_url.set_query(None);
    {
        let mut segs = auth_url
            .path_segments_mut()
            .map_err(|()| "url cannot be a base".to_owned())?;
        let _ = segs.pop_if_empty().pop().extend(&[file_id, "auth"]);
    }

    let bearer = match cred {
        DownloadCredential::Password { value } => URL_SAFE_NO_PAD.encode(value.as_bytes()),
        DownloadCredential::Session { value } => value.clone(),
    };

    let resp = client
        .post(auth_url)
        .bearer_auth(bearer)
        .send()
        .await
        .map_err(|e| format!("auth request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("pre-auth failed: {}", read_error_body(resp).await));
    }
    let parsed: AuthResponse = resp
        .json()
        .await
        .map_err(|e| format!("auth response parse: {e}"))?;
    Ok(parsed.ticket)
}

impl AppState {
    /// Upload a local file to the file-server plugin and return the
    /// signed download URL.
    pub async fn upload_file(
        &self,
        req: UploadRequest,
        app_handle: tauri::AppHandle,
    ) -> Result<UploadResponse, String> {
        if matches!(req.mode, FileAccessMode::Password) && req.password.is_none() {
            return Err("mode=password requires `password`".to_owned());
        }

        let file = tokio::fs::File::open(&req.file_path)
            .await
            .map_err(|e| format!("open file: {e}"))?;
        let file_size = file
            .metadata()
            .await
            .map_err(|e| format!("stat file: {e}"))?
            .len();

        let cancel_token = CancellationToken::new();
        if !req.upload_id.is_empty() {
            if let Ok(mut map) = self.upload_cancels.lock() {
                let _ = map.insert(req.upload_id.clone(), cancel_token.clone());
            }
        }

        let body = reqwest::Body::wrap_stream(build_progress_stream(
            file,
            file_size,
            req.upload_id.clone(),
            app_handle,
        ));

        let client = &self.http_client;
        let endpoint = format!("{}/files", req.base_url.trim_end_matches('/'));
        let form = build_upload_form(&req, body, file_size);

        let send_fut = client
            .post(endpoint)
            .query(&[
                ("session", req.session.to_string()),
                ("token", req.upload_token.clone()),
            ])
            .multipart(form)
            .send();

        let resp = tokio::select! {
            result = send_fut => {
                result.map_err(|e| format!("upload request failed: {e}"))?  
            }
            () = cancel_token.cancelled() => {
                return Err("upload cancelled".to_owned());
            }
        };

        if !req.upload_id.is_empty() {
            if let Ok(mut map) = self.upload_cancels.lock() {
                let _ = map.remove(&req.upload_id);
            }
        }

        if !resp.status().is_success() {
            return Err(format!("upload failed: {}", read_error_body(resp).await));
        }
        resp.json::<UploadResponse>()
            .await
            .map_err(|e| format!("upload response parse: {e}"))
    }

    /// Upload in-memory UTF-8 content to the file-server plugin and return
    /// the signed download URL.  Equivalent to [`AppState::upload_file`] but
    /// accepts a string rather than a local file path, avoiding CORS
    /// restrictions that would block a direct browser `fetch()` call.
    pub async fn upload_bytes(&self, req: UploadBytesRequest) -> Result<UploadResponse, String> {
        if matches!(req.mode, FileAccessMode::Password) && req.password.is_none() {
            return Err("mode=password requires `password`".to_owned());
        }

        let body_bytes = req.content.into_bytes();
        let part = Part::bytes(body_bytes)
            .file_name(req.filename.clone())
            .mime_str(&req.mime_type)
            .unwrap_or_else(|_| Part::text("invalid mime"));
        let mut form = Form::new()
            .part("file", part)
            .text("channel_id", req.channel_id.to_string())
            .text("mode", req.mode.as_str().to_owned());
        if let Some(pw) = req.password {
            form = form.text("password", pw);
        }

        let endpoint = format!("{}/files", req.base_url.trim_end_matches('/'));
        let resp = self
            .http_client
            .post(endpoint)
            .query(&[
                ("session", req.session.to_string()),
                ("token", req.upload_token),
            ])
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("upload request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("upload failed: {}", read_error_body(resp).await));
        }
        resp.json::<UploadResponse>()
            .await
            .map_err(|e| format!("upload response parse: {e}"))
    }

    /// Upload base64-encoded binary content to the file-server plugin and
    /// return the signed download URL.  The base64 detour keeps binary files
    /// (e.g. a `.glb` model picked in the webview) intact across the JSON IPC
    /// boundary, where [`AppState::upload_bytes`] would mangle non-UTF-8 bytes.
    pub async fn upload_binary(&self, req: UploadBinaryRequest) -> Result<UploadResponse, String> {
        if matches!(req.mode, FileAccessMode::Password) && req.password.is_none() {
            return Err("mode=password requires `password`".to_owned());
        }

        let bytes = STANDARD
            .decode(req.content_base64.as_bytes())
            .map_err(|e| format!("invalid base64 content: {e}"))?;
        let part = Part::bytes(bytes)
            .file_name(req.filename.clone())
            .mime_str(&req.mime_type)
            .unwrap_or_else(|_| Part::text("invalid mime"));
        let mut form = Form::new()
            .part("file", part)
            .text("channel_id", req.channel_id.to_string())
            .text("mode", req.mode.as_str().to_owned());
        if let Some(pw) = req.password {
            form = form.text("password", pw);
        }

        let endpoint = format!("{}/files", req.base_url.trim_end_matches('/'));
        let resp = self
            .http_client
            .post(endpoint)
            .query(&[
                ("session", req.session.to_string()),
                ("token", req.upload_token),
            ])
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("upload request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("upload failed: {}", read_error_body(resp).await));
        }
        resp.json::<UploadResponse>()
            .await
            .map_err(|e| format!("upload response parse: {e}"))
    }

    /// Download a (possibly access-controlled) file into memory and return its
    /// bytes as standard base64.  Performs the same password / session-JWT
    /// ticket exchange as [`AppState::download_file`] but never touches disk -
    /// the caller turns the bytes into a same-origin blob URL for inline
    /// rendering.
    pub async fn download_to_base64(&self, req: DownloadBytesRequest) -> Result<String, String> {
        let client = &self.http_client;
        let mut download_url =
            reqwest::Url::parse(&req.url).map_err(|e| format!("invalid url: {e}"))?;

        if let Some(cred) = req.credential.as_ref() {
            let file_id = parse_file_id_from_url(&req.url)?;
            let ticket = obtain_ticket(client, &download_url, &file_id, cred).await?;
            let mut pairs: Vec<(String, String)> = download_url
                .query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .filter(|(k, _)| k != "ticket")
                .collect();
            pairs.push(("ticket".to_owned(), ticket));
            let _ = download_url
                .query_pairs_mut()
                .clear()
                .extend_pairs(pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        }

        let resp = client
            .get(download_url)
            .send()
            .await
            .map_err(|e| format!("download request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("download failed: {}", read_error_body(resp).await));
        }

        let mut buf: Vec<u8> = Vec::new();
        let mut stream = resp.bytes_stream();
        use futures_util::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download stream error: {e}"))?;
            if req.max_bytes > 0 && buf.len() as u64 + chunk.len() as u64 > req.max_bytes {
                return Err(format!("file exceeds max_bytes ({})", req.max_bytes));
            }
            buf.extend_from_slice(&chunk);
        }
        Ok(STANDARD.encode(&buf))
    }

    /// Fetch a value from the caller's private storage namespace.
    /// Returns `None` when the key is absent (HTTP 404).
    pub async fn private_get(&self, req: PrivateStorageRequest) -> Result<Option<String>, String> {
        let endpoint = format!(
            "{}/me/storage/{}",
            req.base_url.trim_end_matches('/'),
            req.key
        );
        let resp = self
            .http_client
            .get(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("private get request failed: {e}"))?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        // 403 means the caller is not a registered user (a genuine guest); the
        // UI shows a "register to keep documents" hint for this.  Any other
        // failure is a real error and must be surfaced distinctly so the UI
        // doesn't mislabel a server problem as "not registered".  The
        // `forbidden:` prefix is the contract the client checks for.
        if resp.status() == reqwest::StatusCode::FORBIDDEN {
            return Err(format!("forbidden: {}", read_error_body(resp).await));
        }
        if !resp.status().is_success() {
            return Err(format!("private get failed: {}", read_error_body(resp).await));
        }
        resp.text()
            .await
            .map(Some)
            .map_err(|e| format!("private get body: {e}"))
    }

    /// Store a value in the caller's private storage namespace.
    pub async fn private_put(&self, req: PrivateStorageRequest) -> Result<(), String> {
        let endpoint = format!(
            "{}/me/storage/{}",
            req.base_url.trim_end_matches('/'),
            req.key
        );
        let resp = self
            .http_client
            .put(endpoint)
            .bearer_auth(req.session_jwt)
            .header("content-type", "application/json")
            .body(req.value.unwrap_or_default())
            .send()
            .await
            .map_err(|e| format!("private put request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("private put failed: {}", read_error_body(resp).await));
        }
        Ok(())
    }

    /// List every file the server is storing, plus aggregate storage stats.
    /// Admin-only (`GET /admin/files`, gated by the session JWT server-side).
    /// Returned verbatim as JSON so the schema lives in one place (the
    /// server); the webview dashboard types it.
    pub async fn admin_list_files(
        &self,
        req: AdminListRequest,
    ) -> Result<serde_json::Value, String> {
        let endpoint = format!("{}/admin/files", req.base_url.trim_end_matches('/'));
        let resp = self
            .http_client
            .get(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("admin list request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("admin list failed: {}", read_error_body(resp).await));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("admin list parse: {e}"))
    }

    /// List every persisted live-doc document plus its revision metadata.
    /// Admin-only (`GET /admin/documents`, gated by the session JWT
    /// server-side).  Returned verbatim as JSON so the schema lives in one
    /// place (the server); the webview dashboard types it.
    pub async fn admin_list_documents(
        &self,
        req: AdminListRequest,
    ) -> Result<serde_json::Value, String> {
        let endpoint = format!("{}/admin/documents", req.base_url.trim_end_matches('/'));
        let resp = self
            .http_client
            .get(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("admin documents request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "admin documents failed: {}",
                read_error_body(resp).await
            ));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("admin documents parse: {e}"))
    }

    /// List per-user private-storage usage filtered to calendars (each user's
    /// `calendar` blob and its size). Admin-only (`GET /admin/private-storage`,
    /// gated by the session JWT). Returned verbatim as JSON.
    pub async fn admin_list_calendars(
        &self,
        req: AdminListRequest,
    ) -> Result<serde_json::Value, String> {
        let endpoint = format!(
            "{}/admin/private-storage?prefix=calendar",
            req.base_url.trim_end_matches('/')
        );
        let resp = self
            .http_client
            .get(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("admin calendars request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "admin calendars failed: {}",
                read_error_body(resp).await
            ));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("admin calendars parse: {e}"))
    }

    /// Delete one persisted live-doc document and all its revisions (blobs +
    /// metadata rows).  Admin-only (`DELETE /admin/documents/{name}`).
    pub async fn admin_delete_document(
        &self,
        req: AdminDeleteDocumentRequest,
    ) -> Result<(), String> {
        let endpoint = format!(
            "{}/admin/documents/{}",
            req.base_url.trim_end_matches('/'),
            req.name
        );
        let resp = self
            .http_client
            .delete(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("admin document delete request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "admin document delete failed: {}",
                read_error_body(resp).await
            ));
        }
        Ok(())
    }

    /// Delete one stored file (blob + metadata).  Admin-only
    /// (`DELETE /admin/files/{id}`).
    pub async fn admin_delete_file(&self, req: AdminDeleteRequest) -> Result<(), String> {
        let endpoint = format!(
            "{}/admin/files/{}",
            req.base_url.trim_end_matches('/'),
            req.file_id
        );
        let resp = self
            .http_client
            .delete(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("admin delete request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "admin delete failed: {}",
                read_error_body(resp).await
            ));
        }
        Ok(())
    }

    /// Stream a file's raw bytes (admin preview) and return them as standard
    /// base64 for the webview to render inline.  Admin-only
    /// (`GET /admin/files/{id}/raw`).
    pub async fn admin_file_base64(&self, req: AdminPreviewRequest) -> Result<String, String> {
        let endpoint = format!(
            "{}/admin/files/{}/raw",
            req.base_url.trim_end_matches('/'),
            req.file_id
        );
        let resp = self
            .http_client
            .get(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("admin preview request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "admin preview failed: {}",
                read_error_body(resp).await
            ));
        }

        let mut buf: Vec<u8> = Vec::new();
        let mut stream = resp.bytes_stream();
        use futures_util::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("preview stream error: {e}"))?;
            if req.max_bytes > 0 && buf.len() as u64 + chunk.len() as u64 > req.max_bytes {
                return Err(format!("file exceeds max_bytes ({})", req.max_bytes));
            }
            buf.extend_from_slice(&chunk);
        }
        Ok(STANDARD.encode(&buf))
    }

    /// List the *caller's own* uploaded files (`GET /me/files`).  Unlike the
    /// admin listing this needs no admin rights; the server scopes the result
    /// to the cert hash in the caller's session JWT, so a normal user only ever
    /// sees their own shared files.  Returned verbatim as JSON.
    pub async fn my_list_files(&self, req: AdminListRequest) -> Result<serde_json::Value, String> {
        let endpoint = format!("{}/me/files", req.base_url.trim_end_matches('/'));
        let resp = self
            .http_client
            .get(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("my files request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("my files failed: {}", read_error_body(resp).await));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("my files parse: {e}"))
    }

    /// Delete one of the caller's own files (`DELETE /me/files/{id}`).  The
    /// server returns 404 if the file isn't the caller's, so a user can only
    /// ever delete their own uploads.
    pub async fn my_delete_file(&self, req: AdminDeleteRequest) -> Result<(), String> {
        let endpoint = format!(
            "{}/me/files/{}",
            req.base_url.trim_end_matches('/'),
            req.file_id
        );
        let resp = self
            .http_client
            .delete(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("my delete request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("my delete failed: {}", read_error_body(resp).await));
        }
        Ok(())
    }

    /// Stream one of the caller's own files for an inline preview and return it
    /// as base64 (`GET /me/files/{id}/raw`).  Server-scoped to the caller's own
    /// uploads (404 otherwise).
    pub async fn my_file_base64(&self, req: AdminPreviewRequest) -> Result<String, String> {
        let endpoint = format!(
            "{}/me/files/{}/raw",
            req.base_url.trim_end_matches('/'),
            req.file_id
        );
        let resp = self
            .http_client
            .get(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("my preview request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("my preview failed: {}", read_error_body(resp).await));
        }

        let mut buf: Vec<u8> = Vec::new();
        let mut stream = resp.bytes_stream();
        use futures_util::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("preview stream error: {e}"))?;
            if req.max_bytes > 0 && buf.len() as u64 + chunk.len() as u64 > req.max_bytes {
                return Err(format!("file exceeds max_bytes ({})", req.max_bytes));
            }
            buf.extend_from_slice(&chunk);
        }
        Ok(STANDARD.encode(&buf))
    }

    /// Return the public, browser-openable signed download URL for one of the
    /// caller's own files (`GET /me/files/{id}/link`).  The server only issues a
    /// link for `public` files; others (password/session) error out because a
    /// plain browser link can't perform the in-app auth handshake.
    pub async fn my_file_link(&self, req: AdminDeleteRequest) -> Result<String, String> {
        let endpoint = format!(
            "{}/me/files/{}/link",
            req.base_url.trim_end_matches('/'),
            req.file_id
        );
        let resp = self
            .http_client
            .get(endpoint)
            .bearer_auth(req.session_jwt)
            .send()
            .await
            .map_err(|e| format!("my file link request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "my file link failed: {}",
                read_error_body(resp).await
            ));
        }
        let v = resp
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("my file link parse: {e}"))?;
        v.get("url")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| "my file link: response missing url".to_owned())
    }

    /// Download a file from the file-server plugin to `dest_path`.
    /// For non-public files, [`DownloadCredential`] must be supplied so the
    /// backend can perform the `POST /files/{id}/auth` exchange first.
    pub async fn download_file(&self, req: DownloadRequest) -> Result<u64, String> {
        let client = &self.http_client;
        let mut download_url =
            reqwest::Url::parse(&req.url).map_err(|e| format!("invalid url: {e}"))?;

        if let Some(cred) = req.credential.as_ref() {
            let file_id = parse_file_id_from_url(&req.url)?;
            let ticket = obtain_ticket(client, &download_url, &file_id, cred).await?;
            let mut pairs: Vec<(String, String)> = download_url
                .query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .filter(|(k, _)| k != "ticket")
                .collect();
            pairs.push(("ticket".to_owned(), ticket));
            let _ = download_url
                .query_pairs_mut()
                .clear()
                .extend_pairs(pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        }

        let resp = client
            .get(download_url)
            .send()
            .await
            .map_err(|e| format!("download request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("download failed: {}", read_error_body(resp).await));
        }

        if let Some(parent) = req.dest_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("create dest dir: {e}"))?;
        }
        let mut file = tokio::fs::File::create(&req.dest_path)
            .await
            .map_err(|e| format!("create dest file: {e}"))?;
        let mut total: u64 = 0;
        let mut stream = resp.bytes_stream();
        use futures_util::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download stream error: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("write dest file: {e}"))?;
            total += chunk.len() as u64;
        }
        file.flush()
            .await
            .map_err(|e| format!("flush dest file: {e}"))?;
        Ok(total)
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::expect_used,
        clippy::unwrap_used,
        reason = "tests panic on failure"
    )]
    use super::*;

    #[test]
    fn parse_file_id_from_valid_url() {
        let id = parse_file_id_from_url("https://files.example/files/abcd1234?ex=1&is=2&hm=3")
            .expect("valid url");
        assert_eq!(id, "abcd1234");
    }

    #[test]
    fn parse_file_id_rejects_non_files_path() {
        assert!(parse_file_id_from_url("https://example/other/abcd").is_err());
    }

    #[test]
    fn parse_file_id_rejects_empty_path() {
        assert!(parse_file_id_from_url("https://example/").is_err());
    }

    #[test]
    fn detect_filename_uses_override() {
        let req = UploadRequest {
            base_url: "http://x".into(),
            session: 1,
            upload_token: "t".into(),
            channel_id: 0,
            file_path: PathBuf::from("/tmp/data.bin"),
            filename: Some("nice.png".into()),
            mime_type: None,
            mode: FileAccessMode::Public,
            password: None,
            ttl_seconds: None,
            upload_id: String::new(),
        };
        assert_eq!(detect_filename(&req), "nice.png");
    }

    #[test]
    fn detect_filename_falls_back_to_basename() {
        let req = UploadRequest {
            base_url: "http://x".into(),
            session: 1,
            upload_token: "t".into(),
            channel_id: 0,
            file_path: PathBuf::from("/tmp/raw.dat"),
            filename: None,
            mime_type: None,
            mode: FileAccessMode::Public,
            password: None,
            ttl_seconds: None,
            upload_id: String::new(),
        };
        assert_eq!(detect_filename(&req), "raw.dat");
    }

    #[test]
    fn access_mode_strings_match_server() {
        assert_eq!(FileAccessMode::Public.as_str(), "public");
        assert_eq!(FileAccessMode::Password.as_str(), "password");
        assert_eq!(FileAccessMode::Session.as_str(), "session");
    }
}
