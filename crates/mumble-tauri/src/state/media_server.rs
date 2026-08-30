//! A loopback HTTP origin, so a shared file can be *played* rather than
//! downloaded.
//!
//! # Why this is not a custom URI scheme
//!
//! The obvious way to give the webview an address for an object with no
//! standing URL is a Tauri custom protocol, the way `asset:` works for local
//! files. It serves bytes correctly - ranges included - and an `<img>` loads
//! from it happily. A `<video>` does not: `WebKitGTK` plays media through
//! `GStreamer`, which fetches over its own HTTP stack rather than through
//! `WebKit`'s loader, and knows nothing about a scheme registered on the web
//! context. Every clip fails as `MEDIA_ERR_SRC_NOT_SUPPORTED`, whatever the
//! codec, while the same bytes fetched by hand and wrapped in a blob play
//! fine. `asset:` has the same hole, which is why a saved video never
//! previewed on Linux either.
//!
//! So the media element is given what it can actually load: an ordinary HTTP
//! origin on loopback, which every media stack in every webview understands.
//!
//! # What guards it
//!
//! The listener is bound to `127.0.0.1` and every URL carries a token minted
//! once per run, so the objects this hands out are reachable only by something
//! that was told the address - not by anything that happens to guess the port.
//! Nothing is served without one, and the token never leaves the machine.
//!
//! # Why a range is capped
//!
//! A player opens with `Range: bytes=0-`, meaning "all of it". Answering that
//! literally would hold a whole film in memory to satisfy a request for its
//! header, so the span is capped and the answer is a partial one: the player
//! reads `Content-Range`, learns the real length, and comes back for the next
//! piece when it needs it.

use std::convert::Infallible;
use std::net::{Ipv4Addr, SocketAddr};

use http_body_util::Full;
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{header, Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tauri::Manager as _;
use tokio::net::TcpListener;

use super::AppState;

/// The most this hands back in one response.
///
/// The same figure Tauri's asset protocol uses. Large enough that playback
/// starts on one or two requests, small enough that a dozen open videos are
/// not a memory problem.
const MAX_SPAN: u64 = 1000 * 1024;

/// A running loopback origin, and the secret half of the URLs it answers.
pub(crate) struct MediaServer {
    /// `http://127.0.0.1:<port>/<token>`, the prefix every media URL carries.
    base_url: String,
}

impl MediaServer {
    /// The URL a media element should be pointed at for one stored object.
    pub(crate) fn url_for(&self, key: &str) -> String {
        let path = percent_encoding::utf8_percent_encode(key, percent_encoding::NON_ALPHANUMERIC);
        format!("{}/{path}", self.base_url)
    }
}

/// Bring the origin up, on a port the OS picks.
///
/// Returns the running server, or the reason it could not start - which is a
/// preview that does not appear rather than anything worse: the card below it
/// still names the file and still offers to save it.
pub(crate) async fn start(app: tauri::AppHandle) -> Result<MediaServer, String> {
    let token = mint_token();
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .await
        .map_err(|e| format!("could not open a media port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("could not read the media port: {e}"))?
        .port();

    let served_token = token.clone();
    drop(tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            drop(tauri::async_runtime::spawn(converse(
                stream,
                app.clone(),
                served_token.clone(),
            )));
        }
    }));

    Ok(MediaServer {
        base_url: format!("http://127.0.0.1:{port}/{token}"),
    })
}

/// Answer requests on one connection until the player closes it.
///
/// A player keeps a connection open across the pieces it asks for, so this
/// outlives any single range.
async fn converse(stream: tokio::net::TcpStream, app: tauri::AppHandle, token: String) {
    let service = service_fn(move |request| {
        let app = app.clone();
        let token = token.clone();
        async move { Ok::<_, Infallible>(answer(&app, &token, request).await) }
    });
    // A dropped connection is the ordinary end of a video the viewer scrolled
    // past, not something to report.
    let _served = http1::Builder::new()
        .serve_connection(TokioIo::new(stream), service)
        .await;
}

/// A secret that has to be presented with every request.
fn mint_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// The object one request names, once its token has been checked.
///
/// `None` when the path is not `/<token>/<key>` with the token this run
/// minted - including when it is a *different* token, which is the case worth
/// keeping quiet about: the answer looks the same as a request for nothing.
fn key_of(path: &str, token: &str) -> Option<String> {
    let rest = path.strip_prefix('/')?;
    let (presented, key) = rest.split_once('/')?;
    if presented != token {
        return None;
    }
    let key = percent_encoding::percent_decode(key.as_bytes())
        .decode_utf8()
        .ok()?
        .into_owned();
    (!key.is_empty()).then_some(key)
}

/// The span a `Range` header asks for, capped, as a header to send upstream.
///
/// `None` when the request carried no range at all - answered whole, which is
/// what a request for a small file deserves.
pub(crate) fn upstream_range(header: Option<&str>) -> Option<String> {
    let spec = header?.trim().strip_prefix("bytes=")?;
    // Only a single span is ever asked for by a media element, and answering a
    // multi-range request needs a body shape this does not build.
    if spec.contains(',') {
        return None;
    }
    let (first, last) = spec.trim().split_once('-')?;
    // A suffix range (`-N`) is already bounded by its own count, and the file
    // server is the end that knows where the object stops.
    if first.is_empty() {
        return Some(format!("bytes={spec}"));
    }
    let start: u64 = first.parse().ok()?;
    let ceiling = start.saturating_add(MAX_SPAN - 1);
    let end = match last {
        "" => ceiling,
        value => value.parse::<u64>().ok()?.min(ceiling),
    };
    Some(format!("bytes={start}-{end}"))
}

/// Serve one request, against whatever this app is connected to.
async fn answer(
    app: &tauri::AppHandle,
    token: &str,
    request: Request<Incoming>,
) -> Response<Full<Bytes>> {
    let Some(state) = app.try_state::<AppState>() else {
        return refuse(StatusCode::SERVICE_UNAVAILABLE);
    };
    serve(
        request.method(),
        request.uri().path(),
        request
            .headers()
            .get(header::RANGE)
            .and_then(|value| value.to_str().ok()),
        token,
        |key, range| async move { state.starling_media_range(&key, range.as_deref()).await },
    )
    .await
}

/// Turn one request into one answer.
///
/// Split from [`answer`] around `fetch` so the whole shape of the exchange -
/// what a wrong token gets, what a range turns into, what a `HEAD` leaves out
/// - is testable without an app, a connection or a server to be connected to.
async fn serve<F, Fut>(
    method: &Method,
    path: &str,
    range_header: Option<&str>,
    token: &str,
    fetch: F,
) -> Response<Full<Bytes>>
where
    F: FnOnce(String, Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<FetchedSpan, String>>,
{
    if method != Method::GET && method != Method::HEAD {
        return refuse(StatusCode::METHOD_NOT_ALLOWED);
    }
    // One answer for a wrong token and for a key that names nothing, so the
    // port cannot be used to learn which objects exist.
    let Some(key) = key_of(path, token) else {
        return refuse(StatusCode::NOT_FOUND);
    };
    let range = upstream_range(range_header);

    match fetch(key.clone(), range).await {
        Ok(fetched) => fetched.into_response(method == Method::HEAD),
        Err(error) => {
            tracing::debug!("media origin: {key} could not be served: {error}");
            refuse(StatusCode::NOT_FOUND)
        }
    }
}

/// What came back from the file server for one span of one object.
pub(crate) struct FetchedSpan {
    pub(crate) status: u16,
    pub(crate) content_type: Option<String>,
    pub(crate) content_range: Option<String>,
    pub(crate) bytes: Vec<u8>,
}

impl FetchedSpan {
    fn into_response(self, head_only: bool) -> Response<Full<Bytes>> {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::OK);
        let length = self.bytes.len();
        let mut builder = Response::builder()
            .status(status)
            // Read off the first answer: a player decides whether it can seek
            // before it asks for a second byte.
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, length)
            // The bytes are whatever somebody uploaded, so the webview is told
            // not to guess at their type.
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
        if let Some(value) = self.content_type {
            builder = builder.header(header::CONTENT_TYPE, value);
        }
        if let Some(value) = self.content_range {
            builder = builder.header(header::CONTENT_RANGE, value);
        }
        let body = if head_only {
            Full::new(Bytes::new())
        } else {
            Full::new(Bytes::from(self.bytes))
        };
        builder
            .body(body)
            .unwrap_or_else(|_| refuse(StatusCode::INTERNAL_SERVER_ERROR))
    }
}

/// An answer with no body, for everything that did not work.
fn refuse(status: StatusCode) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_LENGTH, 0)
        .body(Full::new(Bytes::new()))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn a_key_arrives_percent_encoded_and_comes_back_whole() {
        // Keys nest, so the slashes in one are escaped rather than becoming
        // path segments that would be read as part of the token.
        assert_eq!(
            key_of(&format!("/{TOKEN}/7%2F01890a%2Fclip.mp4"), TOKEN).as_deref(),
            Some("7/01890a/clip.mp4")
        );
    }

    #[test]
    fn a_request_without_this_run_s_token_is_served_nothing() {
        // The whole guard on a port anything local could knock on.
        assert_eq!(key_of("/wrong-token/7%2Fclip.mp4", TOKEN), None);
        assert_eq!(key_of("/7%2Fclip.mp4", TOKEN), None);
        assert_eq!(key_of(&format!("/{TOKEN}/"), TOKEN), None);
    }

    #[test]
    fn a_token_is_long_enough_not_to_be_guessed_and_differs_per_run() {
        let first = mint_token();
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(first, mint_token());
    }

    #[test]
    fn an_open_ended_range_is_capped_rather_than_answered_whole() {
        // The first thing a player sends. Answering it literally would hold a
        // whole film in memory to satisfy a request for its header.
        assert_eq!(
            upstream_range(Some("bytes=0-")).as_deref(),
            Some("bytes=0-1023999")
        );
        assert_eq!(
            upstream_range(Some("bytes=5000-")).as_deref(),
            Some("bytes=5000-1028999")
        );
    }

    #[test]
    fn a_span_smaller_than_the_cap_is_asked_for_as_it_was() {
        assert_eq!(
            upstream_range(Some("bytes=100-199")).as_deref(),
            Some("bytes=100-199")
        );
    }

    #[test]
    fn a_suffix_range_goes_up_unchanged() {
        // Where an MP4's index lives, and it is bounded by its own count.
        assert_eq!(
            upstream_range(Some("bytes=-2048")).as_deref(),
            Some("bytes=-2048")
        );
    }

    #[test]
    fn a_request_without_a_usable_range_asks_for_the_whole_object() {
        assert_eq!(upstream_range(None), None);
        assert_eq!(upstream_range(Some("bytes=0-10,20-30")), None);
        assert_eq!(upstream_range(Some("items=0-10")), None);
    }

    /// A span standing in for one the file server would have answered with.
    fn span(status: u16, bytes: &[u8], content_range: Option<&str>) -> FetchedSpan {
        FetchedSpan {
            status,
            content_type: Some("video/mp4".to_owned()),
            content_range: content_range.map(str::to_owned),
            bytes: bytes.to_vec(),
        }
    }

    async fn body_of(response: Response<Full<Bytes>>) -> Vec<u8> {
        use http_body_util::BodyExt as _;
        response
            .into_body()
            .collect()
            .await
            .expect("a body")
            .to_bytes()
            .to_vec()
    }

    #[tokio::test]
    async fn a_partial_answer_is_passed_on_as_one() {
        // What the player needs to seek: the status, the span and the total
        // length, exactly as the file server stated them.
        let response = serve(
            &Method::GET,
            &format!("/{TOKEN}/7%2Fclip.mp4"),
            Some("bytes=0-"),
            TOKEN,
            |key, range| async move {
                assert_eq!(key, "7/clip.mp4");
                assert_eq!(
                    range.as_deref(),
                    Some("bytes=0-1023999"),
                    "capped, not whole"
                );
                Ok(span(206, b"abcdef", Some("bytes 0-5/900000000")))
            },
        )
        .await;

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 0-5/900000000"
        );
        assert_eq!(
            response.headers().get(header::ACCEPT_RANGES).unwrap(),
            "bytes"
        );
        assert_eq!(response.headers().get(header::CONTENT_LENGTH).unwrap(), "6");
        assert_eq!(body_of(response).await, b"abcdef");
    }

    #[tokio::test]
    async fn a_head_answers_the_headers_and_none_of_the_bytes() {
        // A player asks first and reads later; the length has to be the one a
        // GET would have produced, not the empty body's.
        let response = serve(
            &Method::HEAD,
            &format!("/{TOKEN}/7%2Fclip.mp4"),
            None,
            TOKEN,
            |_, _| async move { Ok(span(200, b"abcdef", None)) },
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(header::CONTENT_LENGTH).unwrap(), "6");
        assert!(body_of(response).await.is_empty());
    }

    #[tokio::test]
    async fn a_wrong_token_is_answered_the_same_way_as_a_missing_object() {
        // The port is open to anything local, so it must not confirm that a
        // key exists to something that could not have been told the token.
        let mut fetched = false;
        let response = serve(
            &Method::GET,
            "/not-the-token/7%2Fclip.mp4",
            None,
            TOKEN,
            |_, _| {
                fetched = true;
                async move { Ok(span(200, b"secret", None)) }
            },
        )
        .await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(
            !fetched,
            "nothing is fetched for a request that lacks the token"
        );
        assert!(body_of(response).await.is_empty());
    }

    #[tokio::test]
    async fn nothing_may_be_written_through_this_port() {
        let response = serve(
            &Method::PUT,
            &format!("/{TOKEN}/7%2Fclip.mp4"),
            None,
            TOKEN,
            |_, _| async move { Ok(span(200, b"", None)) },
        )
        .await;

        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn a_fetch_that_fails_shows_no_preview_rather_than_a_broken_one() {
        let response = serve(
            &Method::GET,
            &format!("/{TOKEN}/7%2Fclip.mp4"),
            None,
            TOKEN,
            |_, _| async move { Err("Not connected".to_owned()) },
        )
        .await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
