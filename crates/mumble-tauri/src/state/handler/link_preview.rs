use mumble_protocol::proto::mumble_tcp;
use serde::{Deserialize, Serialize};
use tracing::debug;

use super::{HandleMessage, HandlerContext};

/// Server-side downscaled preview, ready to render in `<img>`.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub(crate) struct EmbedPreview {
    /// `data:image/jpeg;base64,...` URL the frontend can drop straight into an
    /// `<img src>` without ever performing a network request to the origin
    /// host.
    pub data_url: String,
    pub mime: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub(crate) struct EmbedMedia {
    /// Original (full-resolution) media URL.  Only fetched on explicit user
    /// action so the user's IP isn't leaked to the origin host by default.
    pub url: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    /// Bytes the original CDN reported for the source asset.
    pub original_size: Option<u32>,
    /// Inline server-fetched preview.  When present the UI MUST prefer this
    /// over `url` so the user's IP isn't leaked to the origin.
    pub preview: Option<EmbedPreview>,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub(crate) struct EmbedProvider {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub(crate) struct EmbedAuthor {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub(crate) struct EmbedField {
    pub name: String,
    pub value: String,
    pub inline: bool,
}

/// What a shop listing costs, rebuilt from the `price.*` field rows.
///
/// The canon carries a typed price and the epoch-0 `Embed` has no field for
/// one, so `canon.rs` sends it as four named rows and this reads them back.
/// The names are the contract between the two, and they are spelled out at
/// both ends; nothing else may be named `price.*`.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub(crate) struct EmbedPrice {
    /// The amount, decimal point and all: "89.99".
    pub amount: String,
    /// ISO 4217 where the page named one, empty where it did not.
    pub currency: String,
    /// What it cost before, for a listing that advertises a reduction.
    pub was: String,
    /// "instock", "oos", "preorder" - as the page wrote it.
    pub availability: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub(crate) struct LinkEmbed {
    pub url: Option<String>,
    pub r#type: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub color: Option<i32>,
    pub site_name: Option<String>,
    pub thumbnail: Option<EmbedMedia>,
    pub image: Option<EmbedMedia>,
    pub video: Option<EmbedMedia>,
    pub favicon: Option<EmbedMedia>,
    pub provider: Option<EmbedProvider>,
    pub author: Option<EmbedAuthor>,
    pub canonical_url: Option<String>,
    pub lang: Option<String>,
    pub published_time: Option<String>,
    pub modified_time: Option<String>,
    pub keywords: Vec<String>,
    pub summary: Option<String>,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
    pub media_duration: Option<String>,
    pub nsfw: Option<bool>,
    pub reading_time: Option<String>,
    pub fields: Vec<EmbedField>,
    pub price: Option<EmbedPrice>,
    pub fetched_at: Option<String>,
}

impl LinkEmbed {
    /// Roughly what this card costs to keep, for the preview cache's budget.
    ///
    /// The two data URLs are the whole of it: a thumbnail and a favicon arrive
    /// base64-encoded so no viewer ever contacts the origin, which is what
    /// makes a card two orders of magnitude bigger than its text.
    pub(crate) fn weight(&self) -> usize {
        let media = |m: &Option<EmbedMedia>| {
            m.as_ref()
                .and_then(|media| media.preview.as_ref())
                .map_or(0, |preview| preview.data_url.len())
        };
        media(&self.thumbnail)
            + media(&self.image)
            + media(&self.video)
            + media(&self.favicon)
            + self.title.as_ref().map_or(0, String::len)
            + self.description.as_ref().map_or(0, String::len)
            + self.summary.as_ref().map_or(0, String::len)
            + self.url.as_ref().map_or(0, String::len)
    }
}

#[derive(Serialize, Clone)]
struct LinkPreviewResponsePayload {
    request_id: String,
    embeds: Vec<LinkEmbed>,
    /// The URL each embed answers, in step with `embeds`.
    ///
    /// Not the same as `embed.url`, which is where the walk *ended up*: a card
    /// for a shortened link reports the page behind it. The frontend files
    /// cards under the string it finds in the message text, so it needs the
    /// question rather than the answer, and only this side knows which is
    /// which.
    requested_urls: Vec<String>,
}

fn convert_media(media: &mumble_tcp::fancy_link_preview_response::embed::Media) -> EmbedMedia {
    let preview = media.preview_data.as_ref().and_then(|bytes| {
        if bytes.is_empty() {
            return None;
        }
        let mime = media
            .preview_mime
            .clone()
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| "image/jpeg".to_string());
        // Base64-encode the bytes into a self-contained data URL.  This keeps
        // the binary payload entirely inside the existing IPC bridge - the
        // frontend never needs to make a separate network request to render
        // the preview, which means the user's IP stays unexposed.
        let encoded = base64_encode(bytes);
        Some(EmbedPreview {
            data_url: format!("data:{mime};base64,{encoded}"),
            mime,
            width: media.preview_width,
            height: media.preview_height,
        })
    });

    EmbedMedia {
        url: media.url.clone().unwrap_or_default(),
        width: media.width,
        height: media.height,
        original_size: media.original_size,
        preview,
    }
}

fn convert_embed(embed: &mumble_tcp::fancy_link_preview_response::Embed) -> LinkEmbed {
    LinkEmbed {
        url: embed.url.clone(),
        r#type: embed.r#type.clone(),
        title: embed.title.clone(),
        description: embed.description.clone(),
        color: embed.color,
        site_name: embed.site_name.clone(),
        thumbnail: embed.thumbnail.as_ref().map(convert_media),
        image: embed.image.as_ref().map(convert_media),
        video: embed.video.as_ref().map(convert_media),
        favicon: embed.favicon.as_ref().map(convert_media),
        provider: embed.provider.as_ref().map(|p| EmbedProvider {
            name: p.name.clone().unwrap_or_default(),
            url: p.url.clone(),
        }),
        author: embed.author.as_ref().map(|a| EmbedAuthor {
            name: a.name.clone().unwrap_or_default(),
            url: a.url.clone(),
        }),
        canonical_url: embed.canonical_url.clone(),
        lang: embed.lang.clone(),
        published_time: embed.published_time.clone(),
        modified_time: embed.modified_time.clone(),
        keywords: embed.keywords.clone(),
        summary: embed.summary.clone(),
        content_type: embed.content_type.clone(),
        content_length: embed.content_length,
        media_duration: embed.media_duration.clone(),
        nsfw: embed.nsfw,
        reading_time: embed.reading_time.clone(),
        // The price rows are the bridge, not something to print: they come
        // back out as a typed price and are kept out of the fact list, or
        // every shopping card would carry "price.currency: EUR" under it.
        fields: embed
            .fields
            .iter()
            .filter(|f| !is_price_row(f))
            .map(|f| EmbedField {
                name: f.name.clone().unwrap_or_default(),
                value: f.value.clone().unwrap_or_default(),
                inline: f.r#inline.unwrap_or(false),
            })
            .collect(),
        price: convert_price(&embed.fields),
        fetched_at: embed.fetched_at.clone(),
    }
}

/// Whether a field row is one of the four the price travels in.
fn is_price_row(field: &mumble_tcp::fancy_link_preview_response::embed::Field) -> bool {
    field
        .name
        .as_deref()
        .is_some_and(|name| name.starts_with("price."))
}

/// The typed price the `price.*` rows describe, or `None` where there are none.
///
/// The amount is what makes a price: a listing that names a currency and no
/// number has not stated one, and a card drawing a lone "EUR" is worse than a
/// card with no price on it.
fn convert_price(
    fields: &[mumble_tcp::fancy_link_preview_response::embed::Field],
) -> Option<EmbedPrice> {
    let row = |name: &str| {
        fields
            .iter()
            .find(|field| field.name.as_deref() == Some(name))
            .and_then(|field| field.value.clone())
            .unwrap_or_default()
    };
    let amount = row("price.amount");
    if amount.is_empty() {
        return None;
    }
    Some(EmbedPrice {
        amount,
        currency: row("price.currency"),
        was: row("price.was"),
        availability: row("price.availability"),
    })
}

/// Minimal RFC 4648 base64 encoder.  Avoids pulling in a new dependency for a
/// tiny job (the whole point of inlining the preview is to keep the IPC
/// simple).
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    let mut i = 0;
    while i + 3 <= input.len() {
        let b0 = input[i];
        let b1 = input[i + 1];
        let b2 = input[i + 2];
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        out.push(TABLE[(b2 & 0x3f) as usize] as char);
        i += 3;
    }
    let rem = input.len() - i;
    if rem == 1 {
        let b0 = input[i];
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[((b0 & 0x03) << 4) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let b0 = input[i];
        let b1 = input[i + 1];
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(TABLE[((b1 & 0x0f) << 2) as usize] as char);
        out.push('=');
    }
    out
}

impl HandleMessage for mumble_tcp::FancyLinkPreviewResponse {
    fn handle(&self, ctx: &HandlerContext) {
        let request_id = self.request_id.clone().unwrap_or_default();
        let embeds: Vec<LinkEmbed> = self.embeds.iter().map(convert_embed).collect();

        debug!(
            request_id = %request_id,
            embed_count = embeds.len(),
            "received link preview response"
        );

        // Which URL each card answers, and the same string it is filed under.
        // The reply does not carry it - `embed.url` is where the walk *ended
        // up* - so it is recovered from what this client asked, which only this
        // side knows. See `preview_cache::Previews::attribute`.
        let mut requested_urls = Vec::with_capacity(embeds.len());
        if let Ok(mut state) = ctx.shared.lock() {
            let now = crate::state::preview_cache::now_ms();
            for embed in &embeds {
                let asked = state
                    .previews
                    .attribute(&request_id, embed.url.as_deref())
                    // A card that cannot be attributed is still filed under
                    // where it landed: the next person to paste *that* link
                    // gets it, and the one who pasted the shortener pays a
                    // round-trip the server answers from its own cache.
                    .or_else(|| embed.url.clone())
                    .unwrap_or_default();
                if !asked.is_empty() {
                    state.previews.cache.insert(&asked, embed, now);
                }
                requested_urls.push(asked);
            }
            // Not saved here: writing runs on the session's flush ticker, off
            // this thread. A full save re-encrypts every card in the cache, and
            // this is the protocol event loop.
        }

        ctx.emit(
            "link-preview-response",
            LinkPreviewResponsePayload {
                request_id,
                embeds,
                requested_urls,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }
}
