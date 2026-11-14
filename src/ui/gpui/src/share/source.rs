//! What can be shared, and how well: the picker's sources and the web
//! client's stream settings (`streamSettings.ts`).

use gpui::SharedString;

/// What a source is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum SourceKind {
    /// A whole screen.
    Screen,
    /// One window.
    Window,
    /// A camera.
    Device,
}

/// One thing that can be shared.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Source {
    pub kind: SourceKind,
    /// What the system knows it by.
    pub id: u32,
    pub title: SharedString,
    pub width: u32,
    pub height: u32,
}

/// How large, and how many frames a second, a share is sent at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Quality {
    /// The longest side, in pixels; 0 sends it as large as it is.
    pub longest: u32,
    pub fps: u32,
}

impl Quality {
    /// 720p at 30 frames a second.
    pub(crate) const SD: Self = Self {
        longest: 1280,
        fps: 30,
    };
    /// 1080p at 60, what a share starts at.
    pub(crate) const HD: Self = Self {
        longest: 1920,
        fps: 60,
    };
    /// As large as it is, at 60.
    pub(crate) const SOURCE: Self = Self { longest: 0, fps: 60 };
    /// "Gaming": smoother, 720p at 30.
    pub(crate) const GAMING: Self = Self::SD;
    /// "Screenshare": clearer text, as large as it is at 5.
    pub(crate) const TEXT: Self = Self { longest: 0, fps: 5 };
    /// The sizes the custom setting offers, largest last but "as it is".
    pub(crate) const SIZES: [u32; 4] = [1280, 1920, 2560, 0];
    /// The rates it offers.
    pub(crate) const RATES: [u32; 3] = [15, 30, 60];

    /// The size in words: `720p`, `1080p`, `1440p` or `Source`.
    pub(crate) fn size_name(longest: u32) -> SharedString {
        match longest {
            1280 => "720p".into(),
            1920 => "1080p".into(),
            2560 => "1440p".into(),
            0 => crate::words::t!("Source"),
            other => format!("{other}px").into(),
        }
    }
}

/// What the picker settles: the quality, and whether what the computer
/// plays goes with the picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Settings {
    pub quality: Quality,
    pub audio: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            quality: Quality::HD,
            audio: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_presets_are_the_web_clients() {
        assert_eq!((Quality::SD.longest, Quality::SD.fps), (1280, 30));
        assert_eq!((Quality::HD.longest, Quality::HD.fps), (1920, 60));
        assert_eq!((Quality::SOURCE.longest, Quality::SOURCE.fps), (0, 60));
        assert_eq!(Quality::GAMING, Quality::SD);
        assert_eq!((Quality::TEXT.longest, Quality::TEXT.fps), (0, 5));
        assert_eq!(Settings::default().quality, Quality::HD);
        assert_eq!(Quality::size_name(1920), "1080p");
    }
}
