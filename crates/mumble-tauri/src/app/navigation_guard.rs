//! Keep the app's own webviews on the app.
//!
//! The webview runs with no CSP and every window renders HTML that other
//! people wrote - chat messages, channel descriptions, bios. The sanitisers are
//! what keep a `<form action=...>` or an `<area href=...>` out of that markup,
//! but if one ever slips through, a single click would navigate the window
//! itself to a page of the sender's choosing: the app is gone, the page looks
//! like whatever it wants to (a login prompt, say), and there is no back button.
//!
//! So a top-level navigation may only go somewhere the app itself is served
//! from. External links are unaffected: they never navigate the webview, they
//! go through the link guard to the opener plugin and out to the system
//! browser.
//!
//! # Why only Windows and Android
//!
//! The hook sees a URL and nothing else - not which frame is navigating. On
//! `WebView2` it fires for the main frame only, and Android's
//! `shouldOverrideUrlLoading` skips http(s) subframe loads. `WebKitGTK` and
//! `WKWebView` ask the same question for every iframe, so there the guard would
//! also refuse the video and link-preview embeds the app loads on purpose.

use tauri::plugin::TauriPlugin;
use tauri::{Manager, Runtime};
use url::Url;

/// The host the app is served from on Windows and Android, under `http:` or
/// `https:` depending on `useHttpsScheme`.
const APP_HOST: &str = "tauri.localhost";

/// The plugin that refuses navigations off the app; see the module docs.
pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            let config = webview.app_handle().config();
            let dev_url = if tauri::is_dev() {
                config.build.dev_url.as_ref()
            } else {
                None
            };
            let allowed = is_app_url(url, dev_url);
            if !allowed {
                tracing::warn!(
                    "blocked navigation of webview '{}' to {}",
                    webview.label(),
                    url.origin().ascii_serialization()
                );
            }
            allowed
        })
        .build()
}

/// Whether a top-level navigation to `url` stays inside the app.
///
/// `dev_url` is the Vite server a dev build loads its frontend from, and is
/// only passed in a dev build: a release build has no business loading
/// anything from localhost.
pub(crate) fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        // The custom protocol the other desktop platforms serve the app from.
        "tauri" => url.host_str() == Some("localhost"),
        // A blank page, or an iframe's `srcdoc`: nothing is loaded from anywhere.
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        // A blob belongs to whoever created it, and its URL says who: only the
        // app's own blobs may be shown at the top level.
        "blob" => Url::parse(url.path())
            .is_ok_and(|inner| inner.scheme() != "blob" && is_app_url(&inner, dev_url)),
        "http" | "https" => {
            url.host_str() == Some(APP_HOST)
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(url: &str, dev_url: Option<&str>) -> bool {
        let dev = dev_url.map(|d| Url::parse(d).expect("dev url"));
        is_app_url(&Url::parse(url).expect("url"), dev.as_ref())
    }

    #[test]
    fn the_app_origin_is_allowed_under_every_scheme_it_is_served_from() {
        assert!(allowed("http://tauri.localhost/", None));
        assert!(allowed("https://tauri.localhost/index.html?x=1#y", None));
        assert!(allowed("tauri://localhost/", None));
        assert!(allowed("about:blank", None));
    }

    #[test]
    fn external_pages_are_refused() {
        assert!(!allowed("https://evil.example/p", None));
        assert!(!allowed("http://tauri.localhost.evil.example/", None));
        assert!(!allowed("https://evil.example/?h=tauri.localhost", None));
        assert!(!allowed("tauri://evil.example/", None));
        assert!(!allowed("javascript:alert(1)", None));
        assert!(!allowed("data:text/html,<h1>hi</h1>", None));
        assert!(!allowed("file:///C:/Windows/win.ini", None));
        assert!(!allowed("http://asset.localhost/C%3A/x.html", None));
    }

    #[test]
    fn blobs_are_allowed_only_from_the_app() {
        assert!(allowed("blob:http://tauri.localhost/0b1d", None));
        assert!(!allowed("blob:https://evil.example/0b1d", None));
        assert!(!allowed("blob:blob:http://tauri.localhost/0b1d", None));
    }

    #[test]
    fn the_dev_server_is_allowed_only_when_passed() {
        let dev = Some("http://localhost:1420");
        assert!(allowed("http://localhost:1420/", dev));
        assert!(!allowed("http://localhost:1421/", dev));
        assert!(!allowed("http://localhost:1420/", None));
    }
}
