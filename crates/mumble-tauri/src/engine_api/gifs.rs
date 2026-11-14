//! GIFs, for a view that is not the web page: asking the server what its
//! GIF service offers, searching it, and the message a picked GIF is sent
//! as, the way the web client sends it.
//!
//! The server's answers arrive as [`super::EngineEvent::GifSupport`],
//! [`super::EngineEvent::GifPage`] and [`super::EngineEvent::GifRefused`],
//! each carrying the request id it answers; matching them up is the view's
//! (`state::handler::gifs` says why there are three).

use fancy_utils::html::{LEGACY_FALLBACK_CLOSE, LEGACY_FALLBACK_OPEN, LEGACY_FALLBACK_TAG};

use super::EngineHandle;

/// What a server's GIF service offers, in answer to
/// [`EngineHandle::request_gif_support`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GifSupport {
    /// The request this answers.
    pub request_id: String,
    /// Whether a search would be served at all.
    pub available: bool,
    /// The prefix the server's own copies of the pictures start with, or
    /// empty when results point at the provider's own addresses.
    pub media_base: String,
    /// Which provider answers, for attribution.
    pub provider: String,
}

/// One result of a search.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Gif {
    /// The provider's own handle for it.
    pub id: String,
    /// What it is called; `"GIF"` where the provider named nothing.
    pub title: String,
    /// The full size, the one that is sent.
    pub url: String,
    /// The size a picker draws.
    pub preview: String,
    /// The size of `url`; zero where the provider did not say.
    pub width: u32,
    /// The height of `url`; zero where the provider did not say.
    pub height: u32,
    /// The size of `preview`; zero where the provider did not say.
    pub preview_width: u32,
    /// The height of `preview`; zero where the provider did not say.
    pub preview_height: u32,
    /// What `url` is: `image/webp`, `image/gif`, `video/mp4`.
    pub mime: String,
}

/// One page of results, in answer to [`EngineHandle::request_gif_search`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GifPage {
    /// The request this answers.
    pub request_id: String,
    /// What was found, in the provider's order.
    pub results: Vec<Gif>,
    /// Which page this is, from one.
    pub page: u32,
    /// Whether asking for the next page would bring more.
    pub has_next: bool,
    /// Which provider answered, for attribution.
    pub provider: String,
}

/// Why the server would not search.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GifRefusal {
    /// It has no GIF service: the one refusal a key of the user's own may
    /// answer.
    Unavailable,
    /// Too many searches; waiting would help.
    Throttled,
    /// The provider failed it. Also what a refusal this build does not
    /// know reads as.
    Upstream,
    /// The search itself was refused.
    Malformed,
}

impl GifRefusal {
    /// The kind as the engine names it (`state::handler::gifs`).
    fn named(kind: &str) -> Self {
        match kind {
            "unavailable" => Self::Unavailable,
            "throttled" => Self::Throttled,
            "malformed" => Self::Malformed,
            _ => Self::Upstream,
        }
    }
}

/// A search the server refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GifRefused {
    /// The request this answers.
    pub request_id: String,
    /// The server's words.
    pub reason: String,
    /// How long until asking again could work; 0 when waiting would not.
    pub retry_after_ms: u32,
    /// Why.
    pub kind: GifRefusal,
}

impl From<crate::state::GifSupportPayload> for GifSupport {
    fn from(payload: crate::state::GifSupportPayload) -> Self {
        Self {
            request_id: payload.request_id,
            available: payload.available,
            media_base: payload.media_base,
            provider: payload.provider,
        }
    }
}

impl From<crate::state::GifPagePayload> for GifPage {
    fn from(payload: crate::state::GifPagePayload) -> Self {
        Self {
            request_id: payload.request_id,
            results: payload
                .results
                .into_iter()
                .map(|gif| Gif {
                    id: gif.id,
                    title: gif.title,
                    url: gif.url,
                    preview: gif.preview,
                    width: gif.width,
                    height: gif.height,
                    preview_width: gif.preview_width,
                    preview_height: gif.preview_height,
                    mime: gif.mime,
                })
                .collect(),
            page: payload.page,
            has_next: payload.has_next,
            provider: payload.provider,
        }
    }
}

impl From<crate::state::GifRefusedPayload> for GifRefused {
    fn from(payload: crate::state::GifRefusedPayload) -> Self {
        Self {
            request_id: payload.request_id,
            reason: payload.reason,
            retry_after_ms: payload.retry_after_ms,
            kind: GifRefusal::named(payload.kind),
        }
    }
}

/// What the server takes of a message, as far as a picked GIF's body
/// cares: the web client's `MessageLimits`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessageLimits {
    /// Whether it takes HTML at all.
    pub allow_html: bool,
    /// The most text, counted as the server counts it; 0 for no limit.
    pub max_message_length: u32,
    /// The most a message carrying a picture may be; 0 for no limit.
    pub max_image_message_length: u32,
}

impl Default for MessageLimits {
    /// Mumble's own defaults, for a server that did not say.
    fn default() -> Self {
        Self {
            allow_html: true,
            max_message_length: 5000,
            max_image_message_length: 131_072,
        }
    }
}

impl EngineHandle {
    /// Ask the server what its GIF service offers. The answer arrives as
    /// [`super::EngineEvent::GifSupport`] with `request_id`; a server that
    /// predates GIFs never answers.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn request_gif_support(&self, request_id: &str) -> Result<(), String> {
        self.state.request_gif_support(request_id.to_owned()).await
    }

    /// Ask the server for page `page` (from one) of the GIFs found for
    /// `query`, or of those trending when `query` is empty. The answer
    /// arrives as [`super::EngineEvent::GifPage`] or
    /// [`super::EngineEvent::GifRefused`] with `request_id`.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn request_gif_search(
        &self,
        query: &str,
        page: u32,
        request_id: &str,
    ) -> Result<(), String> {
        self.state
            .request_gif_search(query.to_owned(), page, request_id.to_owned())
            .await
    }

    /// What the server connected to takes of a message.
    pub fn message_limits(&self) -> MessageLimits {
        let config = self.state.server_config();
        MessageLimits {
            allow_html: config.allow_html,
            max_message_length: config.max_message_length,
            max_image_message_length: config.max_image_message_length,
        }
    }

    /// The message the GIF at `url` is sent as, answering the message
    /// `reply_to` if one is given: as the web client's composer sends a
    /// pick, on what the server connected to takes.
    pub fn picked_gif_html(&self, url: &str, reply_to: Option<&str>) -> String {
        let body = picked_gif_body(url, self.message_limits());
        match reply_to {
            Some(to) => super::reply_html(to, &body),
            None => body,
        }
    }
}

/// The message the GIF at `url` is sent as on a server that takes
/// `limits`: the picture by its address, and for a client that loads no
/// picture from the web, a link to it fenced in where only such a client
/// reads it. The web client's `withRemoteImageLink`, to the byte.
pub fn picked_gif_body(url: &str, limits: MessageLimits) -> String {
    let picture = format!(r#"<img src="{}" alt="GIF">"#, escaped(url));
    let link = legacy_link(url);
    if !limits.allow_html || link.is_empty() {
        return picture;
    }
    let fenced = format!(
        "{picture}\n{LEGACY_FALLBACK_TAG}{LEGACY_FALLBACK_OPEN}{link}{LEGACY_FALLBACK_CLOSE}"
    );
    if accepted(&fenced, limits) {
        fenced
    } else {
        picture
    }
}

/// The link a stock Mumble client is given for the GIF at `url`: only for
/// an `https` address with no space in it (`remoteImageLink`).
fn legacy_link(url: &str) -> String {
    let https = url
        .get(..8)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"));
    if !https || url.len() == 8 || url.chars().any(char::is_whitespace) {
        return String::new();
    }
    format!(r#"<a href="{}">GIF</a>"#, escaped(url))
}

/// `text` made safe inside an attribute (`escapeAttr`).
pub(super) fn escaped(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Whether the server would take `body` (`serverAccepts`): lengths in
/// UTF-16 units, as the web client counts them.
pub(super) fn accepted(body: &str, limits: MessageLimits) -> bool {
    let over = |length: usize, limit: u32| limit > 0 && length > limit as usize;
    let length = body.encode_utf16().count();
    if over(length, limits.max_image_message_length) {
        return false;
    }
    if !over(length, limits.max_message_length) {
        return true;
    }
    body.contains('<')
        && !over(
            words_as_counted(body).encode_utf16().count(),
            limits.max_message_length,
        )
}

/// The words between the tags, as the server counts them (Starling's
/// `strip_html`, the web client's `stripHtmlLikeServer`).
fn words_as_counted(html: &str) -> String {
    let mut out = String::new();
    let mut tag = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            tag.clear();
        } else if ch == '>' && in_tag {
            in_tag = false;
            let closing = tag.starts_with('/');
            let name = tag
                .trim_start_matches('/')
                .split([' ', '/', '\t'])
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase();
            if name == "br" || (closing && name == "p") {
                out.push('\n');
            }
        } else if in_tag {
            tag.push(ch);
        } else {
            out.push(ch);
        }
    }
    let lines: Vec<String> = out
        .split('\n')
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect();
    lines
        .join("\n")
        .trim()
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://media.example/g/cat.gif?x=1&y=2";

    #[test]
    fn a_pick_is_the_picture_and_a_fenced_link_as_the_web_client_writes_it() {
        assert_eq!(
            picked_gif_body(URL, MessageLimits::default()),
            "<img src=\"https://media.example/g/cat.gif?x=1&amp;y=2\" alt=\"GIF\">\n\
             <!-- FANCY_FALLBACK --><!-- FANCY_LEGACY -->\
             <a href=\"https://media.example/g/cat.gif?x=1&amp;y=2\">GIF</a>\
             <!-- /FANCY_LEGACY -->"
        );
        // A Fancy client reads the picture alone.
        assert_eq!(
            fancy_utils::html::strip_legacy_fallback(&picked_gif_body(
                URL,
                MessageLimits::default()
            )),
            "<img src=\"https://media.example/g/cat.gif?x=1&amp;y=2\" alt=\"GIF\">"
        );
    }

    #[test]
    fn no_link_where_it_could_not_be_followed_or_would_not_be_taken() {
        let picture = "<img src=\"http://media.example/cat.gif\" alt=\"GIF\">";
        assert_eq!(
            picked_gif_body("http://media.example/cat.gif", MessageLimits::default()),
            picture,
            "only https gets a link"
        );
        let plain = MessageLimits {
            allow_html: false,
            ..MessageLimits::default()
        };
        assert!(!picked_gif_body(URL, plain).contains("FANCY_LEGACY"));
        let tight = MessageLimits {
            max_image_message_length: 100,
            ..MessageLimits::default()
        };
        assert!(!picked_gif_body(URL, tight).contains("FANCY_LEGACY"));
        // Long, but the words in it are few: taken.
        let long = MessageLimits {
            max_message_length: 50,
            ..MessageLimits::default()
        };
        assert!(picked_gif_body(URL, long).contains("FANCY_LEGACY"));
    }

    #[test]
    fn the_words_are_counted_as_the_server_counts_them() {
        assert_eq!(words_as_counted("<p>a  b</p><br/>c <i>d</i>"), "a b\n\nc d");
        assert_eq!(words_as_counted("x < y"), "x");
    }

    #[test]
    fn a_refusal_this_build_does_not_know_is_not_read_as_unavailable() {
        assert_eq!(GifRefusal::named("unavailable"), GifRefusal::Unavailable);
        assert_eq!(GifRefusal::named("throttled"), GifRefusal::Throttled);
        assert_eq!(GifRefusal::named("malformed"), GifRefusal::Malformed);
        assert_eq!(GifRefusal::named("later"), GifRefusal::Upstream);
    }
}
