//! The server's administration, as pages of the settings: the web UI's
//! `AdminScreen` (`nebula/components/admin`), which takes the settings'
//! pane when an entry under "Server admin" is chosen, beside the same
//! column.
//!
//! A page is offered only to somebody the server would let use it, and
//! only once it has something real on it. What a page holds is made when it
//! opens and dropped when another page or the conversation takes the pane:
//! a list of thousands is not kept for a page nobody is looking at.

mod bans;
mod bans_view;
mod role_display;
mod role_grants;
mod role_members;
mod roles;
mod roles_page;
mod roles_view;
mod users;
mod users_view;

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use crate::engine::{Acl, Ban, Registered};
use crate::rights::Right;
use crate::theme::Theme;
use crate::words::t;

pub(super) use users::Act;

/// The channel a server keeps its roles in, as groups.
const ROOT: crate::engine::ChannelId = 0;

/// A page of the administration, in the web UI's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AdminPage {
    Users,
    Roles,
    Bans,
}

impl AdminPage {
    pub(super) const ALL: [Self; 3] = [Self::Users, Self::Roles, Self::Bans];

    /// What the web UI calls it (`AdminPageId`); its entry in the column
    /// is `admin-<id>`.
    pub(super) fn id(self) -> &'static str {
        match self {
            Self::Users => "users",
            Self::Roles => "roles",
            Self::Bans => "bans",
        }
    }

    /// The page the web UI calls `id`.
    pub(super) fn named(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|page| page.id() == id)
    }

    /// What its entry in the column says.
    pub(super) fn name(self) -> SharedString {
        match self {
            Self::Users => t!("Users"),
            Self::Roles => t!("Roles"),
            Self::Bans => t!("Ban List"),
        }
    }

    /// Whether the server lets the local user use it: what it would refuse
    /// every request of is not offered.
    pub(super) fn allowed(self, shell: &Shell) -> bool {
        let root = shell.root_rights();
        match self {
            // Listing the accounts takes the right to register them.
            Self::Users => root.has(Right::REGISTER),
            // The roles are the root's groups: changing them is writing its
            // rules.
            Self::Roles => root.has(Right::WRITE),
            // Reading the bans, and writing them, takes the right to ban.
            Self::Bans => root.has(Right::BAN),
        }
    }
}

/// The page on show, and what it holds.
pub(super) struct Open {
    page: AdminPage,
    users: Option<users::Users>,
    roles: Option<roles_page::RolesPage>,
    bans: Option<bans::Bans>,
}

impl Shell {
    /// Show the administration's `page` in the settings' pane, asking the
    /// server for what it lists.
    pub(super) fn open_admin_page(&mut self, page: AdminPage, cx: &mut Context<Self>) {
        if !page.allowed(self) {
            return;
        }
        if !self.panels.settings.open {
            self.open_settings(cx);
        }
        self.panels.admin_page = Some(Open {
            page,
            users: None,
            roles: None,
            bans: None,
        });
        match page {
            AdminPage::Users => self.open_users(cx),
            AdminPage::Roles => self.open_roles(None, cx),
            AdminPage::Bans => self.open_bans(),
        }
        cx.notify();
    }

    /// Show the Roles page on the role `name`, as the web UI's role pill
    /// opens it from the Users page.
    pub(super) fn open_role(&mut self, name: SharedString, cx: &mut Context<Self>) {
        self.open_admin_page(AdminPage::Roles, cx);
        if let Some(page) = self.roles_page_mut() {
            page.editing = Some(name);
        }
        cx.notify();
    }

    /// The page of the administration on show, if one is.
    pub(super) fn admin_page(&self) -> Option<AdminPage> {
        self.panels.admin_page.as_ref().map(|open| open.page)
    }

    /// Put away what is open over the page of the administration on show:
    /// a field a row is being changed in, or a dialog. Says whether there
    /// was something.
    pub(super) fn dismiss_admin_page(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(open) = self.panels.admin_page.as_mut() else {
            return false;
        };
        let dismissed = open.users.as_mut().is_some_and(users::Users::dismiss)
            || open.bans.as_mut().is_some_and(bans::Bans::dismiss)
            || open.roles.as_mut().is_some_and(roles_page::RolesPage::dismiss);
        if dismissed {
            cx.notify();
        }
        dismissed
    }

    /// The server sent its registered accounts: for the page that lists
    /// them, if it is open.
    pub(super) fn admin_registered(&mut self, accounts: Vec<Registered>, cx: &mut Context<Self>) {
        self.roles_take_accounts(&accounts);
        let theme = crate::theme::ActiveTheme::get(cx);
        let Some(users) = self.users_page_mut() else {
            return;
        };
        users.take(accounts);
        self.refilter_users(&theme, cx);
    }

    /// The server sent its bans: for the page that lists them, if it is
    /// open.
    pub(super) fn admin_bans(&mut self, bans: Vec<Ban>, cx: &mut Context<Self>) {
        if let Some(page) = self.bans_page_mut() {
            page.take(bans);
            cx.notify();
        }
    }

    /// The server sent a channel's rules: the root's are its roles.
    /// The roles' chips may have changed with them: the columns are
    /// measured again.
    pub(super) fn admin_acl(&mut self, acl: &Acl, cx: &mut Context<Self>) {
        if acl.channel != ROOT {
            return;
        }
        self.roles_take_acl(acl, cx);
        let Some(users) = self.users_page_mut() else {
            return;
        };
        users.take_roots(acl.clone());
        let theme = crate::theme::ActiveTheme::get(cx);
        self.refilter_users(&theme, cx);
    }
}

/// The page of the administration on show, as the settings' pane draws it:
/// wider than a page of settings, and as tall as the pane, for a list that
/// scrolls under its head while the title stays.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Option<AnyElement> {
    let open = shell.panels.admin_page.as_ref()?;
    let page = match open.page {
        AdminPage::Users => users_view::render(open.users.as_ref()?, theme, cx),
        AdminPage::Roles => roles_view::render(open.roles.as_ref()?, theme, cx),
        AdminPage::Bans => bans_view::render(open.bans.as_ref()?, theme, cx),
    };
    Some(
        div()
            .id("admin-page")
            .debug_selector(|| "admin-page".to_owned())
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .px(px(52.0))
            .py(px(38.0))
            .line_height(gpui::relative(super::kit::LINE))
            .child(page)
            .into_any_element(),
    )
}

/// What the page of the administration on show has open over the window:
/// its dialogs.
pub(super) fn overlay(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Option<AnyElement> {
    let users = shell.panels.admin_page.as_ref()?.users.as_ref()?;
    users_view::dialogs(shell, users, theme, cx)
}
