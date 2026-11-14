//! What the player's browser is started with and what the embedded player
//! is asked for, each with the measurement that keeps it: one place, for
//! whatever shows the page (this view's child web view, or a composition
//! controller in a port). The method and the full tables are `PLAYER.md`.
//!
//! Figures are CPU in percent of one core over 30 s, the same video
//! (480p30 at card size), muted, summed over the web view's processes.

/// The browser arguments, each with why. Joined with spaces for the engine;
/// `FANCY_GPUI_PLAYER_ARGS` replaces all of them, for measuring.
pub(crate) const ARGUMENTS: &[(&str, &str)] = &[
    (
        "--enable-features=NetworkServiceInProcess2,MediaFoundationClearPlayback",
        "network in the main process (one process fewer); and the video played by the \
         system's Media Foundation pipeline straight onto a composition surface: the \
         graphics process falls from 10-16 % to under 1 %, the whole player from \
         about 20 % to about 9 % (PLAYER.md, part B)",
    ),
    (
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,AudioServiceOutOfProcess,IsolateOrigins,site-per-process",
        "no Edge extras, sound in the main process, one renderer for the page and the \
         player it frames",
    ),
    ("--disable-site-isolation-trials", "one renderer, with the line above"),
    ("--renderer-process-limit=1", "one renderer, with the lines above"),
    (
        "--disable-extensions --disable-background-networking --disable-component-update --no-pings",
        "nothing fetched that nobody asked for",
    ),
    (
        "--autoplay-policy=no-user-gesture-required",
        "play was pressed in the client, not in the page",
    ),
    (
        "--disable-smooth-scrolling",
        "each wheel notch over the player reaches the conversation at once",
    ),
];

/// The browser arguments, as the engine takes them.
pub(crate) fn arguments() -> String {
    std::env::var("FANCY_GPUI_PLAYER_ARGS").unwrap_or_else(|_| {
        ARGUMENTS
            .iter()
            .map(|(argument, _)| *argument)
            .collect::<Vec<_>>()
            .join(" ")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_argument_says_why_and_the_graphics_card_keeps_its_process() {
        assert!(ARGUMENTS.iter().all(|(_, why)| !why.is_empty()));
        let all = ARGUMENTS
            .iter()
            .map(|(argument, _)| *argument)
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            !all.contains("--in-process-gpu"),
            "in the main process the GPU no longer decodes video"
        );
        assert!(all.contains("MediaFoundationClearPlayback"));
    }
}
