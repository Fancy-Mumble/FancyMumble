//! The scrollbar every scroller has: the web UI's (`nebula/theme.ts`), a
//! thumb in the chip tone on no track, brighter while it is hovered or held.
//!
//! GPUI draws no scrollbar, so [`ScrollArea`] wraps a scroller and lays one
//! over its right edge. The wrapper takes the scroller's place in the layout
//! (its size, flex and margin move onto the wrapper), and the scroller fills
//! it, so the bar stands exactly on the scroller's box.
//!
//! The bar is drawn beside the scrolled content, not in it, and keeps its
//! state out of entities: a wheel scroll then still composites the
//! scroller's layer instead of painting its content again
//! (`docs/scroll-layers.md` in the GPUI fork).
//!
//! ```ignore
//! ScrollArea::div("servers", div().id("servers").flex_1().overflow_y_scroll())
//! ScrollArea::list("members", &state, list(state.clone(), render).flex_1())
//! ```

use std::{cell::Cell, mem, rc::Rc};

use gpui::{
    AnyElement, App, Bounds, DispatchPhase, Div, ElementId, EntityId, Hsla, IntoElement, List,
    ListState, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, Point, Position,
    RenderOnce, ScrollEvent, ScrollHandle, Stateful, StyleRefinement, Styled, UniformList,
    UniformListScrollHandle, Window, canvas, div, fill, point, prelude::*, px, size,
};

use crate::theme::ActiveTheme;

/// How wide the bar's lane is, and how far the thumb is inset in it: the
/// web's 9 px scrollbar with a 2 px transparent border round the thumb.
const LANE: f32 = 9.0;
const INSET: f32 = 2.0;
/// The shortest the thumb gets, however long the content.
const SHORTEST: f32 = 24.0;

/// What a bar scrolls, and how its offset is read and set.
#[derive(Clone)]
enum Scrolls {
    Div(ScrollHandle),
    Uniform(UniformListScrollHandle),
    List(ListState),
}

impl Scrolls {
    /// How far down it is scrolled, as a positive length.
    fn down(&self) -> Pixels {
        -match self {
            Self::Div(handle) => handle.offset().y,
            Self::Uniform(handle) => handle.0.borrow().base_handle.offset().y,
            Self::List(state) => state.scroll_px_offset_for_scrollbar().y,
        }
    }

    /// How far down it scrolls at most, with `viewport` of it in view.
    fn most(&self) -> Pixels {
        match self {
            Self::Div(handle) => handle.max_offset().y,
            Self::Uniform(handle) => handle.0.borrow().base_handle.max_offset().y,
            Self::List(state) => state.max_offset_for_scrollbar().y,
        }
    }

    fn scroll_to(&self, down: Pixels) {
        let to = |at: Point<Pixels>| point(at.x, -down);
        match self {
            Self::Div(handle) => handle.set_offset(to(handle.offset())),
            Self::Uniform(handle) => {
                let handle = &handle.0.borrow().base_handle;
                handle.set_offset(to(handle.offset()));
            }
            Self::List(state) => {
                state.set_offset_from_scrollbar(to(state.scroll_px_offset_for_scrollbar()));
            }
        }
    }

    fn grabbed(&self, held: bool) {
        if let Self::List(state) = self {
            if held {
                state.scrollbar_drag_started();
            } else {
                state.scrollbar_drag_ended();
            }
        }
    }
}

/// What a bar keeps from frame to frame.
#[derive(Clone, Copy, Default)]
struct Held {
    /// Where on the thumb it was grabbed, while it is dragged.
    grab: Option<Pixels>,
    hovered: bool,
    /// How far down it was when last drawn.
    seen: Pixels,
}

/// What an area keeps: its bar's state, and the handle of a scroller that
/// was not given one.
struct Kept {
    held: Rc<Cell<Held>>,
    handle: ScrollHandle,
    uniform: UniformListScrollHandle,
}

enum Scroller {
    Div(Stateful<Div>, Option<ScrollHandle>),
    List(List, ListState),
    Uniform(UniformList, Option<UniformListScrollHandle>),
}

impl Scroller {
    fn style(&mut self) -> &mut StyleRefinement {
        match self {
            Self::Div(div, _) => div.style(),
            Self::List(list, _) => list.style(),
            Self::Uniform(list, _) => list.style(),
        }
    }
}

/// A scroller with its scrollbar.
#[derive(IntoElement)]
pub(crate) struct ScrollArea {
    id: ElementId,
    scroller: Scroller,
}

impl ScrollArea {
    /// A `div` that scrolls down (`overflow_y_scroll`), named `id`; its
    /// handle is kept here unless it is given one with [`Self::tracked`].
    pub(crate) fn div(id: impl Into<ElementId>, scroller: Stateful<Div>) -> Self {
        Self {
            id: id.into(),
            scroller: Scroller::Div(scroller, None),
        }
    }

    /// The handle the `div` is scrolled by, for whoever scrolls it too.
    /// Call this instead of `track_scroll` on the `div`.
    pub(crate) fn tracked(mut self, handle: Option<&ScrollHandle>) -> Self {
        if let Scroller::Div(_, kept) = &mut self.scroller {
            *kept = handle.cloned();
        }
        self
    }

    /// A `list` drawn from `state`, named `id`.
    pub(crate) fn list(id: impl Into<ElementId>, state: &ListState, list: List) -> Self {
        Self {
            id: id.into(),
            scroller: Scroller::List(list, state.clone()),
        }
    }

    /// A `uniform_list`, scrolled by `handle` if whoever draws it scrolls it
    /// too, else by one kept here. Do not `track_scroll` the list.
    pub(crate) fn uniform(
        id: impl Into<ElementId>,
        handle: Option<&UniformListScrollHandle>,
        list: UniformList,
    ) -> Self {
        Self {
            id: id.into(),
            scroller: Scroller::Uniform(list, handle.cloned()),
        }
    }
}

/// The scroller's place in the layout, taken off it for the wrapper.
fn place(style: &mut StyleRefinement) -> StyleRefinement {
    let mut place = StyleRefinement {
        size: mem::take(&mut style.size),
        min_size: mem::take(&mut style.min_size),
        max_size: mem::take(&mut style.max_size),
        margin: mem::take(&mut style.margin),
        flex_grow: style.flex_grow.take(),
        flex_shrink: style.flex_shrink.take(),
        flex_basis: style.flex_basis.take(),
        align_self: style.align_self.take(),
        ..StyleRefinement::default()
    };
    if style.position == Some(Position::Absolute) {
        place.position = style.position.take();
        place.inset = mem::take(&mut style.inset);
    }
    place
}

/// Fills the wrapper: grows into it, and shrinks to it when its content is
/// taller.
fn fill_wrapper<E: Styled>(scroller: E) -> E {
    scroller.flex_grow_1().flex_shrink_1().min_h_0().min_w_0()
}

impl RenderOnce for ScrollArea {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let Self { id, mut scroller } = self;
        let key = ElementId::NamedChild(std::sync::Arc::new(id), "scrollbar".into());
        let kept = window.use_keyed_state(key, cx, |_, _| Kept {
            held: Rc::default(),
            handle: ScrollHandle::new(),
            uniform: UniformListScrollHandle::new(),
        });
        let (held, own, own_uniform) = {
            let kept = kept.read(cx);
            (kept.held.clone(), kept.handle.clone(), kept.uniform.clone())
        };
        let mut wrapper = div();
        *wrapper.style() = place(scroller.style());
        if wrapper.style().position.is_none() {
            wrapper = wrapper.relative();
        }
        let (scrolled, scrolls): (AnyElement, Scrolls) = match scroller {
            Scroller::Div(element, handle) => {
                let handle = handle.unwrap_or(own);
                (
                    fill_wrapper(element.track_scroll(&handle)).into_any_element(),
                    Scrolls::Div(handle),
                )
            }
            Scroller::List(element, state) => (
                fill_wrapper(element).into_any_element(),
                Scrolls::List(state),
            ),
            Scroller::Uniform(element, handle) => {
                let handle = handle.unwrap_or(own_uniform);
                (
                    fill_wrapper(element.track_scroll(&handle)).into_any_element(),
                    Scrolls::Uniform(handle),
                )
            }
        };
        wrapper
            .flex()
            .flex_col()
            .child(scrolled)
            .child(bar(scrolls, held))
    }
}

/// The thumb in a lane of `lane` bounds, over content scrolled `down` of
/// at most `most`.
fn thumb(lane: Bounds<Pixels>, down: Pixels, most: Pixels) -> Option<Bounds<Pixels>> {
    let viewport = lane.size.height;
    if most <= px(0.5) || viewport <= px(0.0) {
        return None;
    }
    let content = viewport + most;
    let length = (viewport * (viewport / content))
        .max(px(SHORTEST))
        .min(viewport);
    let top = lane.top() + (viewport - length) * (down / most).clamp(0.0, 1.0);
    Some(Bounds {
        origin: point(lane.left(), top),
        size: size(lane.size.width, length),
    })
}

fn tone(held: Held, card2: Hsla, line2: Hsla) -> Hsla {
    if held.grab.is_some() || held.hovered {
        line2
    } else {
        card2
    }
}

/// A bar as it was drawn this frame, for its listeners.
#[derive(Clone)]
struct Drawn {
    scrolls: Scrolls,
    held: Rc<Cell<Held>>,
    lane: Bounds<Pixels>,
    thumb: Bounds<Pixels>,
    most: Pixels,
    view: EntityId,
}

impl Drawn {
    /// A wheel over the scroller moves the thumb: draw it again if the
    /// scroll moved it since.
    fn wheel(&self, phase: DispatchPhase, cx: &mut App) {
        if phase.bubble() && self.scrolls.down() != self.held.get().seen {
            cx.notify(self.view);
        }
    }

    /// Grabs the thumb, or pages towards a click beside it.
    fn press(&self, event: &MouseDownEvent, phase: DispatchPhase, cx: &mut App) {
        if !phase.bubble()
            || event.button != MouseButton::Left
            || !self.lane.contains(&event.position)
        {
            return;
        }
        cx.stop_propagation();
        let y = event.position.y;
        if self.thumb.contains(&event.position) {
            self.scrolls.grabbed(true);
            let mut now = self.held.get();
            now.grab = Some(y - self.thumb.top());
            self.held.set(now);
        } else {
            let page = self.lane.size.height;
            let down = self.scrolls.down();
            let to = if y < self.thumb.top() {
                down - page
            } else {
                down + page
            };
            self.scrolls.scroll_to(to.clamp(px(0.0), self.most));
        }
        cx.notify(self.view);
    }

    /// Lights the thumb under the pointer, and drags a grabbed one.
    fn hover(&self, event: &MouseMoveEvent, cx: &mut App) {
        let mut now = self.held.get();
        let hovered = self.thumb.contains(&event.position);
        let mut notify = hovered != now.hovered;
        now.hovered = hovered;
        match now.grab {
            Some(grab) if event.dragging() => {
                cx.stop_propagation();
                notify |= self.drag(event.position.y - grab);
            }
            Some(_) => {
                // Let go outside the window.
                now.grab = None;
                self.scrolls.grabbed(false);
                notify = true;
            }
            None => {}
        }
        self.held.set(now);
        if notify {
            cx.notify(self.view);
        }
    }

    /// Scrolls so the thumb's top is at `top`; whether that moved it.
    fn drag(&self, top: Pixels) -> bool {
        let travel = self.lane.size.height - self.thumb.size.height;
        if travel <= px(0.0) {
            return false;
        }
        let to = self.most * ((top - self.lane.top()) / travel).clamp(0.0, 1.0);
        if to == self.scrolls.down() {
            return false;
        }
        self.scrolls.scroll_to(to);
        true
    }

    fn release(&self, cx: &mut App) {
        let mut now = self.held.get();
        if now.grab.take().is_some() {
            self.held.set(now);
            self.scrolls.grabbed(false);
            cx.notify(self.view);
        }
    }
}

/// The bar over the bounds it is given.
fn bar(scrolls: Scrolls, held: Rc<Cell<Held>>) -> impl IntoElement {
    canvas(
        {
            let scrolls = scrolls.clone();
            let held = held.clone();
            move |bounds, _, _| {
                let down = scrolls.down();
                let mut now = held.get();
                now.seen = down;
                held.set(now);
                let lane = Bounds {
                    origin: point(bounds.right() - px(LANE), bounds.top()),
                    size: size(px(LANE), bounds.size.height),
                };
                let most = scrolls.most();
                (lane, thumb(lane, down, most), most)
            }
        },
        move |_, (lane, thumb_bounds, most), window, cx| {
            let Some(thumb_bounds) = thumb_bounds else {
                return;
            };
            let theme = ActiveTheme::get(cx);
            let shown = thumb_bounds.dilate(px(-INSET));
            let radius = theme.skin.radius_md.min(shown.size.width / 2.0);
            window.paint_quad(
                fill(shown, tone(held.get(), theme.c.card2, theme.c.line2)).corner_radii(radius),
            );
            let drawn = Drawn {
                scrolls,
                held,
                lane,
                thumb: thumb_bounds,
                most,
                view: window.current_view(),
            };
            let on = drawn.clone();
            window.on_mouse_event(move |_: &ScrollEvent, phase, _, cx| on.wheel(phase, cx));
            let on = drawn.clone();
            window.on_mouse_event(move |event: &MouseDownEvent, phase, _, cx| {
                on.press(event, phase, cx);
            });
            let on = drawn.clone();
            window.on_mouse_event(move |event: &MouseMoveEvent, _, _, cx| on.hover(event, cx));
            window.on_mouse_event(move |_: &MouseUpEvent, _, _, cx| drawn.release(cx));
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use gpui::{Context, Modifiers, Render, TestAppContext, VisualTestContext};

    use super::*;
    use crate::theme::{ActiveTheme, Catalog, DEFAULT_THEME, Mode};

    /// A 200 px high scroller over 2000 px of content, at the window's
    /// top left: its lane is x 291 to 300, its thumb the shortest one.
    struct Tall {
        handle: ScrollHandle,
    }

    impl Render for Tall {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().child(
                ScrollArea::div(
                    "tall",
                    div()
                        .id("tall")
                        .w(px(300.0))
                        .h(px(200.0))
                        .overflow_y_scroll()
                        .child(div().h(px(2000.0))),
                )
                .tracked(Some(&self.handle)),
            )
        }
    }

    fn tall(cx: &mut TestAppContext) -> (ScrollHandle, &mut VisualTestContext) {
        cx.update(|cx| {
            let theme = Catalog::get()
                .resolve(DEFAULT_THEME, Mode::Dark, &[])
                .expect("the default theme");
            cx.set_global(ActiveTheme(Arc::new(theme)));
        });
        let handle = ScrollHandle::new();
        let kept = handle.clone();
        let (_, cx) = cx.add_window_view(|_, _| Tall { handle: kept });
        cx.run_until_parked();
        (handle, cx)
    }

    fn down(handle: &ScrollHandle) -> f32 {
        -f32::from(handle.offset().y)
    }

    #[test]
    fn the_thumb_stands_for_the_viewport_and_where_it_is() {
        let lane = Bounds {
            origin: point(px(0.0), px(0.0)),
            size: size(px(LANE), px(200.0)),
        };
        assert_eq!(thumb(lane, px(0.0), px(0.0)), None, "all of it fits");
        let half = thumb(lane, px(200.0), px(200.0)).expect("a thumb");
        assert_eq!((half.top(), half.size.height), (px(100.0), px(100.0)));
        let long = thumb(lane, px(0.0), px(100_000.0)).expect("a thumb");
        assert_eq!(long.size.height, px(SHORTEST));
    }

    #[gpui::test]
    fn dragging_the_thumb_scrolls(cx: &mut TestAppContext) {
        let (handle, cx) = tall(cx);
        assert_eq!(down(&handle), 0.0);
        let left = Modifiers::none();
        cx.simulate_mouse_down(point(px(295.0), px(10.0)), MouseButton::Left, left);
        cx.simulate_mouse_move(point(px(295.0), px(98.0)), Some(MouseButton::Left), left);
        cx.simulate_mouse_up(point(px(295.0), px(98.0)), MouseButton::Left, left);
        cx.run_until_parked();
        // 88 px of the 176 the thumb travels: half of the 1800 px.
        assert!((down(&handle) - 900.0).abs() < 1.0, "{}", down(&handle));
        // Dragged past the end, it stops there.
        cx.simulate_mouse_down(point(px(295.0), px(110.0)), MouseButton::Left, left);
        cx.simulate_mouse_move(point(px(295.0), px(900.0)), Some(MouseButton::Left), left);
        cx.simulate_mouse_up(point(px(295.0), px(900.0)), MouseButton::Left, left);
        cx.run_until_parked();
        assert_eq!(down(&handle), 1800.0);
    }

    #[gpui::test]
    fn a_click_beside_the_thumb_pages(cx: &mut TestAppContext) {
        let (handle, cx) = tall(cx);
        let left = Modifiers::none();
        cx.simulate_click(point(px(295.0), px(150.0)), left);
        cx.run_until_parked();
        assert_eq!(down(&handle), 200.0);
        // Beside the scroller, not on its lane: nothing.
        cx.simulate_click(point(px(250.0), px(150.0)), left);
        cx.run_until_parked();
        assert_eq!(down(&handle), 200.0);
    }
}
