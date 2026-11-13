//! What a server's administrator looks after: who is banned, and who is
//! registered.
//!
//! Either list can run to thousands of rows on a busy server, so only the
//! rows in view are built, and the lists are dropped when the panel closes.

use std::ops::Range;

use gpui::{
    AnyElement, Context, Entity, IntoElement, ParentElement, SharedString, Styled, Window, div,
    prelude::*, px, uniform_list,
};

use super::Shell;
use super::text_input::TextInput;
use super::widgets::{EMPHASIS, icon, opaque};
use crate::engine::{Action, Ban, Listing, Registered};
use crate::theme::Theme;

/// The height of one row of either list.
const ROW: f32 = 44.0;

/// The open panel.
pub(super) struct Admin {
    /// Which list is showing.
    pub listing: Listing,
    /// The lists as the server last sent them; `None` until it has.
    pub bans: Option<Vec<Ban>>,
    pub registered: Option<Vec<Registered>>,
    /// Narrows the list showing to the rows that contain it.
    filter: Entity<TextInput>,
    /// The rows of the list showing that pass the filter, by index.
    pub shown: Vec<usize>,
    /// The row a first click on its remove button has armed.
    doomed: Option<usize>,
}

impl Shell {
    /// Open the panel on `listing`, asking the server for it.
    pub(super) fn open_admin(&mut self, listing: Listing, cx: &mut Context<Self>) {
        let filter = cx.new(|cx| TextInput::new("Filter", cx));
        cx.subscribe(&filter, |shell, _, _, cx| {
            shell.refilter_admin(cx);
            cx.notify();
        })
        .detach();
        self.panels.admin = Some(Admin {
            listing,
            bans: None,
            registered: None,
            filter,
            shown: Vec::new(),
            doomed: None,
        });
        self.engine.list(listing);
        cx.notify();
    }

    /// Show the other list, asking for it if it has not come yet.
    fn show_listing(&mut self, listing: Listing, cx: &mut Context<Self>) {
        let Some(admin) = self.panels.admin.as_mut() else {
            return;
        };
        admin.listing = listing;
        admin.doomed = None;
        let missing = match listing {
            Listing::Bans => admin.bans.is_none(),
            Listing::Registered => admin.registered.is_none(),
        };
        if missing {
            self.engine.list(listing);
        }
        self.refilter_admin(cx);
        cx.notify();
    }

    /// Work out again which rows pass the filter.
    pub(super) fn refilter_admin(&mut self, cx: &mut Context<Self>) {
        let Some(admin) = self.panels.admin.as_mut() else {
            return;
        };
        let wanted = admin.filter.read(cx).text().to_lowercase();
        let passes = |texts: &[&str]| {
            wanted.is_empty()
                || texts
                    .iter()
                    .any(|text| text.to_lowercase().contains(&wanted))
        };
        admin.doomed = None;
        admin.shown = match admin.listing {
            Listing::Bans => admin
                .bans
                .iter()
                .flatten()
                .enumerate()
                .filter(|(_, ban)| passes(&[&ban.name, &ban.address, &ban.reason]))
                .map(|(at, _)| at)
                .collect(),
            Listing::Registered => admin
                .registered
                .iter()
                .flatten()
                .enumerate()
                .filter(|(_, user)| passes(&[&user.name]))
                .map(|(at, _)| at)
                .collect(),
        };
    }

    /// The remove button of row `at`: the first click arms it, the second
    /// lifts the ban or removes the registration.
    fn remove_admin_row(&mut self, at: usize, cx: &mut Context<Self>) {
        let Some(admin) = self.panels.admin.as_mut() else {
            return;
        };
        if admin.doomed != Some(at) {
            admin.doomed = Some(at);
            cx.notify();
            return;
        }
        admin.doomed = None;
        match admin.listing {
            Listing::Bans => {
                // The server takes the list whole: what is left is sent.
                if let Some(bans) = admin.bans.as_mut().filter(|bans| at < bans.len()) {
                    drop(bans.remove(at));
                    self.engine.act(Action::SetBans(bans.clone()));
                }
            }
            Listing::Registered => {
                if let Some(users) = admin.registered.as_mut().filter(|users| at < users.len()) {
                    let gone = users.remove(at);
                    self.engine.act(Action::Unregister { id: gone.id });
                }
            }
        }
        self.refilter_admin(cx);
        cx.notify();
    }

    fn admin_rows(
        &mut self,
        range: Range<usize>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let theme = crate::theme::ActiveTheme::get(cx);
        let Some(admin) = self.panels.admin.as_ref() else {
            return Vec::new();
        };
        range
            .filter_map(|row| {
                let at = *admin.shown.get(row)?;
                let (title, about): (SharedString, SharedString) = match admin.listing {
                    Listing::Bans => {
                        let ban = admin.bans.as_ref()?.get(at)?;
                        (ban_title(ban).into(), ban_about(ban).into())
                    }
                    Listing::Registered => {
                        let user = admin.registered.as_ref()?.get(at)?;
                        let channel = user.last_channel.and_then(|id| {
                            self.snapshot.channels.iter().find(|known| known.id == id)
                        });
                        (
                            user.name.clone(),
                            registered_about(user, channel.map(|channel| channel.name.as_ref()))
                                .into(),
                        )
                    }
                };
                let doomed = admin.doomed == Some(at);
                let hover = theme.c.hover;
                Some(
                    div()
                        .h(px(ROW))
                        .flex()
                        .items_center()
                        .gap(px(10.0))
                        .px(px(10.0))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .child(div().truncate().font_weight(EMPHASIS).child(title))
                                .child(
                                    div()
                                        .truncate()
                                        .text_size(px(11.5))
                                        .text_color(if doomed {
                                            theme.c.bad
                                        } else {
                                            theme.c.muted
                                        })
                                        .child(if doomed {
                                            "Click again to remove".into()
                                        } else {
                                            about
                                        }),
                                ),
                        )
                        .child(
                            div()
                                .id(("admin-remove", at))
                                .debug_selector(move || format!("admin-remove-{at}"))
                                .flex_none()
                                .size(px(28.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded(theme.skin.radius_md)
                                .cursor_pointer()
                                .hover(move |style| style.bg(hover))
                                .on_click(cx.listener(move |shell, _, _, cx| {
                                    shell.remove_admin_row(at, cx);
                                }))
                                .child(icon("trash-2", 14.0, theme.c.bad)),
                        )
                        .into_any_element(),
                )
            })
            .collect()
    }
}

/// Who or what a ban is on: the name, or the address when it has none.
fn ban_title(ban: &Ban) -> String {
    let address = if matches!(ban.mask, 32 | 128) {
        ban.address.to_string()
    } else {
        format!("{}/{}", ban.address, ban.mask)
    };
    if ban.name.is_empty() {
        address
    } else {
        format!("{} · {address}", ban.name)
    }
}

/// The rest of a ban: how long, since when, and why.
fn ban_about(ban: &Ban) -> String {
    let length = match ban.duration_secs {
        0 => "for good".to_owned(),
        secs if secs < 3600 => format!("for {} min", secs.div_ceil(60)),
        secs if secs < 86_400 => format!("for {} h", secs / 3600),
        secs => format!("for {} d", secs / 86_400),
    };
    let mut about = length;
    if !ban.start.is_empty() {
        about.push_str(" from ");
        about.push_str(&ban.start);
    }
    if !ban.reason.is_empty() {
        about.push_str(" · ");
        about.push_str(&ban.reason);
    }
    about
}

/// When and where a registered account was last on.
fn registered_about(user: &Registered, channel: Option<&str>) -> String {
    match (user.last_seen.as_ref().map(AsRef::<str>::as_ref), channel) {
        (Some(seen), Some(channel)) => format!("Last on {seen}, in {channel}"),
        (Some(seen), None) => format!("Last on {seen}"),
        (None, _) => "Never seen".to_owned(),
    }
}

/// The head of the panel: the two lists to choose between with how many
/// rows are showing, and the field that narrows them.
fn head(admin: &Admin, theme: &Theme, cx: &mut Context<Shell>) -> [gpui::Div; 2] {
    let hover = theme.c.hover;
    let tab = |listing: Listing, id: &'static str, name: &'static str| {
        let on = admin.listing == listing;
        div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .h(px(30.0))
            .px(px(12.0))
            .flex()
            .items_center()
            .rounded(theme.skin.radius_md)
            .cursor_pointer()
            .text_size(px(13.0))
            .when(on, |tab| tab.bg(theme.c.accent_soft).font_weight(EMPHASIS))
            .when(!on, |tab| tab.text_color(theme.c.muted))
            .hover(move |style| style.bg(hover))
            .on_click(cx.listener(move |shell, _, _, cx| shell.show_listing(listing, cx)))
            .child(name)
    };
    [
        div()
            .flex()
            .items_center()
            .gap(px(6.0))
            .child(tab(Listing::Bans, "admin-bans", "Bans"))
            .child(tab(
                Listing::Registered,
                "admin-registered",
                "Registered users",
            ))
            .child(div().flex_1())
            .child(
                div()
                    .text_size(px(12.0))
                    .text_color(theme.c.muted)
                    .child(SharedString::from(admin.shown.len().to_string())),
            ),
        div()
            .flex_none()
            .h(px(38.0))
            .flex()
            .items_center()
            .gap(px(10.0))
            .px(px(12.0))
            .rounded(theme.skin.radius_md)
            .bg(theme.c.input)
            .border_1()
            .border_color(theme.c.line2)
            .text_size(px(13.0))
            .child(icon("search", 13.0, theme.c.dim))
            .child(admin.filter.clone()),
    ]
}

/// The panel, over a veil.
pub(super) fn render(
    admin: &Admin,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let mut veil = gpui::black();
    veil.a = 0.5;
    let hover = theme.c.hover;
    let loaded = match admin.listing {
        Listing::Bans => admin.bans.is_some(),
        Listing::Registered => admin.registered.is_some(),
    };
    let body = if !loaded {
        div()
            .p(px(10.0))
            .text_color(theme.c.muted)
            .child("Asking the server…")
            .into_any_element()
    } else if admin.shown.is_empty() {
        div()
            .p(px(10.0))
            .text_color(theme.c.muted)
            .child("Nothing to show.")
            .into_any_element()
    } else {
        uniform_list(
            "admin-rows",
            admin.shown.len(),
            cx.processor(Shell::admin_rows),
        )
        .size_full()
        .into_any_element()
    };
    div()
        .id("admin")
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
                .w(px(560.0))
                .h(px(520.0))
                .flex()
                .flex_col()
                .gap(px(12.0))
                .p(px(22.0))
                .rounded(theme.skin.radius_lg)
                .bg(opaque(theme.c.card, theme.c.bg0))
                .border_1()
                .border_color(theme.c.line2)
                .shadow_lg()
                .children(head(admin, theme, cx))
                .child(
                    div()
                        .flex_1()
                        .min_h_0()
                        .rounded(theme.skin.radius_md)
                        .bg(theme.c.card2)
                        .text_size(px(13.0))
                        .child(body),
                )
                .child(
                    div().flex().justify_end().child(
                        div()
                            .id("admin-close")
                            .debug_selector(|| "admin-close".to_owned())
                            .h(px(36.0))
                            .px(px(18.0))
                            .flex()
                            .items_center()
                            .rounded(theme.skin.radius_md)
                            .cursor_pointer()
                            .text_color(theme.c.muted)
                            .hover(move |style| style.bg(hover))
                            .on_click(cx.listener(|shell, _, _, cx| {
                                shell.panels.admin = None;
                                cx.notify();
                            }))
                            .child("Close"),
                    ),
                ),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ban(name: &str, mask: u32, duration_secs: u32, reason: &str) -> Ban {
        Ban {
            address: "203.0.113.7".into(),
            mask,
            name: name.to_owned().into(),
            hash: SharedString::default(),
            reason: reason.to_owned().into(),
            start: "2026-01-02".into(),
            duration_secs,
        }
    }

    #[test]
    fn a_ban_says_who_how_long_and_why() {
        let one = ban("Mallory", 32, 0, "spam");
        assert_eq!(ban_title(&one), "Mallory · 203.0.113.7");
        assert_eq!(ban_about(&one), "for good from 2026-01-02 · spam");
        let network = ban("", 24, 7200, "");
        assert_eq!(ban_title(&network), "203.0.113.7/24");
        assert_eq!(ban_about(&network), "for 2 h from 2026-01-02");
        assert_eq!(ban_about(&ban("", 32, 90, "")), "for 2 min from 2026-01-02");
        assert_eq!(
            ban_about(&ban("", 32, 3 * 86_400, "")),
            "for 3 d from 2026-01-02"
        );
    }

    #[test]
    fn a_registered_account_says_when_and_where_it_was_last_on() {
        let user = |last_seen: Option<&str>| Registered {
            id: 1,
            name: "Rin".into(),
            last_seen: last_seen.map(|seen| seen.to_owned().into()),
            last_channel: None,
        };
        assert_eq!(
            registered_about(&user(Some("2026-01-02")), Some("lounge")),
            "Last on 2026-01-02, in lounge"
        );
        assert_eq!(
            registered_about(&user(Some("2026-01-02")), None),
            "Last on 2026-01-02"
        );
        assert_eq!(registered_about(&user(None), Some("lounge")), "Never seen");
    }
}
