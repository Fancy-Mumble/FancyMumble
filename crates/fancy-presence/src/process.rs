//! Naming the process behind a presence entry.
//!
//! Applications report a pid in their `SET_ACTIVITY` arguments. Turning that
//! into an executable name gives every entry a label even when the Discord
//! application id resolves to nothing - which is the common case offline, or
//! for an application whose id was never registered with Discord.
//!
//! Only implemented where it costs nothing: reading `/proc` needs no
//! privileges, no dependency and no `unsafe`. The Windows and macOS
//! equivalents need process-handle APIs that would mean either an `unsafe`
//! block (denied workspace-wide) or a new dependency, and the name is only
//! ever a fallback label, so those platforms return `None`.

/// The executable name for `pid`, if this platform can tell us cheaply.
#[must_use]
pub fn process_name(pid: u32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let raw = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
        let name = raw.trim();
        if name.is_empty() {
            None
        } else {
            Some(name.to_owned())
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        None
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn names_the_current_process() {
        let pid = std::process::id();
        assert!(process_name(pid).is_some_and(|name| !name.is_empty()));
    }

    #[test]
    fn returns_nothing_for_a_pid_that_cannot_exist() {
        assert_eq!(process_name(u32::MAX), None);
    }
}
