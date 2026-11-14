//! Where the server's administrator's lists go when they arrive, and the
//! way to them from elsewhere: the pages of the administration in the
//! settings (`admin_pages`), and the permissions panel, which calls an
//! account by its name.

use gpui::Context;

use super::Shell;
use super::admin_pages::AdminPage;
use crate::engine::{Ban, Listing, Registered};

impl Shell {
    /// Open the page of the settings that lists `listing`: the way the
    /// server's menu has to the bans and the registered accounts.
    pub(super) fn open_admin(&mut self, listing: Listing, cx: &mut Context<Self>) {
        let page = match listing {
            Listing::Bans => AdminPage::Bans,
            Listing::Registered => AdminPage::Users,
        };
        self.open_admin_page(page, cx);
    }

    /// The server sent its ban list.
    pub(super) fn take_bans(&mut self, bans: Vec<Ban>, cx: &mut Context<Self>) {
        self.admin_bans(bans, cx);
    }

    /// The server sent its registered accounts: the page that lists them,
    /// and what the permissions panel calls an account by.
    pub(super) fn take_registered(&mut self, users: Vec<Registered>, cx: &mut Context<Self>) {
        if let Some(acl) = self.panels.acl.as_mut() {
            acl.names = users
                .iter()
                .map(|user| (user.id, user.name.clone()))
                .collect();
        }
        self.admin_registered(users, cx);
    }
}
