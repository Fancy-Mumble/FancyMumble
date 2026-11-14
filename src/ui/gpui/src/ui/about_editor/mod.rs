//! What the local user says about themselves, edited as blocks: add one,
//! take one away, move it, type its words with the composer's marks. And
//! a profile of the older format, converted: what it would become shown
//! beside what it is now, saved only when its owner says so.
//!
//! A component of its own. For now the own menu opens it over the window
//! ([`render`]); a settings page can draw [`view::body`] in its place and
//! keep the same state, in [`super::profile_page::Profiles::editor`].

mod draft;
pub(super) mod view;

use std::sync::Arc;

use gpui::{Context, SharedString};
use mumble_tauri_lib::engine_api::about::{Limits, Migration, PageRef};

use super::Shell;
use super::toasts;
use crate::engine::Subject;
use crate::profile::{Said, Save, Shown};
use crate::rich::Rich;
use crate::words::t;

pub(super) use draft::Draft;
pub(super) use view::render;

/// The editor, open.
pub(super) struct Editor {
    stage: Stage,
    /// The full profile the profile names now.
    page: Option<PageRef>,
    /// Whether the full pictures go to the server's file store as well.
    keep_full: bool,
    /// Whether a save is on its way.
    saving: bool,
    /// Why the last save failed.
    error: Option<SharedString>,
}

/// Where the editor is.
enum Stage {
    /// The local user's comment is being fetched; whether to convert it.
    Waiting,
    /// Blocks being edited.
    Editing(Vec<Draft>),
    /// A profile of the older format, and what it becomes.
    Converting(Convert),
}

/// A profile of the older format being converted.
pub(super) struct Convert {
    /// What it shows now: its basic words.
    before: Rich,
    /// What it becomes, once read: the reading, and its card's about.
    after: Option<(Migration, Arc<Shown>)>,
}

impl Editor {
    /// Whether it is converting a profile of the older format.
    pub(super) const fn converting(&self) -> bool {
        matches!(self.stage, Stage::Converting(_))
    }

    /// Whether the conversion has been read and can be saved.
    pub(super) const fn converted(&self) -> bool {
        matches!(
            &self.stage,
            Stage::Converting(Convert { after: Some(_), .. })
        )
    }

    /// The blocks being edited, while they are.
    pub(super) fn drafts(&self) -> Option<&[Draft]> {
        match &self.stage {
            Stage::Editing(drafts) => Some(drafts),
            _ => None,
        }
    }
}

impl Shell {
    /// Open the editor on the local user's about: their comment is fetched,
    /// and one of the older format is offered for conversion.
    pub(super) fn open_about_editor(&mut self, cx: &mut Context<Self>) {
        let Some(own) = self.snapshot.own_session else {
            return;
        };
        self.panels.profiles.editor = Some(Editor {
            stage: Stage::Waiting,
            page: None,
            keep_full: false,
            saving: false,
            error: None,
        });
        self.info = None;
        self.engine.about(Subject::User(own));
        cx.notify();
    }

    /// What there is to read about `subject` arrived: if it is the local
    /// user's comment and the editor waits for it, the editor takes it. The
    /// HTML is held no longer than its reading takes.
    pub(super) fn take_own_comment(
        &mut self,
        subject: Subject,
        html: Option<&str>,
        cx: &mut Context<Self>,
    ) {
        let own = self.snapshot.own_session.map(Subject::User);
        let waiting = self
            .panels
            .profiles
            .editor
            .as_ref()
            .is_some_and(|editor| matches!(editor.stage, Stage::Waiting));
        if !waiting || own != Some(subject) {
            return;
        }
        let html = html.unwrap_or_default();
        let (said, page) = Said::of(html);
        let stage = match said {
            Said::About(shown) => Stage::Editing(draft::drafts_of(self, &shown, cx)),
            Said::Older { words, .. } => {
                self.read_conversion(html.to_owned(), cx);
                Stage::Converting(Convert {
                    before: words,
                    after: None,
                })
            }
            Said::Nothing => Stage::Editing(Vec::new()),
        };
        if let Some(editor) = self.panels.profiles.editor.as_mut() {
            editor.stage = stage;
            editor.page = page;
        }
        cx.notify();
    }

    /// Read `html` as the new format, on another thread: pictures are
    /// decoded and made small there.
    fn read_conversion(&self, html: String, cx: &mut Context<Self>) {
        let read = cx.background_executor().spawn(async move {
            let mut migration = Migration::read(&html);
            drop(html);
            migration.thumbnail(Limits::CARD.thumbs);
            let shown = Arc::new(Shown::of(migration.card()));
            (migration, shown)
        });
        cx.spawn(async move |shell, cx| {
            let made = read.await;
            let _ = shell.update(cx, |shell, cx| {
                if let Some(Stage::Converting(convert)) = shell
                    .panels
                    .profiles
                    .editor
                    .as_mut()
                    .map(|editor| &mut editor.stage)
                {
                    convert.after = Some(made);
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// Close the editor, saving nothing.
    pub(super) fn close_about_editor(&mut self, cx: &mut Context<Self>) {
        self.panels.profiles.editor = None;
        cx.notify();
    }

    /// Whether the full pictures go to the server's file store as well.
    pub(super) fn keep_full_pictures(&mut self, keep: bool, cx: &mut Context<Self>) {
        if let Some(editor) = self.panels.profiles.editor.as_mut() {
            editor.keep_full = keep;
        }
        cx.notify();
    }

    /// Save what the editor holds: the conversion, or the blocks.
    pub(super) fn save_about(&mut self, cx: &mut Context<Self>) {
        let store = self.snapshot.fancy;
        let titles = (t!("About").to_string(), t!("Pictures").to_string());
        let Some(editor) = self.panels.profiles.editor.as_mut() else {
            return;
        };
        let keep_full = editor.keep_full && store;
        let save = match &editor.stage {
            Stage::Converting(Convert {
                after: Some((migration, _)),
                ..
            }) => Save {
                about: migration.card(),
                keep: if keep_full {
                    let embedded = migration.embedded.iter();
                    embedded
                        .enumerate()
                        .map(|(at, picture)| (at, Arc::new(picture.bytes.clone())))
                        .collect()
                } else {
                    Vec::new()
                },
                // The text the card cannot hold goes to a full profile,
                // where the server keeps one.
                full_text: (store && migration.cut()).then(|| migration.about.blocks.clone()),
                page: editor.page.clone(),
                titles,
            },
            Stage::Editing(drafts) => {
                let (about, keep) = draft::about_of(drafts, keep_full, cx);
                Save {
                    about,
                    keep,
                    full_text: None,
                    page: editor.page.clone(),
                    titles,
                }
            }
            _ => return,
        };
        editor.saving = true;
        editor.error = None;
        self.engine.save_about(save);
        cx.notify();
    }

    /// The engine said how a save went.
    pub(super) fn about_saved(
        &mut self,
        saved: Result<usize, SharedString>,
        cx: &mut Context<Self>,
    ) {
        let editor = self
            .panels
            .profiles
            .editor
            .as_mut()
            .filter(|editor| editor.saving);
        match (saved, editor) {
            (Ok(dropped), editor) => {
                if editor.is_some() {
                    self.panels.profiles.editor = None;
                }
                let says = if dropped == 0 {
                    t!("Saved what you say about yourself.")
                } else {
                    t!(
                        "Saved. {{count}} picture is shown without its thumbnail, to fit this server.",
                        "Saved. {{count}} pictures are shown without their thumbnails, to fit this server.",
                        count = dropped
                    )
                };
                self.toast(says, toasts::Kind::Done, cx);
                // A card open on oneself shows what was saved.
                if let (Some(own), Some(info)) = (self.snapshot.own_session, self.info.as_ref())
                    && info.subject == Subject::User(own)
                {
                    self.show_about(Subject::User(own), cx);
                }
            }
            (Err(why), Some(editor)) => {
                editor.saving = false;
                editor.error = Some(why);
            }
            (Err(why), None) => self.notice = Some(why),
        }
        cx.notify();
    }

    /// Change the blocks being edited as `change` says.
    pub(super) fn change_drafts(
        &mut self,
        change: impl FnOnce(&mut Vec<Draft>, &mut Context<Self>),
        cx: &mut Context<Self>,
    ) {
        let mut taken = match self.panels.profiles.editor.as_mut().map(|e| &mut e.stage) {
            Some(Stage::Editing(drafts)) => std::mem::take(drafts),
            _ => return,
        };
        change(&mut taken, cx);
        if let Some(Stage::Editing(drafts)) =
            self.panels.profiles.editor.as_mut().map(|e| &mut e.stage)
        {
            *drafts = taken;
        }
        cx.notify();
    }
}

/// The card's about of what the editor holds now, for its preview.
pub(super) fn preview(editor: &Editor, cx: &gpui::App) -> Option<Arc<Shown>> {
    match &editor.stage {
        Stage::Waiting => None,
        Stage::Converting(Convert { after, .. }) => {
            after.as_ref().map(|(_, shown)| Arc::clone(shown))
        }
        Stage::Editing(drafts) => Some(Arc::new(draft::shown_of(drafts, cx))),
    }
}

/// What a profile of the older format shows now, while it is converted.
pub(super) fn before(editor: &Editor) -> Option<&Rich> {
    match &editor.stage {
        Stage::Converting(convert) => Some(&convert.before),
        _ => None,
    }
}

impl Editor {
    pub(super) const fn saving(&self) -> bool {
        self.saving
    }

    pub(super) const fn keeps_full(&self) -> bool {
        self.keep_full
    }

    pub(super) fn error(&self) -> Option<&SharedString> {
        self.error.as_ref()
    }
}
