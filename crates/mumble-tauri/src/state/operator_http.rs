//! Calling the Starling operator API from the backend.
//!
//! The webview cannot call it directly: it is a different origin, so a `fetch`
//! is CORS-blocked, and attaching the admin bearer from JavaScript would put the
//! credential in the page. Livery and server plugin administration both go
//! through here.
//!
//! A refusal comes back as the operator API's own `{"error": "..."}` text rather
//! than a status code. Those messages name the field and the rule it broke, and
//! "Bad Request" would throw away the only part an operator can act on.

use std::sync::OnceLock;

/// The client every operator call goes through; each request sets its own
/// timeout.
///
/// Built once. Constructing a client loads the platform's root certificates,
/// which costs far more than the request it is built for, and every call used
/// to build its own. Idle connections are not kept, so each call still opens a
/// fresh one, exactly as before.
///
/// # Errors
///
/// When the TLS backend cannot be initialised.
pub(crate) fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .pool_max_idle_per_host(0)
                .build()
                .map_err(|error| format!("HTTP client init failed: {error}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// `https://host:port` without a trailing slash, and nothing else.
///
/// A base URL is operator-typed, so it arrives with stray slashes and, often,
/// no scheme at all. The scheme is required rather than guessed: defaulting to
/// `http` would send a bearer token in clear to whatever answered.
pub(crate) fn base(url: &str) -> Result<String, String> {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("no operator API address is set".to_owned());
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("the operator API address must start with http:// or https://".to_owned());
    }
    Ok(trimmed.to_owned())
}

/// Turn a response into its body, or into the operator API's own message.
///
/// `url` is named in the error only when the answer did not come from the
/// operator API, and that distinction is the whole point of carrying it here.
/// Starling refuses with `{"error": "..."}` and those messages need no address
/// attached. Anything else answered instead of Starling: a reverse proxy with no
/// route to it replies with its own 404 (Traefik's is the bare text
/// `404 page not found`), and which address was called is then the entire
/// diagnosis.
pub(crate) async fn body(response: reqwest::Response, url: &str) -> Result<String, String> {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if status.is_success() {
        return Ok(text);
    }
    let refused = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
        });
    Err(match refused {
        Some(message) => message,
        None if text.trim().is_empty() => format!("HTTP {status} from {url}"),
        None => format!(
            "{} — from {url}, which is not the operator API",
            text.trim()
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_base_url_must_name_its_scheme() {
        // Guessing http would put a bearer token in clear on the wire.
        assert!(base("localhost:8081").is_err());
        assert!(base("").is_err());
        assert_eq!(base("  https://x:8081/  ").unwrap(), "https://x:8081");
        assert_eq!(
            base("http://127.0.0.1:8081").unwrap(),
            "http://127.0.0.1:8081"
        );
    }
}
