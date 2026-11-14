//! How dates, numbers and times of day are written: the choices of the
//! Language & format page, as the web client names and writes them
//! (`previewDate`, `previewNumber`, `previewTime`, `formatTimestamp`), and
//! the one place the view asks how to write one.
//!
//! Like the language (`crate::words`), the choice in force belongs to the
//! thread that draws: [`set`] when it changes, [`current`] wherever a date
//! or a number is written.

use std::cell::Cell;

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::words::Language;

/// How a date is written.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DateFormat {
    /// As the language writes it.
    #[default]
    Auto,
    /// Day/Month/Year, `17/05/2026`.
    Dmy,
    /// Month/Day/Year, `05/17/2026`.
    Mdy,
    /// Year-Month-Day, ISO 8601, `2026-05-17`.
    Ymd,
}

/// How a number is written: named by its marks, as the web client names
/// them, so that no convention is the plain one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum NumberFormat {
    /// As the language writes it.
    #[default]
    Auto,
    /// `1,234.56`
    CommaPeriod,
    /// `1.234,56`
    PeriodComma,
    /// `1 234,56`, the space a narrow one that does not break.
    SpaceComma,
}

/// The number the web client shows each number format with.
pub(crate) const SAMPLE_NUMBER: f64 = 1_234_567.89;

impl DateFormat {
    /// Every choice, in the order they are offered.
    pub(crate) const ALL: [Self; 4] = [Self::Auto, Self::Dmy, Self::Mdy, Self::Ymd];

    /// `date` written this way, in `language` where the language decides.
    pub(crate) fn write(self, date: NaiveDate, language: Language) -> String {
        match self {
            Self::Auto => medium(date, language),
            Self::Dmy => date.format("%d/%m/%Y").to_string(),
            Self::Mdy => date.format("%m/%d/%Y").to_string(),
            Self::Ymd => date.format("%Y-%m-%d").to_string(),
        }
    }

    /// What the rule above a day of messages says of a day before
    /// yesterday: its weekday and its date, the date this way.
    pub(crate) fn day(self, date: NaiveDate, language: Language) -> String {
        match self {
            Self::Auto => date.format("%a, %b %-d").to_string(),
            chosen => format!("{}, {}", date.format("%a"), chosen.write(date, language)),
        }
    }
}

impl DateFormat {
    /// `date`'s day and month alone, no year, as a short date is written
    /// this way: `21/11`, `11/21`, `11-21`. "As the language writes it"
    /// follows the system's regional settings where they say, as the web
    /// client's `toLocaleDateString(undefined, { month, day })` does, and the
    /// language's own order elsewhere.
    pub(crate) fn day_and_month(self, date: NaiveDate, language: Language) -> String {
        use mumble_tauri_lib::engine_api::clock::DateOrder;
        let (day, month) = (date.day(), date.month());
        let order = match self {
            Self::Dmy => DateOrder::DayFirst,
            Self::Mdy => DateOrder::MonthFirst,
            Self::Ymd => DateOrder::YearFirst,
            Self::Auto => match (system_date_order(), language) {
                (Some(order), _) => order,
                (None, Language::German) => return format!("{day}.{month}."),
                (None, Language::French) => DateOrder::DayFirst,
                (None, Language::English | Language::Chinese) => DateOrder::MonthFirst,
            },
        };
        match order {
            DateOrder::DayFirst if language == Language::German => format!("{day}.{month}."),
            DateOrder::DayFirst => format!("{day}/{month}"),
            DateOrder::MonthFirst => format!("{month}/{day}"),
            DateOrder::YearFirst => format!("{month:02}-{day:02}"),
        }
    }
}

/// The order the system writes a short date in, where it says; asked once.
fn system_date_order() -> Option<mumble_tauri_lib::engine_api::clock::DateOrder> {
    static ASKED: std::sync::OnceLock<Option<mumble_tauri_lib::engine_api::clock::DateOrder>> =
        std::sync::OnceLock::new();
    *ASKED.get_or_init(mumble_tauri_lib::engine_api::clock::system_date_order)
}

/// A date as `language` writes it at middling length: the web client's
/// `dateStyle: "medium"`.
fn medium(date: NaiveDate, language: Language) -> String {
    let (day, month, year) = (date.day(), date.month0() as usize, date.year());
    match language {
        Language::English => format!("{} {day}, {year}", ENGLISH_MONTHS[month]),
        Language::German => date.format("%d.%m.%Y").to_string(),
        Language::French => format!("{day} {} {year}", FRENCH_MONTHS[month]),
        Language::Chinese => format!("{year}年{}月{day}日", month + 1),
    }
}

const ENGLISH_MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const FRENCH_MONTHS: [&str; 12] = [
    "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.",
    "déc.",
];

impl NumberFormat {
    /// Every choice, in the order they are offered.
    pub(crate) const ALL: [Self; 4] = [
        Self::Auto,
        Self::CommaPeriod,
        Self::PeriodComma,
        Self::SpaceComma,
    ];

    /// The choice this is in `language`: what "as the language writes it"
    /// comes to.
    fn in_force(self, language: Language) -> Self {
        match (self, language) {
            (Self::Auto, Language::English | Language::Chinese) => Self::CommaPeriod,
            (Self::Auto, Language::German) => Self::PeriodComma,
            (Self::Auto, Language::French) => Self::SpaceComma,
            (chosen, _) => chosen,
        }
    }

    /// What separates thousands, and what marks the decimals.
    fn marks(self, language: Language) -> (&'static str, char) {
        match self.in_force(language) {
            Self::PeriodComma => (".", ','),
            Self::SpaceComma => ("\u{202f}", ','),
            Self::Auto | Self::CommaPeriod => (",", '.'),
        }
    }

    /// `value` written this way with `decimals` places, in `language`
    /// where the language decides.
    pub(crate) fn write(self, value: f64, decimals: usize, language: Language) -> String {
        let (thousands, decimal) = self.marks(language);
        let plain = format!("{:.*}", decimals, value.abs());
        let (whole, fraction) = plain.split_once('.').unwrap_or((&plain, ""));
        let mut grouped = String::with_capacity(plain.len() + whole.len() / 3 * thousands.len());
        for (at, digit) in whole.chars().enumerate() {
            if at > 0 && (whole.len() - at) % 3 == 0 {
                grouped.push_str(thousands);
            }
            grouped.push(digit);
        }
        let sign = if value < 0.0 && plain.chars().any(|c| c.is_ascii_digit() && c != '0') {
            "-"
        } else {
            ""
        };
        if fraction.is_empty() {
            format!("{sign}{grouped}")
        } else {
            format!("{sign}{grouped}{decimal}{fraction}")
        }
    }

    /// The web client's sample of this choice: as many places as the
    /// sample number has, at most three, as `Intl.NumberFormat` writes it.
    pub(crate) fn sample(self, language: Language) -> String {
        self.write(SAMPLE_NUMBER, 2, language)
    }
}

/// A time of day as the web client's preview of a clock choice writes it:
/// "auto" as the language's short style, a chosen clock with two digits
/// for the hour.
pub(crate) fn time_sample(
    hours: crate::store::Hours,
    language: Language,
    (hour, minute): (u32, u32),
) -> String {
    use crate::store::Hours;
    let twelve = match hours {
        Hours::Twelve => true,
        Hours::TwentyFour => false,
        Hours::Auto => language == Language::English,
    };
    if !twelve {
        return format!("{hour:02}:{minute:02}");
    }
    let shown = match hour % 12 {
        0 => 12,
        hour => hour,
    };
    if hours == Hours::Auto {
        // The language's own short style has no leading nought.
        return format!(
            "{shown}:{minute:02} {}",
            if hour < 12 { "AM" } else { "PM" }
        );
    }
    twelve_hours(language, shown, minute, hour < 12)
}

/// `hour:minute` on a twelve-hour clock with which half of the day, as
/// `language` marks it: `06:42 PM`, `下午06:42`.
pub(crate) fn twelve_hours(language: Language, hour: u32, minute: u32, morning: bool) -> String {
    match language {
        Language::Chinese => format!(
            "{}{hour:02}:{minute:02}",
            if morning { "上午" } else { "下午" }
        ),
        _ => format!(
            "{hour:02}:{minute:02} {}",
            if morning { "AM" } else { "PM" }
        ),
    }
}

/// Whether the system reads times on a 24-hour clock, where it says; asked
/// once.
pub(crate) fn system_uses_24h() -> Option<bool> {
    static ASKED: std::sync::OnceLock<Option<bool>> = std::sync::OnceLock::new();
    *ASKED.get_or_init(mumble_tauri_lib::engine_api::clock::system_uses_24h)
}

/// The choices in force on this thread.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Formats {
    pub date: DateFormat,
    pub number: NumberFormat,
}

thread_local! {
    static IN_FORCE: Cell<Formats> = Cell::new(Formats::default());
}

/// Write dates and numbers as `formats` says, from now on, on this thread.
pub(crate) fn set(formats: Formats) {
    IN_FORCE.set(formats);
}

/// How dates and numbers are written on this thread.
pub(crate) fn current() -> Formats {
    IN_FORCE.get()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Hours;

    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 5, 7).expect("a date")
    }

    #[test]
    fn a_date_is_written_as_chosen_and_as_each_language_writes_it() {
        assert_eq!(
            DateFormat::Dmy.write(day(), Language::English),
            "07/05/2026"
        );
        assert_eq!(DateFormat::Mdy.write(day(), Language::German), "05/07/2026");
        assert_eq!(DateFormat::Ymd.write(day(), Language::French), "2026-05-07");
        assert_eq!(
            DateFormat::Auto.write(day(), Language::English),
            "May 7, 2026"
        );
        assert_eq!(
            DateFormat::Auto.write(day(), Language::German),
            "07.05.2026"
        );
        assert_eq!(
            DateFormat::Auto.write(day(), Language::French),
            "7 mai 2026"
        );
        assert_eq!(
            DateFormat::Auto.write(day(), Language::Chinese),
            "2026年5月7日"
        );
        // The rule over a day of messages keeps its weekday.
        assert_eq!(DateFormat::Auto.day(day(), Language::English), "Thu, May 7");
        assert_eq!(
            DateFormat::Ymd.day(day(), Language::English),
            "Thu, 2026-05-07"
        );
    }

    #[test]
    fn a_number_is_grouped_and_marked_as_chosen_and_as_each_language_writes_it() {
        let english = Language::English;
        assert_eq!(NumberFormat::CommaPeriod.sample(english), "1,234,567.89");
        assert_eq!(NumberFormat::PeriodComma.sample(english), "1.234.567,89");
        assert_eq!(
            NumberFormat::SpaceComma.sample(english),
            "1\u{202f}234\u{202f}567,89"
        );
        assert_eq!(NumberFormat::Auto.sample(Language::German), "1.234.567,89");
        assert_eq!(
            NumberFormat::Auto.sample(Language::French),
            "1\u{202f}234\u{202f}567,89"
        );
        assert_eq!(NumberFormat::Auto.sample(Language::Chinese), "1,234,567.89");
        assert_eq!(NumberFormat::Auto.write(1.5, 1, english), "1.5");
        assert_eq!(NumberFormat::PeriodComma.write(1.5, 1, english), "1,5");
        assert_eq!(NumberFormat::CommaPeriod.write(999.0, 0, english), "999");
        assert_eq!(NumberFormat::CommaPeriod.write(1000.0, 0, english), "1,000");
        assert_eq!(
            NumberFormat::CommaPeriod.write(-1234.5, 1, english),
            "-1,234.5"
        );
        assert_eq!(NumberFormat::CommaPeriod.write(-0.01, 1, english), "0.0");
    }

    #[test]
    fn a_clock_sample_is_the_web_clients() {
        let evening = (18, 42);
        assert_eq!(
            time_sample(Hours::Auto, Language::English, evening),
            "6:42 PM"
        );
        assert_eq!(time_sample(Hours::Auto, Language::German, evening), "18:42");
        assert_eq!(
            time_sample(Hours::Twelve, Language::English, evening),
            "06:42 PM"
        );
        assert_eq!(
            time_sample(Hours::Twelve, Language::Chinese, (0, 5)),
            "上午12:05"
        );
        assert_eq!(
            time_sample(Hours::TwentyFour, Language::English, (7, 3)),
            "07:03"
        );
    }

    #[test]
    fn the_choices_in_force_are_the_threads() {
        assert_eq!(current(), Formats::default());
        set(Formats {
            date: DateFormat::Ymd,
            number: NumberFormat::SpaceComma,
        });
        assert_eq!(current().date, DateFormat::Ymd);
        let other = std::thread::spawn(current).join().expect("a thread");
        assert_eq!(other, Formats::default(), "another thread's own");
        set(Formats::default());
    }
}
