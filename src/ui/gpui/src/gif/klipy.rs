//! Klipy, asked directly with a key of the user's own.
//!
//! This is the web client's direct path (`KlipyGifBrowser.tsx`): the same
//! requests, thirty to a page, and the same choice of what is sent, the
//! largest GIF there is. The key is a part of the address, so the address
//! is a secret: nothing here logs one, and what a refusal says has the key
//! taken out of it.

use std::sync::Arc;

use gpui::SharedString;
use serde::Deserialize;

use super::{Answer, Gif, Page, Pending, Refused, Source, Why};
use crate::embed::Fetch;

/// Where Klipy's API is.
const API: &str = "https://api.klipy.com/api/v1";
/// How many a page asks for, as the web client asks.
const PER_PAGE: u32 = 30;
/// The most an answer may be, in bytes.
const ANSWER_MOST: usize = 1 << 20;

/// Klipy, asked with the user's own key.
pub(crate) struct Klipy {
    /// Where its API is: Klipy's own, but for the tests.
    api: String,
    key: String,
    fetch: Arc<dyn Fetch>,
}

impl Klipy {
    /// Klipy, asked with `key` through `fetch`.
    pub(crate) fn new(key: &str, fetch: Arc<dyn Fetch>) -> Self {
        Self {
            api: API.to_owned(),
            key: key.trim().to_owned(),
            fetch,
        }
    }

    /// The same API answered at `api` instead: a stand-in for the tests.
    #[cfg(test)]
    pub(crate) fn at(api: &str, key: &str, fetch: Arc<dyn Fetch>) -> Self {
        Self {
            api: api.trim_end_matches('/').to_owned(),
            ..Self::new(key, fetch)
        }
    }

    /// The address of a page: `trending`, or `search` for `query`.
    /// **It carries the key.**
    fn address(&self, query: Option<&str>, page: u32) -> String {
        let action = if query.is_some() {
            "search"
        } else {
            "trending"
        };
        let mut address = url::Url::parse(&self.api).map_or_else(
            |_| format!("{}/{}/gifs/{action}", self.api, self.key),
            |mut url| {
                if let Ok(mut path) = url.path_segments_mut() {
                    let _ = path
                        .pop_if_empty()
                        .extend([self.key.as_str(), "gifs", action]);
                }
                url.to_string()
            },
        );
        let mut pairs = url::form_urlencoded::Serializer::new(String::new());
        if let Some(query) = query {
            let _ = pairs.append_pair("q", query);
        }
        let _ = pairs
            .append_pair("per_page", &PER_PAGE.to_string())
            .append_pair("page", &page.max(1).to_string());
        address.push('?');
        address.push_str(&pairs.finish());
        address
    }

    /// Ask for the page at `address`.
    fn ask(&self, address: &str) -> Pending {
        let told = self.fetch.fetch(address, ANSWER_MOST);
        let key = self.key.clone();
        Box::pin(async move {
            let fetched = told
                .recv()
                .await
                .unwrap_or_else(|_| Err("nothing fetched it".to_owned()));
            match fetched {
                Ok(bytes) => read(&bytes),
                Err(why) => Err(Refused::new(Why::Upstream, without(&why, &key))),
            }
        })
    }
}

impl Source for Klipy {
    fn search(&self, query: &str, page: u32) -> Pending {
        let query = query.trim();
        if query.is_empty() {
            return self.trending(page);
        }
        self.ask(&self.address(Some(query), page))
    }

    fn trending(&self, page: u32) -> Pending {
        self.ask(&self.address(None, page))
    }
}

/// `said` with `key` taken out of it, wherever an address in it named it.
fn without(said: &str, key: &str) -> String {
    if key.is_empty() {
        return said.to_owned();
    }
    said.replace(key, "…")
}

/// Klipy's answer: `{ data: { data: [...], has_next } }`.
#[derive(Deserialize)]
struct Answered {
    data: Paged,
}

#[derive(Deserialize)]
struct Paged {
    #[serde(default)]
    data: Vec<Item>,
    #[serde(default)]
    has_next: bool,
}

#[derive(Deserialize)]
struct Item {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    file: Option<Sizes>,
}

/// The sizes Klipy keeps of one GIF, largest first.
#[derive(Deserialize, Default)]
struct Sizes {
    hd: Option<Formats>,
    md: Option<Formats>,
    sm: Option<Formats>,
    xs: Option<Formats>,
}

#[derive(Deserialize, Default)]
struct Formats {
    gif: Option<File>,
    webp: Option<File>,
}

#[derive(Deserialize)]
struct File {
    url: String,
}

impl Formats {
    /// The animated WebP, else the GIF: a fraction of the bytes for the
    /// same picture.
    fn smallest(&self) -> Option<&str> {
        self.webp
            .as_ref()
            .or(self.gif.as_ref())
            .map(|file| file.url.as_str())
    }

    fn gif(&self) -> Option<&str> {
        self.gif.as_ref().map(|file| file.url.as_str())
    }
}

impl Item {
    /// What is drawn and sent of it, if it has a GIF to send. What is sent
    /// is what the web client sends, the largest GIF; what is drawn is the
    /// smallest size, as WebP where there is one.
    fn into_gif(self) -> Option<Gif> {
        let sizes = self.file?;
        let full = [&sizes.hd, &sizes.md, &sizes.sm]
            .into_iter()
            .flatten()
            .find_map(Formats::gif)?
            .to_owned();
        let preview = [&sizes.xs, &sizes.sm]
            .into_iter()
            .flatten()
            .find_map(Formats::smallest)
            .map_or_else(|| full.clone(), ToOwned::to_owned);
        let title = self
            .title
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| "GIF".to_owned());
        Some(Gif {
            title: title.into(),
            url: full.into(),
            preview: preview.into(),
        })
    }
}

/// A page out of what Klipy answered.
fn read(bytes: &[u8]) -> Answer {
    let answered: Answered = serde_json::from_slice(bytes)
        .map_err(|_| Refused::new(Why::Upstream, "Klipy answered something that is not a page"))?;
    Ok(Page {
        gifs: answered
            .data
            .data
            .into_iter()
            .filter_map(Item::into_gif)
            .collect(),
        has_next: answered.data.has_next,
    })
}

/// What Klipy is called where it has to be credited.
pub(crate) const NAME: &str = "Klipy";

/// The name of the provider `named` by a server, as it is credited.
pub(crate) fn credited(named: &str) -> SharedString {
    if named.trim().is_empty() || named.eq_ignore_ascii_case("klipy") {
        NAME.into()
    } else {
        named.trim().to_owned().into()
    }
}

#[cfg(test)]
mod tests;
