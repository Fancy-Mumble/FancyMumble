//! The devices the account is used from, on the Account page, as the web
//! UI's `AccountDevices`: this one first, then those online, then the rest
//! by when they were last seen; each renamed in place, or signed out (asked
//! first) where it is not this one. Under them, the offer of the account to
//! a new device: its QR code, its code and its link.

use gpui::{Context, Div, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::super::Shell;
use super::super::super::kit::{Banner, Button, Card, Emphasis, Field, Note, Size, Tone};
use super::super::super::widgets::EMPHASIS;
use super::fields::{boxed, gated, note, said};
use super::{AccountPage, Offer, ids, linked, qr};
use crate::engine::{AccountAction, AccountDevice, AccountSettings};
use crate::theme::Theme;
use crate::words::t;

/// How a device is doing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Standing {
    This,
    Online,
    NeverSeen,
    /// Last seen this long ago, said the way the client says times.
    LastSeen(u64),
}

impl Standing {
    pub(super) fn of(device: &AccountDevice, this: Option<&str>) -> Self {
        if Some(device.id.as_str()) == this {
            Self::This
        } else if device.online {
            Self::Online
        } else if device.last_seen_ms == 0 {
            Self::NeverSeen
        } else {
            Self::LastSeen(device.last_seen_ms)
        }
    }

    fn words(&self) -> SharedString {
        match self {
            Self::This => t!("This device"),
            Self::Online => t!("Online now"),
            Self::NeverSeen => t!("Not signed in yet"),
            Self::LastSeen(ms) => t!(
                "Last seen {{when}}",
                when = super::super::super::kit::table::ago(*ms, now_ms())
            ),
        }
    }

    fn rank(&self) -> u8 {
        match self {
            Self::This => 0,
            Self::Online => 1,
            Self::NeverSeen | Self::LastSeen(_) => 2,
        }
    }
}

/// Now, in milliseconds since 1970.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| u64::try_from(since.as_millis()).unwrap_or(u64::MAX))
}

/// The devices in the order they are listed.
pub(super) fn ordered(account: &AccountSettings) -> Vec<&AccountDevice> {
    let this = account.this_device.as_deref();
    let mut devices: Vec<&AccountDevice> = account.devices.iter().collect();
    devices.sort_by(|a, b| {
        Standing::of(a, this)
            .rank()
            .cmp(&Standing::of(b, this).rank())
            .then(b.last_seen_ms.cmp(&a.last_seen_ms))
            .then(a.id.cmp(&b.id))
    });
    devices
}

/// The section.
pub(super) fn render(
    shell: &Shell,
    page: &AccountPage,
    account: &AccountSettings,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let devices = ordered(account);
    let list = if devices.is_empty() {
        note(
            t!("No devices yet. They appear here once they sign in with a current client."),
            theme,
        )
    } else {
        div()
            .debug_selector(|| "account-devices".to_owned())
            .flex()
            .flex_col()
            .gap(px(8.0))
            .children(
                devices
                    .into_iter()
                    .enumerate()
                    .map(|(at, device)| card(page, account, at, device, theme, cx)),
            )
    };
    div()
        .child(super::super::heading(&shell.panels.settings.lit, t!("Devices")).hint(t!(
            "Where this account is signed in. All of them can be online at the same time."
        )))
        .when(account.devices_locked, |group| {
            group.child(note(t!(
                "A device has been signed out, so only the devices listed here can sign in with this account's certificate alone."
            ), theme).mb(px(8.0)))
        })
        .child(list)
        .children(said(page, ids::RENAME_DEVICE))
        .children(said(page, ids::REMOVE_DEVICE))
        .child(div().mt(px(12.0)).child(linking(page, account, theme, cx)))
}

/// One device: its name and how it is doing, and what can be done to it.
fn card(
    page: &AccountPage,
    account: &AccountSettings,
    at: usize,
    device: &AccountDevice,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let standing = Standing::of(device, account.this_device.as_deref());
    let own = standing == Standing::This;
    let lit = own || standing == Standing::Online;
    let busy = page.busy();
    let name: SharedString = if device.name.is_empty() {
        t!("Unnamed device")
    } else {
        device.name.clone().into()
    };
    let (renamed, doomed) = (device.clone(), device.id.clone());
    let head = div()
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .child(div().truncate().text_size(px(12.5)).font_weight(EMPHASIS).child(name))
                .child(
                    div()
                        .text_size(px(11.5))
                        .text_color(if lit { theme.c.ok } else { theme.c.muted })
                        .child(standing.words()),
                ),
        )
        .child(gated(
            Button::new("account-device-rename", t!("Rename"))
                .selector(format!("account-device-rename-{at}"))
                .size(Size::Compact),
            !busy,
            cx.listener(move |shell, _, _, cx| shell.start_renaming(&renamed, cx)),
        ))
        .when(!own, |head| {
            head.child(gated(
                Button::new("account-device-sign-out", t!("Sign out"))
                    .selector(format!("account-device-sign-out-{at}"))
                    .emphasis(Emphasis::Outlined)
                    .tone(Tone::Danger)
                    .size(Size::Compact),
                !busy,
                cx.listener(move |shell, _, _, cx| shell.start_signing_out(&doomed, cx)),
            ))
        });
    let below = if page.renaming.as_deref() == Some(device.id.as_str()) {
        Some(renaming(page, device, at, theme, cx))
    } else if page.signing_out.as_deref() == Some(device.id.as_str()) {
        Some(signing_out(page, account, device, at, cx))
    } else {
        None
    };
    div()
        .id(("account-device", at))
        .debug_selector(move || format!("account-device-{at}"))
        .child(Card::new().child(head).children(below))
}

/// The field a device is renamed in, and its buttons.
fn renaming(
    page: &AccountPage,
    device: &AccountDevice,
    at: usize,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let typed = AccountPage::typed(&page.fields.device, cx).trim().to_owned();
    let on = !page.busy() && !typed.is_empty() && typed != device.name;
    div()
        .mt(px(10.0))
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(boxed(&page.fields.device, "account-device-name", theme))
        .child(
            Button::new("account-device-cancel", t!("Cancel"))
                .selector(format!("account-device-cancel-{at}"))
                .size(Size::Compact)
                .on_click(cx.listener(|shell, _, _, cx| shell.stop_editing_device(cx))),
        )
        .child(gated(
            Button::new("account-device-save", t!("Save"))
                .emphasis(Emphasis::Contained)
                .size(Size::Compact),
            on,
            cx.listener(|shell, _, _, cx| shell.save_device_name(cx)),
        ))
}

/// The question before a device is signed out.
fn signing_out(
    page: &AccountPage,
    account: &AccountSettings,
    device: &AccountDevice,
    at: usize,
    cx: &mut Context<Shell>,
) -> Div {
    let blocked = page.busy() || page.unproved(cx);
    let doomed = device.id.clone();
    div()
        .mt(px(10.0))
        .child(
            Banner::new(Note::Warn)
                .title(t!("Sign out {{name}}?", name = device.name.clone()))
                .child(if account.has_password {
                    t!("It is disconnected now and refused from then on. If your password is saved there, change it as well: a password still lets a new device in.")
                } else {
                    t!("It is disconnected now and refused from then on, even though it still has this account's certificate.")
                }),
        )
        .child(
            div()
                .mt(px(8.0))
                .flex()
                .justify_end()
                .gap(px(6.0))
                .child(
                    Button::new("account-device-cancel", t!("Cancel"))
                        .selector(format!("account-device-cancel-{at}"))
                        .size(Size::Compact)
                        .on_click(cx.listener(|shell, _, _, cx| shell.stop_editing_device(cx))),
                )
                .child(gated(
                    Button::new("account-device-sign-out-confirm", t!("Sign out"))
                        .emphasis(Emphasis::Contained)
                        .tone(Tone::Danger)
                        .size(Size::Compact),
                    !blocked,
                    cx.listener(move |shell, _, _, cx| {
                        shell.ask_account(AccountAction::RemoveDevice(doomed.clone()), cx);
                    }),
                )),
        )
}

/// The offer of the account to a new device, or the way to make one.
fn linking(page: &AccountPage, account: &AccountSettings, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let state = match &page.offer {
        Some(offer) => offered(offer, linked(Some(account), &offer.link), theme, cx),
        None => div().flex().child(gated(
            Button::new("account-link-begin", t!("Link a new device"))
                .emphasis(Emphasis::Outlined)
                .size(Size::Compact)
                .height(32.0),
            !page.busy() && !page.offering,
            cx.listener(|shell, _, _, cx| shell.offer_account(cx)),
        )),
    };
    div()
        .child(state)
        .children(
            page.offer_failed
                .clone()
                .map(|why| Banner::new(Note::Danger).child(why)),
        )
        .when(page.offer_expired, |linking| {
            linking.child(note(
                t!("The link expired. Start again if you still want to link a device."),
                theme,
            ).mt(px(6.0)))
        })
}

/// The offer as it is shown: until the new device signs in, its code to
/// scan, the code to type and the link; then that it did.
fn offered(offer: &Offer, done: bool, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let body = if done {
        div().child(Banner::new(Note::Ok).title(t!("The new device is signed in.")))
    } else {
        div()
            .child(div().mb(px(4.0)).text_size(px(12.5)).font_weight(EMPHASIS).child(t!("Link a new device")))
            .child(note(t!(
                "On the new device, scan this code with its camera or open the link. You can also paste the link under “Link from another device” when adding a server there."
            ), theme))
            .children(offer.code.as_ref().map(|picture| {
                div().my(px(12.0)).flex().justify_center().child(
                    div()
                        .debug_selector(|| "account-link-qr".to_owned())
                        .child(picture.element().size(px(qr::SIDE)).rounded(px(6.0))),
                )
            }))
            .child(div().mb(px(10.0)).child(Field::new(
                t!("Code"),
                div()
                    .debug_selector(|| "account-link-code".to_owned())
                    .font_family("monospace")
                    .text_size(px(15.0))
                    .child(SharedString::from(offer.link.code.clone())),
            )))
            .child(div().mb(px(10.0)).child(Field::new(
                t!("Link"),
                div()
                    .debug_selector(|| "account-link-text".to_owned())
                    .h(px(36.0))
                    .px(px(13.0))
                    .flex()
                    .items_center()
                    .rounded(theme.skin.radius_md)
                    .bg(theme.c.input)
                    .border_1()
                    .border_color(theme.c.line2)
                    .text_size(px(12.5))
                    .child(div().truncate().child(SharedString::from(offer.link.link.clone()))),
            )))
            .child(Banner::new(Note::Warn).title(t!(
                "Anyone with this link can sign in as you for the next ten minutes. Only open it on your own devices."
            )))
    };
    div().debug_selector(|| "account-link-panel".to_owned()).child(
        Card::new().child(body).child(
            div().mt(px(10.0)).flex().justify_end().child(
                Button::new(
                    "account-link-close",
                    if done { t!("Done") } else { t!("Cancel") },
                )
                .size(Size::Compact)
                .on_click(cx.listener(|shell, _, _, cx| shell.close_offer(cx))),
            ),
        ),
    )
}

impl Shell {
    /// Rename `device`: the field holds its name to begin with.
    fn start_renaming(&mut self, device: &AccountDevice, cx: &mut Context<Self>) {
        if let Some(page) = &mut self.panels.settings.account {
            page.signing_out = None;
            page.renaming = Some(device.id.clone());
            let name = device.name.clone();
            page.fields.device.update(cx, |field, cx| {
                field.set_text(name);
                cx.notify();
            });
        }
        cx.notify();
    }

    /// Ask before signing the device `id` out.
    fn start_signing_out(&mut self, id: &str, cx: &mut Context<Self>) {
        if let Some(page) = &mut self.panels.settings.account {
            page.renaming = None;
            page.signing_out = Some(id.to_owned());
        }
        cx.notify();
    }

    /// Close whatever is open on a device.
    fn stop_editing_device(&mut self, cx: &mut Context<Self>) {
        if let Some(page) = &mut self.panels.settings.account {
            page.renaming = None;
            page.signing_out = None;
        }
        cx.notify();
    }
}
