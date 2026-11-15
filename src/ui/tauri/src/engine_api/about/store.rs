//! The engine's side of an about: saving it into the local user's comment,
//! and keeping a profile's files in the server's file store.
//!
//! A profile's files go to the root channel, shared "with those here": who
//! may read one is who may enter the root, which is everybody on most
//! servers, and they are kept until deleted unless the server's operator
//! caps how long files live. A file goes up from disk and comes back to
//! disk, as every shared file does here; it is read into memory only after
//! its size has been checked.

use std::path::PathBuf;

use mumble_protocol::proto::fancy::files::Visibility;

use super::{About, Fitted, Page, PageRef, with_about};
use crate::engine_api::EngineHandle;

/// The channel a profile's files are kept in.
const ROOT: u32 = 0;

/// A file kept in the server's file store for a profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stored {
    /// What it is kept under.
    pub key: String,
    /// Its size, in bytes.
    pub size: u64,
}

/// A folder of its own for one file on its way up or down, removed after.
struct Scratch {
    folder: PathBuf,
}

impl Scratch {
    async fn new() -> Result<Self, String> {
        let folder = std::env::temp_dir().join(format!(
            "fancy-profile-{}",
            uuid::Uuid::new_v4().simple()
        ));
        tokio::fs::create_dir_all(&folder)
            .await
            .map_err(|error| format!("no room for the file: {error}"))?;
        Ok(Self { folder })
    }

    fn path(&self, name: &str) -> PathBuf {
        self.folder.join(name)
    }

    async fn remove(self) {
        let _ = tokio::fs::remove_dir_all(&self.folder).await;
    }
}

impl EngineHandle {
    /// The longest comment the server takes, in bytes; zero for no limit.
    pub fn comment_limit(&self) -> usize {
        self.state.server_config().max_message_length as usize
    }

    /// Whether the server has shown that it keeps files; `None` while that
    /// is not known yet.
    pub fn files_available(&self) -> Option<bool> {
        self.state.starling_files_available()
    }

    /// Save `about` into the local user's comment, with `page` as where its
    /// full profile is kept (none takes that away), and the plain HTML for
    /// other clients after the mark. Everything else the profile says is
    /// kept. Thumbnails are left out until it fits what the server takes.
    ///
    /// # Errors
    ///
    /// When not connected, or it does not fit even without thumbnails.
    pub async fn set_about(&self, about: &About, page: Option<&PageRef>) -> Result<Fitted, String> {
        let held = match self.state.get_own_session() {
            Some(own) => self.user_comment(own).await,
            None => None,
        };
        let fitted = with_about(
            held.as_deref().unwrap_or_default(),
            about,
            page,
            self.comment_limit(),
        )?;
        self.state.set_user_comment(fitted.comment.clone()).await?;
        Ok(fitted)
    }

    /// Set the local user's comment to `comment` as it is written, HTML and
    /// profile mark and all: what the web client does with a profile of the
    /// older format, and what a test writes one with.
    ///
    /// # Errors
    ///
    /// When not connected, or the server refuses it.
    pub async fn set_written_comment(&self, comment: &str) -> Result<(), String> {
        self.state.set_user_comment(comment.to_owned()).await
    }

    /// Keep `bytes` in the server's file store for the local user's
    /// profile, under the file name `name`.
    ///
    /// # Errors
    ///
    /// When the server keeps no files, or refuses this one.
    pub async fn store_profile_file(&self, bytes: &[u8], name: &str) -> Result<Stored, String> {
        let scratch = Scratch::new().await?;
        let path = scratch.path(name);
        let stored = match tokio::fs::write(&path, bytes).await {
            Ok(()) => {
                self.state
                    .starling_upload_file(
                        path.to_string_lossy().into_owned(),
                        ROOT,
                        Some(kind_of(name).to_owned()),
                        String::new(),
                        Visibility::Session,
                        0,
                        String::new(),
                        None,
                    )
                    .await
            }
            Err(error) => Err(format!("the file could not be written: {error}")),
        };
        scratch.remove().await;
        let stored = stored?;
        Ok(Stored {
            key: stored.key,
            size: stored.size,
        })
    }

    /// The file kept under `key` for a profile, if it is no more than
    /// `most` bytes.
    ///
    /// # Errors
    ///
    /// When it is not there any more, or is larger than that.
    pub async fn fetch_profile_file(&self, key: &str, most: u64) -> Result<Vec<u8>, String> {
        let scratch = Scratch::new().await?;
        let path = scratch.path("fetched");
        let written = self
            .state
            .starling_download_to_file(key.to_owned(), path.to_string_lossy().into_owned(), None)
            .await;
        let read = match written {
            Ok(size) if size > most => Err(format!("it is {size} bytes, more than {most}")),
            Ok(_) => tokio::fs::read(&path)
                .await
                .map_err(|error| format!("it could not be read: {error}")),
            Err(error) => Err(error),
        };
        scratch.remove().await;
        read
    }

    /// Keep `page` in the server's file store as the local user's full
    /// profile; what comes back is where it is kept, for [`Self::set_about`].
    ///
    /// # Errors
    ///
    /// When it is larger than a full profile may be, or cannot be kept.
    pub async fn store_profile_page(&self, page: &Page) -> Result<PageRef, String> {
        let bytes = page.to_bytes();
        if bytes.len() as u64 > Page::MOST_BYTES {
            return Err("the full profile is larger than one may be".to_owned());
        }
        let stored = self.store_profile_file(&bytes, "profile.json").await?;
        Ok(PageRef {
            key: stored.key,
            size: stored.size,
            v: Page::VERSION,
        })
    }

    /// The full profile kept where `page` says.
    ///
    /// # Errors
    ///
    /// When it is not there any more, is not the size it was said to be,
    /// or is not a full profile.
    pub async fn fetch_profile_page(&self, page: &PageRef) -> Result<Page, String> {
        let bytes = self.fetch_profile_file(&page.key, Page::MOST_BYTES).await?;
        if bytes.len() as u64 != page.size {
            return Err("the full profile is not the one the profile names".to_owned());
        }
        Page::read(&bytes).ok_or_else(|| "that is not a full profile".to_owned())
    }
}

/// The kind of file `name` is, by its ending.
fn kind_of(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    match lower.rsplit('.').next() {
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("jpg" | "jpeg") => "image/jpeg",
        _ => "application/octet-stream",
    }
}
