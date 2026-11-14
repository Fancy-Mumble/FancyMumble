//! The keyboard's way round the window: the stops Tab moves between, the
//! ring that shows which one has the keyboard, and the surfaces that keep
//! it inside themselves while they are open.
//!
//! GPUI keeps the order of the stops (the order they are drawn in) and
//! moves along it with `Window::focus_next` and `focus_prev`; this is what
//! the kit adds to that. A control from the kit makes itself a stop with a
//! [`TabStop`]; Enter and Space then work its click, which GPUI does for
//! any element that has the keyboard and takes clicks. A press of the
//! pointer works a control without handing it the keyboard, so a ring is
//! only ever seen where the keyboard was brought, as a browser shows
//! `:focus-visible`.

use std::cell::RefCell;
use std::rc::{Rc, Weak};

use gpui::{
    AnyWindowHandle, App, AsyncWindowContext, BorderStyle, DispatchPhase, Div, ElementId,
    FocusHandle, Global, Hsla, InteractiveElement, IntoElement, MouseButton, MouseDownEvent,
    ParentElement, Pixels, RenderOnce, Stateful, Styled, Window, canvas, div, prelude::*, px, quad,
    transparent_black,
};

use crate::theme::ActiveTheme;

/// How thick the ring is.
const RING: f32 = 2.0;

/// Which way along the stops the keyboard moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Way {
    /// To the stop drawn after: Tab, and Down in a menu.
    Next,
    /// To the stop drawn before: Shift+Tab, and Up in a menu.
    Back,
}

impl Way {
    /// Move the keyboard one stop this way along the whole window.
    fn step(self, window: &mut Window, cx: &mut App) {
        match self {
            Self::Next => window.focus_next(cx),
            Self::Back => window.focus_prev(cx),
        }
    }
}

/// What the ring round a control looks like: the control's own corner, so
/// it follows the theme's, and an ink that reads on the control's fill.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Ring {
    pub corner: Pixels,
    pub ink: Hsla,
}

impl Ring {
    /// The ring itself, laid over the control's edge. While it is there a
    /// press of the pointer anywhere lets go of the keyboard, as it does in
    /// a browser: a control the pointer has moved on from is not worked by
    /// the next Enter.
    fn around(self, holder: FocusHandle) -> impl IntoElement {
        div()
            .debug_selector(|| "focus-ring".to_owned())
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .child(
                canvas(
                    |_, _, _| (),
                    move |bounds, (), window, _| {
                        window.paint_quad(quad(
                            bounds,
                            self.corner,
                            transparent_black(),
                            px(RING),
                            self.ink,
                            BorderStyle::Solid,
                        ));
                        window.on_mouse_event(move |_: &MouseDownEvent, phase, window, cx| {
                            if phase == DispatchPhase::Capture && holder.is_focused(window) {
                                window.blur(cx);
                            }
                        });
                    },
                )
                .size_full(),
            )
    }
}

/// A control the keyboard can stop at: the handle that holds the keyboard
/// for it, kept from one frame to the next under the control's id.
pub(crate) struct TabStop {
    handle: FocusHandle,
}

impl TabStop {
    /// The stop of the control with `id`, which must be the id the
    /// control's own element is given.
    pub(crate) fn new(id: impl Into<ElementId>, window: &mut Window, cx: &mut App) -> Self {
        let id = id.into();
        #[cfg(test)]
        let named = id.clone();
        let handle = window.with_global_id(id, |global, window| {
            window.with_element_state(global, |kept: Option<FocusHandle>, _| {
                let handle = kept.unwrap_or_else(|| cx.focus_handle().tab_stop(true));
                (handle.clone(), handle)
            })
        });
        #[cfg(test)]
        if handle.is_focused(window) {
            cx.set_global(Keyboard(handle.clone(), named));
        }
        Self { handle }
    }

    /// Make `control` this stop: Tab reaches it, Enter and Space work its
    /// click, and while it has the keyboard it wears `ring`.
    pub(crate) fn wrap(self, control: Stateful<Div>, ring: Ring, window: &Window) -> Stateful<Div> {
        let focused = self.handle.is_focused(window);
        control
            .track_focus(&self.handle)
            // A press works the control; it does not take the keyboard
            // from wherever it is.
            .on_mouse_down(MouseButton::Left, |_, window, _| window.prevent_default())
            .when(focused, |control| {
                control.relative().child(ring.around(self.handle))
            })
    }

    /// The same, for a control the theme cuts to `cut`: its ring follows
    /// the cut. With no cut, [`Self::wrap`].
    pub(crate) fn wrap_cut(
        self,
        control: Stateful<Div>,
        ring: Ring,
        cut: Option<crate::theme::Cut>,
        window: &Window,
    ) -> Stateful<Div> {
        let Some(cut) = cut else {
            return self.wrap(control, ring, window);
        };
        let focused = self.handle.is_focused(window);
        self.wrap(control, Ring { ink: transparent_black(), ..ring }, window)
            .when(focused, |control| {
                control.child(super::shape::ring(cut, ring.ink, px(RING)))
            })
    }
}

/// A control drawn outside the kit, made a stop the way the kit's own are.
///
/// ```ignore
/// Reachable::new("mode", div().id("mode").on_click(...)).corner(theme.skin.radius_sm)
/// ```
#[derive(IntoElement)]
pub(crate) struct Reachable {
    id: ElementId,
    control: Stateful<Div>,
    corner: Option<Pixels>,
}

impl Reachable {
    /// `control` must have been given `id`.
    pub(crate) fn new(id: impl Into<ElementId>, control: Stateful<Div>) -> Self {
        Self {
            id: id.into(),
            control,
            corner: None,
        }
    }

    /// The control's corner, where it is not the theme's medium one.
    pub(crate) fn corner(mut self, corner: Pixels) -> Self {
        self.corner = Some(corner);
        self
    }
}

impl RenderOnce for Reachable {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let ring = Ring {
            corner: self.corner.unwrap_or(theme.skin.radius_md),
            ink: theme.c.accent,
        };
        TabStop::new(self.id, window, cx).wrap(self.control, ring, window)
    }
}

/// The kit control that had the keyboard when it was last drawn, and its
/// id.
#[cfg(test)]
struct Keyboard(FocusHandle, ElementId);

#[cfg(test)]
impl Global for Keyboard {}

/// The id of the kit control that has the keyboard, if one has it.
#[cfg(test)]
pub(crate) fn keyboard_at(window: &Window, cx: &App) -> Option<String> {
    let Keyboard(handle, id) = cx.try_global::<Keyboard>()?;
    handle.is_focused(window).then(|| id.to_string())
}

/// How a surface holds the keyboard while it is open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Hold {
    /// Tab and Shift+Tab go round the stops inside it: a dialog.
    Tab,
    /// So do Down and Up: a menu.
    Arrows,
}

/// A surface that holds the keyboard: its ends in the order of the stops,
/// and where the keyboard came from, to give it back when the surface
/// goes.
struct Holder {
    /// The surface itself: before every stop inside it, and the one that
    /// knows whether the keyboard is inside.
    head: FocusHandle,
    /// A mark after every stop inside it.
    tail: FocusHandle,
    hold: Hold,
    window: AsyncWindowContext,
    /// Once the keyboard was brought in: where it was before.
    came_from: RefCell<Option<Option<FocusHandle>>>,
    /// Where the keyboard was last brought inside.
    last: RefCell<Option<FocusHandle>>,
}

/// The surface holding the keyboard: the one drawn last of those open.
struct Held(Weak<Holder>);

impl Global for Held {}

impl Holder {
    /// The holder of the surface with `id`, kept from frame to frame, and
    /// now the one holding the keyboard: it is drawn over what was drawn
    /// before it.
    fn kept(id: ElementId, hold: Hold, window: &mut Window, cx: &mut App) -> Rc<Self> {
        let holder = window.with_global_id(id, |global, window| {
            window.with_element_state(global, |kept: Option<Rc<Self>>, window| {
                let holder = kept.unwrap_or_else(|| {
                    Rc::new(Self {
                        head: cx.focus_handle(),
                        tail: cx.focus_handle(),
                        hold,
                        window: window.to_async(cx),
                        came_from: RefCell::default(),
                        last: RefCell::default(),
                    })
                });
                (Rc::clone(&holder), holder)
            })
        });
        cx.set_global(Held(Rc::downgrade(&holder)));
        holder
    }

    /// The surface holding the keyboard in `window`, if one is open there.
    fn current(window: AnyWindowHandle, cx: &App) -> Option<Rc<Self>> {
        let holder = cx.try_global::<Held>()?.0.upgrade()?;
        (holder.window.window_handle() == window).then_some(holder)
    }

    /// The end of the surface a step `way` starts from to reach its first
    /// stop that way.
    fn end(&self, way: Way) -> &FocusHandle {
        match way {
            Way::Next => &self.head,
            Way::Back => &self.tail,
        }
    }

    fn holds_keyboard(&self, window: &Window, cx: &App) -> bool {
        self.head.contains_focused(window, cx)
    }

    /// Move the keyboard one stop `way` among the stops inside, round from
    /// one end to the other, and in from wherever it was.
    fn walk(&self, way: Way, window: &mut Window, cx: &mut App) {
        if !self.holds_keyboard(window, cx) {
            let mut came_from = self.came_from.borrow_mut();
            if came_from.is_none() {
                *came_from = Some(window.focused(cx));
            }
            self.end(way).focus(window, cx);
        }
        way.step(window, cx);
        if !self.holds_keyboard(window, cx) {
            self.end(way).focus(window, cx);
            way.step(window, cx);
        }
        // Nothing inside to stop at: the surface keeps the keyboard itself.
        if !self.holds_keyboard(window, cx) {
            self.head.focus(window, cx);
        }
        *self.last.borrow_mut() = window.focused(cx);
    }
}

impl Drop for Holder {
    /// The surface is gone: give the keyboard back to where it was brought
    /// in from, unless it has been taken somewhere since.
    fn drop(&mut self) {
        let Some(came_from) = self.came_from.take() else {
            return;
        };
        let left = self.last.take();
        self.window
            .spawn(async move |cx| {
                cx.update(|window, cx| {
                    if window.focused(cx) != left {
                        return;
                    }
                    match came_from {
                        Some(back) => window.focus(&back, cx),
                        None => window.blur(cx),
                    }
                })
            })
            .detach();
    }
}

/// The ends of a surface that holds the keyboard, for it to be drawn
/// with.
pub(crate) struct KeyTrap {
    head: FocusHandle,
    tail: FocusHandle,
}

impl KeyTrap {
    /// Have the surface with `id` hold the keyboard the way `hold` says
    /// for as long as it is drawn.
    pub(crate) fn new(id: ElementId, hold: Hold, window: &mut Window, cx: &mut App) -> Self {
        let holder = Holder::kept(id, hold, window, cx);
        Self {
            head: holder.head.clone(),
            tail: holder.tail.clone(),
        }
    }

    /// The surface, holding the keyboard: `surface` is its element, and
    /// gets a mark after its children.
    pub(crate) fn around(self, surface: Stateful<Div>) -> Stateful<Div> {
        surface
            .track_focus(&self.head)
            .child(div().track_focus(&self.tail))
    }
}

/// Move the keyboard one stop `way`: round the surface holding it if one
/// is open, along the whole window if none is.
pub(crate) fn walk(way: Way, window: &mut Window, cx: &mut App) {
    match Holder::current(window.window_handle(), cx) {
        Some(holder) => holder.walk(way, window, cx),
        None => way.step(window, cx),
    }
}

/// Whether a surface holds the keyboard in `window`, and the keyboard is
/// inside it.
#[cfg(test)]
pub(crate) fn held_inside(window: &Window, cx: &App) -> bool {
    Holder::current(window.window_handle(), cx)
        .is_some_and(|holder| holder.holds_keyboard(window, cx))
}

/// Whether the arrows are walking an open menu: if not, they are left to
/// whatever has the keyboard.
pub(crate) fn arrows_held(cx: &App) -> bool {
    cx.try_global::<Held>()
        .and_then(|held| held.0.upgrade())
        .is_some_and(|holder| holder.hold == Hold::Arrows)
}
