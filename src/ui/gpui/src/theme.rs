//! The thirteen themes, in both modes.
//!
//! The colours and shapes are not written here. They come from
//! `assets/themes.json`, which the web UI generates from its own catalogue
//! (`nebula/themeCatalog.ts`, resolved by `themeScheme.ts`) and a test there
//! keeps current, so the two views cannot drift apart.
//!
//! What this view leaves out is what costs the most to draw: backdrop blur
//! and clip paths. The window's mesh and the conversation's backdrop are
//! drawn once into a small picture and stretched (see `paint`), and chrome
//! the web UI draws as glass over them is drawn as the same colour over
//! them, unblurred: a blurred gradient is the gradient.

use std::sync::Arc;

use gpui::{App, FontWeight, Global, Hsla, Pixels, Rgba, SharedString, px};
use serde::Deserialize;

use crate::paint::Paint;

/// The generated table: every theme, both modes, already resolved.
const TABLE: &str = include_str!("../assets/themes.json");

/// The theme a profile with no stored choice opens in.
pub(crate) const DEFAULT_THEME: &str = "dark";

/// Light or dark. Every theme is drawn in both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    /// On a light window.
    Light,
    /// On a dark window.
    Dark,
}

impl Mode {
    /// The other mode.
    pub(crate) fn toggled(self) -> Self {
        match self {
            Self::Light => Self::Dark,
            Self::Dark => Self::Light,
        }
    }
}

/// How a theme marks the selected row, or a message the user sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Fill {
    /// A translucent accent under an accent edge.
    Wash,
    /// The accent itself, with the ink that reads on it.
    Solid,
}

/// The colours one theme paints with in one mode.
#[derive(Debug, Clone)]
pub(crate) struct Colors {
    /// The window, under everything.
    pub bg0: Hsla,
    /// The title band and its three text rungs.
    pub bar: Hsla,
    pub bar_text: Hsla,
    pub bar_dim: Hsla,
    /// The channel column.
    pub panel: Hsla,
    /// The channel header and the composer chrome.
    pub header: Hsla,
    /// The server rail and what is drawn on it.
    pub rail: Hsla,
    pub rail_dim: Hsla,
    /// A raised surface, and its edge.
    pub card: Hsla,
    /// Chips, badges, the keyboard hint.
    pub card2: Hsla,
    /// Search box and composer fill.
    pub input: Hsla,
    /// The section rule, and the stronger card edge.
    pub line: Hsla,
    pub line2: Hsla,
    /// The window's own outline, where the theme draws one.
    pub window_line: Option<Hsla>,
    /// What a row is washed with under the pointer.
    pub hover: Hsla,
    /// The three text rungs.
    pub text: Hsla,
    pub muted: Hsla,
    pub dim: Hsla,
    /// The accent as a fill, as a foreground, and the ink on it.
    pub accent: Hsla,
    pub accent_text: Hsla,
    pub on_accent: Hsla,
    pub accent_soft: Hsla,
    pub accent_line: Hsla,
    /// Presence, destructive, and a mark that wants noticing.
    pub ok: Hsla,
    pub bad: Hsla,
    pub warn: Hsla,
    /// The conversation's ground, under its backdrop.
    pub canvas_b: Hsla,
    /// The gradients behind the whole window, behind the conversation, and
    /// on whatever floats over either: a menu, a dialog.
    pub window: Arc<Paint>,
    pub backdrop: Arc<Paint>,
    pub tint: Arc<Paint>,
    /// The shadow a floating surface casts.
    pub shadow: Shadow,
}

/// A shadow as CSS writes one: how far down, how blurred, what colour.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Shadow {
    pub drop: f32,
    pub blur: f32,
    pub color: Hsla,
}

impl Shadow {
    /// Read `0 <drop>px <blur>px <colour>`; anything else casts nothing.
    fn parse(css: &str) -> Self {
        let nothing = Self {
            drop: 0.0,
            blur: 0.0,
            color: gpui::transparent_black(),
        };
        let mut parts = css.trim().splitn(4, ' ');
        let (Some(_), Some(drop), Some(blur), Some(ink)) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return nothing;
        };
        let length = |value: &str| value.trim_end_matches("px").parse::<f32>().ok();
        match (length(drop), length(blur)) {
            (Some(drop), Some(blur)) => Self {
                drop,
                blur,
                color: color(ink),
            },
            _ => nothing,
        }
    }

    /// This shadow for the renderer, which takes a blur as its deviation:
    /// half of what CSS calls the blur.
    pub(crate) fn cast(self) -> Vec<gpui::BoxShadow> {
        vec![gpui::BoxShadow {
            color: self.color,
            offset: gpui::point(px(0.0), px(self.drop)),
            blur_radius: px(self.blur / 2.0),
            spread_radius: px(0.0),
        }]
    }
}

/// Everything about a theme that is not a colour.
#[derive(Debug, Clone)]
pub(crate) struct Skin {
    /// The first family of the theme's stack that this system has.
    pub font: SharedString,
    /// Whether the theme sets its labels in capitals.
    pub caps: bool,
    /// Base weight for body copy and rows.
    pub weight: FontWeight,
    /// Corners, from inset detail up to the window.
    pub radius_sm: Pixels,
    pub radius_md: Pixels,
    pub radius_lg: Pixels,
    pub radius_xl: Pixels,
    pub radius_rail: Pixels,
    pub radius_pill: Pixels,
    /// Avatar corner, or `None` for a full circle.
    pub radius_avatar: Option<Pixels>,
    /// Hairline weight.
    pub line_width: Pixels,
    /// How the selected channel row is drawn.
    pub selection: Fill,
    /// How a message the user sent is drawn.
    pub bubble_own: Fill,
    /// The three fixed measures of the shell.
    pub rail_width: Pixels,
    pub column_width: Pixels,
    pub header_height: Pixels,
    /// Air between one person's messages and the next person's, and within
    /// one person's run.
    pub message_gap: Pixels,
    pub message_run_gap: Pixels,
    /// Whether the theme draws the band across the top of the window.
    pub band: bool,
}

/// One theme in one mode: what the view paints with.
#[derive(Debug, Clone)]
pub(crate) struct Theme {
    /// The catalogue id, e.g. `midnight-pretenders`.
    pub id: SharedString,
    pub mode: Mode,
    pub c: Colors,
    pub skin: Skin,
}

/// The theme the application is drawn in, shared by every view.
#[derive(Debug, Clone)]
pub(crate) struct ActiveTheme(pub Arc<Theme>);

impl Global for ActiveTheme {}

impl ActiveTheme {
    /// The theme in force.
    pub(crate) fn get(cx: &App) -> Arc<Theme> {
        Arc::clone(&cx.global::<Self>().0)
    }

    /// Switch to `id` in `mode` and repaint every window. An id the
    /// catalogue does not have changes nothing.
    pub(crate) fn set(id: &str, mode: Mode, cx: &mut App) {
        let fonts = cx.text_system().all_font_names();
        if let Some(theme) = Catalog::get().resolve(id, mode, &fonts) {
            cx.set_global(Self(Arc::new(theme)));
            cx.refresh_windows();
        }
    }
}

/// A theme as the picker lists it.
#[derive(Debug, Clone)]
pub(crate) struct ThemeEntry {
    pub id: SharedString,
    pub name: SharedString,
    /// Window, accent and second hue, in `mode`: enough to tell themes apart.
    pub swatches: [Hsla; 3],
}

/// The generated table, parsed.
#[derive(Debug, Deserialize)]
pub(crate) struct Catalog {
    themes: Vec<RawTheme>,
}

impl Catalog {
    /// The table, parsed on first use and kept: it is 60 KiB of text that
    /// every theme switch would otherwise parse again.
    pub(crate) fn get() -> &'static Self {
        static CATALOG: std::sync::OnceLock<Catalog> = std::sync::OnceLock::new();
        CATALOG.get_or_init(|| {
            serde_json::from_str(TABLE).unwrap_or_else(|error| {
                // The table is generated and checked in; a bad one is a build
                // that should not have shipped. Fall back to no themes, which
                // the caller turns into the built-in emergency palette.
                eprintln!("the theme table could not be read: {error}");
                Self { themes: Vec::new() }
            })
        })
    }

    /// Every theme, in the catalogue's order, with swatches for `mode`.
    pub(crate) fn entries(&self, mode: Mode) -> Vec<ThemeEntry> {
        self.themes
            .iter()
            .map(|theme| {
                let tokens = &theme.mode(mode).tokens;
                ThemeEntry {
                    id: theme.id.clone().into(),
                    name: theme.name.clone().into(),
                    swatches: [
                        color(&tokens.bg0),
                        color(&tokens.accent),
                        color(&tokens.accent2),
                    ],
                }
            })
            .collect()
    }

    /// The id after `id` in the catalogue's order, wrapping round.
    pub(crate) fn next_id(&self, id: &str) -> Option<&str> {
        let at = self.themes.iter().position(|theme| theme.id == id)?;
        self.themes
            .get((at + 1) % self.themes.len())
            .map(|theme| theme.id.as_str())
    }

    /// `id` in `mode`, with its font resolved against `installed_fonts`.
    pub(crate) fn resolve(
        &self,
        id: &str,
        mode: Mode,
        installed_fonts: &[String],
    ) -> Option<Theme> {
        let raw = self.themes.iter().find(|theme| theme.id == id)?;
        let scheme = raw.mode(mode);
        Some(Theme {
            id: raw.id.clone().into(),
            mode,
            c: scheme.colors(),
            skin: raw.skin.resolve(installed_fonts),
        })
    }
}

/// A palette for when the table cannot be read at all, so the window still
/// opens and says so legibly.
pub(crate) fn emergency_theme() -> Theme {
    let ink = color("#e7ecfa");
    let ground = color("#0f1420");
    let raised = color("#182031");
    let accent = color("#7ba1d8");
    Theme {
        id: DEFAULT_THEME.into(),
        mode: Mode::Dark,
        c: Colors {
            bg0: ground,
            bar: ground,
            bar_text: ink,
            bar_dim: ink,
            panel: ground,
            header: raised,
            rail: ground,
            rail_dim: ink,
            card: raised,
            card2: raised,
            input: raised,
            line: raised,
            line2: raised,
            window_line: None,
            hover: raised,
            text: ink,
            muted: ink,
            dim: ink,
            accent,
            accent_text: accent,
            on_accent: ground,
            accent_soft: raised,
            accent_line: accent,
            ok: accent,
            bad: accent,
            warn: accent,
            canvas_b: ground,
            window: Arc::default(),
            backdrop: Arc::default(),
            tint: Arc::default(),
            shadow: Shadow::parse(""),
        },
        skin: RawSkin::default().resolve(&[]),
    }
}

#[derive(Debug, Deserialize)]
struct RawTheme {
    id: String,
    name: String,
    skin: RawSkin,
    light: RawMode,
    dark: RawMode,
}

impl RawTheme {
    fn mode(&self, mode: Mode) -> &RawMode {
        match mode {
            Mode::Light => &self.light,
            Mode::Dark => &self.dark,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawMode {
    tokens: RawTokens,
    canvas_b: String,
}

impl RawMode {
    fn colors(&self) -> Colors {
        let t = &self.tokens;
        Colors {
            bg0: color(&t.bg0),
            bar: color(&t.bar),
            bar_text: color(&t.bar_text),
            bar_dim: color(&t.bar_dim),
            panel: color(&t.panel),
            header: color(&t.header),
            rail: color(&t.rail),
            rail_dim: color(&t.rail_dim),
            card: color(&t.card),
            card2: color(&t.card2),
            input: color(&t.input),
            line: color(&t.line),
            line2: color(&t.line2),
            window_line: (t.window_line != "none").then(|| color(&t.window_line)),
            hover: color(&t.hover),
            text: color(&t.text),
            muted: color(&t.muted),
            dim: color(&t.dim),
            accent: color(&t.accent),
            accent_text: color(&t.accent_text),
            on_accent: color(&t.on_accent),
            accent_soft: color(&t.accent_soft),
            accent_line: color(&t.accent_line),
            ok: color(&t.ok),
            bad: color(&t.bad),
            warn: color(&t.warn),
            canvas_b: color(&self.canvas_b),
            window: Arc::new(Paint::parse(&t.window)),
            backdrop: Arc::new(Paint::parse(&t.backdrop)),
            tint: Arc::new(Paint::parse(&t.tint)),
            shadow: Shadow::parse(&t.shadow),
        }
    }
}

/// The tokens `themeScheme.ts` resolves, by the names it gives them.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTokens {
    bg0: String,
    /// The two gradient stacks, as CSS.
    window: String,
    backdrop: String,
    tint: String,
    shadow: String,
    bar: String,
    bar_text: String,
    bar_dim: String,
    panel: String,
    header: String,
    rail: String,
    rail_dim: String,
    card: String,
    card2: String,
    input: String,
    line: String,
    line2: String,
    window_line: String,
    hover: String,
    text: String,
    muted: String,
    dim: String,
    accent: String,
    accent_text: String,
    accent2: String,
    on_accent: String,
    accent_soft: String,
    accent_line: String,
    ok: String,
    bad: String,
    warn: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawSkin {
    font: String,
    caps: String,
    weight: f32,
    radius_sm: String,
    radius_md: String,
    radius_lg: String,
    radius_xl: String,
    radius_rail: String,
    radius_avatar: String,
    radius_pill: String,
    line_width: String,
    selection: String,
    bubble_own: String,
    rail_width: f32,
    column_width: f32,
    header_height: f32,
    message_gap_px: f32,
    message_run_gap_px: f32,
    chrome_slots: RawChromeSlots,
}

/// The catalogue's own defaults (`DEFAULT_SKIN`), for the emergency theme.
impl Default for RawSkin {
    fn default() -> Self {
        Self {
            font: String::new(),
            caps: "none".to_owned(),
            weight: 400.0,
            radius_sm: "6px".to_owned(),
            radius_md: "10px".to_owned(),
            radius_lg: "14px".to_owned(),
            radius_xl: "14px".to_owned(),
            radius_rail: "10px".to_owned(),
            radius_avatar: "50%".to_owned(),
            radius_pill: "999px".to_owned(),
            line_width: "1px".to_owned(),
            selection: "wash".to_owned(),
            bubble_own: "wash".to_owned(),
            rail_width: 56.0,
            column_width: 290.0,
            header_height: 66.0,
            message_gap_px: 26.0,
            message_run_gap_px: 4.0,
            chrome_slots: RawChromeSlots::default(),
        }
    }
}

impl RawSkin {
    fn resolve(&self, installed_fonts: &[String]) -> Skin {
        Skin {
            font: first_installed(&self.font, installed_fonts),
            caps: self.caps == "uppercase",
            weight: FontWeight(self.weight),
            radius_sm: length(&self.radius_sm),
            radius_md: length(&self.radius_md),
            radius_lg: length(&self.radius_lg),
            radius_xl: length(&self.radius_xl),
            radius_rail: length(&self.radius_rail),
            radius_pill: length(&self.radius_pill),
            radius_avatar: (!self.radius_avatar.ends_with('%'))
                .then(|| length(&self.radius_avatar)),
            line_width: length(&self.line_width),
            selection: fill(&self.selection),
            bubble_own: fill(&self.bubble_own),
            rail_width: px(self.rail_width),
            column_width: px(self.column_width),
            header_height: px(self.header_height),
            message_gap: px(self.message_gap_px),
            message_run_gap: px(self.message_run_gap_px),
            band: self.chrome_slots.band != "hidden",
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawChromeSlots {
    band: String,
}

fn fill(value: &str) -> Fill {
    if value == "solid" {
        Fill::Solid
    } else {
        Fill::Wash
    }
}

/// A CSS pixel length (`"10px"`, `"0"`); anything else reads as zero.
fn length(value: &str) -> Pixels {
    px(value
        .trim()
        .trim_end_matches("px")
        .parse::<f32>()
        .unwrap_or(0.0))
}

/// Static families a generic name (`system-ui`, `serif`, `monospace`) may
/// stand for, most wanted first.
///
/// Named rather than left to the system's default, because that default is
/// often a variable font, and the text system draws only its regular
/// instance: every name and title would come out the weight of body copy.
const SANS: &[&str] = &[
    "Inter",
    "Noto Sans",
    "Segoe UI",
    "Helvetica Neue",
    "DejaVu Sans",
    "Arial",
];
const SERIF: &[&str] = &["Noto Serif", "DejaVu Serif", "Georgia", "Times New Roman"];
const MONO: &[&str] = &["Noto Sans Mono", "DejaVu Sans Mono", "Consolas", "Menlo"];

/// The first family in a CSS font stack that is installed, keeping the
/// stack's voice (a serif stack ends in a serif), or the system's default UI
/// face. Inter is always there: the view bundles it (`assets::fonts`).
fn first_installed(stack: &str, installed: &[String]) -> SharedString {
    let has = |family: &str| {
        installed
            .iter()
            .any(|name| name.eq_ignore_ascii_case(family))
    };
    stack
        .split(',')
        .map(|family| family.trim().trim_matches('"'))
        .chain(std::iter::once("system-ui"))
        .find_map(|family| {
            let generic: &[&str] = match family {
                "system-ui" | "-apple-system" | "sans-serif" => SANS,
                "serif" => SERIF,
                "monospace" | "ui-monospace" => MONO,
                named => return has(named).then(|| named.to_owned()),
            };
            generic
                .iter()
                .find(|candidate| has(candidate))
                .map(|found| (*found).to_owned())
        })
        .map_or_else(|| SharedString::from(".SystemUIFont"), SharedString::from)
}

/// A CSS colour as the table writes them: `#rgb`, `#rrggbb`, `#rrggbbaa` or
/// `rgb()`/`rgba()`. Anything else is transparent, which is what `none` means.
pub(crate) fn color(value: &str) -> Hsla {
    parse_color(value).map_or_else(gpui::transparent_black, Hsla::from)
}

pub(crate) fn parse_color(value: &str) -> Option<Rgba> {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#') {
        return parse_hex(hex);
    }
    let body = value
        .strip_prefix("rgba(")
        .or_else(|| value.strip_prefix("rgb("))?
        .strip_suffix(')')?;
    let mut parts = body.split(',').map(|part| part.trim().parse::<f32>());
    let r = parts.next()?.ok()?;
    let g = parts.next()?.ok()?;
    let b = parts.next()?.ok()?;
    let a = parts.next().map_or(Some(1.0), Result::ok)?;
    Some(Rgba {
        r: r / 255.0,
        g: g / 255.0,
        b: b / 255.0,
        a,
    })
}

fn parse_hex(hex: &str) -> Option<Rgba> {
    let digit = |at: usize| u8::from_str_radix(hex.get(at..=at)?, 16).ok();
    let pair = |at: usize| u8::from_str_radix(hex.get(at..at + 2)?, 16).ok();
    let (r, g, b, a) = match hex.len() {
        3 => (digit(0)? * 17, digit(1)? * 17, digit(2)? * 17, 255),
        6 => (pair(0)?, pair(2)?, pair(4)?, 255),
        8 => (pair(0)?, pair(2)?, pair(4)?, pair(6)?),
        _ => return None,
    };
    Some(Rgba {
        r: f32::from(r) / 255.0,
        g: f32::from(g) / 255.0,
        b: f32::from(b) / 255.0,
        a: f32::from(a) / 255.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba(value: &str) -> (u8, u8, u8, u8) {
        let c = parse_color(value).expect("a colour");
        let byte = |v: f32| (v * 255.0).round() as u8;
        (byte(c.r), byte(c.g), byte(c.b), byte(c.a))
    }

    #[test]
    fn reads_the_colour_forms_the_table_uses() {
        assert_eq!(rgba("#0f1420"), (15, 20, 32, 255));
        assert_eq!(rgba("#fff"), (255, 255, 255, 255));
        assert_eq!(rgba("#0f142080"), (15, 20, 32, 128));
        assert_eq!(rgba("rgba(101, 128, 92, 0.2)"), (101, 128, 92, 51));
        assert_eq!(rgba("rgb(1,2,3)"), (1, 2, 3, 255));
        assert!(parse_color("none").is_none());
        assert!(parse_color("linear-gradient(#fff,#000)").is_none());
    }

    #[test]
    fn every_theme_resolves_in_both_modes() {
        let catalog = Catalog::get();
        let entries = catalog.entries(Mode::Dark);
        assert_eq!(entries.len(), 13, "the catalogue draws thirteen themes");
        for entry in &entries {
            for mode in [Mode::Light, Mode::Dark] {
                let theme = catalog
                    .resolve(&entry.id, mode, &[])
                    .expect("a listed theme resolves");
                // A colour the parser did not understand comes out fully
                // transparent, which no theme asks of its window or its text.
                assert!(theme.c.bg0.a > 0.99, "{} {mode:?} window", entry.id);
                assert!(theme.c.text.a > 0.99, "{} {mode:?} text", entry.id);
                assert!(theme.c.accent.a > 0.99, "{} {mode:?} accent", entry.id);
                assert!(theme.skin.rail_width > px(0.0));
            }
        }
    }

    #[test]
    fn the_default_theme_is_in_the_catalogue() {
        assert!(
            Catalog::get()
                .resolve(DEFAULT_THEME, Mode::Dark, &[])
                .is_some()
        );
    }

    #[test]
    fn picks_the_first_installed_family_of_a_stack() {
        let installed = ["Inter".to_owned(), "Roboto".to_owned()];
        assert_eq!(
            first_installed(r#""Inter Tight","Inter",system-ui"#, &installed).as_ref(),
            "Inter"
        );
        assert_eq!(
            first_installed(r#""Fraunces",Georgia"#, &installed).as_ref(),
            "Inter",
            "nothing of the stack is installed, so a sans the system has"
        );
        assert_eq!(first_installed("", &[]).as_ref(), ".SystemUIFont");
    }

    #[test]
    fn a_generic_family_keeps_the_voice_of_its_stack() {
        let installed = [
            "DejaVu Sans".to_owned(),
            "DejaVu Serif".to_owned(),
            "DejaVu Sans Mono".to_owned(),
        ];
        assert_eq!(
            first_installed(r#""Fraunces",Georgia,"Times New Roman",serif"#, &installed).as_ref(),
            "DejaVu Serif"
        );
        assert_eq!(
            first_installed(r#""JetBrains Mono",ui-monospace,monospace"#, &installed).as_ref(),
            "DejaVu Sans Mono"
        );
        assert_eq!(
            first_installed(r#""Inter Tight","Inter",system-ui,sans-serif"#, &installed).as_ref(),
            "DejaVu Sans"
        );
    }

    #[test]
    fn theme_ids_cycle() {
        let catalog = Catalog::get();
        assert_eq!(catalog.next_id("dark"), Some("light"));
        assert_eq!(catalog.next_id("nimbus"), Some("dark"));
        assert_eq!(catalog.next_id("no-such-theme"), None);
    }
}
