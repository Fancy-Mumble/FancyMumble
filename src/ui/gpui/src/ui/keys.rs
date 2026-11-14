//! The keys that work anywhere in the window, and what each does.
//!
//! The web UI's shortcuts, at the keys it gives them by default. They are
//! in one table so that a key is bound in one place and the place that says
//! which key does a thing (a tooltip, the README) reads it from here.

use gpui::{App, Context, KeyBinding, Window, WindowHandle, actions};

use super::Shell;
use super::kit::{Way, arrows_held, walk};
use crate::engine::ChannelId;
use crate::store::{Bindings, Bound};

actions!(
    fancy,
    [
        /// Move to the next theme of the catalogue.
        NextTheme,
        /// Flip between the light and dark drawing of the theme.
        ToggleMode,
        /// Give the keyboard to the search field.
        FocusSearch,
        /// Close the picker or the dialog that is open.
        Dismiss,
        /// Close the application.
        Quit,
        /// Mute or unmute the microphone; turns voice on when it is off.
        ToggleMute,
        /// Deafen or undeafen.
        ToggleDeafen,
        /// Open the settings page.
        OpenSettings,
        /// Take the whole screen, or give it back.
        ToggleFullscreen,
        /// Show or hide who is in the open channel.
        ToggleMembers,
        /// Show or hide the column of channels.
        ToggleColumn,
        /// Move into the channel above the one the user is in.
        ChannelUp,
        /// Move into the channel below the one the user is in.
        ChannelDown,
        /// Move into the server's first channel.
        ChannelRoot,
        /// Give the keyboard to the next control.
        FocusNext,
        /// Give the keyboard to the control before.
        FocusBack,
        /// Walk down the open menu.
        WalkDown,
        /// Walk up the open menu.
        WalkUp,
        /// Flip between push to talk and voice activity.
        ToggleActivationMode
    ]
);


/// Bind the keys, at their defaults. What they do is said by [`act_on`],
/// once there is a window for them to act on.
pub(crate) fn bind(cx: &mut App) {
    rebind(&Bindings::default(), cx);
    cx.on_action(|_: &Quit, cx| cx.quit());
}

/// Bind the keys again: those that cannot be chosen, and those the user
/// chose (the web UI's shortcut names, `chosen`).
pub(crate) fn rebind(chosen: &Bindings, cx: &mut App) {
    cx.clear_key_bindings();
    cx.bind_keys([
        KeyBinding::new("ctrl-shift-t", NextTheme, None),
        KeyBinding::new("ctrl-shift-l", ToggleMode, None),
        KeyBinding::new("escape", Dismiss, None),
        KeyBinding::new("ctrl-q", Quit, None),
        KeyBinding::new("tab", FocusNext, None),
        KeyBinding::new("shift-tab", FocusBack, None),
        KeyBinding::new("down", WalkDown, None),
        KeyBinding::new("up", WalkUp, None),
    ]);
    // While writing, Ctrl+B sets bold where it is the sidebar's: the field
    // takes it back.
    cx.bind_keys(
        chosen
            .chosen()
            .filter(|(_, keys)| gpui::Keystroke::parse(keys).is_ok())
            .filter_map(|(bound, keys)| binding(bound, &keys)),
    );
}

/// The binding of `keys` to what `bound` does; none for what is held, which
/// the shell hears itself.
fn binding(bound: Bound, keys: &str) -> Option<KeyBinding> {
    Some(match bound {
        Bound::ToggleMute => KeyBinding::new(keys, ToggleMute, None),
        Bound::ToggleDeafen => KeyBinding::new(keys, ToggleDeafen, None),
        Bound::ToggleActivationMode => KeyBinding::new(keys, ToggleActivationMode, None),
        Bound::MoveChannelUp => KeyBinding::new(keys, ChannelUp, None),
        Bound::MoveChannelDown => KeyBinding::new(keys, ChannelDown, None),
        Bound::JumpToRootChannel => KeyBinding::new(keys, ChannelRoot, None),
        Bound::ToggleChannelSidebar => KeyBinding::new(keys, ToggleColumn, None),
        Bound::ToggleMemberPanel => KeyBinding::new(keys, ToggleMembers, None),
        Bound::OpenQuickSearch => KeyBinding::new(keys, FocusSearch, None),
        Bound::OpenSettings => KeyBinding::new(keys, OpenSettings, None),
        Bound::ToggleFullscreen => KeyBinding::new(keys, ToggleFullscreen, None),
        Bound::VoicePriority => return None,
    })
}

/// Have the action `A` do `what` to the shell in `window`.
///
/// The application hears a key while the window that took it is still being
/// updated, and from there the window cannot be reached: a handler that
/// tried would take the key and do nothing. So `what` is put off until the
/// window is free, which is at once.
fn on<A: gpui::Action>(
    window: WindowHandle<Shell>,
    cx: &mut App,
    what: impl Fn(&mut Shell, &mut Window, &mut Context<Shell>) + Copy + 'static,
) {
    cx.on_action(move |_: &A, cx| {
        cx.defer(move |cx| {
            let _ = window.update(cx, |shell, window, cx| what(shell, window, cx));
        });
    });
}

/// Have the arrow `A` walk the open menu `way`. With no menu open the key
/// is not taken: it goes on to the field or list that has the keyboard.
fn walk_on<A: gpui::Action>(window: WindowHandle<Shell>, cx: &mut App, way: Way) {
    cx.on_action(move |_: &A, cx| {
        if !arrows_held(cx) {
            cx.propagate();
            return;
        }
        cx.defer(move |cx| {
            let _ = window.update(cx, |_, window, cx| walk(way, window, cx));
        });
    });
}

/// Have the keys act on the shell in `window`, wherever in it the keyboard
/// is, and when it is nowhere.
pub(crate) fn act_on(window: WindowHandle<Shell>, cx: &mut App) {
    on::<NextTheme>(window, cx, |shell, _, cx| shell.next_theme(cx));
    on::<ToggleMode>(window, cx, |shell, _, cx| shell.toggle_mode(cx));
    on::<FocusSearch>(window, cx, Shell::focus_search);
    on::<Dismiss>(window, cx, |shell, _, cx| shell.dismiss(cx));
    on::<ToggleMute>(window, cx, |shell, _, _| shell.engine.toggle_microphone());
    on::<ToggleDeafen>(window, cx, |shell, _, _| shell.engine.toggle_deafen());
    on::<OpenSettings>(window, cx, |shell, _, cx| shell.open_settings(cx));
    on::<ToggleFullscreen>(window, cx, |_, window, _| window.toggle_fullscreen());
    on::<ToggleMembers>(window, cx, |shell, _, cx| shell.toggle_members(cx));
    on::<ToggleColumn>(window, cx, |shell, _, cx| shell.toggle_column(cx));
    on::<ChannelUp>(window, cx, |shell, window, cx| {
        shell.step_channel(Step::Up, window, cx);
    });
    on::<ChannelDown>(window, cx, |shell, window, cx| {
        shell.step_channel(Step::Down, window, cx);
    });
    on::<ChannelRoot>(window, cx, |shell, window, cx| {
        shell.step_channel(Step::First, window, cx);
    });
    on::<FocusNext>(window, cx, |_, window, cx| walk(Way::Next, window, cx));
    on::<FocusBack>(window, cx, |_, window, cx| walk(Way::Back, window, cx));
    walk_on::<WalkDown>(window, cx, Way::Next);
    walk_on::<WalkUp>(window, cx, Way::Back);
    on::<ToggleActivationMode>(window, cx, |shell, _, cx| {
        shell.change_voice(|voice| voice.push_to_talk = !voice.push_to_talk, cx);
    });
}

/// Which way to move among the channels, as the column lists them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Step {
    Up,
    Down,
    First,
}

impl Step {
    /// The channel a step from `current` arrives in, among `listed` in the
    /// column's order. There is no step past either end, and from nowhere
    /// every step is to the first.
    fn from(self, current: Option<ChannelId>, listed: &[ChannelId]) -> Option<ChannelId> {
        let at = current.and_then(|current| listed.iter().position(|id| *id == current));
        let to = match (self, at) {
            (Self::First, _) | (_, None) => 0,
            (Self::Up, Some(at)) => at.checked_sub(1)?,
            (Self::Down, Some(at)) => at + 1,
        };
        listed.get(to).copied().filter(|to| Some(*to) != current)
    }
}

impl Shell {
    /// Move the user a channel up or down the column, or to its first, and
    /// put that channel's conversation on screen.
    pub(super) fn step_channel(&mut self, step: Step, window: &mut Window, cx: &mut Context<Self>) {
        let channels = &self.snapshot.channels;
        let listed: Vec<ChannelId> = super::sidebar::tree_order(channels)
            .into_iter()
            .map(|(at, _)| channels[at].id)
            .collect();
        let Some(to) = step.from(self.snapshot.current_channel, &listed) else {
            return;
        };
        let _ = self.enter(to, window, cx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_step_moves_one_channel_along_the_column_and_stops_at_its_ends() {
        let listed = [0, 4, 7, 2];
        assert_eq!(Step::Down.from(Some(4), &listed), Some(7));
        assert_eq!(Step::Up.from(Some(4), &listed), Some(0));
        assert_eq!(
            Step::Up.from(Some(0), &listed),
            None,
            "no step past the top"
        );
        assert_eq!(
            Step::Down.from(Some(2), &listed),
            None,
            "nor past the bottom"
        );
        assert_eq!(Step::First.from(Some(7), &listed), Some(0));
        assert_eq!(Step::First.from(Some(0), &listed), None, "already there");
        // In no channel, or one the column does not list: to the first.
        assert_eq!(Step::Down.from(None, &listed), Some(0));
        assert_eq!(Step::Up.from(Some(99), &listed), Some(0));
        assert_eq!(Step::Down.from(None, &[]), None);
    }
}
