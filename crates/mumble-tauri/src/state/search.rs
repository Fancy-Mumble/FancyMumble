//! Fuzzy super-search across users, channels, and messages.

use std::collections::HashMap;

use fancy_utils::fuzzy;
use fancy_utils::html::{contains_ignore_ascii_case, find_ignore_ascii_case, visible_text};

use super::AppState;
use super::offload::{BodySummary, OffloadStore};
use super::offload_ops::offloaded_summary;
use super::types::{
    ChatMessage, MessageContext, PhotoEntry, SearchCategory, SearchFilter, SearchResult,
};

/// Maximum number of results to return per category.
const MAX_PER_CATEGORY: usize = 10;
/// Maximum total results returned.
const MAX_TOTAL: usize = 25;
/// Score threshold - discard results worse than this.
const SCORE_CUTOFF: u32 = fuzzy::DEFAULT_SCORE_CUTOFF;
/// Longest message snippet shown in a search result, in characters.
const SNIPPET_LEN: usize = 80;

/// Check whether an HTML message body contains an image tag.
fn body_has_image(body: &str) -> bool {
    contains_ignore_ascii_case(body, "<img") || contains_ignore_ascii_case(body, "data:image")
}

/// Check whether an HTML message body contains a hyperlink or bare URL.
fn body_has_link(body: &str) -> bool {
    contains_ignore_ascii_case(body, "<a ")
        || contains_ignore_ascii_case(body, "http://")
        || contains_ignore_ascii_case(body, "https://")
}

/// Everything search and the photo grid need from a body, computed once
/// when the body is put away (see [`BodySummary`]).
pub(super) fn summarize_body(body: &str) -> BodySummary {
    BodySummary {
        visible_text: visible_text(body),
        has_image: body_has_image(body),
        has_link: body_has_link(body),
        image_count: img_srcs(body).count(),
    }
}

impl AppState {
    /// Fuzzy-search across all data types.
    ///
    /// Returns results sorted by score (best first), capped at [`MAX_TOTAL`].
    ///
    /// `filter` narrows the search scope:
    /// - `None` or `"all"` - search everything (default)
    /// - `"messages"` - only chat messages
    /// - `"photos"` - only messages containing images
    /// - `"users"` - only users
    /// - `"links"` - only messages containing links
    pub fn super_search(
        &self,
        query: &str,
        filter: SearchFilter,
        channel_id: Option<u32>,
    ) -> Vec<SearchResult> {
        let query_lower = query.to_lowercase();
        if query_lower.is_empty() {
            return Vec::new();
        }

        let __session = self.inner.snapshot();

        let Ok(state) = __session.lock() else {
            return Vec::new();
        };

        let scoped = channel_id.is_some();
        let search_channels = !scoped && filter == SearchFilter::All;
        let search_users = !scoped && matches!(filter, SearchFilter::All | SearchFilter::Users);
        let search_messages = matches!(
            filter,
            SearchFilter::All | SearchFilter::Messages | SearchFilter::Photos | SearchFilter::Links
        );

        let mut results = Vec::new();

        if search_channels {
            results.extend(search_channels_fuzzy(&state, &query_lower));
        }
        if search_users {
            results.extend(search_users_fuzzy(&state, &query_lower));
        }
        if search_messages {
            let message_query = MessageQuery {
                query_lower: &query_lower,
                query,
                filter_photos: filter == SearchFilter::Photos,
                filter_links: filter == SearchFilter::Links,
                store: state.offload_store.as_ref(),
            };
            results.extend(search_messages_fuzzy(&state, &message_query, channel_id));
        }

        results.sort_by_key(|r| r.score);
        results.truncate(MAX_TOTAL);
        results
    }

    /// Return paginated photo entries extracted from all chat messages.
    ///
    /// Photos are sorted newest-first (by timestamp if available, then
    /// insertion order as fallback).  Pagination is via `offset` / `limit`.
    pub fn get_photos(&self, offset: usize, limit: usize) -> Vec<PhotoEntry> {
        let __session = self.inner.snapshot();
        let Ok(state) = __session.lock() else {
            return Vec::new();
        };
        collect_photos(&state, offset, limit)
    }
}

// -- Helpers -------------------------------------------------------

fn search_channels_fuzzy(state: &super::SharedState, query_lower: &str) -> Vec<SearchResult> {
    let mut results: Vec<SearchResult> = state
        .channels
        .values()
        .filter_map(|ch| {
            let score = fuzzy::fuzzy_score(query_lower, &ch.name.to_lowercase(), SCORE_CUTOFF)?;
            Some(SearchResult {
                category: SearchCategory::Channel,
                score,
                title: ch.name.clone(),
                subtitle: None,
                id: Some(ch.id),
                string_id: None,
                message: None,
            })
        })
        .collect();
    results.sort_by_key(|r| r.score);
    results.truncate(MAX_PER_CATEGORY);
    results
}

fn search_users_fuzzy(state: &super::SharedState, query_lower: &str) -> Vec<SearchResult> {
    let mut results: Vec<SearchResult> = state
        .users
        .values()
        .filter_map(|u| {
            let score = fuzzy::fuzzy_score(query_lower, &u.name.to_lowercase(), SCORE_CUTOFF)?;
            let ch_name = state.channels.get(&u.channel_id).map(|c| c.name.clone());
            Some(SearchResult {
                category: SearchCategory::User,
                score,
                title: u.name.clone(),
                subtitle: ch_name,
                id: Some(u.session),
                string_id: None,
                message: None,
            })
        })
        .collect();
    results.sort_by_key(|r| r.score);
    results.truncate(MAX_PER_CATEGORY);
    results
}

/// One message search, shared by every bucket it runs over.
struct MessageQuery<'a> {
    query_lower: &'a str,
    query: &'a str,
    filter_photos: bool,
    filter_links: bool,
    /// Where put-away bodies live; their summaries stand in for them.
    store: Option<&'a OffloadStore>,
}

fn search_messages_fuzzy(
    state: &super::SharedState,
    q: &MessageQuery<'_>,
    channel_id: Option<u32>,
) -> Vec<SearchResult> {
    let mut msg_results: Vec<SearchResult> = Vec::new();

    for (ch_id, msgs) in &state.msgs.by_channel {
        if channel_id.is_some_and(|scope| *ch_id != scope) {
            continue;
        }
        let ch_name = state
            .channels
            .get(ch_id)
            .map(|c| c.name.as_str())
            .unwrap_or("Unknown");
        msg_results.extend(collect_channel_message_results(msgs, *ch_id, ch_name, q));
    }

    if channel_id.is_none() {
        for msgs in state.msgs.by_dm.values() {
            msg_results.extend(collect_dm_message_results(msgs, q));
        }
    }

    msg_results.sort_by_key(|r| r.score);
    msg_results.truncate(MAX_PER_CATEGORY);
    msg_results
}

/// The `src` of every `<img>` tag in an HTML string, in order, borrowed
/// from it.
///
/// Scans the original bytes ASCII-case-insensitively. Finding `<img` in a
/// `to_lowercase()` copy and slicing the original with that offset broke
/// as soon as a character whose lowercase form has another byte length
/// ('İ', the Kelvin sign) came before the tag: the offset pointed at the
/// wrong place or into the middle of a character, and the slice panicked.
fn img_srcs(html: &str) -> impl Iterator<Item = &str> {
    let mut from = 0;
    std::iter::from_fn(move || {
        loop {
            let start = find_ignore_ascii_case(html, "<img", from)?;
            // `<` and `>` are ASCII, so both ends are char boundaries.
            let tag_end = start + html[start..].find('>')?;
            from = tag_end + 1;
            let tag = &html[start..=tag_end];
            // `<imgur>` is not an image.
            let whole_name = tag
                .as_bytes()
                .get(4)
                .is_some_and(|&b| b.is_ascii_whitespace() || b == b'/' || b == b'>');
            if !whole_name {
                continue;
            }
            if let Some(src) = attr_value(tag, "src")
                && !src.is_empty()
            {
                return Some(src);
            }
        }
    })
}

/// Extract `src` attributes from `<img>` tags in an HTML string.
fn extract_img_srcs(html: &str) -> Vec<String> {
    img_srcs(html).map(str::to_owned).collect()
}

/// The value of the attribute `attr` (lowercase ASCII) in a tag string.
///
/// Only a whole attribute name counts - `data-src=` and `srcset=` are not
/// `src=` - and double-quoted, single-quoted and unquoted values are read.
fn attr_value<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let mut from = 0;
    while let Some(pos) = find_ignore_ascii_case(tag, attr, from) {
        from = pos + 1;
        let after_space = pos
            .checked_sub(1)
            .and_then(|before| tag.as_bytes().get(before))
            .is_some_and(u8::is_ascii_whitespace);
        if !after_space {
            continue;
        }
        // `attr` is ASCII, so `pos + attr.len()` is a char boundary.
        let Some(rest) = tag[pos + attr.len()..].trim_start().strip_prefix('=') else {
            continue;
        };
        return Some(read_attr_value(rest.trim_start()));
    }
    None
}

/// Read an attribute value off the start of `rest` (just after `=`).
fn read_attr_value(rest: &str) -> &str {
    match rest.chars().next() {
        Some(quote @ ('"' | '\'')) => {
            let inner = &rest[1..];
            // An unterminated quote runs to the end of the tag.
            let end = inner.find(quote).unwrap_or(inner.len());
            &inner[..end]
        }
        _ => {
            let end = rest
                .find(|c: char| c.is_ascii_whitespace() || c == '>')
                .unwrap_or(rest.len());
            &rest[..end]
        }
    }
}

/// One photo the grid could show: which message, which of its images.
///
/// Resolving a slot to its `src` waits until the page is cut, because a
/// put-away body has to be read back from the store to get it, and only
/// the page being shown is worth that.
struct PhotoSlot<'a> {
    msg: &'a ChatMessage,
    /// The channel and its name, or `None` for a direct message.
    channel: Option<(u32, &'a str)>,
    /// Index among the message's image sources.
    nth: usize,
}

/// The photo grid's page `offset..offset + limit`, newest first.
///
/// Offloaded messages count too. The idle-channel sweep puts away most
/// pictures a stock Mumble client pastes inline, and reading only the
/// in-memory bodies made them vanish from the grid once their channel was
/// left. Their bodies are read back for the page alone and dropped with
/// it; the messages stay put away.
fn collect_photos(state: &super::SharedState, offset: usize, limit: usize) -> Vec<PhotoEntry> {
    let store = state.offload_store.as_ref();
    let mut slots: Vec<PhotoSlot<'_>> = Vec::new();

    for (channel_id, msgs) in &state.msgs.by_channel {
        let ch_name = state
            .channels
            .get(channel_id)
            .map(|c| c.name.as_str())
            .unwrap_or("Unknown");
        for msg in msgs {
            push_photo_slots(msg, Some((*channel_id, ch_name)), store, &mut slots);
        }
    }
    for msgs in state.msgs.by_dm.values() {
        for msg in msgs {
            push_photo_slots(msg, None, store, &mut slots);
        }
    }

    // Sort newest-first.  Messages without a timestamp sort last.
    slots.sort_by(|a, b| {
        let ta = a.msg.timestamp.unwrap_or(0);
        let tb = b.msg.timestamp.unwrap_or(0);
        tb.cmp(&ta)
    });

    let mut loaded: HashMap<&str, Vec<String>> = HashMap::new();
    slots
        .into_iter()
        .skip(offset)
        .take(limit)
        .filter_map(|slot| {
            let src = resolve_photo_src(&slot, store, &mut loaded)?;
            Some(photo_entry(&slot, src))
        })
        .collect()
}

/// Add one slot per image `msg` shows, whether its body is in memory or
/// put away.
fn push_photo_slots<'a>(
    msg: &'a ChatMessage,
    channel: Option<(u32, &'a str)>,
    store: Option<&OffloadStore>,
    slots: &mut Vec<PhotoSlot<'a>>,
) {
    let count = match offloaded_summary(msg, store) {
        Some(summary) => summary.image_count,
        None if body_has_image(&msg.body) => img_srcs(&msg.body).count(),
        None => 0,
    };
    slots.extend((0..count).map(|nth| PhotoSlot { msg, channel, nth }));
}

/// The `src` a slot stands for, reading a put-away body back if needed.
///
/// `loaded` holds the sources of bodies already read back for this page,
/// by message id, so a message with several pictures is decrypted once.
fn resolve_photo_src<'a>(
    slot: &PhotoSlot<'a>,
    store: Option<&OffloadStore>,
    loaded: &mut HashMap<&'a str, Vec<String>>,
) -> Option<String> {
    if offloaded_summary(slot.msg, store).is_none() {
        return img_srcs(&slot.msg.body).nth(slot.nth).map(str::to_owned);
    }
    let id = slot.msg.message_id.as_deref()?;
    let srcs = loaded.entry(id).or_insert_with(|| {
        store
            .and_then(|s| s.load(id).ok())
            .map(|body| extract_img_srcs(&body))
            .unwrap_or_default()
    });
    srcs.get(slot.nth).cloned()
}

fn photo_entry(slot: &PhotoSlot<'_>, src: String) -> PhotoEntry {
    let msg = slot.msg;
    let (channel_id, dm_session, context) = match slot.channel {
        Some((id, name)) => (Some(id), None, format!("in #{name}")),
        None => (None, msg.dm_session, format!("DM with {}", msg.sender_name)),
    };
    PhotoEntry {
        src,
        sender_name: msg.sender_name.clone(),
        channel_id,
        dm_session,
        context,
        timestamp: msg.timestamp,
    }
}

/// Score `msg` against the query, returning the score and the visible text
/// it was scored on (the snippet is cut from the same text).
///
/// Matches what the reader sees, never the markup: scored against the raw
/// body, "jpeg", "src" or "base64" hit every pasted picture, and "br" or
/// "nbsp" nearly every message a stock Mumble client sent. An offloaded
/// body is scored on the visible text its summary kept.
fn score_one_message(msg: &ChatMessage, q: &MessageQuery<'_>) -> Option<(u32, String)> {
    let offloaded = offloaded_summary(msg, q.store);
    if q.filter_photos && !offloaded.map_or_else(|| body_has_image(&msg.body), |s| s.has_image) {
        return None;
    }
    if q.filter_links && !offloaded.map_or_else(|| body_has_link(&msg.body), |s| s.has_link) {
        return None;
    }
    let text = offloaded.map_or_else(|| visible_text(&msg.body), |s| s.visible_text.clone());
    let score = fuzzy::fuzzy_score(q.query_lower, &text.to_lowercase(), SCORE_CUTOFF)?;
    Some((score, text))
}

fn collect_channel_message_results(
    msgs: &[ChatMessage],
    ch_id: u32,
    ch_name: &str,
    q: &MessageQuery<'_>,
) -> Vec<SearchResult> {
    msgs.iter()
        .filter_map(|msg| {
            let (score, text) = score_one_message(msg, q)?;
            Some(SearchResult {
                category: SearchCategory::Message,
                score,
                title: fuzzy::snippet_plain(&text, q.query, SNIPPET_LEN),
                subtitle: Some(format!("{} in #{ch_name}", msg.sender_name)),
                id: Some(ch_id),
                string_id: msg.message_id.clone(),
                message: Some(MessageContext {
                    sender_session: msg.sender_session,
                    sender_name: msg.sender_name.clone(),
                    context: format!("in #{ch_name}"),
                    timestamp: msg.timestamp,
                    dm: false,
                }),
            })
        })
        .collect()
}

fn collect_dm_message_results(msgs: &[ChatMessage], q: &MessageQuery<'_>) -> Vec<SearchResult> {
    msgs.iter()
        .filter_map(|msg| {
            let (score, text) = score_one_message(msg, q)?;
            Some(SearchResult {
                category: SearchCategory::Message,
                score,
                title: fuzzy::snippet_plain(&text, q.query, SNIPPET_LEN),
                subtitle: Some(format!("DM with {}", msg.sender_name)),
                id: msg.dm_session,
                string_id: msg.message_id.clone(),
                message: Some(MessageContext {
                    sender_session: msg.sender_session,
                    sender_name: msg.sender_name.clone(),
                    context: format!("DM with {}", msg.sender_name),
                    timestamp: msg.timestamp,
                    dm: true,
                }),
            })
        })
        .collect()
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "panic-on-failure is acceptable in test code"
)]
mod tests {
    use super::*;
    use crate::state::SharedState;
    use crate::state::offload_ops::offload_idle_bodies;

    fn message(id: &str, body: &str, timestamp: u64) -> ChatMessage {
        ChatMessage {
            sender_session: Some(1),
            sender_name: "user".into(),
            sender_hash: None,
            body: body.into(),
            channel_id: 0,
            is_own: false,
            dm_session: None,
            message_id: Some(id.into()),
            timestamp: Some(timestamp),
            is_legacy: false,
            send_failed: false,
            edited_at: None,
            pinned: false,
            pinned_by: None,
            pinned_at: None,
            plugin_name: None,
            plugin_components: None,
        }
    }

    /// A stock-Mumble paste: an inline picture over the offload threshold.
    fn pasted_picture(caption: &str, payload: char) -> String {
        format!(
            "{caption}<img src=\"data:image/jpeg;base64,{}\">",
            payload.to_string().repeat(70_000)
        )
    }

    fn query<'a>(
        query: &'a str,
        filter: SearchFilter,
        store: Option<&'a OffloadStore>,
    ) -> MessageQuery<'a> {
        MessageQuery {
            query_lower: query,
            query,
            filter_photos: filter == SearchFilter::Photos,
            filter_links: filter == SearchFilter::Links,
            store,
        }
    }

    fn search(state: &SharedState, q: &str, filter: SearchFilter) -> Vec<SearchResult> {
        let store = state.offload_store.as_ref();
        search_messages_fuzzy(state, &query(q, filter, store), None)
    }

    fn state_with_store(dir: &tempfile::TempDir) -> SharedState {
        SharedState {
            offload_store: Some(OffloadStore::new(dir.path().to_path_buf()).unwrap()),
            ..SharedState::default()
        }
    }

    #[test]
    fn extract_single_img_double_quotes() {
        let html = r#"<p>Hello</p><img src="data:image/png;base64,abc123" alt="pic">"#;
        let srcs = extract_img_srcs(html);
        assert_eq!(srcs, vec!["data:image/png;base64,abc123"]);
    }

    #[test]
    fn extract_single_img_single_quotes() {
        let html = "<img src='https://example.com/photo.jpg'>";
        let srcs = extract_img_srcs(html);
        assert_eq!(srcs, vec!["https://example.com/photo.jpg"]);
    }

    #[test]
    fn extract_multiple_images() {
        let html = r#"<img src="a.png"><p>text</p><img src="b.jpg">"#;
        let srcs = extract_img_srcs(html);
        assert_eq!(srcs, vec!["a.png", "b.jpg"]);
    }

    #[test]
    fn extract_no_images() {
        let srcs = extract_img_srcs("<p>No images here</p>");
        assert!(srcs.is_empty());
    }

    #[test]
    fn extract_img_with_extra_attrs() {
        let html = r#"<img alt="photo" src="pic.webp" width="200">"#;
        let srcs = extract_img_srcs(html);
        assert_eq!(srcs, vec!["pic.webp"]);
    }

    #[test]
    fn extract_after_case_changing_characters() {
        // 'İ' (2 bytes) lowercases to 3 bytes and the Kelvin sign (3 bytes)
        // to 1: offsets from a lowercased copy used to land mid-character
        // and panic, or slice the wrong tag.
        let html = format!(
            "{}<IMG SRC=\"a.png\">{}<img src='b.png'>",
            "İ".repeat(7),
            "\u{212a}".repeat(5)
        );
        assert_eq!(extract_img_srcs(&html), vec!["a.png", "b.png"]);
        let html = format!(
            "{}<img alt=\"{}\" src=\"c.png\">",
            "\u{212a}".repeat(9),
            "İ".repeat(3)
        );
        assert_eq!(extract_img_srcs(&html), vec!["c.png"]);
    }

    #[test]
    fn extract_skips_lookalike_tags_and_attributes() {
        let html = r#"<imgur src="no.png"><img data-src="lazy.png" srcset="x 2x" src="yes.png">"#;
        assert_eq!(extract_img_srcs(html), vec!["yes.png"]);
    }

    #[test]
    fn extract_unquoted_and_spaced_attributes() {
        assert_eq!(extract_img_srcs("<img src=a.png alt=x>"), vec!["a.png"]);
        assert_eq!(extract_img_srcs("<img src = \"b.png\" />"), vec!["b.png"]);
    }

    #[test]
    fn extract_attr_double_quotes() {
        assert_eq!(
            attr_value(r#"<img src="hello.png">"#, "src"),
            Some("hello.png")
        );
    }

    #[test]
    fn extract_attr_missing() {
        assert_eq!(attr_value("<img alt='x'>", "src"), None);
    }

    #[test]
    fn body_has_image_detects_img_tag() {
        assert!(body_has_image(r#"<img src="x.png">"#));
        assert!(body_has_image(r#"İ<IMG src="x.png">"#));
    }

    #[test]
    fn body_has_image_detects_data_uri() {
        assert!(body_has_image("look: data:image/png;base64,abc"));
    }

    #[test]
    fn body_has_image_negative() {
        assert!(!body_has_image("<p>No images</p>"));
    }

    #[test]
    fn search_never_panics_on_a_long_multibyte_message() {
        // Crashed the client: "end byte index 80 is not a char boundary".
        let mut state = SharedState::default();
        let body = format!("a{}", "ä".repeat(60));
        let _ = state
            .msgs
            .by_channel
            .insert(1, vec![message("m", &body, 1)]);
        let results = search(&state, "a", SearchFilter::All);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, body);
    }

    #[test]
    fn search_matches_visible_text_not_markup() {
        let mut state = SharedState::default();
        let stock_picture = "<img src=\"data:image/jpeg;base64,/9j/4AAQSkZJRg\">";
        let stock_text = "<p>hello&nbsp;there<br>friend</p>";
        let _ = state.msgs.by_channel.insert(
            1,
            vec![
                message("pic", stock_picture, 1),
                message("txt", stock_text, 2),
            ],
        );
        for markup in ["jpeg", "src", "base64", "nbsp", "br", "img"] {
            let results = search(&state, markup, SearchFilter::All);
            assert!(results.is_empty(), "{markup:?} matched {results:?}");
        }
        let results = search(&state, "there friend", SearchFilter::All);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "hello there friend");
    }

    #[test]
    fn search_skips_comment_markers() {
        let mut state = SharedState::default();
        let body = "<!-- FANCY_FILE:{\"name\":\"report.pdf\"} -->";
        let _ = state.msgs.by_channel.insert(1, vec![message("f", body, 1)]);
        assert!(search(&state, "fancy_file", SearchFilter::All).is_empty());
    }

    #[test]
    fn offloaded_pictures_stay_searchable() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = state_with_store(&dir);
        let mut msgs = vec![message("m", &pasted_picture("sunset at the lake", 'A'), 1)];
        let store = state.offload_store.as_mut().unwrap();
        assert_eq!(offload_idle_bodies(&mut msgs, store, 0), 1);
        let _ = state.msgs.by_channel.insert(1, msgs);

        let results = search(&state, "sunset", SearchFilter::Photos);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "sunset at the lake");
    }

    #[test]
    fn photos_include_offloaded_pictures_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = state_with_store(&dir);
        let old = pasted_picture("old", 'A');
        let new = pasted_picture("new", 'B');
        let mut msgs = vec![
            message("old", &old, 1),
            message("small", "<img src=\"tiny.png\"><img src=\"tiny2.png\">", 2),
            message("new", &new, 3),
            message("text", "just words", 4),
        ];
        let store = state.offload_store.as_mut().unwrap();
        assert_eq!(offload_idle_bodies(&mut msgs, store, 0), 2);
        let _ = state.msgs.by_channel.insert(1, msgs);

        let photos = collect_photos(&state, 0, 10);
        assert_eq!(photos.len(), 4);
        assert!(photos[0].src.ends_with("BBBB"));
        assert_eq!(photos[1].src, "tiny.png");
        assert_eq!(photos[2].src, "tiny2.png");
        assert!(photos[3].src.ends_with("AAAA"));
        assert_eq!(photos[0].context, "in #Unknown");
        assert_eq!(photos[0].channel_id, Some(1));

        // Pagination cuts by photo, and reading a page back does not
        // restore the bodies: they stay put away.
        let page = collect_photos(&state, 3, 10);
        assert_eq!(page.len(), 1);
        assert!(page[0].src.ends_with("AAAA"));
        assert!(
            state.msgs.by_channel[&1][0]
                .body
                .starts_with("<!-- OFFLOADED:")
        );
        assert_eq!(state.offload_store.as_ref().unwrap().offloaded_count(), 2);
    }

    #[test]
    fn photos_from_direct_messages_say_who() {
        let mut state = SharedState::default();
        let mut dm = message("d", "<img src=\"x.png\">", 1);
        dm.dm_session = Some(7);
        let _ = state.msgs.by_dm.insert(7, vec![dm]);
        let photos = collect_photos(&state, 0, 10);
        assert_eq!(photos.len(), 1);
        assert_eq!(photos[0].dm_session, Some(7));
        assert_eq!(photos[0].channel_id, None);
        assert_eq!(photos[0].context, "DM with user");
    }

    #[test]
    fn summary_matches_what_search_reads_off_a_body() {
        let body =
            "<p>Hi&amp;bye</p><img src=\"a.png\"><img src=\"b.png\"> <a href=\"https://x\">x</a>";
        let summary = summarize_body(body);
        assert_eq!(summary.visible_text, "Hi&bye x");
        assert!(summary.has_image);
        assert!(summary.has_link);
        assert_eq!(summary.image_count, 2);
    }
}
