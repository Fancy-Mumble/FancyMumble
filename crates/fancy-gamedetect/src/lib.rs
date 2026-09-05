//! Decides whether the window the user is looking at is a game worth putting
//! a voice overlay over.
//!
//! The contract this crate keeps, because an overlay that breaks it gets
//! people banned:
//!
//! - It never opens a game process for anything but
//!   `PROCESS_QUERY_LIMITED_INFORMATION`, which is what every anti-cheat
//!   permits and what the client already does to name an audio endpoint.
//! - It never reads another process's memory, never enumerates its modules,
//!   and never installs a hook of any kind.
//! - It looks at the **foreground** window only, once every poll tick, rather
//!   than scanning the whole process table the way Discord's game detection
//!   does. An overlay is about what is on screen.
//!
//! The decision is evidence-based rather than list-based (see
//! `docs/GAME-OVERLAY-POC-PLAN.md` in the e2e repository). Positive evidence -
//! installed under a game store, remembered as a game by Windows, publishing
//! Rich Presence, a game engine's window class, rendering borderless
//! fullscreen - adds weight. A deny-list of desktop software vetoes outright,
//! so Explorer, a CAD package or an IDE can never score its way to an overlay.
//! User rules override both.

mod classify;
mod denylist;
mod evidence;
mod index;
mod probe;

use std::collections::HashMap;
use std::time::{Duration, Instant};

pub use classify::{Assessment, Verdict};
pub use evidence::{Evidence, Reason};
pub use index::{GameIndex, InstalledGame, Store};
pub use probe::{ForegroundFacts, Rect, ShellState};

/// What the user has decided about one executable, which outranks every
/// heuristic in both directions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rule {
    /// Always eligible, even against a deny-list veto.
    Allow,
    /// Never eligible, whatever it scores.
    Deny,
}

/// Per-executable user rules, keyed by lowercased full path.
pub type Rules = HashMap<String, Rule>;

/// How often the installed-game index is rebuilt. Games are installed rarely
/// and the rebuild walks a few hundred small files, so an hour is generous.
const INDEX_TTL: Duration = Duration::from_secs(60 * 60);

/// The detector: probes the foreground window and turns it into a verdict.
///
/// Cheap to call at the overlay's poll rate. The expensive parts - the
/// installed-game index and Windows' own game registry - are cached, and the
/// per-process facts are memoised by pid so a steady foreground costs four
/// user32 calls a tick.
#[derive(Debug)]
pub struct Detector {
    index: GameIndex,
    index_built: Instant,
    /// pid -> lowercased executable path. Resolving the path is the only part
    /// of the probe that opens a handle, so it is the only part worth caching.
    process_cache: HashMap<u32, String>,
    /// Sessions publishing Discord Rich Presence, by pid. Fed from the
    /// client's existing presence listener; empty when presence is off.
    presence_pids: Vec<u32>,
}

impl Default for Detector {
    fn default() -> Self {
        Self::new()
    }
}

impl Detector {
    /// Build a detector and its installed-game index.
    ///
    /// The index walks launcher manifests and registry keys, so call this off
    /// the UI thread.
    #[must_use]
    pub fn new() -> Self {
        Self {
            index: GameIndex::build(),
            index_built: Instant::now(),
            process_cache: HashMap::new(),
            presence_pids: Vec::new(),
        }
    }

    /// Tell the detector which pids are currently publishing Rich Presence.
    ///
    /// A process that announces itself to Discord as playing something is a
    /// game by its own admission - the strongest single piece of evidence
    /// available, and the one Discord itself increasingly relies on instead of
    /// its executable list.
    pub fn set_presence_pids(&mut self, pids: Vec<u32>) {
        self.presence_pids = pids;
    }

    /// How many installed games the index knows about, for diagnostics.
    #[must_use]
    pub fn indexed_games(&self) -> usize {
        self.index.len()
    }

    /// Probe the foreground window and classify it.
    ///
    /// Returns `None` when there is nothing to judge: no foreground window, a
    /// cloaked one, or our own process.
    pub fn assess(&mut self, own_pid: u32, rules: &Rules) -> Option<Assessment> {
        if self.index_built.elapsed() > INDEX_TTL {
            self.index = GameIndex::build();
            self.index_built = Instant::now();
        }

        let raw = probe::foreground_window(own_pid)?;

        let exe_path = match self.process_cache.get(&raw.pid) {
            Some(cached) => cached.clone(),
            None => {
                let resolved = probe::exe_path_of(raw.pid)?.trim().to_ascii_lowercase();
                // The cache only spares repeated handle opens for the window
                // the user is sitting in; anything more would be a leak.
                if self.process_cache.len() > 32 {
                    self.process_cache.clear();
                }
                let _previous = self.process_cache.insert(raw.pid, resolved.clone());
                resolved
            }
        };

        let facts = ForegroundFacts {
            hwnd: raw.hwnd,
            pid: raw.pid,
            exe_stem: exe_stem(&exe_path),
            exe_path,
            class: raw.class,
            has_caption: raw.has_caption,
            has_thickframe: raw.has_thickframe,
            rect: raw.rect,
            monitor_rect: raw.monitor_rect,
            shell: probe::shell_state(),
        };

        let presence = self.presence_pids.contains(&facts.pid);
        Some(classify::assess(&facts, &self.index, presence, rules))
    }
}

/// File name without directory or extension, for deny-list matching.
fn exe_stem(exe_path: &str) -> String {
    std::path::Path::new(exe_path)
        .file_stem()
        .map_or_else(String::new, |s| s.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exe_stem_drops_the_directory_and_extension() {
        // `Path` splits on the host's separator, and the paths this reads came
        // from the host in the first place - so the directory here has to be
        // one the host recognises. Asserting a Windows path on Linux asserts
        // that `Path` is broken, which is why this failed everywhere it ran.
        #[cfg(windows)]
        assert_eq!(
            exe_stem("c:\\games\\elden ring\\eldenring.exe"),
            "eldenring"
        );
        #[cfg(not(windows))]
        assert_eq!(exe_stem("/games/elden ring/eldenring.exe"), "eldenring");
        assert_eq!(exe_stem("eldenring.exe"), "eldenring");
    }

    #[test]
    fn rules_are_keyed_by_lowercased_full_path() {
        // The classifier looks rules up with the probe's lowercased path; this
        // documents the contract callers must honour when they build the map.
        let mut rules = Rules::new();
        let _previous = rules.insert("c:\\games\\thing.exe".to_owned(), Rule::Allow);
        assert_eq!(rules.get("c:\\games\\thing.exe"), Some(&Rule::Allow));
    }
}
