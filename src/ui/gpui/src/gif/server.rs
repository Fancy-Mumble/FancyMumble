//! The server's own GIF service, reached through the engine.
//!
//! A question goes out with an id of its own and the answer comes back as
//! an engine event carrying that id ([`ServerGifs::noted_page`] and the
//! rest): what is still waiting is kept here. A server too old to know the
//! question drops it without a word, so no answer within twelve seconds is
//! read as "no GIF service", and remembered until the next server, as the
//! web client does (`serverGifs.ts`).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use mumble_tauri_lib::engine_api::EngineHandle;
use mumble_tauri_lib::engine_api::gifs::{GifPage, GifRefusal, GifRefused, GifSupport};

use super::{Answer, Gif, Page, Pending, Refused, Service, Source, Support, Why};

/// How long an answer is waited for: the server's own fetch may take
/// eight seconds, and the way there and back the rest.
const WITHIN: Duration = Duration::from_secs(12);

/// A question put to the server, on its way.
pub(crate) type Sent = Pin<Box<dyn Future<Output = Result<(), String>> + Send>>;

/// Putting questions to the server.
pub(crate) trait Ask: Send + Sync + 'static {
    /// Ask what its GIF service offers, under `request_id`.
    fn support(&self, request_id: String) -> Sent;
    /// Ask for page `page` of what is found for `query`, under `request_id`.
    fn search(&self, query: String, page: u32, request_id: String) -> Sent;
}

impl Ask for EngineHandle {
    fn support(&self, request_id: String) -> Sent {
        let engine = self.clone();
        Box::pin(async move { engine.request_gif_support(&request_id).await })
    }

    fn search(&self, query: String, page: u32, request_id: String) -> Sent {
        let engine = self.clone();
        Box::pin(async move { engine.request_gif_search(&query, page, &request_id).await })
    }
}

/// What is waited for, and what the server said.
#[derive(Default)]
struct Waiting {
    /// The pages asked for and not yet answered, by request id.
    pages: HashMap<String, async_channel::Sender<Answer>>,
    /// The support question waiting for its answer.
    asked: Option<String>,
    /// What the server said of its service, once it has.
    support: Option<Support>,
    /// Whether it has said, or shown by its silence, that it has none.
    unavailable: bool,
    /// The last request id given out.
    counter: u64,
}

impl Waiting {
    fn next_id(&mut self, what: &str) -> String {
        self.counter += 1;
        format!("gif-{what}-{}", self.counter)
    }
}

struct Inner {
    ask: Arc<dyn Ask>,
    runtime: tokio::runtime::Handle,
    within: Duration,
    waiting: Mutex<Waiting>,
}

impl Inner {
    fn waiting(&self) -> std::sync::MutexGuard<'_, Waiting> {
        self.waiting.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Answer the page asked for under `request_id`, if it still waits.
    fn settle(&self, request_id: &str, answer: Answer) {
        let waiting = self.waiting().pages.remove(request_id);
        if let Some(tell) = waiting {
            let _ = tell.try_send(answer);
        }
    }
}

/// The server's GIF service, as the engine reaches it.
#[derive(Clone)]
pub(crate) struct ServerGifs {
    inner: Arc<Inner>,
}

impl ServerGifs {
    /// Asking through `ask`, waiting on `runtime`.
    pub(crate) fn new(ask: Arc<dyn Ask>, runtime: tokio::runtime::Handle) -> Self {
        Self::waiting_for(ask, runtime, WITHIN)
    }

    /// The same, waiting `within` for each answer.
    pub(crate) fn waiting_for(
        ask: Arc<dyn Ask>,
        runtime: tokio::runtime::Handle,
        within: Duration,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                ask,
                runtime,
                within,
                waiting: Mutex::default(),
            }),
        }
    }

    /// The service, once the server has said what it offers.
    pub(crate) fn service(&self) -> Option<Service> {
        let support = self.inner.waiting().support.clone()?;
        Some(Service {
            support,
            source: Arc::new(self.clone()),
        })
    }

    /// Ask the server connected to what its service offers. Silence past
    /// the wait reads as nothing.
    pub(crate) fn ask_support(&self) {
        let id = {
            let mut waiting = self.inner.waiting();
            let id = waiting.next_id("support");
            waiting.asked = Some(id.clone());
            id
        };
        let inner = Arc::clone(&self.inner);
        let asked = id.clone();
        drop(self.inner.runtime.spawn(async move {
            let sent = inner.ask.support(asked.clone()).await;
            if sent.is_ok() {
                tokio::time::sleep(inner.within).await;
            }
            let mut waiting = inner.waiting();
            if waiting.asked.as_ref() == Some(&asked) {
                waiting.asked = None;
                waiting.support = Some(Support::default());
            }
        }));
    }

    /// Forget the server: the next one is another server. What still waits
    /// is answered "unavailable".
    pub(crate) fn forget(&self) {
        let mut waiting = self.inner.waiting();
        waiting.pages.clear();
        waiting.asked = None;
        waiting.support = None;
        waiting.unavailable = false;
    }

    /// The server said what its service offers. Whether that was the
    /// answer waited for.
    pub(crate) fn noted_support(&self, support: &GifSupport) -> bool {
        let mut waiting = self.inner.waiting();
        if waiting.asked.as_deref() != Some(support.request_id.as_str()) {
            return false;
        }
        waiting.asked = None;
        waiting.support = Some(Support {
            available: support.available,
            media_base: support.media_base.parse().ok(),
            provider: super::klipy::credited(&support.provider),
        });
        true
    }

    /// A page came.
    pub(crate) fn noted_page(&self, page: GifPage) {
        let answer = Page {
            gifs: page
                .results
                .into_iter()
                .map(|gif| Gif {
                    title: if gif.title.trim().is_empty() {
                        "GIF".into()
                    } else {
                        gif.title.into()
                    },
                    url: gif.url.into(),
                    preview: gif.preview.into(),
                })
                .collect(),
            has_next: page.has_next,
        };
        self.inner.settle(&page.request_id, Ok(answer));
    }

    /// The server would not search.
    pub(crate) fn noted_refused(&self, refused: GifRefused) {
        let why = match refused.kind {
            GifRefusal::Unavailable => Why::Unavailable,
            GifRefusal::Throttled => Why::Throttled,
            GifRefusal::Upstream => Why::Upstream,
            GifRefusal::Malformed => Why::Malformed,
        };
        if why == Why::Unavailable {
            self.inner.waiting().unavailable = true;
        }
        let reason = if refused.reason.trim().is_empty() {
            "the server would not search for GIFs".to_owned()
        } else {
            refused.reason
        };
        self.inner
            .settle(&refused.request_id, Err(Refused::new(why, reason)));
    }
}

impl Source for ServerGifs {
    fn search(&self, query: &str, page: u32) -> Pending {
        let (tell, told) = async_channel::bounded(1);
        let id = {
            let mut waiting = self.inner.waiting();
            if waiting.unavailable {
                return super::ready(Err(Refused::new(
                    Why::Unavailable,
                    "this server has no GIF service",
                )));
            }
            let id = waiting.next_id("search");
            let _ = waiting.pages.insert(id.clone(), tell);
            id
        };
        let inner = Arc::clone(&self.inner);
        let (query, asked) = (query.trim().to_owned(), id);
        drop(self.inner.runtime.spawn(async move {
            if let Err(why) = inner.ask.search(query, page.max(1), asked.clone()).await {
                inner.settle(&asked, Err(Refused::new(Why::Unavailable, why)));
                return;
            }
            tokio::time::sleep(inner.within).await;
            // Nothing came back at all: what an older server looks like.
            if inner.waiting().pages.contains_key(&asked) {
                inner.waiting().unavailable = true;
                inner.settle(
                    &asked,
                    Err(Refused::new(
                        Why::Unavailable,
                        "the server did not answer the GIF search",
                    )),
                );
            }
        }));
        Box::pin(async move {
            told.recv()
                .await
                .unwrap_or_else(|_| Err(Refused::new(Why::Unavailable, "the server is gone")))
        })
    }

    fn trending(&self, page: u32) -> Pending {
        self.search("", page)
    }
}

#[cfg(test)]
mod tests;
