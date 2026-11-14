//! The role editor's Permissions tab: one switch for each of the server's
//! permissions, on the one rule of the root that names the role, and the
//! rules a parent gave it, shown: the web UI's `RolePermissions`.

use gpui::{AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{Card, GroupTitle, SwitchRow};
use super::roles_page::RolesPage;
use crate::engine::AclGroup;
use crate::theme::Theme;
use crate::words::t;

/// The server's permissions in the web UI's order: Mumble's bit, and the
/// id each switch is named by for the tests.
const PERMISSIONS: [(u32, &str); 26] = [
    (0x1, "grant-write"),
    (0x2, "grant-traverse"),
    (0x4, "grant-enter"),
    (0x8, "grant-speak"),
    (0x10, "grant-mute-deafen"),
    (0x20, "grant-move"),
    (0x40, "grant-make-channel"),
    (0x80, "grant-link-channel"),
    (0x100, "grant-whisper"),
    (0x200, "grant-text-message"),
    (0x400, "grant-make-temp-channel"),
    (0x800, "grant-listen"),
    (0x1000, "grant-delete-message"),
    (0x2000, "grant-subscribe-push"),
    (0x4000, "grant-share-files"),
    (0x8000, "grant-share-files-public"),
    (0x1_0000, "grant-kick"),
    (0x2_0000, "grant-ban"),
    (0x4_0000, "grant-register"),
    (0x8_0000, "grant-self-register"),
    (0x10_0000, "grant-reset-user-content"),
    (0x20_0000, "grant-key-owner"),
    (0x40_0000, "grant-manage-emotes"),
    (0x80_0000, "grant-read-register"),
    (0x100_0000, "grant-see-channel"),
    (0x200_0000, "grant-send-voice-message"),
];

/// What a permission is called, and what it lets somebody do, as the web
/// UI says them.
fn words(bit: u32) -> (SharedString, SharedString) {
    match bit {
        0x1 => (t!("Write ACL"), t!("Edit the channel ACL and groups.")),
        0x2 => (t!("Traverse"), t!("See the channel and walk into its sub-channels.")),
        0x4 => (t!("Enter"), t!("Join the channel.")),
        0x8 => (t!("Speak"), t!("Transmit voice in the channel.")),
        0x10 => (t!("Mute / Deafen others"), t!("Server-mute or server-deafen other users in this channel.")),
        0x20 => (t!("Move users"), t!("Move other users into or out of this channel.")),
        0x40 => (t!("Make sub-channel"), t!("Create permanent sub-channels.")),
        0x80 => (t!("Link channels"), t!("Link this channel to other channels for cross-talk.")),
        0x100 => (t!("Whisper"), t!("Send targeted whispers into this channel.")),
        0x200 => (t!("Send text messages"), t!("Post text messages in the channel chat.")),
        0x400 => (t!("Make temporary sub-channel"), t!("Create temporary sub-channels that vanish when empty.")),
        0x800 => (t!("Listen"), t!("Receive audio from this channel without joining it.")),
        0x1000 => (t!("Delete messages"), t!("Delete other users' messages in the channel.")),
        0x2000 => (t!("Subscribe to push"), t!("Receive push notifications from the channel.")),
        0x4000 => (t!("Share files"), t!("Share files in the channel.")),
        0x8000 => (t!("Share files (public)"), t!("Share files publicly in the channel.")),
        0x1_0000 => (t!("Kick"), t!("Kick users from the server.")),
        0x2_0000 => (t!("Ban"), t!("Ban users from the server.")),
        0x4_0000 => (t!("Register users"), t!("Register guest users into the server database.")),
        0x8_0000 => (t!("Self-register"), t!("Users can register themselves.")),
        0x10_0000 => (t!("Reset user content"), t!("Wipe avatars, comments and other content from a user.")),
        0x20_0000 => (t!("Key owner"), t!("Marks the user as a key owner for the persistent-chat key share workflow.")),
        0x40_0000 => (t!("Manage emotes"), t!("Manage custom server emotes.")),
        0x80_0000 => (t!("List registered users"), t!("View the server's list of registered users.")),
        0x100_0000 => (t!("See hidden channel"), t!("See this channel even when it's hidden from users without access.")),
        // The web UI has no words of its own for this one, and says it so.
        _ => (
            t!("Send Voice Message"),
            t!("Grants the {{label}} permission.", label = "Send Voice Message"),
        ),
    }
}

/// The tab.
pub(super) fn render(page: &RolesPage, role: &AclGroup, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let rule = page.rule();
    let granted = rule.map_or(0, |rule| rule.grant);
    let locked = role.from_parent;
    let inherited = page.inherited_rules();
    div()
        .max_w(px(640.0))
        .child(
            div()
                .mb(px(14.0))
                .text_size(px(11.5))
                .text_color(theme.c.muted)
                .child(t!(
                    "Permissions are stored as ACL rules on the channel. Toggling a permission creates or updates an \"apply here\" rule that targets the {{role}} role.",
                    role = role.name
                )),
        )
        .when(rule.is_none(), |tab| {
            tab.child(
                div()
                    .mb(px(12.0))
                    .text_size(px(11.5))
                    .text_color(theme.c.dim)
                    .child(t!("No explicit permissions set yet.")),
            )
        })
        .children(PERMISSIONS.map(|(bit, id)| {
            let (title, hint) = words(bit);
            let on = granted & bit != 0;
            let row = SwitchRow::new(id, title, on).hint(hint);
            if locked {
                row
            } else {
                row.on_click(cx.listener(move |shell, _, _, cx| shell.grant_role(bit, !on, cx)))
            }
        }))
        .when(!inherited.is_empty(), |tab| {
            tab.child(GroupTitle::new(t!("Inherited rules ({{count}})", count = inherited.len())))
                .child(Card::new().children(inherited.into_iter().map(|rule| {
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.c.muted)
                        .child(SharedString::from(format!(
                            "grant=0x{:x}, deny=0x{:x}",
                            rule.grant, rule.deny
                        )))
                })))
        })
        .into_any_element()
}
