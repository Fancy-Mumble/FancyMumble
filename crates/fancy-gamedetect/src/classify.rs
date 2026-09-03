//! Turning facts about the foreground window into a verdict.
//!
//! The order of the checks is the design: a veto or a user rule settles the
//! question before any scoring happens, so no amount of "it looks like a game"
//! can put an overlay over a CAD package, and a user who has said yes to
//! something never has to say it twice.

use crate::denylist::{self, Veto};
use crate::evidence::{engine_for_class, Evidence, Reason};
use crate::index::GameIndex;
use crate::probe::{ForegroundFacts, ShellState};
use crate::{Rule, Rules};

/// At or above this, the overlay shows without asking.
pub(crate) const GAME_THRESHOLD: i32 = 60;
/// At or above this (but below [`GAME_THRESHOLD`]), the user is asked once.
pub(crate) const PROBABLY_THRESHOLD: i32 = 30;
/// What an exclusive-fullscreen Direct3D app is worth as evidence. It is
/// nearly always a game, but it is also the one case nothing can be drawn over.
const EXCLUSIVE_FULLSCREEN_WEIGHT: i32 = 30;

/// What the detector concluded about the foreground window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    /// A game, and the overlay may show over it.
    Game,
    /// Probably a game. The overlay stays hidden until the user says yes once.
    Probably,
    /// Not a game, or explicitly not wanted here.
    NotGame,
    /// A game, but in exclusive fullscreen: no composited window can appear
    /// over it, so the overlay stays hidden and the user is told once.
    CannotShow,
}

impl Verdict {
    /// May the overlay be shown for this verdict?
    #[must_use]
    pub const fn is_eligible(self) -> bool {
        matches!(self, Self::Game)
    }
}

/// A verdict plus everything the diagnostics panel needs to explain it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assessment {
    /// The conclusion.
    pub verdict: Verdict,
    /// Total weight of the evidence, before thresholds.
    pub score: i32,
    /// Everything that was noticed, in the order it was checked.
    pub reasons: Vec<Reason>,
    /// Full path of the foreground executable, lowercased.
    pub exe_path: String,
    /// File name without directory or extension.
    pub exe_stem: String,
    /// The Win32 window class.
    pub class: String,
    /// The game's name as the store records it, when the index knows it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Native handle of the foreground window.
    pub hwnd: isize,
    /// Physical-pixel rect of the monitor the window is on - where the
    /// overlay has to place itself.
    pub monitor_rect: crate::probe::Rect,
    /// What the shell reported.
    pub shell: ShellState,
}

/// Classify one foreground window.
pub(crate) fn assess(
    facts: &ForegroundFacts,
    index: &GameIndex,
    publishes_presence: bool,
    rules: &Rules,
) -> Assessment {
    let mut reasons = Vec::new();
    let installed = index.lookup(&facts.exe_path);
    let title = installed.map(|game| game.name.clone());

    // 1. A presentation suppresses everything, including an allow rule: the
    //    user asked for the overlay over a game, not over their own slides.
    if facts.shell == ShellState::Presenting {
        reasons.push(Reason::new("shell:presenting", 0));
        return finish(facts, title, Verdict::NotGame, 0, reasons);
    }

    // 2. User rules outrank every heuristic, in both directions.
    match rules.get(facts.exe_path.as_str()) {
        Some(Rule::Deny) => {
            reasons.push(Reason::new("rule:deny", 0));
            return finish(facts, title, Verdict::NotGame, 0, reasons);
        }
        Some(Rule::Allow) => {
            reasons.push(Reason::new("rule:allow", 0));
            let verdict = if facts.shell == ShellState::ExclusiveFullscreen {
                Verdict::CannotShow
            } else {
                Verdict::Game
            };
            return finish(facts, title, verdict, GAME_THRESHOLD, reasons);
        }
        None => {}
    }

    // 3. Vetoes: desktop software never gets an overlay by scoring well.
    if let Some(veto) = denylist::veto_for(&facts.exe_path, &facts.exe_stem, &facts.class) {
        let code = match veto {
            Veto::Executable => "veto:executable",
            Veto::Launcher => "veto:launcher",
            Veto::WindowClass => "veto:window-class",
        };
        reasons.push(Reason::detailed(code, 0, veto_detail(veto, facts)));
        return finish(facts, title, Verdict::NotGame, 0, reasons);
    }

    // 4. Evidence.
    let mut score = 0;
    if let Some(game) = installed {
        score += push(
            &mut reasons,
            Evidence::InstalledUnderStore,
            Some(format!("{}: {}", game.store.label(), game.name)),
        );
    }
    if index.windows_remembers(&facts.exe_path) {
        score += push(&mut reasons, Evidence::WindowsRemembersGame, None);
    }
    if publishes_presence {
        score += push(&mut reasons, Evidence::PublishesPresence, None);
    }
    if let Some(engine) = engine_for_class(&facts.class) {
        score += push(
            &mut reasons,
            Evidence::EngineWindowClass,
            Some(format!("{engine} ({})", facts.class)),
        );
    }
    if facts.is_fullscreen_shaped() {
        score += push(&mut reasons, Evidence::FullscreenShaped, None);
    }
    match facts.shell {
        ShellState::Busy => score += push(&mut reasons, Evidence::ShellBusy, None),
        ShellState::ExclusiveFullscreen => {
            reasons.push(Reason::new(
                "shell:exclusive-fullscreen",
                EXCLUSIVE_FULLSCREEN_WEIGHT,
            ));
            score += EXCLUSIVE_FULLSCREEN_WEIGHT;
        }
        ShellState::Normal | ShellState::Presenting | ShellState::Unknown => {}
    }

    // 5. Thresholds. Exclusive fullscreen turns an otherwise-eligible verdict
    //    into "we know, and we cannot" so the UI can say so once.
    let verdict = if score >= GAME_THRESHOLD {
        if facts.shell == ShellState::ExclusiveFullscreen {
            Verdict::CannotShow
        } else {
            Verdict::Game
        }
    } else if score >= PROBABLY_THRESHOLD {
        Verdict::Probably
    } else {
        Verdict::NotGame
    };

    finish(facts, title, verdict, score, reasons)
}

fn push(reasons: &mut Vec<Reason>, evidence: Evidence, detail: Option<String>) -> i32 {
    let weight = evidence.weight();
    reasons.push(match detail {
        Some(detail) => Reason::detailed(evidence.code(), weight, detail),
        None => Reason::new(evidence.code(), weight),
    });
    weight
}

fn veto_detail(veto: Veto, facts: &ForegroundFacts) -> String {
    match veto {
        Veto::Executable => facts.exe_stem.clone(),
        Veto::Launcher => facts.exe_path.clone(),
        Veto::WindowClass => facts.class.clone(),
    }
}

fn finish(
    facts: &ForegroundFacts,
    title: Option<String>,
    verdict: Verdict,
    score: i32,
    reasons: Vec<Reason>,
) -> Assessment {
    Assessment {
        verdict,
        score,
        reasons,
        exe_path: facts.exe_path.clone(),
        exe_stem: facts.exe_stem.clone(),
        class: facts.class.clone(),
        title,
        hwnd: facts.hwnd,
        monitor_rect: facts.monitor_rect,
        shell: facts.shell,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{InstalledGame, Store};
    use crate::probe::Rect;

    const MONITOR: Rect = Rect {
        x: 0,
        y: 0,
        w: 2560,
        h: 1440,
    };

    fn facts(stem: &str, class: &str) -> ForegroundFacts {
        ForegroundFacts {
            hwnd: 1,
            pid: 42,
            exe_path: format!("c:\\apps\\{stem}.exe"),
            exe_stem: stem.to_owned(),
            class: class.to_owned(),
            has_caption: true,
            has_thickframe: true,
            rect: Rect {
                x: 100,
                y: 100,
                w: 800,
                h: 600,
            },
            monitor_rect: MONITOR,
            shell: ShellState::Normal,
        }
    }

    fn fullscreen(mut f: ForegroundFacts) -> ForegroundFacts {
        f.has_caption = false;
        f.has_thickframe = false;
        f.rect = MONITOR;
        f
    }

    fn empty_index() -> GameIndex {
        GameIndex::from_parts(Vec::new(), Vec::new())
    }

    fn index_with(path: &str, name: &str) -> GameIndex {
        GameIndex::from_parts(
            vec![InstalledGame {
                store: Store::Steam,
                name: name.to_owned(),
                install_dir: path.to_owned(),
            }],
            Vec::new(),
        )
    }

    #[test]
    fn explorer_is_never_a_game() {
        let got = assess(
            &fullscreen(facts("explorer", "CabinetWClass")),
            &empty_index(),
            false,
            &Rules::new(),
        );
        assert_eq!(got.verdict, Verdict::NotGame);
    }

    #[test]
    fn a_cad_package_in_fullscreen_is_never_a_game() {
        let mut f = fullscreen(facts("acad", "Afx:0000"));
        f.shell = ShellState::Busy;
        let got = assess(&f, &empty_index(), false, &Rules::new());
        assert_eq!(got.verdict, Verdict::NotGame);
        assert!(got.reasons.iter().any(|r| r.code == "veto:executable"));
    }

    #[test]
    fn a_fullscreen_browser_video_is_not_a_game() {
        let got = assess(
            &fullscreen(facts("chrome", "Chrome_WidgetWin_1")),
            &empty_index(),
            false,
            &Rules::new(),
        );
        assert_eq!(got.verdict, Verdict::NotGame);
    }

    #[test]
    fn the_minecraft_launcher_is_not_a_game() {
        // Installed under a game store (so it scores +60) and called
        // minecraft.exe (so no name list can catch it). Its path says what it
        // is. Reported from a real machine during shadow mode.
        let mut f = facts("minecraft", "MCLWindow");
        f.exe_path = "c:\\xboxgames\\minecraft launcher\\content\\minecraft.exe".to_owned();
        let index = index_with("c:\\xboxgames", "Xbox game");
        let got = assess(&f, &index, false, &Rules::new());
        assert_eq!(got.verdict, Verdict::NotGame);
        assert!(got.reasons.iter().any(|r| r.code == "veto:launcher"));
    }

    #[test]
    fn a_game_inside_a_store_directory_is_still_a_game() {
        // The launcher veto must not swallow everything under XboxGames.
        let mut f = fullscreen(facts("forza", "ForzaWindow"));
        f.exe_path = "c:\\xboxgames\\forza horizon\\content\\forza.exe".to_owned();
        let index = index_with("c:\\xboxgames", "Xbox game");
        let got = assess(&f, &index, false, &Rules::new());
        assert_eq!(got.verdict, Verdict::Game);
    }

    #[test]
    fn a_steam_game_in_borderless_is_a_game() {
        let index = index_with("c:\\apps", "Elden Ring");
        let got = assess(
            &fullscreen(facts("eldenring", "ELDEN RING")),
            &index,
            false,
            &Rules::new(),
        );
        assert_eq!(got.verdict, Verdict::Game);
        assert_eq!(got.title.as_deref(), Some("Elden Ring"));
    }

    #[test]
    fn rich_presence_alone_is_enough() {
        let got = assess(
            &facts("somegame", "GenericClass"),
            &empty_index(),
            true,
            &Rules::new(),
        );
        assert_eq!(got.verdict, Verdict::Game);
    }

    #[test]
    fn an_unknown_engine_game_is_only_probably() {
        // Unity class plus a plain window: 40, which asks rather than assumes.
        let got = assess(
            &facts("mystery", "UnityWndClass"),
            &empty_index(),
            false,
            &Rules::new(),
        );
        assert_eq!(got.verdict, Verdict::Probably);
        assert_eq!(got.score, 40);
    }

    #[test]
    fn fullscreen_shape_alone_never_reaches_a_game_verdict() {
        let mut f = fullscreen(facts("unknownapp", "SomeClass"));
        f.shell = ShellState::Busy;
        let got = assess(&f, &empty_index(), false, &Rules::new());
        assert_eq!(got.verdict, Verdict::Probably);
        assert!(got.score < GAME_THRESHOLD);
    }

    #[test]
    fn a_user_allow_rule_beats_the_denylist() {
        let mut rules = Rules::new();
        let _previous = rules.insert("c:\\apps\\vlc.exe".to_owned(), Rule::Allow);
        let got = assess(
            &fullscreen(facts("vlc", "Qt5152QWindowIcon")),
            &empty_index(),
            false,
            &rules,
        );
        assert_eq!(got.verdict, Verdict::Game);
    }

    #[test]
    fn a_user_deny_rule_beats_every_signal() {
        let mut rules = Rules::new();
        let _previous = rules.insert("c:\\apps\\eldenring.exe".to_owned(), Rule::Deny);
        let index = index_with("c:\\apps", "Elden Ring");
        let got = assess(&fullscreen(facts("eldenring", "X")), &index, true, &rules);
        assert_eq!(got.verdict, Verdict::NotGame);
    }

    #[test]
    fn exclusive_fullscreen_reports_that_it_cannot_show() {
        let mut f = fullscreen(facts("oldgame", "SDL_app"));
        f.shell = ShellState::ExclusiveFullscreen;
        let got = assess(&f, &empty_index(), false, &Rules::new());
        assert_eq!(got.verdict, Verdict::CannotShow);
    }

    #[test]
    fn a_presentation_suppresses_everything() {
        let mut f = fullscreen(facts("eldenring", "X"));
        f.shell = ShellState::Presenting;
        let index = index_with("c:\\apps", "Elden Ring");
        let got = assess(&f, &index, true, &Rules::new());
        assert_eq!(got.verdict, Verdict::NotGame);
    }
}
