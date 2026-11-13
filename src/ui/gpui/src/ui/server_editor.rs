//! The dialog that adds a saved identity, or changes one.

use gpui::{
    Context, Entity, IntoElement, ParentElement, SharedString, Styled, Subscription, Window, div,
    prelude::*, px,
};

use super::Shell;
use super::text_input::{InputEvent, TextInput};
use super::widgets::{EMPHASIS, icon, label, opaque};
use crate::engine::SavedServer;
use crate::theme::Theme;

/// The port a Mumble server listens on unless it says otherwise.
const DEFAULT_PORT: u16 = 64738;

/// The dialog's state while it is open.
pub(super) struct ServerEditor {
    /// The identity being changed; `None` when adding one.
    editing: Option<SavedServer>,
    /// Label, host, port, username: in tab order.
    fields: [Entity<TextInput>; 4],
    /// Whether the identity presents a certificate.
    certificate: bool,
    favorite: bool,
    /// What is wrong with what was entered, once Save was pressed.
    error: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

/// What the dialog's four fields hold.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct Entered {
    pub label: String,
    pub host: String,
    pub port: String,
    pub username: String,
}

/// The saved identity `entered` describes, or what is wrong with it.
///
/// `existing` is the identity being changed, whose id and certificate are
/// kept; `new_id` names a new one.
pub(super) fn identity_from(
    entered: &Entered,
    certificate: bool,
    favorite: bool,
    existing: Option<&SavedServer>,
    new_id: impl FnOnce() -> String,
) -> Result<SavedServer, &'static str> {
    let host = entered.host.trim();
    let username = entered.username.trim();
    if host.is_empty() {
        return Err("Enter the server's address.");
    }
    if host.contains(char::is_whitespace) || host.contains('/') {
        return Err("The address is a host name, without spaces or a path.");
    }
    if username.is_empty() {
        return Err("Enter the name to join as.");
    }
    let port = match entered.port.trim() {
        "" => DEFAULT_PORT,
        port => port
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0)
            .ok_or("The port is a number from 1 to 65535.")?,
    };
    let label = match entered.label.trim() {
        "" => host,
        label => label,
    };
    let certificate = certificate.then(|| {
        existing
            .and_then(|existing| existing.certificate.clone())
            .unwrap_or_else(|| certificate_label(username).into())
    });
    Ok(SavedServer {
        id: existing.map_or_else(|| new_id().into(), |existing| existing.id.clone()),
        label: label.to_owned().into(),
        host: host.to_owned().into(),
        port,
        username: username.to_owned().into(),
        certificate,
        favorite,
    })
}

/// A certificate label for `username`: what the engine accepts as one
/// (letters, digits, `.`, `_`, `-`; at most 64), and never empty.
pub(super) fn certificate_label(username: &str) -> String {
    let label: String = username
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .take(64)
        .collect();
    let label = label.trim_matches(|c| matches!(c, '-' | '.')).to_owned();
    if label.is_empty() {
        "identity".to_owned()
    } else {
        label
    }
}

/// An id for a new saved identity: unique within this run and, with the
/// clock in it, across runs.
fn new_id() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos());
    let count = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{nanos:x}-{count:x}")
}

impl Shell {
    /// Open the dialog: on `existing` to change it, or empty - with
    /// `address` filled in when the identity is for a server already saved.
    pub(super) fn open_editor(
        &mut self,
        existing: Option<SavedServer>,
        address: Option<&(SharedString, u16)>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let field = |placeholder: &'static str, text: String, cx: &mut Context<Self>| {
            cx.new(|cx| {
                let mut input = TextInput::new(placeholder, cx);
                input.set_text(text);
                input
            })
        };
        let (host, port) = match (&existing, &address) {
            (Some(existing), _) => (existing.host.to_string(), existing.port.to_string()),
            (None, Some((host, port))) => (host.to_string(), port.to_string()),
            (None, None) => (String::new(), String::new()),
        };
        let fields = [
            field(
                "Shown in the list; the address if empty",
                existing
                    .as_ref()
                    .filter(|existing| existing.label != existing.host)
                    .map(|existing| existing.label.to_string())
                    .unwrap_or_default(),
                cx,
            ),
            field("mumble.example.org", host, cx),
            field("64738", port, cx),
            field(
                "Your name on this server",
                existing
                    .as_ref()
                    .map(|existing| existing.username.to_string())
                    .unwrap_or_default(),
                cx,
            ),
        ];
        let subscriptions = fields
            .iter()
            .enumerate()
            .map(|(at, input)| {
                cx.subscribe_in(input, window, move |shell, _, event, window, cx| {
                    shell.on_editor_input(at, event, window, cx);
                })
            })
            .collect();
        // Start where there is something to type: the address, or the name
        // when the address is already known.
        let first = if existing.is_none() && address.is_some() {
            3
        } else {
            1
        };
        fields[first].read(cx).focus(window);
        self.editor = Some(ServerEditor {
            certificate: existing
                .as_ref()
                .is_none_or(|existing| existing.certificate.is_some()),
            favorite: existing.as_ref().is_some_and(|existing| existing.favorite),
            editing: existing,
            fields,
            error: None,
            _subscriptions: subscriptions,
        });
        cx.notify();
    }

    fn on_editor_input(
        &mut self,
        at: usize,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            InputEvent::Submitted(_) => self.save_editor(cx),
            InputEvent::Cancelled => self.close_editor(cx),
            InputEvent::Tabbed { back } => {
                let Some(editor) = &self.editor else { return };
                let count = editor.fields.len();
                let next = if *back { at + count - 1 } else { at + 1 } % count;
                editor.fields[next].read(cx).focus(window);
                cx.notify();
            }
            InputEvent::Changed => {}
        }
    }

    pub(super) fn close_editor(&mut self, cx: &mut Context<Self>) {
        self.editor = None;
        cx.notify();
    }

    /// Save what was entered, or say what is wrong with it.
    pub(super) fn save_editor(&mut self, cx: &mut Context<Self>) {
        let Some(editor) = &mut self.editor else {
            return;
        };
        let text = |at: usize| editor.fields[at].read(cx).text().to_owned();
        let entered = Entered {
            label: text(0),
            host: text(1),
            port: text(2),
            username: text(3),
        };
        match identity_from(
            &entered,
            editor.certificate,
            editor.favorite,
            editor.editing.as_ref(),
            new_id,
        ) {
            Ok(server) => {
                self.selected_server = Some(format!("{}:{}", server.host, server.port));
                self.selected_identity = Some(server.id.clone());
                self.engine.save_server(server);
                self.editor = None;
            }
            Err(problem) => editor.error = Some(problem.into()),
        }
        cx.notify();
    }

    /// Forget the identity being edited.
    fn delete_edited(&mut self, cx: &mut Context<Self>) {
        if let Some(existing) = self.editor.take().and_then(|editor| editor.editing) {
            self.engine.remove_server(&existing.id);
            self.selected_identity = None;
        }
        cx.notify();
    }
}

/// The dialog, over a veil that keeps clicks off what is behind it.
pub(super) fn render(
    editor: &ServerEditor,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let mut veil = gpui::black();
    veil.a = 0.5;
    let title = if editor.editing.is_some() {
        "Edit identity"
    } else {
        "Add a server"
    };
    let names = ["Name", "Address", "Port", "Join as"];
    div()
        .id("server-editor")
        .absolute()
        .size_full()
        .top_0()
        .left_0()
        .occlude()
        .bg(veil)
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .w(px(440.0))
                .flex()
                .flex_col()
                .gap(px(12.0))
                .p(px(22.0))
                .rounded(theme.skin.radius_lg)
                .bg(opaque(theme.c.card, theme.c.bg0))
                .border_1()
                .border_color(theme.c.line2)
                .shadow_lg()
                .child(
                    div()
                        .text_size(px(17.0))
                        .font_weight(EMPHASIS)
                        .child(label(title, theme)),
                )
                .children(
                    names
                        .into_iter()
                        .zip(editor.fields.iter())
                        .map(|(name, input)| field_row(name, input, theme)),
                )
                .child(toggle_row(
                    "certificate",
                    "Use a certificate, so the server can recognise you",
                    editor.certificate,
                    theme,
                    cx,
                ))
                .child(toggle_row(
                    "favourite",
                    "Favourite",
                    editor.favorite,
                    theme,
                    cx,
                ))
                .when_some(editor.error.clone(), |dialog, problem| {
                    dialog.child(
                        div()
                            .text_size(px(12.5))
                            .text_color(theme.c.bad)
                            .child(problem),
                    )
                })
                .child(buttons(editor.editing.is_some(), theme, cx)),
        )
}

fn field_row(
    name: &'static str,
    input: &Entity<TextInput>,
    theme: &Theme,
) -> impl IntoElement + use<> {
    div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .child(
            div()
                .text_size(px(11.5))
                .text_color(theme.c.muted)
                .child(label(name, theme)),
        )
        .child(
            div()
                .h(px(38.0))
                .flex()
                .items_center()
                .px(px(12.0))
                .rounded(theme.skin.radius_md)
                .bg(theme.c.input)
                .border_1()
                .border_color(theme.c.line2)
                .child(input.clone()),
        )
}

/// A check box and what it means.
fn toggle_row(
    id: &'static str,
    meaning: &'static str,
    on: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div()
        .id(id)
        .debug_selector(move || format!("toggle-{id}"))
        .flex()
        .items_center()
        .gap(px(10.0))
        .cursor_pointer()
        .on_click(cx.listener(move |shell, _, _, cx| {
            if let Some(editor) = &mut shell.editor {
                match id {
                    "certificate" => editor.certificate = !editor.certificate,
                    _ => editor.favorite = !editor.favorite,
                }
            }
            cx.notify();
        }))
        .child(
            div()
                .flex_none()
                .size(px(18.0))
                .rounded(theme.skin.radius_sm.min(px(5.0)))
                .border_1()
                .flex()
                .items_center()
                .justify_center()
                .map(|check_box| {
                    if on {
                        check_box
                            .bg(theme.c.accent)
                            .border_color(theme.c.accent)
                            .child(icon("check", 12.0, theme.c.on_accent))
                    } else {
                        check_box.border_color(theme.c.line2)
                    }
                }),
        )
        .child(div().text_size(px(13.0)).child(meaning))
}

fn buttons(editing: bool, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    let button = |id: &'static str| {
        div()
            .id(id)
            .debug_selector(move || format!("editor-{id}"))
            .h(px(36.0))
            .px(px(18.0))
            .flex()
            .items_center()
            .rounded(theme.skin.radius_md)
            .cursor_pointer()
    };
    div()
        .mt(px(6.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .when(editing, |row| {
            row.child(
                button("delete")
                    .text_color(theme.c.bad)
                    .hover(move |style| style.bg(hover))
                    .on_click(cx.listener(|shell, _, _, cx| shell.delete_edited(cx)))
                    .child(label("Forget", theme)),
            )
        })
        .child(div().flex_1())
        .child(
            button("cancel")
                .text_color(theme.c.muted)
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(|shell, _, _, cx| shell.close_editor(cx)))
                .child(label("Cancel", theme)),
        )
        .child(
            button("save")
                .bg(theme.c.accent)
                .text_color(theme.c.on_accent)
                .font_weight(EMPHASIS)
                .on_click(cx.listener(|shell, _, _, cx| shell.save_editor(cx)))
                .child(label("Save", theme)),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entered(label: &str, host: &str, port: &str, username: &str) -> Entered {
        Entered {
            label: label.to_owned(),
            host: host.to_owned(),
            port: port.to_owned(),
            username: username.to_owned(),
        }
    }

    fn id() -> String {
        "new".to_owned()
    }

    #[test]
    fn a_new_identity_takes_the_defaults_for_what_is_left_empty() {
        let saved = identity_from(
            &entered("", " example.org ", "", " Alex "),
            true,
            false,
            None,
            id,
        )
        .expect("valid");
        assert_eq!(saved.id.as_ref(), "new");
        assert_eq!(saved.label.as_ref(), "example.org", "the address names it");
        assert_eq!(saved.host.as_ref(), "example.org");
        assert_eq!(saved.port, 64738);
        assert_eq!(saved.username.as_ref(), "Alex");
        assert_eq!(saved.certificate.as_ref().map(AsRef::as_ref), Some("alex"));
    }

    #[test]
    fn what_cannot_be_connected_to_is_refused_with_a_reason() {
        let refused = |entered: Entered| identity_from(&entered, false, false, None, id).is_err();
        assert!(refused(entered("", "", "", "Alex")), "no address");
        assert!(refused(entered("", "example.org", "", "  ")), "no name");
        assert!(
            refused(entered("", "example.org", "0", "Alex")),
            "port zero"
        );
        assert!(
            refused(entered("", "example.org", "70000", "Alex")),
            "port too big"
        );
        assert!(
            refused(entered("", "example.org", "abc", "Alex")),
            "port not a number"
        );
        assert!(
            refused(entered("", "exa mple.org", "", "Alex")),
            "space in address"
        );
        assert!(
            refused(entered("", "http://example.org", "", "Alex")),
            "a URL"
        );
    }

    #[test]
    fn editing_keeps_the_id_and_the_certificate_it_had() {
        let existing = identity_from(
            &entered("Home", "example.org", "1234", "Alex"),
            true,
            true,
            None,
            id,
        )
        .expect("valid");
        let changed = identity_from(
            &entered("Home", "example.org", "1234", "Somebody Else"),
            true,
            false,
            Some(&existing),
            || unreachable!("an edit does not mint an id"),
        )
        .expect("valid");
        assert_eq!(changed.id, existing.id);
        assert_eq!(
            changed.certificate.as_ref().map(AsRef::as_ref),
            Some("alex"),
            "renaming does not swap the identity for a new one"
        );
        assert_eq!(changed.port, 1234);
        assert!(!changed.favorite);
        let without = identity_from(
            &entered("Home", "example.org", "1234", "Alex"),
            false,
            false,
            Some(&existing),
            id,
        )
        .expect("valid");
        assert_eq!(without.certificate, None);
    }

    #[test]
    fn a_certificate_label_is_one_the_engine_accepts() {
        assert_eq!(certificate_label("Alex"), "alex");
        assert_eq!(certificate_label("Alex (work)"), "alex--work");
        assert_eq!(certificate_label("ÄÖ"), "identity");
        assert_eq!(certificate_label("a.b_c-d"), "a.b_c-d");
        assert_eq!(certificate_label(&"x".repeat(100)).len(), 64);
        assert_eq!(certificate_label(".."), "identity");
    }

    #[test]
    fn new_ids_do_not_repeat() {
        assert_ne!(new_id(), new_id());
    }
}
