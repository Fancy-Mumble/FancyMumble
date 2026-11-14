//! The registered accounts of the administrator's panel: what a row says of
//! one, and the order the rows come in.

use std::cmp::Ordering;

use super::pins::age;
use crate::engine::Registered;

/// What the accounts are put in order by.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum Order {
    /// By what they are called.
    #[default]
    Name,
    /// Whoever is here first, then whoever was on last.
    LastOn,
    /// By the channel they were last in.
    Channel,
}

impl Order {
    pub(super) const ALL: [Self; 3] = [Self::Name, Self::LastOn, Self::Channel];
    /// What each is called where it is chosen, in the order of [`Self::ALL`].
    pub(super) const NAMES: [&'static str; 3] = ["Name", "Last on", "Channel"];
}

/// When the server says an account was last on, in Unix milliseconds. It
/// writes the date and the time of day in UTC, with or without saying so.
pub(crate) fn seen_ms(written: &str) -> Option<u64> {
    let at = chrono::DateTime::parse_from_rfc3339(written)
        .map(|at| at.naive_utc())
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(written, "%Y-%m-%dT%H:%M:%S"))
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(written, "%Y-%m-%d %H:%M:%S"))
        .ok()?;
    u64::try_from(at.and_utc().timestamp_millis()).ok()
}

/// One account as its row has it: what the list alone does not say.
#[derive(Debug, Clone, Copy)]
pub(super) struct Row<'a> {
    pub user: &'a Registered,
    /// The channel it is in now, when it is connected.
    pub here: Option<&'a str>,
    /// The channel it was last in.
    pub channel: Option<&'a str>,
}

impl Row<'_> {
    /// Where it is, or when and where it was last on. A time the server
    /// wrote some other way is shown as it wrote it.
    pub(super) fn about(&self, now_ms: u64) -> String {
        if let Some(here) = self.here {
            return format!("Here now, in {here}");
        }
        // A server with no time to give writes an empty one.
        let seen = self.user.last_seen.as_ref();
        let Some(seen) = seen.filter(|seen| !seen.trim().is_empty()) else {
            return "Never seen".to_owned();
        };
        let when = seen_ms(seen).map_or_else(|| seen.to_string(), |at| age(at, now_ms));
        match self.channel {
            Some(channel) => format!("Last on {when}, in {channel}"),
            None => format!("Last on {when}"),
        }
    }

    /// Which of two comes first by `order`; by name where that leaves them
    /// level.
    pub(super) fn before(&self, other: &Self, order: Order) -> Ordering {
        let name = |row: &Self| row.user.name.to_lowercase();
        let by_name = || name(self).cmp(&name(other));
        match order {
            Order::Name => by_name(),
            Order::LastOn => {
                // Here now, then the latest; never seen comes last.
                let seen = |row: &Self| {
                    let at = row.user.last_seen.as_ref().and_then(|seen| seen_ms(seen));
                    (row.here.is_some(), at)
                };
                seen(other).cmp(&seen(self)).then_with(by_name)
            }
            Order::Channel => {
                // No channel comes last.
                let place = |row: &Self| {
                    let channel = row.here.or(row.channel).map(str::to_lowercase);
                    (channel.is_none(), channel)
                };
                place(self).cmp(&place(other)).then_with(by_name)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(name: &str, last_seen: Option<&str>) -> Registered {
        Registered {
            id: 1,
            name: name.to_owned().into(),
            last_seen: last_seen.map(|seen| seen.to_owned().into()),
            last_channel: None,
            picture: false,
        }
    }

    fn row<'a>(user: &'a Registered, here: Option<&'a str>, channel: Option<&'a str>) -> Row<'a> {
        Row {
            user,
            here,
            channel,
        }
    }

    #[test]
    fn when_an_account_was_last_on_is_read_as_the_server_writes_it() {
        let at = seen_ms("2026-01-02T03:04:05Z").expect("a time");
        assert_eq!(at, 1_767_323_045_000);
        assert_eq!(seen_ms("2026-01-02T03:04:05"), Some(at));
        assert_eq!(seen_ms("2026-01-02 03:04:05"), Some(at));
        assert_eq!(seen_ms("yesterday"), None);
    }

    #[test]
    fn a_row_says_where_an_account_is_or_how_long_ago_it_was_on() {
        let now = 1_767_323_045_000 + 3 * 86_400_000;
        let rin = user("Rin", Some("2026-01-02T03:04:05Z"));
        assert_eq!(
            row(&rin, None, Some("lounge")).about(now),
            "Last on 3 d ago, in lounge"
        );
        assert_eq!(row(&rin, None, None).about(now), "Last on 3 d ago");
        assert_eq!(
            row(&rin, Some("studio"), Some("lounge")).about(now),
            "Here now, in studio"
        );
        for never in [None, Some("")] {
            assert_eq!(
                row(&user("Rin", never), None, Some("lounge")).about(now),
                "Never seen"
            );
        }
        // Written some other way: shown as it is.
        assert_eq!(
            row(&user("Rin", Some("long ago")), None, None).about(now),
            "Last on long ago"
        );
    }

    #[test]
    fn accounts_come_in_the_order_asked_for() {
        let users = [
            user("scout", Some("2026-01-05T00:00:00Z")),
            user("Alex", None),
            user("Rin", Some("2026-01-09T00:00:00Z")),
            user("flora", Some("2026-01-01T00:00:00Z")),
        ];
        let rows = [
            row(&users[0], None, Some("studio")),
            row(&users[1], None, None),
            row(&users[2], None, Some("afk")),
            row(&users[3], Some("lounge"), Some("afk")),
        ];
        let ordered = |order: Order| {
            let mut rows = rows;
            rows.sort_by(|a, b| a.before(b, order));
            rows.map(|row| row.user.name.to_string())
        };
        assert_eq!(ordered(Order::Name), ["Alex", "flora", "Rin", "scout"]);
        // Here now, then the latest; never seen last.
        assert_eq!(ordered(Order::LastOn), ["flora", "Rin", "scout", "Alex"]);
        // Where they are now, or were: afk, lounge, studio, nowhere.
        assert_eq!(ordered(Order::Channel), ["Rin", "flora", "scout", "Alex"]);
    }
}
