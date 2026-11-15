//! An about in a comment: read out of the profile's mark, and written into
//! it together with the plain HTML other clients show.

use serde_json::Value;

use super::bounds::Limits;
use super::model::About;
use super::page::PageRef;

const OPENS: &str = "<!--FANCY:";
const CLOSES: &str = "-->";

/// The most a comment carrying an about is made to be, also where the
/// server sets no limit: a card is not the place for more.
const MOST: usize = 128 * 1024;

/// A comment, as its profile and what follows the profile's mark.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Written<'a> {
    /// The profile, a JSON object, if the comment carries one that reads.
    pub profile: Option<Value>,
    /// The HTML after the mark; the whole comment if it carries none.
    pub html: &'a str,
}

impl<'a> Written<'a> {
    /// `comment`, taken apart.
    #[must_use]
    pub fn read(comment: &'a str) -> Self {
        let split = comment.trim_start().strip_prefix(OPENS).and_then(|rest| {
            let end = rest.find(CLOSES)?;
            Some((&rest[..end], &rest[end + CLOSES.len()..]))
        });
        let read = split.and_then(|(json, html)| {
            let profile = serde_json::from_str::<Value>(json)
                .ok()
                .filter(Value::is_object)?;
            Some((profile, html))
        });
        match read {
            Some((profile, html)) => Self {
                profile: Some(profile),
                html: html.strip_prefix('\n').unwrap_or(html),
            },
            None => Self {
                profile: None,
                html: comment,
            },
        }
    }

    /// The about the profile carries, if it carries one: the new format.
    #[must_use]
    pub fn about(&self) -> Option<About> {
        self.profile.as_ref()?.get("about").map(About::read)
    }

    /// Where its full profile is kept, if it has one that can be fetched.
    #[must_use]
    pub fn page(&self) -> Option<PageRef> {
        PageRef::read(self.profile.as_ref()?.get("page")?)
    }
}

/// A comment written to carry an about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fitted {
    /// The comment.
    pub comment: String,
    /// The about as it went into it.
    pub about: About,
    /// How many thumbnails were left out to make it fit the server.
    pub dropped: usize,
}

/// `comment` carrying `about` and `page` in its profile, everything else
/// the profile says kept, followed by the about as plain HTML in place of
/// what followed before. It is made to fit `limit` bytes (none where it is
/// zero) by leaving thumbnails out, the heaviest first, keeping each
/// picture's key to its full copy.
///
/// # Errors
///
/// When it does not fit even with no thumbnails at all.
pub fn with_about(
    comment: &str,
    about: &About,
    page: Option<&PageRef>,
    limit: usize,
) -> Result<Fitted, String> {
    let mut profile = Written::read(comment)
        .profile
        .unwrap_or_else(|| serde_json::json!({ "v": 1 }));
    let limit = if limit == 0 { MOST } else { limit.min(MOST) };
    let mut about = about.clone().bounded(Limits::CARD);
    let mut dropped = 0;
    loop {
        let written = compose(&mut profile, &about, page);
        if written.len() <= limit {
            return Ok(Fitted {
                comment: written,
                about,
                dropped,
            });
        }
        if !lighten(&mut about) {
            return Err(format!(
                "This profile takes {} bytes, and this server takes {limit} at most.",
                written.len()
            ));
        }
        dropped += 1;
    }
}

/// The comment for `profile` carrying `about` and `page`.
fn compose(profile: &mut Value, about: &About, page: Option<&PageRef>) -> String {
    profile["about"] = about.to_value();
    match page.and_then(|page| serde_json::to_value(page).ok()) {
        Some(page) => profile["page"] = page,
        None => {
            if let Some(fields) = profile.as_object_mut() {
                let _ = fields.remove("page");
            }
        }
    }
    // JSON may hold `-->` inside a string, where it would end the mark.
    let json = profile.to_string().replace("-->", "--\\u003e");
    format!("{OPENS}{json}{CLOSES}\n{}", about.html())
}

/// Take the heaviest thumbnail out of `about`; `false` if it has none.
fn lighten(about: &mut About) -> bool {
    let heaviest = about
        .pictures_mut()
        .filter(|picture| picture.thumb.is_some())
        .max_by_key(|picture| picture.thumb_weight().unwrap_or_default());
    let Some(picture) = heaviest else {
        return false;
    };
    picture.thumb = None;
    *about = std::mem::take(about).bounded(Limits::CARD);
    true
}
