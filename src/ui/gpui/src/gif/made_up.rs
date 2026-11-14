//! A GIF service that is made up, for the demo engine and the tests: a
//! catalogue of named GIFs served from one address, which the server it
//! stands for announces as its own. It reaches nobody: what its addresses
//! lead to is whatever answers there (the tests' table, or a stand-in on
//! this machine for a look at the window).

use std::sync::{Arc, Mutex, PoisonError};

use gpui::SharedString;

use super::{Gif, MediaBase, Page, Pending, Refused, Service, Source, Support};

/// What the catalogue's GIFs are of, in turn.
const OF: [&str; 10] = [
    "cat", "dog", "party", "happy", "reaction", "anime", "dance", "wave", "clap", "sad",
];
/// How many a page has.
const PER_PAGE: usize = 12;

/// The made-up service.
pub(crate) struct MadeUp {
    /// Where its pictures are: `<root>/gif?`.
    root: String,
    gifs: Vec<Gif>,
    /// What it was asked for, in order: the words and the page.
    asked: Mutex<Vec<(String, u32)>>,
    /// What it answers every question with instead, if anything.
    refusing: Mutex<Option<Refused>>,
}

impl MadeUp {
    /// `count` GIFs, served from `root`.
    pub(crate) fn at(root: &str, count: usize) -> Self {
        let root = root.trim_end_matches('/').to_owned();
        let gifs = (0..count)
            .map(|n| Gif {
                title: format!("{} {n}", OF[n % OF.len()]).into(),
                url: format!("{root}/gif?u={n}").into(),
                preview: format!("{root}/gif?u={n}&s=xs").into(),
            })
            .collect();
        Self {
            root,
            gifs,
            asked: Mutex::default(),
            refusing: Mutex::default(),
        }
    }

    /// Where its pictures are.
    pub(crate) fn media_base(&self) -> Option<MediaBase> {
        format!("{}/gif?", self.root).parse().ok()
    }

    /// Itself, as the service of a server that serves its own pictures.
    pub(crate) fn service(self: &Arc<Self>) -> Service {
        Service {
            support: Support {
                available: true,
                media_base: self.media_base(),
                provider: super::klipy::NAME.into(),
            },
            source: Arc::clone(self) as Arc<dyn Source>,
        }
    }

    /// What it was asked for, in order.
    #[cfg(test)]
    pub(crate) fn asked(&self) -> Vec<(String, u32)> {
        self.asked
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Answer every question with `refused` from now on, or answer again.
    #[cfg(test)]
    pub(crate) fn refuse(&self, refused: Option<Refused>) {
        *self.refusing.lock().unwrap_or_else(PoisonError::into_inner) = refused;
    }

    /// The `page`th page of `found`.
    fn paged(found: &[&Gif], page: u32) -> Page {
        let from = (page.max(1) as usize - 1) * PER_PAGE;
        Page {
            gifs: found
                .iter()
                .skip(from)
                .take(PER_PAGE)
                .map(|gif| (*gif).clone())
                .collect(),
            has_next: found.len() > from + PER_PAGE,
        }
    }

    fn answer(&self, words: &str, page: u32) -> Pending {
        self.asked
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push((words.to_owned(), page));
        if let Some(refused) = self
            .refusing
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
        {
            return super::ready(Err(refused));
        }
        let words = words.to_lowercase();
        let found: Vec<&Gif> = self
            .gifs
            .iter()
            .filter(|gif| words.is_empty() || matches(&gif.title, &words))
            .collect();
        super::ready(Ok(Self::paged(&found, page)))
    }
}

/// Whether a GIF called `title` is found for `words`: the title has
/// them, or they have what it is of ("reactions" finds a reaction).
fn matches(title: &SharedString, words: &str) -> bool {
    let title = title.to_lowercase();
    let of = title.split(' ').next().unwrap_or_default();
    title.contains(words) || words.contains(of)
}

impl Source for MadeUp {
    fn search(&self, query: &str, page: u32) -> Pending {
        self.answer(query.trim(), page)
    }

    fn trending(&self, page: u32) -> Pending {
        self.answer("", page)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gif::{Why, wait};

    #[test]
    fn it_finds_by_name_pages_and_refuses_when_told() {
        let made_up = MadeUp::at("https://chat.example/", 40);
        let all = wait(made_up.trending(1)).expect("a page");
        assert_eq!(all.gifs.len(), PER_PAGE);
        assert!(all.has_next);
        assert_eq!(all.gifs[1].url, "https://chat.example/gif?u=1");
        let last = wait(made_up.trending(4)).expect("a page");
        assert_eq!((last.gifs.len(), last.has_next), (4, false));
        let cats = wait(made_up.search("Cat", 1)).expect("a page");
        assert!(cats.gifs.iter().all(|gif| gif.title.starts_with("cat")));
        let reactions = wait(made_up.search("Reactions", 1)).expect("a page");
        assert!(!reactions.gifs.is_empty());
        made_up.refuse(Some(Refused::new(Why::Throttled, "slow")));
        assert!(wait(made_up.search("cat", 1)).is_err());
        assert_eq!(made_up.asked().len(), 5);
        let service = Arc::new(made_up).service();
        assert!(
            service
                .support
                .media_base
                .is_some_and(|base| base.serves("https://chat.example/gif?u=3"))
        );
    }
}
