//! The Users page's state: the server's registered accounts as the table
//! lists them, narrowed by the search and in the order chosen, and what is
//! being done to one of them. The web UI's `UsersAdmin`.

use std::cmp::Ordering;

use gpui::{AppContext as _, Context, Entity, Pixels, Point, SharedString, Subscription, Window};

use super::super::Shell;
use super::super::accounts::seen_ms;
use super::super::kit::table::{Cell, Column, Direction, Widths};
use super::super::menu::{Command, Item};
use super::super::text_input::{InputEvent, TextInput};
use super::ROOT;
use super::roles::Managing;
use crate::engine::{Acl, Action, Listing, Registered, Role, Snapshot};
use crate::rights::Right;
use crate::theme::Theme;
use crate::words::t;

/// What a row's menu does to its account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::ui) enum Act {
    /// Change its name, in the row.
    Rename,
    /// Choose which of the server's roles it holds.
    Roles,
    /// Take it away, once asked.
    Unregister,
}

/// The columns the rows can be put in order by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::ui) enum Key {
    Name,
    LastSeen,
    LastChannel,
}

impl Key {
    /// The key of the column at `at`, if the rows can be ordered by it.
    fn of_column(at: usize) -> Option<Self> {
        [Self::Name, Self::LastSeen, Self::LastChannel]
            .get(at)
            .copied()
    }
}

/// An account's name being changed in its row.
pub(in crate::ui) struct Renaming {
    pub id: u32,
    pub field: Entity<TextInput>,
    _watch: Subscription,
}

/// The page's state.
pub(in crate::ui) struct Users {
    /// The accounts as the server last sent them.
    pub accounts: Vec<Registered>,
    /// Whether the server has been asked and has not answered yet.
    pub loading: bool,
    /// What the names are searched for.
    pub search: Entity<TextInput>,
    _watch: Subscription,
    /// What the rows are in order by, and which way.
    pub sort: (Key, Direction),
    /// The accounts that pass the search, by place in `accounts`, in order.
    pub shown: Vec<usize>,
    /// What the columns share the width out by.
    pub widths: Widths,
    /// The root channel's rules as last read: whose roles are whose.
    pub roots: Option<Acl>,
    pub renaming: Option<Renaming>,
    /// The account whose registration is to go, once the dialog is answered.
    pub unregistering: Option<u32>,
    /// The dialog choosing an account's roles, while it is open.
    pub managing: Option<Managing>,
}

impl Users {
    pub(super) fn take(&mut self, accounts: Vec<Registered>) {
        self.accounts = accounts;
        self.loading = false;
        // A row being changed that has gone is changed no more.
        if let Some(renaming) = &self.renaming
            && !self
                .accounts
                .iter()
                .any(|account| account.id == renaming.id)
        {
            self.renaming = None;
        }
    }

    pub(super) fn take_roots(&mut self, acl: Acl) {
        if let Some(managing) = self.managing.as_mut() {
            managing.seed(&acl);
        }
        self.roots = Some(acl);
    }

    /// The account with the id `id`.
    pub(super) fn account(&self, id: u32) -> Option<&Registered> {
        self.accounts.iter().find(|account| account.id == id)
    }

    /// The account in the row `row` of the table.
    pub(in crate::ui) fn at_row(&self, row: usize) -> Option<&Registered> {
        self.accounts.get(*self.shown.get(row)?)
    }

    /// Put away the topmost thing open over the page; says whether there
    /// was one.
    pub(super) fn dismiss(&mut self) -> bool {
        self.managing.take().is_some()
            || self.unregistering.take().is_some()
            || self.renaming.take().is_some()
    }
}

/// The columns, with the one the rows are in order by marked.
pub(super) fn columns(sort: (Key, Direction)) -> Vec<Column> {
    let by = |key: Key| (sort.0 == key).then_some(sort.1);
    vec![
        Column::new(t!("Username")).sortable(by(Key::Name)),
        Column::new(t!("Last Seen")).sortable(by(Key::LastSeen)),
        Column::new(t!("Last Channel")).sortable(by(Key::LastChannel)),
        Column::new(t!("Roles")),
        Column::new(t!("Actions")).least(56.0).end(),
    ]
}

/// What the server calls the channel `id`, if it still has one.
fn channel_name(snapshot: &Snapshot, id: Option<u32>) -> Option<SharedString> {
    let id = id?;
    let channel = snapshot.channels.iter().find(|channel| channel.id == id)?;
    Some(channel.name.clone())
}

/// The cells of `account`'s row: its name, when it was last on, where, its
/// roles and its menu.
pub(super) fn cells(
    account: &Registered,
    snapshot: &Snapshot,
    roles: &[Role],
    now_ms: u64,
) -> Vec<Cell> {
    let written = account
        .last_seen
        .as_ref()
        .filter(|seen| !seen.trim().is_empty());
    let seen = match written {
        None => Cell::Text(t!("Never")),
        Some(written) => match seen_ms(written) {
            Some(at) => Cell::ago(at, now_ms),
            // Written some other way: shown as it is, as the web UI does.
            None => Cell::Text(written.clone()),
        },
    };
    let channel = channel_name(snapshot, account.last_channel).unwrap_or_else(|| t!("Unknown"));
    let held = roles
        .iter()
        .filter(|role| role.members.contains(&account.id))
        .map(|role| (role.name.clone(), role.color))
        .collect();
    vec![
        Cell::Strong(account.name.clone()),
        seen,
        Cell::Text(channel),
        Cell::Chips(held),
        Cell::Menu,
    ]
}

/// Which of two accounts comes first by `key`; by name where that leaves
/// them level, and in server order after that.
fn before(one: &Registered, other: &Registered, key: Key, snapshot: &Snapshot) -> Ordering {
    let name = |account: &Registered| account.name.to_lowercase();
    match key {
        Key::Name => name(one).cmp(&name(other)),
        // Never seen first, then the longest ago, as the web UI's order of
        // the server's dates.
        Key::LastSeen => {
            let seen =
                |account: &Registered| account.last_seen.as_ref().and_then(|seen| seen_ms(seen));
            seen(one)
                .cmp(&seen(other))
                .then_with(|| name(one).cmp(&name(other)))
        }
        // By the name the channel is shown by; none last.
        Key::LastChannel => {
            let place = |account: &Registered| {
                let channel = channel_name(snapshot, account.last_channel);
                let channel = channel.map(|channel| channel.to_lowercase());
                (channel.is_none(), channel)
            };
            place(one)
                .cmp(&place(other))
                .then_with(|| name(one).cmp(&name(other)))
        }
    }
}

/// The time now, in Unix milliseconds.
pub(super) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

impl Shell {
    pub(super) fn users_page_mut(&mut self) -> Option<&mut Users> {
        self.panels.admin_page.as_mut()?.users.as_mut()
    }

    pub(in crate::ui) fn users_page(&self) -> Option<&Users> {
        self.panels.admin_page.as_ref()?.users.as_ref()
    }

    /// Make the page and ask for what it lists: the accounts, and the root
    /// channel's rules, where the roles are.
    pub(super) fn open_users(&mut self, cx: &mut Context<Self>) {
        let search = cx.new(|cx| TextInput::new(t!("Search users..."), cx));
        let watch = cx.subscribe(&search, |shell, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Changed) {
                let theme = crate::theme::ActiveTheme::get(cx);
                shell.refilter_users(&theme, cx);
                cx.notify();
            }
        });
        if let Some(open) = self.panels.admin_page.as_mut() {
            open.users = Some(Users {
                accounts: Vec::new(),
                loading: true,
                search,
                _watch: watch,
                sort: (Key::Name, Direction::Up),
                shown: Vec::new(),
                widths: Widths::default(),
                roots: None,
                renaming: None,
                unregistering: None,
                managing: None,
            });
        }
        self.engine.list(Listing::Registered);
        self.engine.request_acl(ROOT);
    }

    /// Ask the server for its accounts again.
    pub(super) fn refresh_users(&mut self, cx: &mut Context<Self>) {
        if let Some(users) = self.users_page_mut() {
            users.loading = true;
        }
        self.engine.list(Listing::Registered);
        cx.notify();
    }

    /// Work out again which accounts pass the search, in what order, and
    /// how wide the columns are for them.
    pub(super) fn refilter_users(&mut self, theme: &Theme, cx: &mut Context<Self>) {
        let roles = self.engine.roles();
        let snapshot = &self.snapshot;
        let Some(users) = self
            .panels
            .admin_page
            .as_mut()
            .and_then(|open| open.users.as_mut())
        else {
            return;
        };
        let wanted = users.search.read(cx).text().trim().to_lowercase();
        let (key, direction) = users.sort;
        let accounts = &users.accounts;
        let mut shown: Vec<usize> = (0..accounts.len())
            .filter(|at| wanted.is_empty() || accounts[*at].name.to_lowercase().contains(&wanted))
            .collect();
        shown.sort_by(|one, other| {
            let order = before(&accounts[*one], &accounts[*other], key, snapshot);
            match direction {
                Direction::Up => order,
                Direction::Down => order.reverse(),
            }
        });
        let now = now_ms();
        let rows = shown
            .iter()
            .map(|at| cells(&accounts[*at], snapshot, &roles, now));
        users.widths = Widths::measure(&columns(users.sort), rows, theme, cx);
        users.shown = shown;
    }

    /// Put the rows in order by the column at `at`; the other way if they
    /// already are.
    pub(super) fn sort_users(&mut self, at: usize, cx: &mut Context<Self>) {
        let Some(key) = Key::of_column(at) else {
            return;
        };
        let Some(users) = self.users_page_mut() else {
            return;
        };
        users.sort = if users.sort.0 == key {
            (key, users.sort.1.turned())
        } else {
            (key, Direction::Up)
        };
        let theme = crate::theme::ActiveTheme::get(cx);
        self.refilter_users(&theme, cx);
        cx.notify();
    }

    /// Open the menu of the account in row `row`, at `at`.
    pub(super) fn open_account_menu(
        &mut self,
        row: usize,
        at: Point<Pixels>,
        cx: &mut Context<Self>,
    ) {
        let roles = self.root_rights().has(Right::WRITE);
        let Some(users) = self.users_page() else {
            return;
        };
        let Some(account) = users.at_row(row) else {
            return;
        };
        let id = account.id;
        let mut items = Vec::new();
        // Being renamed already: nothing to start.
        if users
            .renaming
            .as_ref()
            .is_none_or(|renaming| renaming.id != id)
        {
            items.push(
                Item::new(&t!("Rename"), Command::Account(id, Act::Rename))
                    .selector("menu-account-rename"),
            );
        }
        // The roles are the root channel's groups: changing them is writing
        // its rules.
        if roles {
            items.push(
                Item::new(&t!("Manage roles"), Command::Account(id, Act::Roles))
                    .selector("menu-account-roles"),
            );
        }
        items.push(
            Item::new(
                &t!("Unregister {{name}}", name = account.name),
                Command::Account(id, Act::Unregister),
            )
            .selector("menu-account-unregister")
            .danger(),
        );
        self.open_menu(at, items, cx);
    }

    /// Open the Roles page on the `at`th role the account in row `row`
    /// holds: what a click on that role's pill does.
    pub(super) fn open_role_of_row(&mut self, row: usize, at: usize, cx: &mut Context<Self>) {
        let Some(id) = self.users_page().and_then(|users| users.at_row(row)).map(|account| account.id)
        else {
            return;
        };
        let held: Vec<_> = self
            .engine
            .roles()
            .into_iter()
            .filter(|role| role.members.contains(&id))
            .collect();
        if let Some(role) = held.get(at) {
            self.open_role(role.name.clone(), cx);
        }
    }

    /// Do `act` to the account `id`, as its menu asked.
    pub(in crate::ui) fn act_on_account(
        &mut self,
        id: u32,
        act: Act,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match act {
            Act::Rename => self.rename_account(id, window, cx),
            Act::Roles => self.manage_roles(id, cx),
            Act::Unregister => {
                if let Some(users) = self.users_page_mut() {
                    users.renaming = None;
                    users.unregistering = Some(id);
                }
            }
        }
        cx.notify();
    }

    /// Change the name of the account `id` in its row: a field with its
    /// name in it, ready to type in.
    fn rename_account(&mut self, id: u32, window: &mut Window, cx: &mut Context<Self>) {
        let Some(name) = self
            .users_page()
            .and_then(|users| users.account(id))
            .map(|account| account.name.clone())
        else {
            return;
        };
        let field = cx.new(|cx| {
            let mut input = TextInput::new(t!("User name"), cx);
            input.set_text(name.to_string());
            input
        });
        let watch = cx.subscribe(&field, |shell, _, event: &InputEvent, cx| match event {
            InputEvent::Submitted(_) => shell.finish_renaming_account(cx),
            InputEvent::Cancelled => shell.stop_renaming_account(cx),
            _ => {}
        });
        field.read(cx).focus(window);
        if let Some(users) = self.users_page_mut() {
            users.unregistering = None;
            users.renaming = Some(Renaming {
                id,
                field,
                _watch: watch,
            });
        }
    }

    /// Put the field away, the name as it was.
    pub(super) fn stop_renaming_account(&mut self, cx: &mut Context<Self>) {
        if let Some(users) = self.users_page_mut() {
            users.renaming = None;
        }
        cx.notify();
    }

    /// Give the account the name typed, and read the list again. An empty
    /// name is no name: nothing is sent.
    pub(super) fn finish_renaming_account(&mut self, cx: &mut Context<Self>) {
        let Some(users) = self.users_page_mut() else {
            return;
        };
        let Some(renaming) = users.renaming.as_ref() else {
            return;
        };
        let name = renaming.field.read(cx).text().trim().to_owned();
        if name.is_empty() {
            return;
        }
        let id = renaming.id;
        users.renaming = None;
        self.engine.act(Action::RenameRegistered { id, name });
        self.refresh_users(cx);
    }

    /// The answer to the dialog: the registration goes, with all the server
    /// keeps for it, and the list is read again.
    pub(super) fn confirm_unregister(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self
            .users_page_mut()
            .and_then(|users| users.unregistering.take())
        else {
            return;
        };
        self.engine.act(Action::Unregister { id });
        self.refresh_users(cx);
    }
}
