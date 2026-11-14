//! What floats over the window (menus, dialogs, cards, toasts), drawn above
//! anything the system composes into the window: a video playing in place
//! is a surface of the window's composition, between what the window draws
//! under it and the composition's overlay. While there is such a surface,
//! what floats is drawn on the overlay; while there is none, there is no
//! overlay and it is drawn as everything else is. Either way it is laid
//! out where it would be, as the child of whatever it is put in.

use gpui::{
    AnyElement, App, Bounds, CompositionSurfaceId, Element, ElementId, GlobalElementId,
    InspectorElementId, IntoElement, LayoutId, ParentElement, Pixels, Window,
};

/// What floats over the window, gathered as a window's root gathers its
/// children, to be drawn on `surface`.
#[derive(Default)]
pub(crate) struct Floating {
    children: Vec<AnyElement>,
}

impl ParentElement for Floating {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl gpui::prelude::FluentBuilder for Floating {}

impl Floating {
    /// Each of them, drawn on `surface` while there is one.
    pub(crate) fn on(self, surface: Option<CompositionSurfaceId>) -> impl Iterator<Item = AnyElement> {
        self.children.into_iter().map(move |child| {
            OnSurface {
                child,
                surface,
            }
            .into_any_element()
        })
    }
}

/// One element drawn on a surface of the window's composition, laid out as
/// its child is.
struct OnSurface {
    child: AnyElement,
    surface: Option<CompositionSurfaceId>,
}

impl OnSurface {
    /// Do `step` to the child on the surface; where the surface cannot be
    /// drawn on (there is none, or the window does not compose), as the
    /// window draws everything else.
    fn on_surface(&mut self, window: &mut Window, cx: &mut App, step: fn(&mut AnyElement, &mut Window, &mut App)) {
        #[cfg(test)]
        tests::note(self.surface);
        let child = &mut self.child;
        if let Some(surface) = self.surface
            && window
                .with_composition_surface(surface, |window| step(child, window, cx))
                .is_ok()
        {
            return;
        }
        step(child, window, cx);
    }
}

impl IntoElement for OnSurface {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for OnSurface {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        (self.child.request_layout(window, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        (): &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.on_surface(window, cx, |child, window, cx| {
            let _ = child.prepaint(window, cx);
        });
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        (): &mut Self::RequestLayoutState,
        (): &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.on_surface(window, cx, |child, window, cx| child.paint(window, cx));
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::cell::RefCell;

    use gpui::CompositionSurfaceId;

    thread_local! {
        /// The surfaces floating elements were last asked to be drawn on.
        static ASKED: RefCell<Vec<Option<CompositionSurfaceId>>> = const { RefCell::new(Vec::new()) };
    }

    pub(super) fn note(surface: Option<CompositionSurfaceId>) {
        ASKED.with(|asked| asked.borrow_mut().push(surface));
    }

    /// The surfaces asked for since the last call.
    pub(crate) fn asked() -> Vec<Option<CompositionSurfaceId>> {
        ASKED.with(|asked| std::mem::take(&mut *asked.borrow_mut()))
    }
}
