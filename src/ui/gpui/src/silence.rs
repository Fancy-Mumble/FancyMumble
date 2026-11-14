//! Whether this run makes any sound.
//!
//! `FANCY_GPUI_SILENT` (any value) keeps a run silent: no voice message is
//! played or recorded from the microphone, no sound says what happened,
//! and nothing a watched share's computer plays is heard. The older
//! `FANCY_GPUI_VOICE_MESSAGES=silent` and the share pattern's
//! `FANCY_GPUI_SHARE_PATTERN` say the same. A test is always silent.

/// Whether this run is to make no sound at all.
pub(crate) fn everything() -> bool {
    cfg!(test)
        || std::env::var_os("FANCY_GPUI_SILENT").is_some()
        || std::env::var("FANCY_GPUI_VOICE_MESSAGES").as_deref() == Ok("silent")
        || std::env::var_os("FANCY_GPUI_SHARE_PATTERN").is_some()
}
