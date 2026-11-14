//! The real engine's side of what the local user says about themselves:
//! keeping a profile's files in the server's file store, saving its about,
//! and fetching somebody's full profile when it is asked for.

use std::sync::Arc;

use mumble_tauri_lib::engine_api::about::PageRef;

use super::Shared;
use crate::engine::EngineEvent;
use crate::profile::Save;

impl Shared {
    /// Save `save`, and say how it went.
    pub(super) fn save_about(self: &Arc<Self>, runtime: &tokio::runtime::Handle, save: Save) {
        let shared = Arc::clone(self);
        drop(runtime.spawn(async move {
            let saved = shared.saved(save).await;
            shared.tell(EngineEvent::AboutSaved(saved.map_err(Into::into)));
        }));
    }

    async fn saved(&self, save: Save) -> Result<usize, String> {
        let mut about = save.about.clone();
        for (at, bytes) in &save.keep {
            let name = format!("profile-picture-{at}.{}", ending_of(bytes));
            let stored = self.engine.store_profile_file(bytes, &name).await?;
            Save::note_kept(&mut about, *at, stored.key, stored.size);
        }
        let page = match save.page_for(&about) {
            Some(page) => Some(self.engine.store_profile_page(&page).await?),
            None => save.page.clone(),
        };
        let fitted = self.engine.set_about(&about, page.as_ref()).await?;
        Ok(fitted.dropped)
    }

    /// Fetch the full profile `page` names, and hand it over.
    pub(super) fn fetch_page(self: &Arc<Self>, runtime: &tokio::runtime::Handle, page: PageRef) {
        let shared = Arc::clone(self);
        drop(runtime.spawn(async move {
            let fetched = shared.engine.fetch_profile_page(&page).await;
            shared.tell(EngineEvent::ProfilePage {
                key: page.key.into(),
                page: fetched.map(Arc::new).map_err(Into::into),
            });
        }));
    }
}

/// The ending a picture's file takes, by what its bytes say it is.
fn ending_of(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG") {
        "png"
    } else if bytes.starts_with(b"GIF") {
        "gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(&b"WEBP"[..]) {
        "webp"
    } else {
        "jpg"
    }
}
