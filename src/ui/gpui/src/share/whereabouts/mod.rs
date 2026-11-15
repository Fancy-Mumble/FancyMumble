//! Where a shared source lies on the screens: what the overlay of viewers'
//! drawings is laid over, and follows. A screen lies where its monitor is;
//! a window where its inside is, until it is minimized (then the overlay
//! shows nothing) or closed (then the overlay closes), as the web client's
//! overlay follows it.
//!
//! The test pattern lies nowhere on the user's screens: in a run that shares
//! it, the overlay lies only where `FANCY_GPUI_SHARE_PATTERN_AT=x,y,w,h`
//! puts it (on the screen's own pixels), and without that it is not opened.

#[cfg(windows)]
mod win32;

use std::sync::{Mutex, PoisonError};

use super::{Source, SourceKind};

/// An area of the screens, in the screens' own pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Area {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Area {
    /// The area `x,y,w,h` names, if it is one.
    fn named(named: &str) -> Option<Self> {
        let numbers: Vec<i32> = named
            .split(',')
            .map(|each| each.trim().parse().ok())
            .collect::<Option<_>>()?;
        let [x, y, width, height] = numbers[..] else {
            return None;
        };
        (width > 0 && height > 0).then_some(Self { x, y, width, height })
    }
}

/// Where a source lies now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Lies {
    At(Area),
    #[cfg_attr(target_os = "android", expect(dead_code, reason = "what uses it is not built on Android, where share/real_absent.rs stands in"))]
    /// Out of sight for now: a minimized window.
    Hidden,
    /// No more: a closed window, an unplugged monitor, or nowhere to lie.
    Gone,
}

/// Finds where sources lie.
pub(crate) trait Whereabouts: Send + Sync {
    fn of(&self, source: &Source) -> Lies;
}

/// The screens and windows of this computer.
#[derive(Debug, Default)]
pub(crate) struct System;

#[cfg(windows)]
impl Whereabouts for System {
    fn of(&self, source: &Source) -> Lies {
        match source.kind {
            SourceKind::Screen => win32::screen(source.id),
            SourceKind::Window => win32::window(source.id),
            SourceKind::Device => Lies::Gone,
        }
    }
}

// todo(linux, mac): where a window lies; until then there is no overlay.
#[cfg(not(windows))]
impl Whereabouts for System {
    fn of(&self, _source: &Source) -> Lies {
        Lies::Gone
    }
}

/// Where the overlay of a share of the test pattern lies: the one area the
/// run names, or nowhere. Set from outside in a test.
#[derive(Debug)]
pub(crate) struct StandIn(Mutex<Lies>);

impl StandIn {
    /// The area `FANCY_GPUI_SHARE_PATTERN_AT` names, or nowhere.
    pub(crate) fn from_env() -> Self {
        let named = std::env::var("FANCY_GPUI_SHARE_PATTERN_AT").ok();
        Self::at(named.as_deref().and_then(Area::named))
    }

    pub(crate) fn at(area: Option<Area>) -> Self {
        Self(Mutex::new(area.map_or(Lies::Gone, Lies::At)))
    }

    /// Have the stand-in lie `lies` from now.
    #[cfg(test)]
    pub(crate) fn set(&self, lies: Lies) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = lies;
    }
}

impl Whereabouts for StandIn {
    fn of(&self, source: &Source) -> Lies {
        if source.kind == SourceKind::Device {
            return Lies::Gone;
        }
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(kind: SourceKind) -> Source {
        Source {
            kind,
            id: 1,
            title: "Test pattern".into(),
            width: 1920,
            height: 1080,
        }
    }

    #[test]
    fn a_stand_in_is_named_x_y_width_height_and_nothing_else() {
        let area = Area {
            x: -20,
            y: 40,
            width: 640,
            height: 360,
        };
        assert_eq!(Area::named("-20,40,640,360"), Some(area));
        assert_eq!(Area::named(" -20, 40 ,640,360 "), Some(area));
        for wrong in ["", "1,2,3", "1,2,3,4,5", "a,b,c,d", "0,0,0,10", "0,0,10,-1"] {
            assert_eq!(Area::named(wrong), None, "{wrong:?}");
        }
    }

    #[test]
    fn the_pattern_lies_only_where_the_stand_in_is_and_a_camera_nowhere() {
        let area = Area {
            x: 0,
            y: 0,
            width: 320,
            height: 180,
        };
        let stand_in = StandIn::at(Some(area));
        assert_eq!(stand_in.of(&source(SourceKind::Screen)), Lies::At(area));
        assert_eq!(stand_in.of(&source(SourceKind::Window)), Lies::At(area));
        assert_eq!(stand_in.of(&source(SourceKind::Device)), Lies::Gone);
        assert_eq!(StandIn::at(None).of(&source(SourceKind::Screen)), Lies::Gone);
        stand_in.set(Lies::Hidden);
        assert_eq!(stand_in.of(&source(SourceKind::Window)), Lies::Hidden);
    }
}
