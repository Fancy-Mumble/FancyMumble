//! The icon in the system's tray (the notification area on Windows), with
//! the menu the web client gives it: mute, deafen and leave the server
//! without coming back to the window, show the window, quit. A click on the
//! icon shows the window, and the icon wears a green dot while the user is
//! talking.
//!
//! The icon is the system's, through the `tray-icon` crate the web client
//! also uses. Windows only so far: elsewhere the crate needs GTK, which
//! GPUI does not run, and the stand-in below puts nothing anywhere.
#![cfg_attr(
    not(windows),
    allow(dead_code, reason = "only Windows has a tray icon so far")
)]

use image::RgbaImage;

pub(crate) use held::Tray;

/// What the icon says when the pointer rests on it.
const TOOLTIP: &str = "Fancy Mumble";

/// The application's icon, the one the web client puts in the tray.
const APP_ICON: &[u8] = include_bytes!("../../tauri/icons/icon.png");

/// How many pixels a side the icon is handed to the system at: what a
/// tray draws at twice the usual scale. The system shrinks it from there.
const SIDE: u32 = 32;

/// The dot of somebody talking: the green the web client draws it in.
const TALKING: image::Rgba<u8> = image::Rgba([76, 175, 80, 255]);

/// Whether to put an icon in the tray: with the real engine, and not with
/// the made-up one, unless `FANCY_GPUI_TRAY` (`asked`) says `on` or `off`.
pub(crate) fn wanted(asked: Option<&str>, real_engine: bool) -> bool {
    match asked {
        Some("on") => true,
        Some("off") => false,
        _ => real_engine,
    }
}

/// What was picked in the tray.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Picked {
    /// Mute, or unmute.
    Mute,
    /// Deafen, or undeafen.
    Deafen,
    /// Leave the server.
    Disconnect,
    /// Bring the window up: the menu's entry, or a click on the icon.
    Show,
    /// Close the application.
    Quit,
}

/// What the tray shows of the client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Shown {
    /// On a server: what muting, deafening and leaving need.
    pub connected: bool,
    pub muted: bool,
    pub deafened: bool,
    /// The user is talking: the icon wears the dot.
    pub talking: bool,
}

/// One entry of the tray's menu, as it is to be drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Entry {
    pub picks: Picked,
    pub label: &'static str,
    pub enabled: bool,
    /// Whether it is ticked, for an entry that can be; `None` for one that
    /// cannot.
    pub ticked: Option<bool>,
}

/// A row of the tray's menu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Row {
    Entry(Entry),
    /// The line between two groups of entries.
    Rule,
}

impl Shown {
    /// The menu, top to bottom, as it is to be drawn for this.
    pub(crate) fn menu(self) -> [Row; 7] {
        let on_server = |picks, label, ticked| {
            Row::Entry(Entry {
                picks,
                label,
                enabled: self.connected,
                ticked,
            })
        };
        let always = |picks, label| {
            Row::Entry(Entry {
                picks,
                label,
                enabled: true,
                ticked: None,
            })
        };
        [
            on_server(Picked::Mute, "Mute", Some(self.muted)),
            on_server(Picked::Deafen, "Deafen", Some(self.deafened)),
            Row::Rule,
            on_server(Picked::Disconnect, "Disconnect", None),
            Row::Rule,
            always(Picked::Show, "Show Window"),
            always(Picked::Quit, "Quit"),
        ]
    }
}

/// The icon as it is handed to the system: `SIDE` pixels square, in RGBA.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Picture {
    image: RgbaImage,
}

impl Picture {
    /// The application's icon.
    ///
    /// # Errors
    ///
    /// When the icon built into the executable cannot be read.
    pub(crate) fn still() -> Result<Self, String> {
        Ok(Self::scaled(&Self::app_icon()?))
    }

    /// The application's icon with the green dot of somebody talking in its
    /// bottom right corner, ringed in white to stand off whatever is under
    /// it.
    ///
    /// # Errors
    ///
    /// When the icon built into the executable cannot be read.
    pub(crate) fn talking() -> Result<Self, String> {
        let mut full = Self::app_icon()?;
        // Drawn at full size and shrunk with the rest: the shrinking
        // smooths its edge.
        let side = i64::from(full.width().min(full.height()));
        let radius = side * 3 / 20;
        let ring = (radius + side / 32).pow(2);
        let centre = side - radius - side / 32 - side / 64;
        for (x, y, pixel) in full.enumerate_pixels_mut() {
            let far = (i64::from(x) - centre).pow(2) + (i64::from(y) - centre).pow(2);
            if far <= radius.pow(2) {
                *pixel = TALKING;
            } else if far <= ring {
                *pixel = image::Rgba([255; 4]);
            }
        }
        Ok(Self::scaled(&full))
    }

    fn app_icon() -> Result<RgbaImage, String> {
        image::load_from_memory_with_format(APP_ICON, image::ImageFormat::Png)
            .map(image::DynamicImage::into_rgba8)
            .map_err(|error| format!("the application's icon cannot be read: {error}"))
    }

    fn scaled(full: &RgbaImage) -> Self {
        let image =
            image::imageops::resize(full, SIDE, SIDE, image::imageops::FilterType::Triangle);
        Self { image }
    }
}

/// Where there is no tray to put an icon in: the same shape, doing
/// nothing, so that nothing above it needs to know which system it is on.
#[cfg(not(windows))]
mod held {
    use super::{Picked, Shown};

    /// No icon: there is no tray for one on this system yet.
    #[derive(Debug)]
    pub(crate) struct Tray {
        picked: async_channel::Receiver<Picked>,
    }

    impl Tray {
        /// # Errors
        ///
        /// Always: there is no tray to put an icon in here.
        pub(crate) fn new(_: Shown) -> Result<Self, String> {
            Err("There is no tray to put an icon in on this system yet".to_owned())
        }

        /// Where what is picked in the tray would be said.
        pub(crate) fn picked(&self) -> async_channel::Receiver<Picked> {
            self.picked.clone()
        }

        /// Nothing to show it on.
        pub(crate) fn show(&mut self, _: Shown) {}
    }
}

#[cfg(windows)]
mod held {
    use tray_icon::TrayIconEvent;
    use tray_icon::menu::PredefinedMenuItem;
    use tray_icon::menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuId, MenuItem};
    use tray_icon::{Icon, MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder};

    use super::{Entry, Picked, Picture, Row, Shown, TOOLTIP};

    /// An entry of the menu, held to change what it shows.
    enum Item {
        Plain(MenuItem),
        Ticked(CheckMenuItem),
    }

    impl Item {
        fn new(entry: &Entry) -> Self {
            match entry.ticked {
                Some(ticked) => {
                    Self::Ticked(CheckMenuItem::new(entry.label, entry.enabled, ticked, None))
                }
                None => Self::Plain(MenuItem::new(entry.label, entry.enabled, None)),
            }
        }

        fn id(&self) -> &MenuId {
            match self {
                Self::Plain(item) => item.id(),
                Self::Ticked(item) => item.id(),
            }
        }

        fn as_menu_item(&self) -> &dyn IsMenuItem {
            match self {
                Self::Plain(item) => item,
                Self::Ticked(item) => item,
            }
        }

        fn show(&self, entry: &Entry) {
            match self {
                Self::Plain(item) => item.set_enabled(entry.enabled),
                Self::Ticked(item) => {
                    item.set_enabled(entry.enabled);
                    item.set_checked(entry.ticked.unwrap_or_default());
                }
            }
        }
    }

    /// The icon in the tray. Dropping it takes the icon out.
    pub(crate) struct Tray {
        icon: TrayIcon,
        /// The menu's entries, in the order [`Shown::menu`] lists them.
        items: Vec<Item>,
        still: Icon,
        talking: Icon,
        shown: Shown,
        picked: async_channel::Receiver<Picked>,
    }

    impl std::fmt::Debug for Tray {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("Tray")
                .field("shown", &self.shown)
                .finish_non_exhaustive()
        }
    }

    impl Tray {
        /// The icon in the tray, showing `shown`, on the thread that runs
        /// the window: the system tells the thread that made the icon what
        /// was done with it.
        ///
        /// # Errors
        ///
        /// When the system takes no icon.
        pub(crate) fn new(shown: Shown) -> Result<Self, String> {
            let icon = |picture: Picture| {
                Icon::from_rgba(picture.image.into_raw(), super::SIDE, super::SIDE)
                    .map_err(|error| error.to_string())
            };
            let (still, talking) = (icon(Picture::still()?)?, icon(Picture::talking()?)?);
            let menu = Menu::new();
            let mut items = Vec::new();
            let mut table = Vec::new();
            for row in shown.menu() {
                let added = match row {
                    Row::Rule => menu.append(&PredefinedMenuItem::separator()),
                    Row::Entry(entry) => {
                        let item = Item::new(&entry);
                        table.push((item.id().clone(), entry.picks));
                        let added = menu.append(item.as_menu_item());
                        items.push(item);
                        added
                    }
                };
                added.map_err(|error| error.to_string())?;
            }
            let picked = Self::hear(table);
            let icon = TrayIconBuilder::new()
                .with_icon(if shown.talking { &talking } else { &still }.clone())
                .with_tooltip(TOOLTIP)
                .with_menu(Box::new(menu))
                .with_menu_on_left_click(false)
                .build()
                .map_err(|error| error.to_string())?;
            // Where the system put it: none, if it did not take it.
            tracing::info!(rect = ?icon.rect(), "put an icon in the tray");
            Ok(Self {
                icon,
                items,
                still,
                talking,
                shown,
                picked,
            })
        }

        /// Have the system say what is picked, by the menu's `table` of
        /// which entry picks what. One hearing per process, kept for its
        /// life: there is one icon.
        fn hear(table: Vec<(MenuId, Picked)>) -> async_channel::Receiver<Picked> {
            let (said, picked) = async_channel::unbounded();
            let clicked = said.clone();
            MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
                if let Some((_, picks)) = table.iter().find(|(id, _)| *id == event.id) {
                    let _ = said.try_send(*picks);
                }
            }));
            TrayIconEvent::set_event_handler(Some(move |event: TrayIconEvent| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let _ = clicked.try_send(Picked::Show);
                }
            }));
            picked
        }

        /// Where what is picked in the tray is said.
        pub(crate) fn picked(&self) -> async_channel::Receiver<Picked> {
            self.picked.clone()
        }

        /// Show `shown`. The menu is set every time: the system ticks an
        /// entry itself when it is picked, before the engine has done
        /// anything, and that is put back here.
        pub(crate) fn show(&mut self, shown: Shown) {
            let entries = shown.menu().into_iter().filter_map(|row| match row {
                Row::Entry(entry) => Some(entry),
                Row::Rule => None,
            });
            for (item, entry) in self.items.iter().zip(entries) {
                item.show(&entry);
            }
            if shown.talking != self.shown.talking {
                let face = if shown.talking {
                    &self.talking
                } else {
                    &self.still
                };
                if let Err(error) = self.icon.set_icon(Some(face.clone())) {
                    tracing::warn!(%error, "the tray icon could not be changed");
                }
            }
            self.shown = shown;
        }
    }

    impl Drop for Tray {
        fn drop(&mut self) {
            tracing::info!("took the icon out of the tray");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_icon_is_put_in_the_tray_with_the_real_engine_unless_told() {
        assert!(wanted(None, true));
        assert!(!wanted(None, false));
        assert!(!wanted(Some("off"), true));
        assert!(wanted(Some("on"), false));
        // Anything else is not an answer.
        assert!(wanted(Some("yes"), true));
        assert!(!wanted(Some("yes"), false));
    }

    #[test]
    fn the_menu_is_the_web_clients_and_follows_what_is_shown() {
        let entries = |shown: Shown| {
            shown
                .menu()
                .into_iter()
                .map(|row| match row {
                    Row::Entry(entry) => (entry.label, entry.enabled, entry.ticked),
                    Row::Rule => ("-", true, None),
                })
                .collect::<Vec<_>>()
        };
        // Not on a server: only showing the window and quitting.
        assert_eq!(
            entries(Shown::default()),
            [
                ("Mute", false, Some(false)),
                ("Deafen", false, Some(false)),
                ("-", true, None),
                ("Disconnect", false, None),
                ("-", true, None),
                ("Show Window", true, None),
                ("Quit", true, None),
            ]
        );
        let on = Shown {
            connected: true,
            muted: true,
            deafened: false,
            talking: false,
        };
        assert_eq!(
            entries(on)[..4],
            [
                ("Mute", true, Some(true)),
                ("Deafen", true, Some(false)),
                ("-", true, None),
                ("Disconnect", true, None),
            ]
        );
        let deaf = Shown {
            deafened: true,
            ..on
        };
        assert_eq!(entries(deaf)[1], ("Deafen", true, Some(true)));
        // Each entry picks its own thing.
        let picks: Vec<Picked> = on
            .menu()
            .into_iter()
            .filter_map(|row| match row {
                Row::Entry(entry) => Some(entry.picks),
                Row::Rule => None,
            })
            .collect();
        assert_eq!(
            picks,
            [
                Picked::Mute,
                Picked::Deafen,
                Picked::Disconnect,
                Picked::Show,
                Picked::Quit
            ]
        );
    }

    #[test]
    fn talking_puts_a_green_dot_in_the_icons_corner() {
        let (still, talking) = (
            Picture::still().expect("the icon"),
            Picture::talking().expect("the icon"),
        );
        assert_eq!(still.image.dimensions(), (SIDE, SIDE));
        assert_eq!(talking.image.dimensions(), (SIDE, SIDE));
        // The dot's middle is green.
        let image::Rgba([r, g, b, a]) = *talking.image.get_pixel(SIDE * 4 / 5, SIDE * 4 / 5);
        assert!(g > 150 && r < 120 && b < 120 && a == 255, "{r} {g} {b} {a}");
        // Away from the corner the icon is as it was.
        assert_eq!(
            still.image.get_pixel(SIDE / 3, SIDE / 3),
            talking.image.get_pixel(SIDE / 3, SIDE / 3)
        );
        assert_ne!(still, talking);
    }
}
