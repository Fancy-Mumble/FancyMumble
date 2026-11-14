//! Which source is asked, in which order, and what of its answer is drawn:
//! the web client's `gifsEnabled` and `pageOfGifs`.

use std::future::Future;
use std::sync::Arc;

use gpui::SharedString;

use super::klipy::{self, Klipy};
use super::{Answer, MediaBase, Page, Service, Source, Why};
use crate::embed::Fetch;

/// How GIFs are found here, if they are at all.
pub(crate) struct Plan {
    /// Asked first.
    first: Arc<dyn Source>,
    /// Asked when the first says it has no GIFs to give: the user's own key.
    then: Option<Arc<dyn Source>>,
    /// Only what is served from here is kept of an answer, where the user
    /// has not agreed to the provider being reached.
    only_from: Option<MediaBase>,
    /// Who finds them, credited where they are shown.
    pub(crate) provider: SharedString,
}

impl Plan {
    /// The plan for a server offering `service`, with the user's Klipy
    /// `key`, fetching through `fetch`. With a key, the server is asked
    /// first if it searches at all, and Klipy when it says it does not;
    /// without one, only a server that serves the pictures itself. With
    /// neither, `None`: there are no GIFs.
    pub(crate) fn of(
        service: Option<&Service>,
        key: Option<&str>,
        fetch: Arc<dyn Fetch>,
    ) -> Option<Self> {
        let searches = service.filter(|service| service.support.available);
        let own: Option<Arc<dyn Source>> = key
            .map(str::trim)
            .filter(|key| !key.is_empty())
            .map(|key| Arc::new(Klipy::new(key, fetch)) as Arc<dyn Source>);
        match (searches, own) {
            (Some(service), Some(own)) => Some(Self {
                first: Arc::clone(&service.source),
                then: Some(own),
                only_from: None,
                provider: service.support.provider.clone(),
            }),
            (None, Some(own)) => Some(Self {
                first: own,
                then: None,
                only_from: None,
                provider: klipy::NAME.into(),
            }),
            (Some(service), None) => {
                let base = service.support.media_base.clone()?;
                Some(Self {
                    first: Arc::clone(&service.source),
                    then: None,
                    only_from: Some(base),
                    provider: service.support.provider.clone(),
                })
            }
            (None, None) => None,
        }
    }

    /// Page `page` of what is found for `query`; of what is trending when
    /// `query` is empty.
    pub(crate) fn page(&self, query: &str, page: u32) -> impl Future<Output = Answer> + use<> {
        let query = query.trim().to_owned();
        let first = asked(&self.first, &query, page);
        let then = self.then.clone();
        let only_from = self.only_from.clone();
        async move {
            let answer = match (first.await, then) {
                // Only "this server has none" falls back: a throttle routed
                // round with the user's own quota is what the limit stops.
                // The second is asked only then, never alongside.
                (Err(refused), Some(then)) if refused.why == Why::Unavailable => {
                    asked(&then, &query, page).await
                }
                (answer, _) => answer,
            };
            answer.map(|page| kept(page, only_from.as_ref()))
        }
    }
}

/// Ask `source` for page `page` of `query`, or of what is trending.
fn asked(source: &Arc<dyn Source>, query: &str, page: u32) -> super::Pending {
    if query.is_empty() {
        source.trending(page)
    } else {
        source.search(query, page)
    }
}

/// What of `page` may be drawn: everything, or what is served `from` the
/// server itself, its preview and what is sent alike.
fn kept(mut page: Page, from: Option<&MediaBase>) -> Page {
    if let Some(base) = from {
        page.gifs
            .retain(|gif| base.serves(&gif.url) && base.serves(&gif.preview));
    }
    page
}

#[cfg(test)]
mod tests;
