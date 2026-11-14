//! The editor drawn: the blocks being edited beside a preview of the card's
//! about, or a profile of the older format beside what it becomes.

use gpui::{
    AnyElement, Context, Div, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::draft::{Draft, Kind, pictured};
use super::{Editor, before, preview};
use crate::theme::Theme;
use crate::ui::Shell;
use crate::ui::about_view::{self, Drawing};
use crate::ui::conversation::words_as;
use crate::ui::kit::{
    Button, Corner, Dialog, Emphasis, IconButton, Size, SwitchRow, Tone, Variant,
};
use crate::ui::widgets::EMPHASIS;
use crate::words::t;

/// How wide a card's about is: what the preview is drawn at.
const CARD_ROOM: f32 = 270.0;

/// The editor over the window, while it is open.
pub(crate) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Option<AnyElement> {
    let editor = shell.panels.profiles.editor.as_ref()?;
    let title = if editor.converting() {
        t!("Convert your profile to the new format")
    } else {
        t!("What you say about yourself")
    };
    Some(
        Dialog::new("about-editor")
            .w(px(860.0))
            .max_h(px(760.0))
            .gap(px(14.0))
            .p(px(22.0))
            .scrolls()
            .title(title)
            .text_size(px(13.0))
            .child(body(shell, editor, theme, cx))
            .into_any_element(),
    )
}

/// What the editor shows, wherever it is drawn: a settings page can draw
/// this in place of [`render`].
pub(crate) fn body(
    shell: &Shell,
    editor: &Editor,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let main = if let Some(words) = before(editor) {
        converting(words, editor, theme, cx)
    } else if let Some(drafts) = editor.drafts() {
        editing(drafts, editor, theme, cx)
    } else {
        div()
            .text_color(theme.c.muted)
            .child(t!("Fetching what you say about yourself…"))
    };
    div()
        .flex()
        .flex_col()
        .gap(px(14.0))
        .child(main)
        .child(footer(shell, editor, theme, cx))
        .into_any_element()
}

/// The glyph of the button that adds a block of `kind`.
const fn glyph(kind: Kind) -> &'static str {
    match kind {
        Kind::Heading => "heading",
        Kind::Text => "type",
        Kind::List => "list",
        Kind::Quote => "text-quote",
        Kind::Divider => "minus",
        Kind::Pictures => "image",
    }
}

/// The editor as a field of a settings page, as the web UI's field for what
/// one says about oneself is drawn: a box with a strip of buttons on top,
/// one for each kind of block, and the blocks under it. A profile of the
/// older format shows its words, with the way to its conversion, which
/// opens as the dialog it always was.
pub(crate) fn field(
    shell: &Shell,
    editor: &Editor,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let editing = editor.drafts().is_some();
    let tools = field_tools(editing, cx);
    let room = if let Some(words) = before(editor) {
        older_words(words, theme, cx)
    } else if let Some(drafts) = editor.drafts() {
        div().flex().flex_col().gap(px(8.0)).children(
            drafts
                .iter()
                .enumerate()
                .map(|(at, draft)| draft_row(at, draft, drafts.len(), theme, cx)),
        )
    } else {
        div()
            .text_color(theme.c.muted)
            .child(t!("Fetching what you say about yourself…"))
    };
    let boxed = div()
        .debug_selector(|| "about-field".to_owned())
        .w_full()
        .flex()
        .flex_col()
        .rounded(theme.skin.radius_md)
        .bg(theme.c.card)
        .border_1()
        .border_color(theme.c.line2)
        .overflow_hidden()
        .child(
            div()
                .h(px(33.0))
                .px(px(6.0))
                .flex()
                .items_center()
                .gap(px(2.0))
                .border_b_1()
                .border_color(theme.c.line)
                .children(tools),
        )
        .child(
            div()
                .min_h(px(96.0))
                .px(px(13.0))
                .py(px(10.0))
                .text_size(px(12.5))
                .line_height(px(19.375))
                .child(room),
        );
    div()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .child(boxed)
        .when(editing, |field| field.child(footer(shell, editor, theme, cx)))
        .into_any_element()
}

/// The field's strip of buttons, one for each kind of block, faded while
/// there are no blocks to add to.
fn field_tools(editing: bool, cx: &mut Context<Shell>) -> Vec<IconButton> {
    Kind::ALL
        .into_iter()
        .map(|kind| {
            IconButton::new(kind.add_id(), glyph(kind))
                .dims(26.0, 24.0)
                .glyph_size(13.0)
                .corner(Corner::Small)
                .faded(!editing)
                .tip(kind.name())
                .on_click(cx.listener(move |shell, _, _, cx| {
                    if shell
                        .panels
                        .profiles
                        .editor
                        .as_ref()
                        .is_some_and(|editor| editor.drafts().is_some())
                    {
                        shell.add_draft(kind, cx);
                    }
                }))
        })
        .collect()
}

/// A profile of the older format in the field: its words, and the way to
/// its conversion.
fn older_words(words: &crate::rich::Rich, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let viewer = cx.entity().downgrade();
    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            div()
                .debug_selector(|| "about-field-words".to_owned())
                .children(words_as(
                    ("about-field-words", 0_usize),
                    words,
                    (None, Some(&viewer)),
                    theme.c.accent_text,
                    theme,
                )),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_size(px(11.0))
                        .line_height(px(15.0))
                        .text_color(theme.c.muted)
                        .child(t!(
                            "This profile uses the older format: only its words are shown."
                        )),
                )
                .child(
                    Button::new("about-convert", t!("Convert"))
                        .size(Size::Small)
                        .on_click(cx.listener(|shell, _, _, cx| {
                            shell.convert_about_in_dialog(cx);
                        })),
                ),
        )
}

/// A column with a heading over it.
fn column(title: &str, theme: &Theme) -> Div {
    div().flex().flex_col().gap(px(8.0)).child(
        div()
            .text_size(px(11.0))
            .font_weight(EMPHASIS)
            .text_color(theme.c.dim)
            .child(title.to_uppercase()),
    )
}

/// A card's ground, for what is shown as a card would show it.
fn plate(theme: &Theme) -> Div {
    div()
        .w(px(CARD_ROOM + 24.0))
        .flex_none()
        .p(px(12.0))
        .rounded(px(14.0))
        .bg(theme.c.card)
        .border_1()
        .border_color(theme.c.line2)
        .flex()
        .flex_col()
        .gap(px(4.0))
        .text_size(px(12.0))
        .line_height(px(18.0))
        .text_color(theme.c.muted)
}

fn drawing<'a>(
    name: &'static str,
    theme: &'a Theme,
    viewer: &'a gpui::WeakEntity<Shell>,
) -> Drawing<'a> {
    Drawing {
        name,
        room: CARD_ROOM,
        ink: theme.c.muted,
        link: theme.c.accent_text,
        line: theme.c.line2,
        theme,
        viewer,
    }
}

/// The older profile's words beside what they become.
fn converting(
    words: &crate::rich::Rich,
    editor: &Editor,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let viewer = cx.entity().downgrade();
    let now = plate(theme)
        .debug_selector(|| "convert-before".to_owned())
        .text_center()
        .children(words_as(
            ("convert-before", 0_usize),
            words,
            (None, Some(&viewer)),
            theme.c.accent_text,
            theme,
        ));
    let after = preview(editor, cx);
    let then = plate(theme)
        .debug_selector(|| "convert-after".to_owned())
        .text_center()
        .map(|plate| match &after {
            Some(shown) => plate.children(about_view::blocks(
                shown,
                drawing("convert-after", theme, &viewer),
                cx,
            )),
            None => plate.child(t!("Reading your profile…")),
        });
    div()
        .flex()
        .flex_col()
        .gap(px(12.0))
        .child(div().text_color(theme.c.muted).child(t!(
            "Your profile uses the older format. The new one is lighter to show: what it says as blocks, its pictures as small thumbnails. Here is what it would become; nothing changes until you save."
        )))
        .child(
            div()
                .flex()
                .gap(px(18.0))
                .justify_center()
                .child(column(&t!("Now"), theme).child(now))
                .child(column(&t!("Converted"), theme).child(then)),
        )
}

/// The blocks being edited, beside the card's about they make.
fn editing(drafts: &[Draft], editor: &Editor, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let viewer = cx.entity().downgrade();
    let rows: Vec<_> = drafts
        .iter()
        .enumerate()
        .map(|(at, draft)| draft_row(at, draft, drafts.len(), theme, cx))
        .collect();
    let adds: Vec<_> = Kind::ALL
        .into_iter()
        .map(|kind| {
            Button::new(kind.add_id(), kind.name())
                .start_icon("plus")
                .size(Size::Small)
                .on_click(cx.listener(move |shell, _, _, cx| shell.add_draft(kind, cx)))
        })
        .collect();
    let shown = preview(editor, cx);
    let card = plate(theme)
        .debug_selector(|| "about-preview".to_owned())
        .text_center()
        .when_some(shown, |plate, shown| {
            plate.children(about_view::blocks(
                &shown,
                drawing("about-preview", theme, &viewer),
                cx,
            ))
        });
    div()
        .flex()
        .gap(px(18.0))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(10.0))
                .children(rows)
                .child(div().flex().flex_wrap().gap(px(6.0)).children(adds)),
        )
        .child(column(&t!("On your card"), theme).child(card))
}

/// One block being edited: what it is, its controls, and its words or
/// pictures.
fn draft_row(
    at: usize,
    draft: &Draft,
    count: usize,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let head = draft_head(at, draft, count, theme, cx);
    div()
        .id(("about-block", at))
        .debug_selector(move || format!("about-block-{at}"))
        .flex()
        .flex_col()
        .gap(px(6.0))
        .p(px(10.0))
        .rounded(px(10.0))
        .bg(theme.c.card)
        .border_1()
        .border_color(theme.c.line2)
        .child(head)
        .when_some(draft.field.clone(), |row, field| {
            row.child(
                div()
                    .min_h(px(38.0))
                    .px(px(10.0))
                    .py(px(8.0))
                    .rounded(px(8.0))
                    .bg(theme.c.input)
                    .border_1()
                    .border_color(theme.c.line2)
                    .child(field),
            )
        })
        .when(draft.kind == Kind::Pictures, |row| {
            row.child(picture_strip(at, draft, theme, cx))
        })
}

/// What a block being edited is, and its controls: where its words stand,
/// whether its list is numbered, up, down, out.
fn draft_head(
    at: usize,
    draft: &Draft,
    count: usize,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let control = |id: &'static str, glyph: &'static str, tip: SharedString| {
        IconButton::at(id, at, glyph)
            .size(26.0)
            .glyph_size(12.0)
            .tip(tip)
    };
    let align_word = match draft.align {
        mumble_tauri_lib::engine_api::about::Align::Left => t!("Left"),
        mumble_tauri_lib::engine_api::about::Align::Center => t!("Centre"),
        mumble_tauri_lib::engine_api::about::Align::Right => t!("Right"),
    };
    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .child(
            div()
                .flex_1()
                .text_size(px(11.0))
                .font_weight(EMPHASIS)
                .text_color(theme.c.dim)
                .child(draft.kind.name().to_uppercase()),
        )
        .when(draft.kind.aligns(), |head| {
            head.child(
                div()
                    .id(("about-align", at))
                    .debug_selector(move || format!("about-align-{at}"))
                    .px(px(8.0))
                    .py(px(3.0))
                    .rounded(px(6.0))
                    .cursor_pointer()
                    .text_size(px(11.0))
                    .text_color(theme.c.muted)
                    .hover(|style| style.bg(theme.c.hover))
                    .child(align_word)
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.change_drafts(|drafts, _| drafts[at].turn_align(), cx);
                    })),
            )
        })
        .when(draft.kind == Kind::List, |head| {
            let numbered = draft.numbered;
            head.child(
                control(
                    "about-numbered",
                    if numbered { "hash" } else { "minus" },
                    t!("Numbered or bulleted"),
                )
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.change_drafts(|drafts, _| drafts[at].numbered = !numbered, cx);
                })),
            )
        })
        .when(at > 0, |head| {
            head.child(
                control("about-up", "chevron-up", t!("Move up")).on_click(cx.listener(
                    move |shell, _, _, cx| {
                        shell.change_drafts(|drafts, _| drafts.swap(at, at - 1), cx)
                    },
                )),
            )
        })
        .when(at + 1 < count, |head| {
            head.child(
                control("about-down", "chevron-down", t!("Move down")).on_click(cx.listener(
                    move |shell, _, _, cx| {
                        shell.change_drafts(|drafts, _| drafts.swap(at, at + 1), cx)
                    },
                )),
            )
        })
        .child(
            control("about-remove", "trash-2", t!("Remove"))
                .tone(Tone::Danger)
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.change_drafts(
                        |drafts, _| {
                            let _ = drafts.remove(at);
                        },
                        cx,
                    );
                })),
        )
}

/// The pictures of a block being edited, each with a way to take it out,
/// and a way to add one while there is room.
fn picture_strip(at: usize, draft: &Draft, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let tiles = draft.pictures.iter().enumerate().map(|(nth, pictured)| {
        div()
            .relative()
            .size(px(64.0))
            .rounded(px(8.0))
            .overflow_hidden()
            .bg(theme.c.card2)
            .when_some(pictured.thumb.clone(), |tile, thumb| {
                tile.child(
                    gpui::img(crate::pictures::shown(&thumb, crate::pictures::Fit::Tile))
                        .size_full()
                        .object_fit(gpui::ObjectFit::Cover),
                )
            })
            .child(
                div().absolute().top(px(2.0)).right(px(2.0)).child(
                    IconButton::at("about-picture-out", at * 8 + nth, "x")
                        .size(20.0)
                        .glyph_size(10.0)
                        .variant(Variant::Filled)
                        .tip(t!("Take this picture out"))
                        .on_click(cx.listener(move |shell, _, _, cx| {
                            shell.change_drafts(
                                |drafts, _| {
                                    let _ = drafts[at].pictures.remove(nth);
                                },
                                cx,
                            );
                        })),
                ),
            )
    });
    div()
        .flex()
        .items_center()
        .gap(px(6.0))
        .children(tiles)
        .when(draft.takes_picture(), |strip| {
            strip.child(
                IconButton::at("about-picture-add", at, "image")
                    .size(64.0)
                    .glyph_size(18.0)
                    .variant(Variant::Soft)
                    .tip(t!("Add a picture"))
                    .on_click(cx.listener(move |shell, _, _, cx| shell.pick_about_picture(at, cx))),
            )
        })
}

/// What is said under the editor, and its buttons.
fn footer(shell: &Shell, editor: &Editor, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let keep = editor.keeps_full();
    let ready = !editor.saving() && (editor.drafts().is_some() || editor.converted());
    div()
        .flex()
        .flex_col()
        .gap(px(10.0))
        // Only where the server keeps files.
        .when(shell.snapshot.fancy, |footer| {
            footer.child(
                SwitchRow::new("about-keep-full", t!("Keep the full pictures on this server"), keep)
                    .hint(t!(
                        "Your card carries small thumbnails; the full pictures go to this server's file store, and are fetched only when somebody opens one."
                    ))
                    .on_click(cx.listener(move |shell, _, _, cx| shell.keep_full_pictures(!keep, cx))),
            )
        })
        .when_some(editor.error().cloned(), |footer, why| {
            footer.child(
                div()
                    .debug_selector(|| "about-error".to_owned())
                    .text_color(theme.c.bad)
                    .child(why),
            )
        })
        .child(
            div()
                .flex()
                .justify_end()
                .gap(px(8.0))
                .child(
                    Button::new("about-cancel", t!("Cancel"))
                        .on_click(cx.listener(|shell, _, _, cx| shell.close_about_editor(cx))),
                )
                .child(
                    Button::new("about-save", if editor.saving() { t!("Saving…") } else { t!("Save") })
                        .emphasis(Emphasis::Contained)
                        .tone(Tone::Accent)
                        .on_click(cx.listener(move |shell, _, _, cx| {
                            if ready {
                                shell.save_about(cx);
                            }
                        })),
                ),
        )
}

impl Shell {
    /// Add a block of `kind` at the end.
    pub(crate) fn add_draft(&mut self, kind: Kind, cx: &mut Context<Self>) {
        let draft = Draft::new(kind, "", self, cx);
        self.change_drafts(move |drafts, _| drafts.push(draft), cx);
    }

    /// Choose a picture file for the block at `at`.
    fn pick_about_picture(&mut self, at: usize, cx: &mut Context<Self>) {
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some(t!("Choose a picture")),
        });
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(paths))) = chosen.await else {
                return;
            };
            let Some(path) = paths.into_iter().next() else {
                return;
            };
            let read = cx
                .background_executor()
                .spawn(async move { std::fs::read(&path).map_err(|e| e.to_string()) })
                .await;
            let _ = shell.update(cx, |shell, cx| match read {
                Ok(bytes) => shell.add_about_picture(at, bytes, cx),
                Err(why) => shell.notice = Some(why.into()),
            });
        })
        .detach();
    }

    /// Add the picture in `bytes` to the block at `at`: made small on
    /// another thread, its full bytes kept for the file store.
    pub(crate) fn add_about_picture(&mut self, at: usize, bytes: Vec<u8>, cx: &mut Context<Self>) {
        let made = cx
            .background_executor()
            .spawn(async move { pictured(bytes) });
        cx.spawn(async move |shell, cx| {
            let made = made.await;
            let _ = shell.update(cx, |shell, cx| match made {
                Ok(pictured) => shell.change_drafts(
                    |drafts, _| {
                        if let Some(draft) =
                            drafts.get_mut(at).filter(|draft| draft.takes_picture())
                        {
                            draft.pictures.push(pictured);
                        }
                    },
                    cx,
                ),
                Err(why) => shell.notice = Some(why.into()),
            });
        })
        .detach();
    }
}
