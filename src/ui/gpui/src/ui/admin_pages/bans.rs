//! The Ban List page's state: the server's bans as the list shows them,
//! the one chosen and its form, and the changes not saved yet. The web
//! UI's `BansAdmin`.
//!
//! The server takes the list whole, so changes gather here and are sent
//! together when saved; the list is then read again, and what the server
//! holds is what is shown, never a refused change that looks saved.

use std::net::IpAddr;

use gpui::Focusable as _;
use gpui::{AppContext as _, Context, Entity, SharedString, Subscription, Window};

use super::super::Shell;
use super::super::text_input::{InputEvent, TextInput};
use crate::engine::{Action, Ban, Listing};
use crate::words::t;

/// The fields of the form, in the web UI's order, with what each says while
/// it is empty.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::ui) enum Part {
    Name,
    Address,
    Mask,
    Reason,
    Hash,
    Start,
    Duration,
}

impl Part {
    pub(super) const ALL: [Self; 7] = [
        Self::Name,
        Self::Address,
        Self::Mask,
        Self::Reason,
        Self::Hash,
        Self::Start,
        Self::Duration,
    ];

    /// What the field is called, over it.
    pub(super) fn label(self) -> SharedString {
        match self {
            Self::Name => t!("Username"),
            Self::Address => t!("Address"),
            Self::Mask => t!("Mask"),
            Self::Reason => t!("Reason"),
            Self::Hash => t!("Hash"),
            Self::Start => t!("Start"),
            Self::Duration => t!("Duration (seconds, 0 = permanent)"),
        }
    }

    /// What the tests call its field.
    pub(super) fn id(self) -> &'static str {
        match self {
            Self::Name => "ban-name",
            Self::Address => "ban-address",
            Self::Mask => "ban-mask",
            Self::Reason => "ban-reason",
            Self::Hash => "ban-hash",
            Self::Start => "ban-start",
            Self::Duration => "ban-duration",
        }
    }

    /// What `ban` has in this field, as it is written in it.
    fn of(self, ban: &Ban) -> String {
        match self {
            Self::Name => ban.name.to_string(),
            Self::Address => ban.address.to_string(),
            Self::Mask => ban.mask.to_string(),
            Self::Reason => ban.reason.to_string(),
            Self::Hash => ban.hash.to_string(),
            Self::Start => ban.start.to_string(),
            Self::Duration => ban.duration_secs.to_string(),
        }
    }
}

/// How many bits an address of the kind `address` is: 32 for IPv4, 128
/// for anything else, an address not finished yet among them.
fn bits_of(address: &str) -> u32 {
    match address.trim().parse::<IpAddr>() {
        Ok(IpAddr::V4(_)) => 32,
        _ => 128,
    }
}

/// `ban` with `written` put in `part`. A number that is not one leaves the
/// field as it was; a mask that covered all of the old address covers all
/// of a new one, so an IPv4 address typed into a new entry bans that
/// address and nothing more.
pub(super) fn patched(mut ban: Ban, part: Part, written: &str) -> Ban {
    match part {
        Part::Name => ban.name = written.to_owned().into(),
        Part::Address => {
            let whole = ban.mask >= bits_of(&ban.address);
            let most = bits_of(written);
            ban.mask = if whole { most } else { ban.mask.min(most) };
            ban.address = written.to_owned().into();
        }
        Part::Mask => {
            if let Ok(mask) = written.trim().parse::<u32>() {
                ban.mask = mask.min(bits_of(&ban.address));
            }
        }
        Part::Reason => ban.reason = written.to_owned().into(),
        Part::Hash => ban.hash = written.to_owned().into(),
        Part::Start => ban.start = written.to_owned().into(),
        Part::Duration => {
            if let Ok(secs) = written.trim().parse::<u32>() {
                ban.duration_secs = secs;
            }
        }
    }
    ban
}

/// A new entry: no address yet, and a mask covering all of whatever is
/// typed.
fn empty_ban() -> Ban {
    Ban {
        address: SharedString::default(),
        mask: 128,
        name: SharedString::default(),
        hash: SharedString::default(),
        reason: SharedString::default(),
        start: SharedString::default(),
        duration_secs: 0,
    }
}

/// `bans` as they go to the server, each as the server will write it back;
/// or what is wrong with one of them. An entry needs an address, at least
/// eight of its bits, and a hash of hexadecimal digits: a ban on fewer bits
/// turns away most of the world, and one on none of them everybody.
pub(super) fn checked(bans: &[Ban]) -> Result<Vec<Ban>, SharedString> {
    bans.iter()
        .map(|ban| {
            crate::bans::Entered::of(ban)
                .ban(ban.start.clone())
                .map_err(SharedString::new_static)
        })
        .collect()
}

/// The form of the entry chosen.
pub(in crate::ui) struct Form {
    pub fields: Vec<(Part, Entity<TextInput>)>,
    _watch: Vec<Subscription>,
}

/// The page's state.
pub(in crate::ui) struct Bans {
    /// The list as shown: the server's, with the changes not saved yet.
    pub bans: Vec<Ban>,
    pub loading: bool,
    pub selected: Option<usize>,
    pub form: Option<Form>,
    /// Whether something was changed since the list was read.
    pub dirty: bool,
    /// Why the last save did not go out, while that is said.
    pub refusal: Option<SharedString>,
    /// Whether a save went out and the list has not come back yet: a
    /// refusal the server says meanwhile is that save's.
    pub saving: bool,
}

impl Bans {
    /// The server's list arrived: whatever was being changed against the
    /// old one is gone, saved or not.
    pub(super) fn take(&mut self, bans: Vec<Ban>) {
        self.bans = bans;
        self.loading = false;
        self.saving = false;
        self.selected = None;
        self.form = None;
        self.dirty = false;
    }

    /// Put away the topmost thing open: the form.
    pub(super) fn dismiss(&mut self) -> bool {
        self.selected = None;
        self.form.take().is_some()
    }
}

impl Shell {
    pub(super) fn bans_page_mut(&mut self) -> Option<&mut Bans> {
        self.panels.admin_page.as_mut()?.bans.as_mut()
    }

    pub(in crate::ui) fn bans_page(&self) -> Option<&Bans> {
        self.panels.admin_page.as_ref()?.bans.as_ref()
    }

    /// Make the page and ask for the list.
    pub(super) fn open_bans(&mut self) {
        if let Some(open) = self.panels.admin_page.as_mut() {
            open.bans = Some(Bans {
                bans: Vec::new(),
                loading: true,
                selected: None,
                form: None,
                dirty: false,
                refusal: None,
                saving: false,
            });
        }
        self.engine.list(Listing::Bans);
    }

    /// Ask the server for its bans again.
    pub(super) fn refresh_bans(&mut self, cx: &mut Context<Self>) {
        if let Some(bans) = self.bans_page_mut() {
            bans.loading = true;
        }
        self.engine.list(Listing::Bans);
        cx.notify();
    }

    /// Choose the entry at `at`, and fill the form with it.
    pub(super) fn choose_ban(&mut self, at: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(ban) = self.bans_page().and_then(|bans| bans.bans.get(at)).cloned() else {
            return;
        };
        let mut watch = Vec::new();
        let fields = Part::ALL
            .into_iter()
            .map(|part| {
                let field = cx.new(|cx| {
                    // Only the start says anything while empty, as the web
                    // UI's form.
                    let placeholder = match part {
                        Part::Start => t!("e.g. 2025-01-01T00:00:00"),
                        _ => SharedString::default(),
                    };
                    let mut input = TextInput::new(placeholder, cx);
                    input.set_text(part.of(&ban));
                    input
                });
                watch.push(cx.subscribe_in(
                    &field,
                    window,
                    move |shell, field, event, window, cx| {
                        shell.on_ban_field(part, field, event, window, cx);
                    },
                ));
                (part, field)
            })
            .collect();
        if let Some(bans) = self.bans_page_mut() {
            bans.selected = Some(at);
            bans.form = Some(Form {
                fields,
                _watch: watch,
            });
        }
        cx.notify();
    }

    /// A field of the form changed, or was left.
    fn on_ban_field(
        &mut self,
        part: Part,
        field: &Entity<TextInput>,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            InputEvent::Changed => {
                let written = field.read(cx).text().to_owned();
                let Some(bans) = self.bans_page_mut() else {
                    return;
                };
                let Some(ban) = bans.selected.and_then(|at| bans.bans.get_mut(at)) else {
                    return;
                };
                *ban = patched(ban.clone(), part, &written);
                bans.dirty = true;
                // The mask follows a new address: say so in its field.
                if part == Part::Address {
                    let mask = ban.mask.to_string();
                    let fields = bans.form.as_ref().map(|form| form.fields.clone());
                    if let Some((_, mask_field)) = fields
                        .into_iter()
                        .flatten()
                        .find(|(part, _)| *part == Part::Mask)
                    {
                        mask_field.update(cx, |input, _| input.set_text(mask));
                    }
                }
                cx.notify();
            }
            InputEvent::Tabbed { back } => self.step_ban_field(part, *back, window, cx),
            InputEvent::Submitted(_) => self.save_bans(cx),
            InputEvent::Cancelled => {
                if let Some(bans) = self.bans_page_mut() {
                    let _ = bans.dismiss();
                }
                cx.notify();
            }
            InputEvent::PastedPicture(_) | InputEvent::Pick(_) => {}
        }
    }

    /// Give the keyboard to the field after `part`, or the one before.
    fn step_ban_field(
        &mut self,
        part: Part,
        back: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(form) = self.bans_page().and_then(|bans| bans.form.as_ref()) else {
            return;
        };
        let count = form.fields.len();
        let Some(at) = form.fields.iter().position(|(one, _)| *one == part) else {
            return;
        };
        let next = if back { at + count - 1 } else { at + 1 } % count;
        window.focus(&form.fields[next].1.focus_handle(cx), cx);
        cx.notify();
    }

    /// A new entry at the end of the list, chosen, to be filled in.
    pub(super) fn add_ban(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(bans) = self.bans_page_mut() else {
            return;
        };
        bans.bans.push(empty_ban());
        bans.dirty = true;
        let at = bans.bans.len() - 1;
        self.choose_ban(at, window, cx);
        if let Some(form) = self.bans_page().and_then(|bans| bans.form.as_ref())
            && let Some((_, address)) = form.fields.iter().find(|(part, _)| *part == Part::Address)
        {
            window.focus(&address.focus_handle(cx), cx);
        }
    }

    /// Take the entry chosen out of the list.
    pub(super) fn remove_ban(&mut self, cx: &mut Context<Self>) {
        let Some(bans) = self.bans_page_mut() else {
            return;
        };
        let Some(at) = bans.selected.take() else {
            return;
        };
        if at < bans.bans.len() {
            drop(bans.bans.remove(at));
        }
        bans.form = None;
        bans.dirty = true;
        cx.notify();
    }

    /// Send the list as it is now, which the server takes whole, and read
    /// it back; or say why it cannot go.
    pub(super) fn save_bans(&mut self, cx: &mut Context<Self>) {
        let Some(bans) = self.bans_page_mut() else {
            return;
        };
        if !bans.dirty {
            return;
        }
        let whole = match checked(&bans.bans) {
            Ok(whole) => whole,
            Err(problem) => {
                bans.refusal = Some(problem);
                cx.notify();
                return;
            }
        };
        bans.refusal = None;
        bans.saving = true;
        self.engine.act(Action::SetBans(whole));
        self.refresh_bans(cx);
    }

    /// The server said something: while a save waits for its list, that
    /// is why the save was refused, and the page says so. The list read
    /// back after it is the server's, as it was.
    pub(in crate::ui) fn admin_notice(&mut self, notice: Option<&SharedString>) {
        let Some(bans) = self.bans_page_mut().filter(|bans| bans.saving) else {
            return;
        };
        if let Some(notice) = notice {
            bans.refusal = Some(notice.clone());
        }
    }

    /// Stop saying why the last save did not go out.
    pub(super) fn clear_ban_refusal(&mut self, cx: &mut Context<Self>) {
        if let Some(bans) = self.bans_page_mut() {
            bans.refusal = None;
        }
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ban(address: &str, mask: u32) -> Ban {
        Ban {
            address: address.to_owned().into(),
            mask,
            ..empty_ban()
        }
    }

    #[test]
    fn a_mask_that_covered_the_whole_address_covers_the_whole_new_one() {
        let typed = patched(empty_ban(), Part::Address, "203.0.113.7");
        assert_eq!(typed.mask, 32, "one IPv4 address, not all of IPv4");
        let six = patched(typed, Part::Address, "2001:db8::1");
        assert_eq!(six.mask, 128);
        let network = patched(ban("198.51.100.0", 24), Part::Address, "198.51.101.0");
        assert_eq!(network.mask, 24, "a network stays one");
    }

    #[test]
    fn a_number_that_is_not_one_leaves_its_field_as_it_was() {
        let held = ban("203.0.113.7", 32);
        assert_eq!(patched(held.clone(), Part::Mask, "2x").mask, 32);
        assert_eq!(
            patched(held.clone(), Part::Mask, "99").mask,
            32,
            "no more than it has"
        );
        assert_eq!(patched(held.clone(), Part::Mask, "24").mask, 24);
        assert_eq!(patched(held, Part::Duration, "3600").duration_secs, 3600);
    }

    #[test]
    fn an_entry_that_is_no_ban_keeps_the_list_from_going_out() {
        assert!(checked(&[ban("203.0.113.7", 32)]).is_ok());
        assert!(checked(&[ban("203.0.113.7", 32), ban("", 128)]).is_err());
        assert!(checked(&[ban("not one", 128)]).is_err());
        // Everybody, or most of the world.
        assert!(checked(&[ban("203.0.113.7", 0)]).is_err());
        assert!(checked(&[ban("203.0.113.7", 4)]).is_err());
        // Written back as the server writes it.
        let six = checked(&[ban("2001:DB8::1", 128)]).expect("a ban");
        assert_eq!(six[0].address.as_ref(), "2001:db8::1");
    }
}
