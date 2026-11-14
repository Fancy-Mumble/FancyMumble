//! The Language & format page, as the web UI's: the language the window
//! speaks (each by its flag and its own name), the clock a time is read
//! on and whether it is the local one, and how dates and numbers are
//! written, each choice showing what it gives.

use std::sync::LazyLock;

use chrono::Timelike;
use gpui::{Context, Div, ParentElement, SharedString, Styled, div, px};

use super::super::Shell;
use super::super::kit::{
    Choice, Choices, Field, Look, PageTitle, Picture, Select, Shape, SwitchRow, rule,
};
use crate::formats::{DateFormat, NumberFormat};
use crate::store::Hours;
use crate::theme::Theme;
use crate::words::{self, Language, t};

/// Each language's flag, in the order of [`Language::ALL`]: where the
/// language comes from, as the web UI marks it (`country-flag-icons`, MIT,
/// see `assets/flags/LICENSE`).
static FLAGS: LazyLock<Vec<Picture>> = LazyLock::new(|| {
    // Drawn in their own colours, as pictures: not as icons, which take
    // the theme's ink.
    let flag = |svg: &[u8]| Picture::from_svg(svg, FLAG_WIDTH);
    [
        flag(include_bytes!("../../../assets/flags/gb.svg")),
        flag(include_bytes!("../../../assets/flags/de.svg")),
        flag(include_bytes!("../../../assets/flags/fr.svg")),
        flag(include_bytes!("../../../assets/flags/cn.svg")),
    ]
    .into_iter()
    .flatten()
    .collect()
});

/// How wide a flag is drawn beside its language's name.
const FLAG_WIDTH: f32 = 20.0;

/// What the page changes about how things are written.
#[derive(Debug, Clone, Copy)]
enum Written {
    Hours(Hours),
    LocalTime,
    Date(DateFormat),
    Number(NumberFormat),
}

impl Shell {
    /// Write times, dates or numbers another way.
    fn set_written(&mut self, change: Written, cx: &mut Context<Self>) {
        let format = &mut self.panels.settings.format;
        match change {
            Written::Hours(hours) => format.hours = hours,
            Written::LocalTime => format.convert_to_local_time = !format.convert_to_local_time,
            Written::Date(date) => format.date_format = date,
            Written::Number(number) => format.number_format = number,
        }
        crate::formats::set(format.formats());
        // The rules over each day say their dates again.
        if matches!(change, Written::Date(_)) {
            self.reload_messages(cx);
        }
        self.remember_settings(cx);
        cx.refresh_windows();
    }

    /// Say everything in `language`, and keep it for the next launch.
    pub(in crate::ui) fn set_language(&mut self, language: Language, cx: &mut Context<Self>) {
        words::speak(language);
        if let Some(search) = &self.panels.settings.search {
            search.field.update(cx, |field, _| {
                field.set_placeholder(t!("Search settings"));
            });
        }
        self.remember_settings(cx);
        cx.refresh_windows();
    }
}

/// The page.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let spoken = words::spoken();
    let speaking = Language::ALL.iter().position(|known| *known == spoken);
    let lit = &shell.panels.settings.lit;
    div()
        .child(PageTitle::new(t!("Language & Format")))
        .child(
            Field::new(
                t!("Language"),
                div()
                    .child(
                        // Each in its own words, to be found whatever the
                        // window is in.
                        Select::new(
                            "language",
                            Language::ALL
                                .map(|language| SharedString::from(language.name()))
                                .into(),
                            speaking.unwrap_or(0),
                        )
                        .pictures(FLAGS.clone())
                        .on_choose(cx.listener(
                            |shell, at: &usize, _, cx| {
                                if let Some(language) = Language::ALL.get(*at) {
                                    shell.set_language(*language, cx);
                                }
                            },
                        )),
                    )
                    .child(
                        div()
                            .mt(px(3.0))
                            .mx(px(14.0))
                            .text_size(px(11.0))
                            .line_height(gpui::relative(1.45))
                            .text_color(theme.c.muted)
                            .child(t!("Choose the application language")),
                    ),
            )
            .lit(lit.lights(&t!("Language"))),
        )
        .child(rule(cx))
        .child(time_display(shell, cx))
        .child(rule(cx))
        .child(date_display(shell, cx))
        .child(rule(cx))
        .child(number_format(shell, cx))
}

/// The moment the samples are written for, fixed while the page is drawn
/// so that they do not tick: now, on the clock the reader has.
fn sample_now() -> chrono::DateTime<chrono::Local> {
    chrono::Local::now()
}

/// The clock a time is read on, and whether it is the local one.
fn time_display(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let format = shell.panels.settings.format;
    let lit = &shell.panels.settings.lit;
    let now = sample_now();
    let spoken = words::spoken();
    let clocks = Hours::ALL
        .map(|hours| {
            let name = match hours {
                Hours::Auto => t!("Auto"),
                Hours::Twelve => t!("12-hour"),
                Hours::TwentyFour => t!("24-hour"),
            };
            let sample = crate::formats::time_sample(hours, spoken, (now.hour(), now.minute()));
            Choice::new(name).detail(sample)
        })
        .into();
    let local = t!("Convert to local time");
    div()
        .child(
            super::heading(lit, t!("Time Display"))
                .hint(t!("Choose how timestamps are formatted in chat messages.")),
        )
        .child(
            Choices::new(
                "hours",
                Shape::Grid(3),
                clocks,
                Hours::ALL
                    .iter()
                    .position(|known| *known == format.hours)
                    .unwrap_or(0),
            )
            .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                if let Some(hours) = Hours::ALL.get(*at) {
                    shell.set_written(Written::Hours(*hours), cx);
                }
            })),
        )
        .child(
            div().mt(px(14.0)).child(
                SwitchRow::new("local-time", local.clone(), format.convert_to_local_time)
                    .look(Look::Setting)
                    .lit(lit.lights(&local))
                    .hint(t!(
                        "When enabled, timestamps are displayed in your local timezone. When disabled, times are shown in UTC."
                    ))
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.set_written(Written::LocalTime, cx);
                    })),
            ),
        )
}

/// How dates are written.
fn date_display(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let chosen = shell.panels.settings.format.date_format;
    let today = sample_now().date_naive();
    let spoken = words::spoken();
    let choices = DateFormat::ALL
        .map(|date| {
            let name = match date {
                DateFormat::Auto => t!("Auto"),
                DateFormat::Dmy => t!("Day/Month/Year"),
                DateFormat::Mdy => t!("Month/Day/Year"),
                DateFormat::Ymd => t!("Year-Month-Day (ISO)"),
            };
            // The web UI writes "auto" as the language's middling date.
            Choice::new(name).detail(date.write(today, spoken))
        })
        .into();
    div()
        .child(
            super::heading(&shell.panels.settings.lit, t!("Date Display"))
                .hint(t!("Choose how dates appear throughout the app.")),
        )
        .child(
            Choices::new(
                "date-format",
                Shape::Grid(4),
                choices,
                DateFormat::ALL
                    .iter()
                    .position(|known| *known == chosen)
                    .unwrap_or(0),
            )
            .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                if let Some(date) = DateFormat::ALL.get(*at) {
                    shell.set_written(Written::Date(*date), cx);
                }
            })),
        )
}

/// How numbers are written.
fn number_format(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let chosen = shell.panels.settings.format.number_format;
    let spoken = words::spoken();
    let choices = NumberFormat::ALL
        .map(|number| {
            let name = match number {
                NumberFormat::Auto => t!("Auto"),
                NumberFormat::CommaPeriod => t!("1,234.56"),
                NumberFormat::PeriodComma => t!("1.234,56"),
                NumberFormat::SpaceComma => t!("1 234,56"),
            };
            Choice::new(name).detail(number.sample(spoken))
        })
        .into();
    div()
        .child(
            super::heading(&shell.panels.settings.lit, t!("Number Format"))
                .hint(t!("Choose the thousands separator and decimal mark.")),
        )
        .child(
            Choices::new(
                "number-format",
                Shape::Grid(2),
                choices,
                NumberFormat::ALL
                    .iter()
                    .position(|known| *known == chosen)
                    .unwrap_or(0),
            )
            .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                if let Some(number) = NumberFormat::ALL.get(*at) {
                    shell.set_written(Written::Number(*number), cx);
                }
            })),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The colour at `share` of the way down the middle of `flag`.
    fn down(flag: &image::RgbaImage, share: f32) -> [u8; 4] {
        let (width, height) = flag.dimensions();
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss,
            reason = "a place in a small picture"
        )]
        let y = (height as f32 * share) as u32;
        flag.get_pixel(width / 2, y).0
    }

    #[test]
    fn a_flag_is_drawn_in_its_own_colours_whatever_the_theme_inks() {
        assert_eq!(
            FLAGS.len(),
            Language::ALL.len(),
            "every language has its flag"
        );
        // Black, red and gold, top to bottom: not the one ink of an icon.
        // The picture is drawn before any theme is, so no theme reaches it.
        let german = FLAGS[1].pixels();
        let [r, g, b, a] = down(&german, 0.15);
        assert!(
            r < 40 && g < 40 && b < 40 && a > 200,
            "black, not {:?}",
            [r, g, b, a]
        );
        let [r, g, b, _] = down(&german, 0.5);
        assert!(r > 180 && g < 60 && b < 60, "red, not {:?}", [r, g, b]);
        let [r, g, b, _] = down(&german, 0.85);
        assert!(r > 200 && g > 150 && b < 80, "gold, not {:?}", [r, g, b]);
    }
}
