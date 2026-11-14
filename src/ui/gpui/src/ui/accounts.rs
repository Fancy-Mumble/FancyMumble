//! When the server says a registered account was last on, read as a time:
//! what the Users page shows and orders its rows by.

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn when_an_account_was_last_on_is_read_as_the_server_writes_it() {
        let at = seen_ms("2026-01-02T03:04:05Z").expect("a time");
        assert_eq!(at, 1_767_323_045_000);
        assert_eq!(seen_ms("2026-01-02T03:04:05"), Some(at));
        assert_eq!(seen_ms("2026-01-02 03:04:05"), Some(at));
        assert_eq!(seen_ms("yesterday"), None);
    }
}
