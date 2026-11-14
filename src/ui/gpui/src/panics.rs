//! Where a crash leaves its word.
//!
//! A release build has no console of its own, and stops at once when it
//! panics: without this, what went wrong would be written to a terminal
//! nobody has. So a panic is also written into the log of the day (`logs`
//! under the data directory), and then said where it always was.

use std::panic::Location;

/// Write every panic into the log as well, from now on.
pub(crate) fn keep_in_log() {
    let said = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        let payload = panic.payload();
        let what = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("(no message)");
        let thread = std::thread::current();
        let crash = Crash {
            thread: thread.name().unwrap_or("unnamed"),
            at: panic.location(),
            what,
        };
        tracing::error!(target: "panic", "{crash}");
        said(panic);
    }));
}

/// A panic as the log says it: on which thread, where, and what.
#[derive(Debug)]
struct Crash<'a> {
    thread: &'a str,
    at: Option<&'a Location<'a>>,
    what: &'a str,
}

impl std::fmt::Display for Crash<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let Self { thread, at, what } = self;
        match at {
            Some(at) => write!(f, "panicked on thread {thread} at {at}: {what}"),
            None => write!(f, "panicked on thread {thread}: {what}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_panic_is_said_with_where_and_what() {
        let crash = Crash {
            thread: "main",
            at: Some(Location::caller()),
            what: "the reason",
        };
        let said = crash.to_string();
        assert!(said.starts_with("panicked on thread main at "), "{said}");
        assert!(said.contains("panics.rs:"), "{said}");
        assert!(said.ends_with(": the reason"), "{said}");
    }
}
