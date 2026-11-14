//! What is going up: one row for each file sent with a message, above the
//! composer, as the web UI's `UploadRow`. A small picture of it, its name,
//! how large it is, how much of it has gone and how long the rest will
//! take at the rate so far, a thin bar filled as far, and the way to stop
//! it.
//!
//! A batch goes up one file after another, and shows the one going: a file
//! done makes way for the next. One that fails keeps its row, saying why,
//! until it is taken away; the rest still go. One that is stopped goes at
//! once, and the message names the others.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px, relative};

use super::Shell;
use super::kit::{Corner, IconButton};
use crate::engine::Uploaded;
use crate::theme::Theme;
use crate::words::t;

/// One file sent, until it is up.
pub(super) struct Upload {
    id: SharedString,
    /// The batch it was sent in: its message.
    batch: u64,
    name: SharedString,
    /// Its size on disk, known before a byte has gone.
    size: u64,
    picture: Option<Arc<gpui::Image>>,
    /// How much has gone, of how much, once the first of it has.
    sent: Option<(u64, u64)>,
    /// When it was sent: the rate is reckoned from here.
    since: Instant,
    /// Why it did not go, where it failed.
    failed: Option<SharedString>,
}

impl Upload {
    /// How much of it has gone, in hundredths: never all of it until it is
    /// up, which its row going says.
    fn percent(&self) -> u64 {
        match self.sent {
            // Rounded, as the web UI's `Math.round`.
            Some((bytes, of)) if of > 0 => (bytes.saturating_mul(100).saturating_add(of / 2) / of).min(99),
            _ => 0,
        }
    }

    /// Seconds left at the rate so far; none while there is no rate yet.
    fn seconds_left(&self) -> Option<u64> {
        let (bytes, of) = self.sent?;
        let elapsed = self.since.elapsed().as_secs_f64();
        if elapsed <= 0.0 || bytes == 0 || of <= bytes {
            return None;
        }
        #[expect(clippy::cast_precision_loss, reason = "a rate, said in whole seconds")]
        let left = (of - bytes) as f64 / (bytes as f64 / elapsed);
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "positive, and seconds"
        )]
        let left = left.round().max(1.0) as u64;
        Some(left)
    }

    /// What the line under its name says: its size, how much has gone, and
    /// the time left once there is a rate to tell it by.
    fn progress_line(&self) -> String {
        [
            Some(super::bytes_in_words(self.size)),
            Some(format!("{}%", self.percent())),
            self.seconds_left()
                .map(|seconds| t!("{{seconds}}s left", seconds = seconds).to_string()),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ")
    }
}

/// A file about to be sent, as the composer knows it.
pub(super) struct Sending {
    pub path: PathBuf,
    pub name: SharedString,
    pub size: u64,
    pub picture: Option<Arc<gpui::Image>>,
}

impl Shell {
    /// Whether a file is still going up: nothing more is sent until it is.
    pub(super) fn uploading(&self) -> bool {
        self.panels.uploads.iter().any(|upload| upload.failed.is_none())
    }

    /// Give each of `files` a row, as one batch, and the id its upload is
    /// followed by.
    pub(super) fn start_uploads(&mut self, files: Vec<Sending>) -> Vec<(SharedString, PathBuf)> {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let next = || NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let batch = next();
        let since = Instant::now();
        files
            .into_iter()
            .map(|file| {
                let id = SharedString::from(format!("upload-{}", next()));
                self.panels.uploads.push(Upload {
                    id: id.clone(),
                    batch,
                    name: file.name,
                    size: file.size,
                    picture: file.picture,
                    sent: None,
                    since,
                    failed: None,
                });
                (id, file.path)
            })
            .collect()
    }

    /// What became of the file going up under `id`.
    pub(super) fn uploaded(&mut self, id: &str, now: Uploaded, cx: &mut Context<Self>) {
        let Some(at) = self.panels.uploads.iter().position(|upload| upload.id == id) else {
            return;
        };
        match now {
            Uploaded::Sent { bytes, of } => {
                // The next of a batch going up says the ones before it went.
                let batch = self.panels.uploads[at].batch;
                let behind = self.panels.uploads[..at]
                    .iter()
                    .any(|upload| upload.batch == batch && upload.failed.is_none());
                let mut index = 0;
                self.panels.uploads.retain(|upload| {
                    let earlier = index < at;
                    index += 1;
                    !(earlier && upload.batch == batch && upload.failed.is_none())
                });
                if let Some(upload) = self.panels.uploads.iter_mut().find(|upload| upload.id == id) {
                    // Timed from its own first piece when it was waiting
                    // behind others.
                    if upload.sent.is_none() && behind {
                        upload.since = Instant::now();
                    }
                    upload.sent = Some((bytes, of));
                }
            }
            Uploaded::Done | Uploaded::Cancelled => {
                let _ = self.panels.uploads.remove(at);
            }
            Uploaded::Failed(why) => {
                self.panels.uploads[at].failed = Some(why);
            }
        }
        cx.notify();
    }

    /// Stop the file going up under `id`, or take its failure away.
    fn stop_upload(&mut self, id: &SharedString, cx: &mut Context<Self>) {
        if let Some(at) = self.panels.uploads.iter().position(|upload| upload.id == *id) {
            let upload = self.panels.uploads.remove(at);
            if upload.failed.is_none() {
                self.engine.cancel_upload(upload.id);
            }
        }
        cx.notify();
    }
}

/// The small square a row starts with: the picture, or the file's kind.
fn thumbnail(upload: &Upload, theme: &Theme) -> impl IntoElement + use<> {
    use crate::pictures::{Fit, shown};
    div()
        .flex_none()
        .size(px(40.0))
        .flex()
        .items_center()
        .justify_center()
        .overflow_hidden()
        .rounded(theme.skin.radius_md)
        .border(theme.skin.line_width)
        .border_color(theme.c.line)
        .bg(theme.c.tile)
        .font_family(theme.skin.mono.clone())
        .text_size(px(9.0))
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .text_color(theme.c.muted)
        .map(|square| match &upload.picture {
            Some(picture) => square.child(
                gpui::img(shown(picture, Fit::Tile))
                    .size_full()
                    .object_fit(gpui::ObjectFit::Cover),
            ),
            None => square.child(super::staged::extension(&upload.name)),
        })
}

/// One file's row.
fn row(
    (place, upload): (usize, &Upload),
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let id = upload.id.clone();
    let failed = upload.failed.is_some();
    let line = match &upload.failed {
        Some(why) if why.is_empty() => t!("Upload failed"),
        Some(why) => why.clone(),
        None => upload.progress_line().into(),
    };
    // A failure stops the bar where it stopped.
    #[expect(clippy::cast_precision_loss, reason = "a hundredth")]
    let done = upload.percent() as f32 / 100.0;
    let name = upload.name.clone();
    div()
        .debug_selector({
            let id = id.clone();
            move || format!("upload-{id}")
        })
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(4.0))
        .py(px(6.0))
        .child(thumbnail(upload, theme))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .truncate()
                        .text_size(px(11.5))
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child(name.clone()),
                )
                .child(
                    div()
                        .debug_selector({
                            let id = id.clone();
                            move || format!("upload-line-{id}")
                        })
                        .mt(px(2.0))
                        .text_size(px(10.0))
                        .text_color(if failed { theme.c.bad } else { theme.c.dim })
                        .child(line),
                )
                .child(
                    div()
                        .mt(px(5.0))
                        .h(px(3.0))
                        .rounded(px(2.0))
                        .overflow_hidden()
                        .bg(theme.c.card2)
                        .child(
                            div()
                                .h_full()
                                .w(relative(done))
                                .rounded(px(2.0))
                                .bg(if failed { theme.c.bad } else { theme.c.accent }),
                        ),
                ),
        )
        .child(
            div().ml_auto().child(
                IconButton::at("upload-cancel", place, "x")
                .size(20.0)
                .glyph_size(10.0)
                .corner(Corner::Small)
                .tip(t!("Cancel upload of {{filename}}", filename = name))
                .on_click(cx.listener(move |shell, _, _, cx| shell.stop_upload(&id, cx))),
            ),
        )
}

/// The files going up, in a tray above the composer: of each batch the one
/// going, and every one that failed.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<gpui::AnyElement> {
    let mut shown_batches = Vec::new();
    let shown: Vec<&Upload> = shell
        .panels
        .uploads
        .iter()
        .filter(|upload| {
            if upload.failed.is_some() {
                return true;
            }
            if shown_batches.contains(&upload.batch) {
                return false;
            }
            shown_batches.push(upload.batch);
            true
        })
        .collect();
    if shown.is_empty() {
        return None;
    }
    let mut rows = div().debug_selector(|| "uploads".to_owned()).flex().flex_col();
    for (at, upload) in shown.into_iter().enumerate() {
        if at > 0 {
            // Lighter than the tray's own edge, and inset from it.
            rows = rows.child(div().h(px(1.0)).mx(px(4.0)).bg(theme.c.line));
        }
        rows = rows.child(row((at, upload), theme, cx));
    }
    Some(super::staged::tray_of(rows, theme))
}

#[cfg(test)]
impl Shell {
    /// What each row shown says under its name, in order.
    pub(super) fn upload_lines(&self) -> Vec<String> {
        let mut shown_batches = Vec::new();
        self.panels
            .uploads
            .iter()
            .filter(|upload| {
                upload.failed.is_some() || {
                    let first = !shown_batches.contains(&upload.batch);
                    shown_batches.push(upload.batch);
                    first
                }
            })
            .map(|upload| match &upload.failed {
                Some(why) => why.to_string(),
                None => upload.progress_line(),
            })
            .collect()
    }
}