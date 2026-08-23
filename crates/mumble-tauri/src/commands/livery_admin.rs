//! Proxy commands for the Starling operator API's livery surface.
//!
//! The webview cannot call the operator API directly: it is a different origin,
//! so a `fetch` is CORS-blocked, and attaching the admin bearer from JavaScript
//! would put the credential in the page. Both are the same reasons the
//! file-server dashboard proxies through the backend, and this follows it.
//!
//! Every handler returns the operator API's own `{"error": "..."}` text rather
//! than a status code. Those messages name the field and the rule it broke —
//! "tagline is longer than 120 characters", "dark.accent is red;…, which is not
//! #rrggbb" — and an editor that replaced them with "Bad Request" would be
//! throwing away the only part an operator can act on.

use std::time::Duration;

/// How long any one operator call may take.
///
/// Longer than the file-server probe's five seconds because an image upload is
/// on this path, and shorter than forever because a hung admin panel that never
/// says so is indistinguishable from a broken one.
const TIMEOUT: Duration = Duration::from_secs(20);

/// Which livery image a call addresses. Rejected here rather than interpolated,
/// so no caller can steer the path.
fn image_path(which: &str) -> Result<&'static str, String> {
    match which {
        "banner" => Ok("banner"),
        "icon" => Ok("icon"),
        other => Err(format!("no livery image is called {other}")),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|error| format!("HTTP client init failed: {error}"))
}

/// `https://host:port` without a trailing slash, and nothing else.
///
/// A base URL is operator-typed, so it arrives with stray slashes and, often,
/// no scheme at all. The scheme is required rather than guessed: defaulting to
/// `http` would send a bearer token in clear to whatever answered.
fn base(url: &str) -> Result<String, String> {
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
async fn body(response: reqwest::Response) -> Result<String, String> {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if status.is_success() {
        return Ok(text);
    }
    // `{"error": "..."}` when the operator API refused; the raw body otherwise,
    // which is what a reverse proxy in front of it would send.
    let message = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| {
            if text.trim().is_empty() {
                format!("HTTP {status}")
            } else {
                text.clone()
            }
        });
    Err(message)
}

async fn get_json(url: &str, token: &str) -> Result<serde_json::Value, String> {
    let response = client()?
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;
    let text = body(response).await?;
    serde_json::from_str(&text).map_err(|error| format!("the answer was not JSON: {error}"))
}

/// Read the whole livery document.
#[tauri::command]
pub(crate) async fn livery_get(
    base_url: String,
    token: String,
) -> Result<serde_json::Value, String> {
    get_json(&format!("{}/v1/livery", base(&base_url)?), &token).await
}

/// Write the fields named in `patch`, and only those.
///
/// The operator API merges field-wise, so an editor sends what changed rather
/// than the whole document; two operators editing different halves of the
/// branding then do not overwrite each other.
#[tauri::command]
pub(crate) async fn livery_set(
    base_url: String,
    token: String,
    patch: serde_json::Value,
) -> Result<(), String> {
    let response = client()?
        .post(format!("{}/v1/livery", base(&base_url)?))
        .bearer_auth(&token)
        .json(&patch)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;
    body(response).await.map(|_| ())
}

/// What a client on `mode` will actually paint, after the contrast clamp.
#[tauri::command]
pub(crate) async fn livery_preview(
    base_url: String,
    token: String,
    mode: String,
) -> Result<serde_json::Value, String> {
    let mode = if mode == "light" { "light" } else { "dark" };
    get_json(
        &format!("{}/v1/livery/preview?mode={mode}", base(&base_url)?),
        &token,
    )
    .await
}

/// Store an image and point the document at it, in one call.
#[tauri::command]
pub(crate) async fn livery_upload_image(
    base_url: String,
    token: String,
    which: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let response = client()?
        .put(format!(
            "{}/v1/livery/{}",
            base(&base_url)?,
            image_path(&which)?
        ))
        .bearer_auth(&token)
        .body(bytes)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;
    body(response).await.map(|_| ())
}

/// Remove an image and clear the key pointing at it.
#[tauri::command]
pub(crate) async fn livery_clear_image(
    base_url: String,
    token: String,
    which: String,
) -> Result<(), String> {
    let response = client()?
        .delete(format!(
            "{}/v1/livery/{}",
            base(&base_url)?,
            image_path(&which)?
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;
    body(response).await.map(|_| ())
}

/// An image as a `data:` URI, or `None` when none is set.
///
/// Fetched here and handed over as bytes for the same reason the connect screen
/// does it: the operator API needs a bearer the page must not hold, and an
/// `<img src>` at that URL could not carry one anyway.
#[tauri::command]
pub(crate) async fn livery_image_data_uri(
    base_url: String,
    token: String,
    which: String,
) -> Result<Option<String>, String> {
    use base64::Engine as _;

    let response = client()?
        .get(format!(
            "{}/v1/livery/{}",
            base(&base_url)?,
            image_path(&which)?
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;

    // Not an error: an unset image is the normal state for most servers, and a
    // caller would only translate a 404 back into "there is none".
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(body(response).await.err().unwrap_or_else(|| {
            "the operator API answered with an unexpected success".to_owned()
        }));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("could not read the image: {error}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:{content_type};base64,{encoded}")))
}

/// Whether the operator API is reachable with this credential.
///
/// `POST /v1/whoami` demands the literal `*` scope, so it is the wrong probe for
/// a narrowly-scoped token: this reads the livery instead, which is the scope
/// the tab actually needs and therefore the one worth reporting on.
#[tauri::command]
pub(crate) async fn livery_check(base_url: String, token: String) -> Result<String, String> {
    let document = livery_get(base_url, token).await?;
    let version = document
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    Ok(if version == 0 {
        "connected; this server has no livery yet".to_owned()
    } else {
        format!("connected; livery version {version}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;


    /// Drive the real proxy commands against a running operator API.
    ///
    /// Ignored by default because it needs one:
    /// `LIVERY_API=http://127.0.0.1:18081 LIVERY_TOKEN=... cargo test -p
    /// mumble-tauri -- --ignored livery_admin_round_trip --nocapture`
    #[tokio::test]
    #[ignore = "needs a live operator API; set LIVERY_API and LIVERY_TOKEN"]
    async fn livery_admin_round_trip() {
        let (api, token) = match (std::env::var("LIVERY_API"), std::env::var("LIVERY_TOKEN")) {
            (Ok(api), Ok(token)) => (api, token),
            _ => panic!("set LIVERY_API and LIVERY_TOKEN"),
        };

        let hello = livery_check(api.clone(), token.clone()).await.expect("reachable");
        println!("check: {hello}");

        livery_set(
            api.clone(),
            token.clone(),
            serde_json::json!({"tagline": "set by the admin tab", "dark": {"accent": "#8a90ff"}}),
        )
        .await
        .expect("write");

        let document = livery_get(api.clone(), token.clone()).await.expect("read");
        assert_eq!(document["tagline"], "set by the admin tab");
        assert_eq!(document["dark"]["accent"], "#8a90ff");
        println!("digest: {}", document["digest"]);

        let preview = livery_preview(api.clone(), token.clone(), "dark".to_owned())
            .await
            .expect("preview");
        println!("preview: {preview}");

        // A refusal has to arrive as the operator API's own sentence, because
        // that names the field and the rule; "HTTP 400" would not.
        let refused = livery_set(
            api.clone(),
            token.clone(),
            serde_json::json!({"dark": {"accent": "red;background:url(x)"}}),
        )
        .await
        .expect_err("a hostile colour is refused");
        assert!(refused.contains("#rrggbb"), "unhelpful refusal: {refused}");
        println!("refusal: {refused}");

        // An unset image is absence, not an error.
        let icon = livery_image_data_uri(api.clone(), token.clone(), "icon".to_owned())
            .await
            .expect("no transport failure");
        assert!(icon.is_none(), "nothing has been uploaded yet");

        // The bytes path, which is where a marshalling mistake would land.
        let png: Vec<u8> = std::fs::read(
            std::env::var("LIVERY_IMAGE").unwrap_or_else(|_| "/nonexistent".to_owned()),
        )
        .unwrap_or_default();
        if png.is_empty() {
            println!("upload: skipped, set LIVERY_IMAGE to exercise it");
            return;
        }
        livery_upload_image(api.clone(), token.clone(), "banner".to_owned(), png.clone())
            .await
            .expect("upload");
        let banner = livery_image_data_uri(api.clone(), token.clone(), "banner".to_owned())
            .await
            .expect("read back")
            .expect("a banner is set now");
        assert!(banner.starts_with("data:image/"), "not an image: {}", &banner[..24]);
        println!("upload: {} bytes -> {}", png.len(), &banner[..24]);

        livery_clear_image(api.clone(), token.clone(), "banner".to_owned())
            .await
            .expect("clear");
        assert!(
            livery_image_data_uri(api, token, "banner".to_owned())
                .await
                .expect("no transport failure")
                .is_none(),
            "clearing left the image behind"
        );
        println!("clear: banner removed");
    }

    #[test]
    fn a_base_url_must_name_its_scheme() {
        // Guessing http would put a bearer token in clear on the wire.
        assert!(base("localhost:8081").is_err());
        assert!(base("").is_err());
        assert_eq!(base("  https://x:8081/  ").unwrap(), "https://x:8081");
        assert_eq!(base("http://127.0.0.1:8081").unwrap(), "http://127.0.0.1:8081");
    }

    #[test]
    fn only_the_two_images_are_addressable() {
        assert!(image_path("banner").is_ok());
        assert!(image_path("icon").is_ok());
        for hostile in ["../config", "banner/../../v1/accounts", "", "BANNER"] {
            assert!(image_path(hostile).is_err(), "{hostile} should be refused");
        }
    }
}
