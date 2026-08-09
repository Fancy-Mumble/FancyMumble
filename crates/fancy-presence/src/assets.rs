//! Turning activity image keys into something displayable.
//!
//! `assets.large_image` is rarely a URL. It is usually an opaque *key* that
//! only means something relative to the application that sent it, and it has
//! to be resolved through Discord's public application-assets endpoint. A few
//! well-known prefixes bypass that and point straight at a CDN.
//!
//! This module only builds URLs. Fetching them is the embedder's job: it
//! already has an HTTP client, a cache directory and a say in whether the
//! feature is allowed to touch the network at all.

/// Discord's public API base. The endpoints used here need no authentication.
const API_BASE: &str = "https://discord.com/api/v10";

/// Where resolved application assets are served from.
const CDN_BASE: &str = "https://cdn.discordapp.com";

/// Where `mp:`-prefixed proxied media is served from.
const MEDIA_PROXY_BASE: &str = "https://media.discordapp.net";

/// How an image key resolves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageSource {
    /// Already a complete URL - fetch it directly.
    Url(String),
    /// An application-scoped asset key. The embedder must look the key up in
    /// the application's asset list ([`application_assets_url`]) to get the
    /// asset id, then build the image URL with [`asset_url`].
    AssetKey {
        /// Application the key belongs to.
        application_id: String,
        /// The key as sent by the application.
        key: String,
    },
}

/// Where to fetch an application's `key -> asset id` table.
///
/// Unauthenticated and cacheable; the mapping only changes when the
/// application's developer uploads new artwork.
#[must_use]
pub fn application_assets_url(application_id: &str) -> String {
    format!("{API_BASE}/oauth2/applications/{application_id}/assets")
}

/// Where to fetch an application's public profile, whose `name` field is the
/// label shown next to the activity.
#[must_use]
pub fn application_rpc_url(application_id: &str) -> String {
    format!("{API_BASE}/applications/{application_id}/rpc")
}

/// The image URL for a resolved asset id.
///
/// `size` must be a power of two between 16 and 4096; Discord rejects
/// anything else, so out-of-range values are clamped rather than passed on.
#[must_use]
pub fn asset_url(application_id: &str, asset_id: &str, size: u16) -> String {
    let size = size.clamp(16, 4096).next_power_of_two();
    format!("{CDN_BASE}/app-assets/{application_id}/{asset_id}.png?size={size}")
}

/// Classify an image key from an [`crate::protocol::Assets`] field.
///
/// Returns `None` for an empty key. The recognised prefixes are the ones
/// Discord's own clients special-case: proxied external media, and the
/// media services whose artwork Discord serves from the origin CDN.
#[must_use]
pub fn resolve_image(application_id: &str, key: &str) -> Option<ImageSource> {
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    if key.starts_with("http://") || key.starts_with("https://") {
        return Some(ImageSource::Url(key.to_owned()));
    }
    if let Some(rest) = key.strip_prefix("mp:") {
        return Some(ImageSource::Url(format!("{MEDIA_PROXY_BASE}/{rest}")));
    }
    if let Some(id) = key.strip_prefix("spotify:") {
        return Some(ImageSource::Url(format!("https://i.scdn.co/image/{id}")));
    }
    if let Some(user) = key.strip_prefix("twitch:") {
        return Some(ImageSource::Url(format!(
            "https://static-cdn.jtvnw.net/previews-ttv/live_user_{user}.png"
        )));
    }
    // A bare snowflake is already an asset id and needs no lookup.
    if key.chars().all(|c| c.is_ascii_digit()) {
        return Some(ImageSource::Url(asset_url(application_id, key, 256)));
    }
    Some(ImageSource::AssetKey {
        application_id: application_id.to_owned(),
        key: key.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_through_an_absolute_url() {
        assert_eq!(
            resolve_image("1", "https://example.invalid/a.png"),
            Some(ImageSource::Url("https://example.invalid/a.png".to_owned()))
        );
    }

    #[test]
    fn rewrites_proxied_external_media_to_the_media_proxy() {
        let resolved = resolve_image("1", "mp:external/abc/https/example.invalid/a.png");
        assert_eq!(
            resolved,
            Some(ImageSource::Url(
                "https://media.discordapp.net/external/abc/https/example.invalid/a.png".to_owned()
            ))
        );
    }

    #[test]
    fn maps_spotify_and_twitch_keys_to_their_origin_cdns() {
        assert_eq!(
            resolve_image("1", "spotify:xyz"),
            Some(ImageSource::Url("https://i.scdn.co/image/xyz".to_owned()))
        );
        assert_eq!(
            resolve_image("1", "twitch:someone"),
            Some(ImageSource::Url(
                "https://static-cdn.jtvnw.net/previews-ttv/live_user_someone.png".to_owned()
            ))
        );
    }

    #[test]
    fn treats_a_bare_snowflake_as_an_already_resolved_asset() {
        let resolved = resolve_image("42", "9876543210");
        let Some(ImageSource::Url(url)) = resolved else {
            panic!("expected a direct URL");
        };
        assert!(url.starts_with("https://cdn.discordapp.com/app-assets/42/9876543210.png"));
    }

    #[test]
    fn leaves_an_opaque_key_for_the_embedder_to_look_up() {
        assert_eq!(
            resolve_image("42", "main_menu_art"),
            Some(ImageSource::AssetKey {
                application_id: "42".to_owned(),
                key: "main_menu_art".to_owned(),
            })
        );
    }

    #[test]
    fn ignores_an_empty_key() {
        assert_eq!(resolve_image("42", "   "), None);
    }

    #[test]
    fn clamps_the_requested_image_size_to_what_discord_accepts() {
        assert!(asset_url("1", "2", 9000).ends_with("size=4096"));
        assert!(asset_url("1", "2", 1).ends_with("size=16"));
        assert!(asset_url("1", "2", 256).ends_with("size=256"));
    }
}
