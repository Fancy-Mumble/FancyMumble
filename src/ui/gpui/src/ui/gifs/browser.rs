//! The GIF browser over the composer, as the web client's
//! (`GifBrowser.tsx` in a `GifPopover`): a search row, the shortcuts
//! (trending and two searches) while nothing is typed, a grid of two
//! columns, and the provider credited at its foot.
//!
//! Only the rows in view are built, so only the previews in view are
//! fetched and read; each plays a frame at a time (`crate::pictures`) and
//! stops being read the moment it is not drawn. What is typed is searched
//! for once typing has paused, and an answer to an older question is
//! dropped.

use std::rc::Rc;
use std::time::Duration;

use gpui::Focusable as _;
use gpui::{
    AnyElement, Context, Entity, IntoElement, ParentElement, Pixels, Point, ScrollStrategy,
    SharedString, Styled, Subscription, UniformListScrollHandle, Window, div, prelude::*, px,
    uniform_list,
};

use super::super::Shell;
use super::super::embeds::{Showing, Want};
use super::super::kit::{IconButton, Reachable, Sheet, Way, icon, walk};
use super::super::text_input::{InputEvent, TextInput};
use crate::gif::{Answer, CATEGORIES, Gif, Plan};
use crate::pictures::{Fit, shown};
use crate::theme::Theme;
use crate::words::t;

/// How long typing must pause before what is typed is searched for.
pub(in crate::ui) const PAUSE: Duration = Duration::from_millis(350);
/// The browser's width, the grid's most height, and a tile's height.
const WIDTH: f32 = 400.0;
const GRID_MOST: f32 = 300.0;
const TILE: f32 = 104.0;
/// The gap between tiles, and round the grid.
const GAP: f32 = 8.0;
const INSET: f32 = 12.0;

/// Where the browser's list stands.
#[derive(Debug, Clone, PartialEq, Eq)]
enum State {
    Loading,
    Ready,
    Failed(SharedString),
}

/// The browser's own state.
pub(super) struct Browser {
    plan: Rc<Plan>,
    search: Entity<TextInput>,
    _typing: Subscription,
    /// The shortcut chosen, by its place in [`CATEGORIES`].
    tab: usize,
    gifs: Vec<Gif>,
    /// The page asked for next, and whether there is one.
    next_page: u32,
    has_next: bool,
    state: State,
    /// Whether a further page is on its way.
    more_coming: bool,
    /// The last question asked: an answer to any other is dropped.
    asked: u64,
    scroll: UniformListScrollHandle,
    /// Where the chip that opened it was pressed: it stands above that.
    anchor: Point<Pixels>,
    /// The previews fetched while it was open: let go of when it closes.
    pub(super) previews: Vec<SharedString>,
    /// What it was opened for.
    pub(super) purpose: super::For,
}

impl Browser {
    /// What is being looked for: what is typed, else the shortcut's search;
    /// nothing for trending.
    fn words(&self, cx: &gpui::App) -> String {
        let typed = self.search.read(cx).text().trim().to_owned();
        if !typed.is_empty() || self.tab == 0 {
            return typed;
        }
        CATEGORIES[self.tab].to_owned()
    }

    /// Whether something is typed.
    fn typing(&self, cx: &gpui::App) -> bool {
        !self.search.read(cx).text().trim().is_empty()
    }

    /// The rows of the grid, two tiles to a row.
    fn rows(&self) -> usize {
        self.gifs.len().div_ceil(2)
    }
}

impl Shell {
    /// Open the browser, standing above `anchor`, on what is trending, its
    /// search field ready to be typed in. Nothing happens where GIFs cannot
    /// be had.
    pub(in crate::ui) fn open_gifs(
        &mut self,
        anchor: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(plan) = self.gif_plan() else {
            return;
        };
        let search = cx.new(|cx| TextInput::new(t!("Search GIFs"), cx));
        let typing = cx.subscribe_in(&search, window, |shell, _, event, window, cx| {
            shell.on_gif_search(event, window, cx);
        });
        window.focus(&search.focus_handle(cx), cx);
        self.panels.gifs.browser = Some(Browser {
            plan: Rc::new(plan),
            search,
            _typing: typing,
            tab: 0,
            gifs: Vec::new(),
            next_page: 1,
            has_next: false,
            state: State::Loading,
            more_coming: false,
            asked: 0,
            scroll: UniformListScrollHandle::new(),
            anchor,
            previews: Vec::new(),
            purpose: super::For::Composer,
        });
        self.ask_gifs(true, cx);
    }

    /// What the search field said.
    fn on_gif_search(&mut self, event: &InputEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            InputEvent::Changed => self.search_gifs_soon(cx),
            InputEvent::Submitted(_) => self.ask_gifs(true, cx),
            InputEvent::Cancelled => {
                let _ = self.close_gifs(cx);
            }
            InputEvent::Tabbed { back } => {
                walk(if *back { Way::Back } else { Way::Next }, window, cx);
            }
            InputEvent::PastedPicture(_) | InputEvent::Pick(_) => {}
        }
    }

    /// Search for what is typed once typing has paused.
    fn search_gifs_soon(&mut self, cx: &mut Context<Self>) {
        let Some(browser) = self.panels.gifs.browser.as_mut() else {
            return;
        };
        browser.asked += 1;
        let waiting_for = browser.asked;
        let pause = cx.background_executor().timer(PAUSE);
        cx.spawn(async move |shell, cx| {
            pause.await;
            let _ = shell.update(cx, |shell, cx| {
                let still = shell
                    .panels
                    .gifs
                    .browser
                    .as_ref()
                    .is_some_and(|browser| browser.asked == waiting_for);
                if still {
                    shell.ask_gifs(true, cx);
                }
            });
        })
        .detach();
        cx.notify();
    }

    /// Ask for the first page of what is looked for (`fresh`), or for the
    /// next.
    fn ask_gifs(&mut self, fresh: bool, cx: &mut Context<Self>) {
        let Some(browser) = self.panels.gifs.browser.as_mut() else {
            return;
        };
        let words = browser.words(cx);
        browser.asked += 1;
        let asked = browser.asked;
        let page = if fresh { 1 } else { browser.next_page };
        if fresh {
            browser.state = State::Loading;
            browser.more_coming = false;
        } else {
            browser.more_coming = true;
        }
        let answer = browser.plan.page(&words, page);
        cx.spawn(async move |shell, cx| {
            let answer = answer.await;
            let _ = shell.update(cx, |shell, cx| shell.gifs_came(asked, fresh, answer, cx));
        })
        .detach();
        cx.notify();
    }

    /// The answer to question `asked` came.
    fn gifs_came(&mut self, asked: u64, fresh: bool, answer: Answer, cx: &mut Context<Self>) {
        let Some(browser) = self.panels.gifs.browser.as_mut() else {
            return;
        };
        if browser.asked != asked {
            return;
        }
        browser.more_coming = false;
        match answer {
            Ok(page) => {
                if fresh {
                    browser.gifs = page.gifs;
                    browser.next_page = 2;
                    browser.scroll.scroll_to_item(0, ScrollStrategy::Top);
                } else {
                    browser.gifs.extend(page.gifs);
                    browser.next_page += 1;
                }
                browser.has_next = page.has_next;
                browser.state = State::Ready;
            }
            // A further page that did not come leaves those already here.
            Err(_) if !fresh => browser.has_next = false,
            Err(refused) => {
                tracing::debug!(why = ?refused.why, reason = %refused.reason, "no GIFs");
                browser.gifs.clear();
                browser.state = State::Failed(refused.reason);
            }
        }
        cx.notify();
    }

    /// Go to the shortcut at `tab`.
    fn choose_gif_tab(&mut self, tab: usize, cx: &mut Context<Self>) {
        if let Some(browser) = self.panels.gifs.browser.as_mut() {
            browser.tab = tab;
        }
        self.ask_gifs(true, cx);
    }

    /// The rows of the grid in view: the only previews fetched and read.
    fn gif_rows(
        &mut self,
        range: std::ops::Range<usize>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let theme = crate::theme::ActiveTheme::get(cx);
        let Some(browser) = self.panels.gifs.browser.as_ref() else {
            return Vec::new();
        };
        let wants_more = range.end + 2 >= browser.rows()
            && browser.has_next
            && !browser.more_coming
            && browser.state == State::Ready;
        let rows: Vec<(usize, Vec<(usize, Gif)>)> = range
            .map(|row| {
                let tiles = (row * 2..(row * 2 + 2).min(browser.gifs.len()))
                    .map(|at| (at, browser.gifs[at].clone()))
                    .collect();
                (row, tiles)
            })
            .collect();
        if wants_more {
            self.ask_gifs(false, cx);
        }
        rows.into_iter()
            .map(|(_, tiles)| {
                let tiles: Vec<AnyElement> = tiles
                    .into_iter()
                    .map(|(at, gif)| self.gif_tile(at, &gif, &theme, cx))
                    .collect();
                div()
                    .h(px(TILE + GAP))
                    .pb(px(GAP))
                    .flex()
                    .gap(px(GAP))
                    .children(tiles)
                    .into_any_element()
            })
            .collect()
    }

    /// One preview, a click or Enter away from being sent.
    fn gif_tile(
        &mut self,
        at: usize,
        gif: &Gif,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let preview = gif.preview.clone();
        // The browser opens only where the user agreed to where its
        // pictures come from: they are fetched without asking again.
        if self.panels.embeds.wants(&preview, true) {
            if let Some(browser) = self.panels.gifs.browser.as_mut() {
                browser.previews.push(preview.clone());
            }
            self.fetch_embed(preview.clone(), Want::Picture, cx);
        }
        let picture = match self.panels.embeds.showing(&preview, true) {
            Showing::Picture(picture) => Some(picture),
            _ => None,
        };
        let picked = gif.clone();
        let accent = theme.c.accent_line;
        let control = div()
            .id(("gif-tile", at))
            .debug_selector(move || format!("gif-tile-{at}"))
            .flex_1()
            .h(px(TILE))
            .overflow_hidden()
            .rounded(px(14.0))
            .bg(theme.c.card2)
            .cursor_pointer()
            .hover(move |style| style.border_2().border_color(accent))
            .tooltip(super::super::kit::keyed_tip(
                gif.title.clone(),
                None::<&str>,
            ))
            .on_click(cx.listener(move |shell, _, window, cx| {
                shell.pick_gif(&picked, window, cx);
            }))
            .children(picture.map(|picture| {
                gpui::img(shown(&picture, Fit::Tile))
                    .size_full()
                    .object_fit(gpui::ObjectFit::Cover)
            }));
        Reachable::new(("gif-tile", at), control)
            .corner(px(14.0))
            .into_any_element()
    }
}

/// The browser, standing over the composer, if it is open.
pub(in crate::ui) fn render(
    shell: &Shell,
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    let browser = shell.panels.gifs.browser.as_ref()?;
    let viewport = window.viewport_size();
    // Above the chip, and inside the window.
    let left = (browser.anchor.x - px(24.0))
        .max(px(8.0))
        .min((viewport.width - px(WIDTH + 8.0)).max(px(8.0)));
    let bottom = (viewport.height - browser.anchor.y + px(22.0)).max(px(8.0));
    let typing = browser.typing(cx);
    Some(
        div()
            .id("gif-veil")
            .absolute()
            .size_full()
            .top_0()
            .left_0()
            .on_click(cx.listener(|shell, _, _, cx| {
                let _ = shell.close_gifs(cx);
            }))
            .child(
                Sheet::new("gif-browser")
                    .holds(super::super::kit::Hold::Tab)
                    .absolute()
                    .left(left)
                    .bottom(bottom)
                    .w(px(WIDTH))
                    .flex()
                    .flex_col()
                    .overflow_hidden()
                    .child(head(theme, cx))
                    .child(search_row(browser, theme))
                    .when(!typing, |sheet| sheet.child(tabs(browser.tab, theme, cx)))
                    .child(grid(browser, theme, cx))
                    .child(foot(browser, theme)),
            ),
    )
}

/// The browser's head: what it is, and the way out.
fn head(theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .h(px(40.0))
        .px(px(14.0))
        .flex()
        .items_center()
        .border_b_1()
        .border_color(theme.c.line)
        .child(
            div()
                .flex_1()
                .text_size(px(11.0))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .text_color(theme.c.muted)
                .child("GIF"),
        )
        .child(
            IconButton::new("gif-close", "x")
                .size(24.0)
                .glyph_size(13.0)
                .tip(t!("Close"))
                .on_click(cx.listener(|shell, _, _, cx| {
                    let _ = shell.close_gifs(cx);
                })),
        )
}

/// The search row: a glass and the field, the web's header rather than a
/// boxed field.
fn search_row(browser: &Browser, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .h(px(44.0))
        .px(px(14.0))
        .flex()
        .items_center()
        .gap(px(10.0))
        .border_b_1()
        .border_color(theme.c.line)
        .text_size(px(14.0))
        .child(icon("search", 15.0, theme.c.dim))
        .child(div().flex_1().child(browser.search.clone()))
}

/// The shortcuts, the chosen one lit.
fn tabs(chosen: usize, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let names = [t!("Trending"), t!("Reactions"), t!("Anime")];
    div()
        .flex_none()
        .px(px(12.0))
        .py(px(8.0))
        .flex()
        .gap(px(8.0))
        .border_b_1()
        .border_color(theme.c.line)
        .children(names.into_iter().enumerate().map(|(at, name)| {
            let lit = at == chosen;
            let control = div()
                .id(("gif-tab", at))
                .debug_selector(move || format!("gif-tab-{at}"))
                .h(px(28.0))
                .px(px(14.0))
                .flex()
                .items_center()
                .rounded(theme.skin.radius_pill)
                .text_size(px(13.0))
                .cursor_pointer()
                .when(lit, |tab| {
                    tab.bg(theme.c.accent_soft)
                        .text_color(theme.c.text)
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                })
                .when(!lit, |tab| tab.text_color(theme.c.muted))
                .on_click(cx.listener(move |shell, _, _, cx| shell.choose_gif_tab(at, cx)))
                .child(name);
            Reachable::new(("gif-tab", at), control).corner(theme.skin.radius_pill)
        }))
}

/// The grid of previews, or what stands for it.
fn grid(browser: &Browser, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let said = match &browser.state {
        State::Loading => Some(t!("Loading GIFs…")),
        State::Failed(_) => Some(t!("GIFs could not be loaded.")),
        State::Ready if browser.gifs.is_empty() => Some(t!("No GIFs found.")),
        State::Ready => None,
    };
    if let Some(said) = said {
        return div()
            .debug_selector(|| "gif-said".to_owned())
            .flex_none()
            .px(px(INSET))
            .py(px(20.0))
            .text_size(px(13.0))
            .text_color(theme.c.muted)
            .child(said)
            .into_any_element();
    }
    #[expect(clippy::cast_precision_loss, reason = "a few hundred rows at most")]
    let tall = browser.rows() as f32 * (TILE + GAP);
    let rows = uniform_list("gif-rows", browser.rows(), cx.processor(Shell::gif_rows))
        .flex_none()
        .h(px(tall.min(GRID_MOST)))
        .px(px(INSET))
        .pt(px(INSET));
    super::super::kit::ScrollArea::uniform("gif-rows", Some(&browser.scroll), rows).into_any_element()
}

/// The foot: how a GIF is sent, and who found it.
fn foot(browser: &Browser, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .min_h(px(34.0))
        .px(px(14.0))
        .flex()
        .items_center()
        .border_t_1()
        .border_color(theme.c.line)
        .text_size(px(11.0))
        .text_color(theme.c.muted)
        .child(
            div()
                .flex_1()
                .child(t!("Click a GIF, or Enter on it, to send it")),
        )
        .child(
            div()
                .debug_selector(|| "gif-provider".to_owned())
                .child(browser.plan.provider.clone()),
        )
}
