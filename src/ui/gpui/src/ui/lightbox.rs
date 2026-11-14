//! A picture opened large, over a veil: looked at closer, moved about,
//! saved, copied, and stepped from to the pictures before and after it in
//! the conversation.

use std::sync::Arc;

use gpui::{
    Context, IntoElement, MouseButton, ParentElement, SharedString, Styled, Window, div,
    prelude::*, px,
};

use super::Shell;
use super::kit::{IconButton, Variant};
use super::toasts::Kind;
use super::zoom::View;
use crate::theme::Theme;

/// The share of the window a picture may take, as the web UI has it.
const SHARE: f32 = 0.9;
/// What the buttons under the picture take of the window's height.
const UNDER: f32 = 56.0;

/// The room a picture has in `window`, and the size it fits into it at;
/// `None` for a file that does not say how large it is.
fn placed(picture: &gpui::Image, window: &Window) -> Option<((f32, f32), (f32, f32))> {
    let viewport = window.viewport_size();
    let room = (
        f32::from(viewport.width) * SHARE,
        (f32::from(viewport.height) * SHARE - UNDER).max(1.0),
    );
    let natural = crate::picture::dimensions(picture.bytes())?;
    Some((crate::picture::fitted(natural, room), room))
}

/// Whether `html` carries a picture of its own: what is worth reading a
/// message for when stepping from picture to picture.
fn pictured(html: &str) -> bool {
    html.contains("<img") && (html.contains("data:image") || crate::away::is_light(html))
}

impl Shell {
    /// How the open picture is being looked at: as it fits, for one that
    /// was not looked at closer yet.
    pub(super) fn lightbox_view(&self) -> View {
        self.lightbox.as_ref().map_or_else(View::default, |open| {
            View::of(self.panels.looking, open.id())
        })
    }

    /// Look at the open picture another way.
    pub(super) fn look(&mut self, change: impl FnOnce(View) -> View, cx: &mut Context<Self>) {
        self.panels.looking = change(self.lightbox_view());
        cx.notify();
    }

    /// What `key` does while a picture is open: the arrows go from picture
    /// to picture, plus and minus look closer and less close, nought puts
    /// it back. Says whether it was one of those.
    pub(super) fn lightbox_key(&mut self, key: &str, cx: &mut Context<Self>) -> bool {
        match key {
            "left" | "right" => {
                let _ = self.step_lightbox(key == "right", cx);
            }
            "+" | "=" => self.look(|view| view.zoomed(1.0), cx),
            "-" => self.look(|view| view.zoomed(-1.0), cx),
            "0" => self.look(View::reset, cx),
            _ => return false,
        }
        true
    }

    /// Put the picture being looked at on the clipboard.
    fn copy_lightbox_picture(&mut self, cx: &mut Context<Self>) {
        let Some(picture) = self.lightbox.clone() else {
            return;
        };
        cx.write_to_clipboard(gpui::ClipboardItem::new_image(&picture));
        self.toast("Copied the picture", Kind::Done, cx);
    }

    /// Where the picture being looked at stands: which message of the
    /// conversation, and which of its pictures. `None` for one that is not
    /// of a message, or whose message is no longer held.
    fn lightbox_place(&self) -> Option<(usize, usize)> {
        let open = self.lightbox.as_ref()?;
        self.bodies.iter().find_map(|(index, body)| {
            // By what is in its file: a body read again holds the same
            // picture anew.
            let nth = body
                .pictures()
                .position(|picture| picture.id() == open.id())?;
            Some((*index, nth))
        })
    }

    /// Whether there is a picture after the one being looked at, or with
    /// `forward` false one before it. Told from the messages as they were
    /// sent, without reading any of them.
    fn has_picture_beyond(&self, forward: bool) -> bool {
        let Some((index, nth)) = self.lightbox_place() else {
            return false;
        };
        let within = self.bodies.get(&index).is_some_and(|body| {
            if forward {
                nth + 1 < body.pictures().count()
            } else {
                nth > 0
            }
        });
        let mut beyond = if forward {
            self.messages.get(index + 1..).unwrap_or_default().iter()
        } else {
            self.messages.get(..index).unwrap_or_default().iter()
        };
        within || beyond.any(|message| pictured(&message.html))
    }

    /// Go to the picture after the one being looked at, or with `forward`
    /// false the one before it: in its own message first, then in the
    /// nearest message that has one. Says whether there was one.
    pub(super) fn step_lightbox(&mut self, forward: bool, cx: &mut Context<Self>) -> bool {
        let Some((index, nth)) = self.lightbox_place() else {
            return false;
        };
        let of = |shell: &mut Self, index: usize| -> Vec<Arc<gpui::Image>> {
            let read = shell
                .messages
                .get(index)
                .is_some_and(|message| pictured(&message.html));
            if !read {
                return Vec::new();
            }
            shell.drawn_body(index).pictures().cloned().collect()
        };
        let own = of(self, index);
        let within = if forward {
            own.get(nth + 1)
        } else {
            nth.checked_sub(1).and_then(|before| own.get(before))
        };
        let next = within.cloned().or_else(|| {
            let mut at = index;
            loop {
                at = if forward {
                    at.checked_add(1).filter(|at| *at < self.messages.len())?
                } else {
                    at.checked_sub(1)?
                };
                let found = of(self, at);
                // Into a message from its near end: its first picture going
                // on, its last going back.
                let entered = if forward { found.first() } else { found.last() };
                if let Some(picture) = entered {
                    return Some(Arc::clone(picture));
                }
            }
        });
        let Some(next) = next else {
            return false;
        };
        self.lightbox = Some(next);
        cx.notify();
        true
    }

    /// Ask where to, and write the picture being looked at there.
    fn save_lightbox_picture(&mut self, cx: &mut Context<Self>) {
        let Some(picture) = self.lightbox.clone() else {
            return;
        };
        let home = std::env::var_os("HOME").map_or_else(std::env::temp_dir, Into::into);
        let chosen = cx.prompt_for_new_path(&home, Some(picture_file_name(&picture)));
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(to))) = chosen.await else {
                return;
            };
            let written = cx
                .background_executor()
                .spawn(async move {
                    std::fs::write(&to, picture.bytes())
                        .map(|()| to)
                        .map_err(|e| e.to_string())
                })
                .await;
            let _ = shell.update(cx, |shell, cx| {
                match written {
                    Ok(to) => shell.toast(format!("Saved {}", to.display()), Kind::Done, cx),
                    Err(problem) => {
                        shell.notice =
                            Some(format!("The picture could not be saved: {problem}").into());
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
}

/// The name a picture is offered to be saved under.
fn picture_file_name(picture: &gpui::Image) -> &'static str {
    match picture.format() {
        gpui::ImageFormat::Png => "picture.png",
        gpui::ImageFormat::Jpeg => "picture.jpg",
        gpui::ImageFormat::Gif => "picture.gif",
        gpui::ImageFormat::Webp => "picture.webp",
        _ => "picture",
    }
}

/// Where the picture stands: in the middle of the room it has, as large
/// as `view` has it and moved as far, with what hangs over cut off.
fn stage(
    picture: &Arc<gpui::Image>,
    view: View,
    window: &Window,
    cx: &mut Context<Shell>,
) -> gpui::Div {
    use crate::pictures::{Fit, shown};
    let drawn = |fit| {
        gpui::img(shown(picture, fit))
            .rounded(px(8.0))
            .object_fit(gpui::ObjectFit::Contain)
    };
    let stage = div()
        .flex_1()
        .min_h_0()
        .w_full()
        .flex()
        .items_center()
        .justify_center()
        .overflow_hidden();
    match placed(picture, window) {
        Some((fitted, room)) => {
            let view = view.kept_in(fitted, room);
            let (across, down) = view.offset();
            stage.child(
                div()
                    .id("lightbox-picture")
                    .debug_selector(|| "lightbox-picture".to_owned())
                    .flex_none()
                    .relative()
                    .left(px(across))
                    .top(px(down))
                    .w(px(fitted.0 * view.scale()))
                    .h(px(fitted.1 * view.scale()))
                    .cursor_pointer()
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|shell, event: &gpui::MouseDownEvent, _, cx| {
                            let at = (f32::from(event.position.x), f32::from(event.position.y));
                            shell.look(|view| view.held_at(at), cx);
                        }),
                    )
                    .on_click(cx.listener(|shell, _, _, cx| {
                        // A click on the picture looks closer; it does not close.
                        cx.stop_propagation();
                        let mut view = shell.lightbox_view();
                        let clicked = view.released();
                        shell.look(|_| if clicked { view.clicked() } else { view }, cx);
                    }))
                    // What the conversation already shows of it, at once,
                    // until as much of it as is worth looking at closely
                    // has been read. Not under that: where a picture lets
                    // through what is behind it, the coarser one would show.
                    .when(!crate::pictures::is_read(picture, Fit::Large, cx), |held| {
                        held.child(drawn(Fit::Tile).absolute().size_full())
                    })
                    .child(drawn(Fit::Large).absolute().size_full()),
            )
        }
        // A file that does not say how large it is: all the room.
        None => stage.child(drawn(Fit::Large).size_full()),
    }
}

/// A picture as large as it is, or as the window lets it be, over a veil.
/// A click anywhere closes it.
///
/// What is behind the veil is blurred, as the web UI has it. That is the one
/// blur this view draws, and only while a picture is open: the renderer
/// (Fancy Mumble's fork of GPUI, `gpui-next`) draws it on Windows so far, and
/// elsewhere the veil alone is what is seen.
pub(super) fn render(
    shell: &Shell,
    picture: &Arc<gpui::Image>,
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    /// How far what is behind the veil is blurred: the web UI's `blur(8px)`.
    const BLUR: f32 = 8.0;
    let mut veil = gpui::black();
    veil.a = 0.8;
    let view = shell.lightbox_view();
    div()
        .id("lightbox")
        .debug_selector(|| "lightbox".to_owned())
        .absolute()
        .size_full()
        .top_0()
        .left_0()
        .occlude()
        .backdrop_blur(px(BLUR))
        .bg(veil)
        .flex()
        .flex_col()
        .items_center()
        .gap(px(12.0))
        .p(px(32.0))
        .on_click(cx.listener(|shell, _, _, cx| {
            // A press that began on the picture and ended off it moved the
            // picture: only a click on the veil itself closes.
            let mut view = shell.lightbox_view();
            if view.is_held() {
                let _ = view.released();
                shell.look(|_| view, cx);
            } else {
                shell.lightbox = None;
                cx.notify();
            }
        }))
        .on_scroll(cx.listener(|shell, event: &gpui::ScrollEvent, _, cx| {
            let line = px(20.0);
            let notches = event.delta.pixel_delta(line).y / line;
            shell.look(|view| view.zoomed(notches), cx);
            cx.stop_propagation();
        }))
        .on_mouse_move(
            cx.listener(|shell, event: &gpui::MouseMoveEvent, window, cx| {
                let view = shell.lightbox_view();
                if !view.is_held() || event.pressed_button != Some(MouseButton::Left) {
                    return;
                }
                let at = (f32::from(event.position.x), f32::from(event.position.y));
                let placed = shell
                    .lightbox
                    .as_ref()
                    .and_then(|open| placed(open, window));
                shell.look(
                    |view| match placed {
                        Some((fitted, room)) => view.dragged_to(at).kept_in(fitted, room),
                        None => view,
                    },
                    cx,
                );
            }),
        )
        .children(step(shell, false, cx))
        .children(step(shell, true, cx))
        .child(stage(picture, view, window, cx))
        .child(under(view, theme, cx))
}

/// What stands under the picture: saving it, copying it, and how much
/// larger than it fits it is being looked at, while it is.
fn under(view: View, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let pill = |id: &'static str, says: &'static str| {
        div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .flex_none()
            .px(px(14.0))
            .py(px(6.0))
            .rounded(theme.skin.radius_pill)
            .bg(theme.c.card)
            .border_1()
            .border_color(theme.c.line2)
            .text_size(px(12.5))
            .cursor_pointer()
            .hover(|style| style.opacity(0.85))
            .child(says)
    };
    #[allow(
        clippy::cast_possible_truncation,
        reason = "a share of at most eight hundred, rounded"
    )]
    let share = (view.scale() * 100.0).round() as i32;
    div()
        .flex_none()
        .h(px(UNDER - 24.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            pill("save-picture", "Save…").on_click(cx.listener(|shell, _, _, cx| {
                // Saving is not closing.
                cx.stop_propagation();
                shell.save_lightbox_picture(cx);
            })),
        )
        .child(
            pill("copy-picture", "Copy").on_click(cx.listener(|shell, _, _, cx| {
                cx.stop_propagation();
                shell.copy_lightbox_picture(cx);
            })),
        )
        .when(view.enlarged(), |under| {
            under.child(
                div()
                    .id("lightbox-fit")
                    .debug_selector(|| "lightbox-fit".to_owned())
                    .flex_none()
                    .px(px(14.0))
                    .py(px(6.0))
                    .rounded(theme.skin.radius_pill)
                    .bg(theme.c.card)
                    .border_1()
                    .border_color(theme.c.line2)
                    .text_size(px(12.5))
                    .cursor_pointer()
                    .on_click(cx.listener(|shell, _, _, cx| {
                        cx.stop_propagation();
                        shell.look(View::reset, cx);
                    }))
                    .child(SharedString::from(format!("{share} % · fit"))),
            )
        })
}

/// The button at an edge of the veil that goes to the picture before, or
/// with `forward` the one after, where there is one.
fn step(shell: &Shell, forward: bool, cx: &mut Context<Shell>) -> Option<impl IntoElement + use<>> {
    if !shell.has_picture_beyond(forward) {
        return None;
    }
    let (id, glyph, says) = if forward {
        ("lightbox-next", "chevron-right", "Next picture")
    } else {
        ("lightbox-previous", "chevron-left", "Previous picture")
    };
    let button = IconButton::new(id, glyph)
        .size(44.0)
        .glyph_size(20.0)
        .variant(Variant::Filled)
        .corner(super::kit::Corner::Pill)
        .tip(says)
        .on_click(cx.listener(move |shell, _, _, cx| {
            // Stepping is not closing.
            cx.stop_propagation();
            let _ = shell.step_lightbox(forward, cx);
        }));
    let edge = div().absolute().top_0().bottom_0().flex().items_center();
    Some(if forward {
        edge.right(px(18.0)).child(button)
    } else {
        edge.left(px(18.0)).child(button)
    })
}
