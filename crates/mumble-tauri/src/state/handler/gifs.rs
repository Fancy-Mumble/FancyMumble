//! The server's answers to a GIF search, on their way to the picker.
//!
//! Two events rather than one with an optional error, because the frontend
//! branches on them differently: a page is rendered, and a refusal decides
//! whether to fall back to a key the user configured themselves. A third,
//! `gif-support`, answers the once-per-connection "what can you do" question
//! before any search is made.

use mumble_protocol::proto::fancy;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};

/// One result, as the picker renders it.
#[derive(Serialize, Clone)]
struct GifResult {
    id: String,
    title: String,
    /// Full size, for sending into a channel.
    url: String,
    /// Grid size, for drawing the picker.
    preview: String,
    /// Zero means the provider did not say, and the grid should not reserve
    /// space it may have to give back.
    width: u32,
    height: u32,
    preview_width: u32,
    preview_height: u32,
    mime: String,
}

#[derive(Serialize, Clone)]
struct GifPagePayload {
    request_id: String,
    results: Vec<GifResult>,
    page: u32,
    has_next: bool,
    /// Which provider answered, for the attribution these APIs require.
    provider: String,
}

#[derive(Serialize, Clone)]
struct GifRefusedPayload {
    request_id: String,
    reason: String,
    retry_after_ms: u32,
    /// `"unavailable" | "throttled" | "upstream" | "malformed"`.
    ///
    /// A string rather than the raw enum number: the frontend branches on this
    /// to decide whether falling back to the user's own key is right, and a
    /// magic number at that decision is how the wrong branch gets taken after a
    /// renumbering nobody noticed.
    kind: &'static str,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
struct GifSupportPayload {
    request_id: String,
    /// Whether a search would be served at all.
    available: bool,
    /// The prefix the server's proxied `url`s and `preview`s start with, or
    /// empty when results point at the provider's own CDN.
    media_base: String,
    /// Which provider answers, for attribution.
    provider: String,
}

impl From<&fancy::media::GifSupport> for GifSupportPayload {
    fn from(support: &fancy::media::GifSupport) -> Self {
        Self {
            request_id: support.request_id.clone(),
            available: support.available,
            media_base: support.media_base.clone(),
            provider: support.provider.clone(),
        }
    }
}

/// The refusal kind, named.
///
/// An unknown number reads as `"upstream"` - a transient failure - rather than
/// as `"unavailable"`. That direction matters: `unavailable` is the one kind
/// the picker responds to by using the user's own key, so a future refusal this
/// build has never heard of must not be mistaken for permission to do that.
const fn kind_of(kind: i32) -> &'static str {
    match kind {
        0 => "unavailable",
        1 => "throttled",
        3 => "malformed",
        _ => "upstream",
    }
}

impl HandleMessage for fancy::media::GifPage {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(
            request_id = %self.request_id,
            results = self.results.len(),
            page = self.page,
            "received a page of gif results"
        );
        ctx.emit(
            "gif-search-page",
            GifPagePayload {
                request_id: self.request_id.clone(),
                results: self
                    .results
                    .iter()
                    .map(|gif| GifResult {
                        id: gif.id.clone(),
                        title: gif.title.clone(),
                        url: gif.url.clone(),
                        preview: gif.preview_url.clone(),
                        width: gif.width,
                        height: gif.height,
                        preview_width: gif.preview_width,
                        preview_height: gif.preview_height,
                        mime: gif.mime.clone(),
                    })
                    .collect(),
                page: self.page,
                has_next: self.has_next,
                provider: self.provider.clone(),
            },
        );
    }
}

impl HandleMessage for fancy::media::GifRefused {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(
            request_id = %self.request_id,
            reason = %self.reason,
            kind = kind_of(self.kind),
            "the server refused a gif search"
        );
        ctx.emit(
            "gif-search-refused",
            GifRefusedPayload {
                request_id: self.request_id.clone(),
                reason: self.reason.clone(),
                retry_after_ms: self.retry_after_ms,
                kind: kind_of(self.kind),
            },
        );
    }
}

impl HandleMessage for fancy::media::GifSupport {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(
            request_id = %self.request_id,
            available = self.available,
            media_base = %self.media_base,
            provider = %self.provider,
            "the server said what its gif service can do"
        );
        ctx.emit("gif-support", GifSupportPayload::from(self));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_kind_this_build_does_not_know_is_not_read_as_permission() {
        // `unavailable` is the one kind the picker answers by falling back to
        // the user's own key. A refusal added to the canon later must not land
        // there by accident, so the unknown case is the transient one.
        assert_eq!(kind_of(0), "unavailable");
        assert_eq!(kind_of(1), "throttled");
        assert_eq!(kind_of(2), "upstream");
        assert_eq!(kind_of(3), "malformed");
        assert_eq!(kind_of(99), "upstream");
        assert_eq!(kind_of(-1), "upstream");
    }

    #[test]
    fn the_support_answer_reaches_the_frontend_under_the_names_it_reads() {
        let support = fancy::media::GifSupport {
            request_id: "g-1".to_owned(),
            available: true,
            media_base: "https://chat.example.org/gif?".to_owned(),
            provider: "klipy".to_owned(),
        };
        let json = serde_json::to_value(GifSupportPayload::from(&support))
            .expect("the payload serializes");
        assert_eq!(
            json,
            serde_json::json!({
                "request_id": "g-1",
                "available": true,
                "media_base": "https://chat.example.org/gif?",
                "provider": "klipy",
            })
        );
    }
}
