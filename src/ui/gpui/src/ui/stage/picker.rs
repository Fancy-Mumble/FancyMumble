//! Choosing what to share (`ScreenSharePickerDialog.tsx`): screens, windows
//! and cameras in tabs, each with a small picture of it; a screen or window
//! and a camera may go together. The quality under it: SD, HD or as large
//! as it is, and the stream mode's presets, size and rate, and whether what
//! the computer plays goes too.

use std::collections::HashMap;
use std::sync::Arc;

use gpui::{
    AnyElement, ClickEvent, Context, IntoElement, ParentElement, SharedString, Styled, Task, div,
    img, prelude::*, px,
};

use super::super::Shell;
use super::super::kit::{Button, Dialog, Emphasis, Reachable, Segmented, SwitchRow, icon};
use crate::share::{Media, Quality, Settings, Source, SourceKind};
use crate::theme::Theme;
use crate::words::t;

/// The picker, open.
pub(crate) struct Picker {
    pub tab: SourceKind,
    /// What can be shared; `None` while it is asked for.
    pub sources: Option<Result<Vec<Source>, String>>,
    pub thumbnails: HashMap<(SourceKind, u32), Arc<gpui::Image>>,
    /// The screen or window picked, and the camera.
    pub display: Option<Source>,
    pub device: Option<Source>,
    pub settings: Settings,
    /// Whether the stream mode's settings are out.
    pub mode_open: bool,
    /// Whether what is offered is the test pattern.
    pub made_up: bool,
    _listing: Task<()>,
}

impl std::fmt::Debug for Picker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Picker")
            .field("tab", &self.tab)
            .field("display", &self.display)
            .field("device", &self.device)
            .finish_non_exhaustive()
    }
}

impl Picker {
    /// The picker, asking `media` what there is to share and then for a
    /// small picture of each, one at a time. `seeded` is what is shared
    /// now, to change.
    pub(crate) fn open(
        media: Arc<dyn Media>,
        seeded: Option<(Vec<Source>, Settings)>,
        cx: &mut Context<Shell>,
    ) -> Self {
        let made_up = media.made_up();
        let listing = cx.spawn(async move |shell, cx| {
            let lister = Arc::clone(&media);
            let sources = cx.background_executor().spawn(async move { lister.sources() }).await;
            let listed = sources.clone().unwrap_or_default();
            let taken = shell.update(cx, |shell, cx| {
                if let Some(picker) = shell.stage.picker.as_mut() {
                    picker.sources = Some(sources);
                }
                cx.notify();
            });
            if taken.is_err() {
                return;
            }
            read_thumbnails(&shell, &media, listed, cx).await;
        });
        let (sources, settings) = seeded.unwrap_or_default();
        Self {
            tab: SourceKind::Screen,
            sources: None,
            thumbnails: HashMap::new(),
            display: sources.iter().find(|s| s.kind != SourceKind::Device).cloned(),
            device: sources.iter().find(|s| s.kind == SourceKind::Device).cloned(),
            settings,
            mode_open: false,
            made_up,
            _listing: listing,
        }
    }

    /// What is picked, the screen or window first: its track comes first.
    pub(crate) fn picked(&self) -> Vec<Source> {
        self.display.iter().chain(self.device.iter()).cloned().collect()
    }

    /// Pick `source`, or put it back if it was picked.
    pub(crate) fn toggle(&mut self, source: &Source) {
        let slot = if source.kind == SourceKind::Device {
            &mut self.device
        } else {
            &mut self.display
        };
        *slot = if slot.as_ref() == Some(source) {
            None
        } else {
            Some(source.clone())
        };
    }
}

/// Ask `media` for a small picture of each of `listed`, one at a time, and
/// put each in the picker as it comes; stop when the picker is closed.
async fn read_thumbnails(
    shell: &gpui::WeakEntity<Shell>,
    media: &Arc<dyn Media>,
    listed: Vec<Source>,
    cx: &mut gpui::AsyncApp,
) {
    for source in listed {
        let media = Arc::clone(media);
        let asked = source.clone();
        let thumbnail = cx
            .background_executor()
            .spawn(async move { media.thumbnail(&asked) })
            .await;
        let kept = shell.update(cx, |shell, cx| {
            let Some(picker) = shell.stage.picker.as_mut() else {
                return false;
            };
            if let Some(thumbnail) = thumbnail {
                let _ = picker.thumbnails.insert((source.kind, source.id), thumbnail);
            }
            cx.notify();
            true
        });
        if !kept.unwrap_or(false) {
            break;
        }
    }
}

const TABS: [SourceKind; 3] = [SourceKind::Screen, SourceKind::Window, SourceKind::Device];

/// The picker over the window.
pub(super) fn render(picker: &Picker, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let tab = TABS.iter().position(|kind| *kind == picker.tab).unwrap_or(0);
    let tabs = Segmented::new("share-tab", [t!("Entire Screen"), t!("Window"), t!("Device")], tab)
        .on_choose(cx.listener(|shell, at: &usize, _, cx| {
            if let Some(picker) = shell.stage.picker.as_mut() {
                picker.tab = TABS[*at];
            }
            cx.notify();
        }));
    Dialog::new("share-picker")
        .title(t!("Choose what to share"))
        .w(px(760.0))
        .max_w(gpui::relative(0.94))
        .p(px(20.0))
        .gap(px(14.0))
        .on_dismiss(cx.listener(|shell, _, _, cx| shell.close_share_picker(cx)))
        .child(tabs)
        .when(picker.made_up, |dialog| {
            dialog.child(
                div()
                    .text_size(px(12.0))
                    .text_color(theme.c.muted)
                    .child(t!("This computer's screens are not offered in this run: the test pattern is.")),
            )
        })
        .child(grid(picker, theme, cx))
        .children(chosen(picker, theme))
        .child(footer(picker, theme, cx))
        .when(picker.mode_open, |dialog| dialog.child(mode(picker, cx)))
        .into_any_element()
}

/// The sources of the tab that is open, two to a row.
fn grid(picker: &Picker, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let said = |words: SharedString| {
        div()
            .h(px(200.0))
            .flex()
            .items_center()
            .justify_center()
            .text_color(theme.c.muted)
            .child(words)
            .into_any_element()
    };
    let sources = match &picker.sources {
        None => return said(t!("Finding your screens and windows…")),
        Some(Err(why)) => return said(t!("Could not list screens and windows: {{detail}}", detail = why)),
        Some(Ok(sources)) => sources,
    };
    let of_tab: Vec<&Source> = sources.iter().filter(|source| source.kind == picker.tab).collect();
    if of_tab.is_empty() {
        return said(if picker.tab == SourceKind::Device {
            t!("No camera found.")
        } else {
            t!("Nothing available to share here.")
        });
    }
    let cards: Vec<AnyElement> = of_tab
        .into_iter()
        .enumerate()
        .map(|(at, source)| card(picker, source, at, theme, cx))
        .collect();
    crate::ui::kit::ScrollArea::div("share-sources", div()
        .id("share-sources")
        .max_h(px(420.0))
        .overflow_y_scroll()
        .grid()
        .grid_cols(2)
        .gap(px(10.0))
        .children(cards))
        .into_any_element()
}

/// One source: its picture, its kind and its title.
fn card(picker: &Picker, source: &Source, at: usize, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let picked = picker.display.as_ref() == Some(source) || picker.device.as_ref() == Some(source);
    let glyph = match source.kind {
        SourceKind::Screen => "monitor",
        SourceKind::Window => "app-window",
        SourceKind::Device => "webcam",
    };
    let thumbnail = picker.thumbnails.get(&(source.kind, source.id)).cloned();
    let chosen = source.clone();
    let picture = div()
        .w_full()
        .h(px(180.0))
        .rounded(theme.skin.radius_md)
        .bg(gpui::hsla(0.6, 0.3, 0.04, 1.0))
        .overflow_hidden()
        .flex()
        .items_center()
        .justify_center()
        .map(|well| match thumbnail {
            Some(thumbnail) => well.child(
                img(crate::pictures::shown(&thumbnail, crate::pictures::Fit::Tile))
                    .size_full()
                    .object_fit(gpui::ObjectFit::Contain),
            ),
            None => well.child(icon(glyph, 32.0, theme.c.dim)),
        });
    let card = div()
        .id(("share-source", at))
        .debug_selector(move || format!("share-source-{at}"))
        .flex()
        .flex_col()
        .gap(px(6.0))
        .p(px(6.0))
        .rounded(theme.skin.radius_lg)
        .border_2()
        .border_color(if picked { theme.c.accent } else { theme.c.line })
        .cursor_pointer()
        .hover(|style| style.bg(theme.c.hover))
        .on_click(cx.listener(move |shell, event: &ClickEvent, _, cx| {
            shell.pick_source(&chosen, event.click_count() >= 2, cx);
        }))
        .child(picture)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .text_size(px(12.5))
                .child(icon(glyph, 13.0, theme.c.muted))
                .child(div().min_w_0().truncate().child(source.title.clone())),
        );
    Reachable::new(("share-source", at), card).into_any_element()
}

/// What is picked, said under the grid.
fn chosen(picker: &Picker, theme: &Theme) -> Option<AnyElement> {
    let picked = picker.picked();
    if picked.is_empty() {
        return None;
    }
    let names: Vec<SharedString> = picked.iter().map(|source| source.title.clone()).collect();
    let hint = match (&picker.display, &picker.device) {
        (Some(_), None) => Some(t!("Tip: add a camera from the Device tab to share both")),
        (None, Some(_)) => Some(t!("Tip: add a screen or window to share both")),
        _ => None,
    };
    Some(
        div()
            .debug_selector(|| "share-chosen".to_owned())
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(8.0))
            .text_size(px(12.0))
            .child(div().text_color(theme.c.muted).child(t!("Sharing:")))
            .children(names.into_iter().map(|name| {
                div()
                    .px(px(8.0))
                    .py(px(2.0))
                    .rounded(theme.skin.radius_pill)
                    .bg(theme.c.card2)
                    .child(name)
            }))
            .children(hint.map(|hint| div().text_color(theme.c.dim).child(hint)))
            .into_any_element(),
    )
}

/// The quality, the stream mode, and the way out.
fn footer(picker: &Picker, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    const PRESETS: [Quality; 3] = [Quality::SD, Quality::HD, Quality::SOURCE];
    let preset = PRESETS.iter().position(|quality| *quality == picker.settings.quality);
    let count = picker.picked().len();
    let share_words = if count == 2 { t!("Share both") } else { t!("Share") };
    div()
        .flex()
        .items_center()
        .gap(px(10.0))
        .child(
            Segmented::new("share-quality", ["SD", "HD", "Source"], preset.unwrap_or(usize::MAX))
                .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                    if let Some(picker) = shell.stage.picker.as_mut() {
                        picker.settings.quality = PRESETS[*at];
                    }
                    cx.notify();
                })),
        )
        .child(
            Button::new("share-mode", t!("Stream Mode"))
                .start_icon("settings-2")
                .on_click(cx.listener(|shell, _, _, cx| {
                    if let Some(picker) = shell.stage.picker.as_mut() {
                        picker.mode_open = !picker.mode_open;
                    }
                    cx.notify();
                })),
        )
        .child(div().flex_1())
        .child(div().text_size(px(11.0)).text_color(theme.c.dim).child(format!(
            "{} · {} fps",
            Quality::size_name(picker.settings.quality.longest),
            picker.settings.quality.fps
        )))
        .child(
            Button::new("share-cancel", t!("Cancel"))
                .on_click(cx.listener(|shell, _, _, cx| shell.close_share_picker(cx))),
        )
        .child(
            Button::new("share-confirm", share_words)
                .emphasis(Emphasis::Contained)
                .on_click(cx.listener(|shell, _, _, cx| shell.confirm_share_picker(cx))),
        )
        .into_any_element()
}

/// The stream mode: the presets for smooth motion and for text, the size
/// and rate one by one, and what the computer plays.
fn mode(picker: &Picker, cx: &mut Context<Shell>) -> AnyElement {
    let quality = picker.settings.quality;
    let presets = [Quality::GAMING, Quality::TEXT];
    let preset = presets.iter().position(|each| *each == quality);
    let size = Quality::SIZES.iter().position(|each| *each == quality.longest);
    let rate = Quality::RATES.iter().position(|each| *each == quality.fps);
    div()
        .debug_selector(|| "share-mode-settings".to_owned())
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            Segmented::new("share-preset", [t!("Gaming"), t!("Screenshare")], preset.unwrap_or(usize::MAX))
                .on_choose(set(cx, |quality, at| *quality = [Quality::GAMING, Quality::TEXT][at])),
        )
        .child(
            Segmented::new(
                "share-size",
                Quality::SIZES.map(Quality::size_name),
                size.unwrap_or(usize::MAX),
            )
            .on_choose(set(cx, |quality, at| quality.longest = Quality::SIZES[at])),
        )
        .child(
            Segmented::new(
                "share-rate",
                Quality::RATES.map(|fps| format!("{fps} fps")),
                rate.unwrap_or(usize::MAX),
            )
            .on_choose(set(cx, |quality, at| quality.fps = Quality::RATES[at])),
        )
        .child(
            SwitchRow::new("share-audio", t!("Share Stream Audio"), picker.settings.audio).on_click(
                cx.listener(|shell, _, _, cx| {
                    if let Some(picker) = shell.stage.picker.as_mut() {
                        picker.settings.audio = !picker.settings.audio && !picker.made_up;
                    }
                    cx.notify();
                }),
            ),
        )
        .into_any_element()
}

/// What choosing on one of the stream mode's rows does to the quality.
fn set(
    cx: &mut Context<Shell>,
    change: fn(&mut Quality, usize),
) -> impl Fn(&usize, &mut gpui::Window, &mut gpui::App) + 'static {
    cx.listener(move |shell: &mut Shell, at: &usize, _, cx| {
        if let Some(picker) = shell.stage.picker.as_mut() {
            change(&mut picker.settings.quality, *at);
        }
        cx.notify();
    })
}

impl Shell {
    /// A source was clicked: picked, or put back; twice, shared at once.
    fn pick_source(&mut self, source: &Source, at_once: bool, cx: &mut Context<Self>) {
        let Some(picker) = self.stage.picker.as_mut() else {
            return;
        };
        if at_once {
            let slot = if source.kind == SourceKind::Device {
                &mut picker.device
            } else {
                &mut picker.display
            };
            *slot = Some(source.clone());
            self.confirm_share_picker(cx);
            return;
        }
        picker.toggle(source);
        cx.notify();
    }

    /// Share what is picked.
    pub(super) fn confirm_share_picker(&mut self, cx: &mut Context<Self>) {
        let Some(picker) = self.stage.picker.as_ref() else {
            return;
        };
        let picked = picker.picked();
        if picked.is_empty() {
            return;
        }
        let settings = picker.settings;
        self.start_share(picked, settings, cx);
    }

    pub(super) fn close_share_picker(&mut self, cx: &mut Context<Self>) {
        self.stage.picker = None;
        cx.notify();
    }
}
