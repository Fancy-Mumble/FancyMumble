//! Where GIFs come from, and who learns what of looking for them.
//!
//! As in the web client (`core/features/chat/gif/`) there are two sources,
//! and neither makes this machine talk to the GIF provider (Klipy) behind
//! the user's back:
//!
//! - **The server's own GIF service** ([`server`]). The server holds one
//!   provider key for everybody and searches for its users. It learns what
//!   is searched for; the provider learns only the server. Used without
//!   asking only when the server also serves the pictures itself, from an
//!   address it announced ([`MediaBase`]): then drawing a page of results
//!   reaches nobody but the server.
//! - **A Klipy key of the user's own** ([`klipy`]), from the settings. This
//!   machine then asks Klipy directly, and loads the pictures from Klipy:
//!   Klipy learns what is searched for and the user's address. Setting a key
//!   is the user's consent to that.
//!
//! With a key the server is still asked first, and Klipy only when the
//! server says it has no GIF service ([`Plan`]). With neither, there is no
//! GIF button.

pub(crate) mod klipy;
pub(crate) mod made_up;
mod media_base;
mod plan;
pub(crate) mod server;
#[cfg(test)]
pub(crate) mod stand_in;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use gpui::SharedString;

pub(crate) use media_base::MediaBase;
pub(crate) use plan::Plan;

/// The shortcuts the browser offers besides typing: the first is what the
/// source has trending, the rest are searches. The web client's tabs
/// (`GifBrowser.tsx`).
pub(crate) const CATEGORIES: [&str; 3] = ["Trending", "Reactions", "Anime"];

/// One GIF found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Gif {
    /// What it is called; `"GIF"` where the provider named nothing.
    pub title: SharedString,
    /// The full size: what is sent when it is picked.
    pub url: SharedString,
    /// The smallest size there is: what the browser draws.
    pub preview: SharedString,
}

/// One page of what was found.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Page {
    pub gifs: Vec<Gif>,
    /// Whether asking for the next page would bring more.
    pub has_next: bool,
}

/// Why a page did not come.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Why {
    /// This source has no GIFs to give: the server has no GIF service, or
    /// is too old to know of one. The one refusal a key of the user's own
    /// may answer.
    Unavailable,
    /// Too many searches; waiting would help. Never routed round with the
    /// user's own key: that is what the limit is there to stop.
    Throttled,
    /// The provider failed, or answered something unreadable.
    Upstream,
    /// The search itself was refused.
    Malformed,
}

/// A page that did not come, and the source's words for why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Refused {
    pub why: Why,
    pub reason: SharedString,
}

impl Refused {
    pub(crate) fn new(why: Why, reason: impl Into<SharedString>) -> Self {
        Self {
            why,
            reason: reason.into(),
        }
    }
}

/// What asking for a page comes to.
pub(crate) type Answer = Result<Page, Refused>;

/// A page on its way.
pub(crate) type Pending = Pin<Box<dyn Future<Output = Answer> + Send>>;

/// Somewhere GIFs are found.
pub(crate) trait Source: Send + Sync {
    /// Page `page`, from one, of the GIFs found for `query`.
    fn search(&self, query: &str, page: u32) -> Pending;

    /// Page `page`, from one, of the GIFs most looked at now.
    fn trending(&self, page: u32) -> Pending;
}

/// What the server connected to says of its GIF service.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Support {
    /// Whether it searches at all.
    pub available: bool,
    /// Where it serves the pictures from, if it serves them itself.
    pub media_base: Option<MediaBase>,
    /// Who it searches, for attribution.
    pub provider: SharedString,
}

/// The server's GIF service: what it said of itself, and searching it.
#[derive(Clone)]
pub(crate) struct Service {
    pub support: Support,
    pub source: Arc<dyn Source>,
}

impl std::fmt::Debug for Service {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Service")
            .field("support", &self.support)
            .finish_non_exhaustive()
    }
}

/// A page that is already here.
pub(crate) fn ready(answer: Answer) -> Pending {
    Box::pin(std::future::ready(answer))
}

/// Run `pending` to its end on this thread. For the tests, whose sources
/// answer from threads of their own.
#[cfg(test)]
pub(crate) fn wait<T>(pending: impl Future<Output = T>) -> T {
    let mut pending = std::pin::pin!(pending);
    let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
    loop {
        if let std::task::Poll::Ready(answer) = pending.as_mut().poll(&mut cx) {
            return answer;
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
}
