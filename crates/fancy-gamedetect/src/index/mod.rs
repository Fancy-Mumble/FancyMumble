//! The installed-game index: which directories on this machine hold games.
//!
//! This is the local replacement for Discord's server-side list of ten
//! thousand executables. Every launcher already records what it installed and
//! where - Steam in its `appmanifest` files, Epic in JSON manifests, the rest
//! in the registry - so the same question ("did a game store put this
//! executable here?") is answerable from disk, with no network call, no
//! central list to maintain, and no dependence on an undocumented endpoint.
//!
//! Windows also keeps its own list: `GameConfigStore` holds the executables
//! Game Bar and Fullscreen Optimizations have classified as games, which is
//! where "Remember this is a game" writes to.

mod epic;
mod registry_stores;
mod steam;
mod windows_games;

/// Which launcher installed a game.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Store {
    /// Valve's Steam.
    Steam,
    /// Epic Games Store.
    Epic,
    /// GOG Galaxy.
    Gog,
    /// Ubisoft Connect.
    Ubisoft,
    /// EA app / Origin.
    Ea,
    /// Battle.net.
    BattleNet,
    /// Riot Client.
    Riot,
    /// Xbox app / Microsoft Store.
    Xbox,
}

impl Store {
    /// Human-readable name, used in the diagnostics panel's reason strings.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Steam => "Steam",
            Self::Epic => "Epic",
            Self::Gog => "GOG",
            Self::Ubisoft => "Ubisoft",
            Self::Ea => "EA",
            Self::BattleNet => "Battle.net",
            Self::Riot => "Riot",
            Self::Xbox => "Xbox",
        }
    }
}

/// One game a launcher says it installed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledGame {
    /// Which launcher installed it.
    pub store: Store,
    /// The name the launcher records, shown in the ask-once prompt.
    pub name: String,
    /// Install directory, lowercased and without a trailing separator.
    pub install_dir: String,
}

/// Everything on this machine that a launcher or Windows calls a game.
#[derive(Debug, Default)]
pub struct GameIndex {
    games: Vec<InstalledGame>,
    /// Lowercased executable paths from Windows' own `GameConfigStore`.
    remembered: Vec<String>,
}

impl GameIndex {
    /// Walk every launcher's records and Windows' game list.
    ///
    /// Failures are logged and skipped: a machine without Epic installed
    /// simply contributes no Epic games, and one whose registry is locked down
    /// falls back on the evidence that does not need it.
    #[must_use]
    pub fn build() -> Self {
        let mut games = Vec::new();
        steam::collect(&mut games);
        epic::collect(&mut games);
        registry_stores::collect(&mut games);

        // Longest first, so a game installed inside another store's directory
        // resolves to the more specific entry.
        games.sort_by_key(|game| std::cmp::Reverse(game.install_dir.len()));
        games.dedup_by(|a, b| a.install_dir == b.install_dir);

        let remembered = windows_games::remembered_executables();
        tracing::debug!(
            games = games.len(),
            remembered = remembered.len(),
            "game index built"
        );
        Self { games, remembered }
    }

    /// Build an index directly, for tests.
    #[must_use]
    pub fn from_parts(games: Vec<InstalledGame>, remembered: Vec<String>) -> Self {
        Self { games, remembered }
    }

    /// How many installed games are known.
    #[must_use]
    pub fn len(&self) -> usize {
        self.games.len()
    }

    /// Is the index empty?
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.games.is_empty()
    }

    /// The game whose install directory contains `exe_path`, if any.
    ///
    /// `exe_path` must already be lowercased; the index stores its directories
    /// the same way so the comparison is a plain prefix test.
    #[must_use]
    pub fn lookup(&self, exe_path: &str) -> Option<&InstalledGame> {
        self.games
            .iter()
            .find(|game| is_under(exe_path, &game.install_dir))
    }

    /// Does Windows itself remember this executable as a game?
    #[must_use]
    pub fn windows_remembers(&self, exe_path: &str) -> bool {
        self.remembered.iter().any(|p| p == exe_path)
    }
}

/// Is `exe_path` inside `dir`?
///
/// A plain `starts_with` would match `c:\games\portal2` against
/// `c:\games\portal`, so the character after the directory has to be a
/// separator.
fn is_under(exe_path: &str, dir: &str) -> bool {
    if dir.is_empty() || !exe_path.starts_with(dir) {
        return false;
    }
    matches!(exe_path.as_bytes().get(dir.len()), Some(b'\\' | b'/'))
}

/// Lowercase a path and strip any trailing separator, so the index and the
/// probe agree on spelling.
pub(crate) fn normalise_dir(path: &str) -> String {
    path.trim()
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(dir: &str, name: &str) -> InstalledGame {
        InstalledGame {
            store: Store::Steam,
            name: name.to_owned(),
            install_dir: normalise_dir(dir),
        }
    }

    #[test]
    fn lookup_matches_only_on_a_directory_boundary() {
        let index = GameIndex::from_parts(vec![game("c:\\games\\portal", "Portal")], Vec::new());
        assert!(index.lookup("c:\\games\\portal\\portal.exe").is_some());
        assert!(index.lookup("c:\\games\\portal2\\portal2.exe").is_none());
    }

    #[test]
    fn lookup_prefers_the_more_specific_directory() {
        let mut games = vec![
            game("c:\\steam\\steamapps\\common", "library root"),
            game("c:\\steam\\steamapps\\common\\hades", "Hades"),
        ];
        games.sort_by_key(|game| std::cmp::Reverse(game.install_dir.len()));
        let index = GameIndex::from_parts(games, Vec::new());
        assert_eq!(
            index
                .lookup("c:\\steam\\steamapps\\common\\hades\\hades.exe")
                .map(|g| g.name.as_str()),
            Some("Hades")
        );
    }

    #[test]
    fn normalise_dir_lowercases_and_trims() {
        assert_eq!(normalise_dir("C:\\Games\\Thing\\"), "c:\\games\\thing");
    }

    #[test]
    fn windows_remembers_is_an_exact_path_match() {
        let index =
            GameIndex::from_parts(Vec::new(), vec!["c:\\games\\thing\\thing.exe".to_owned()]);
        assert!(index.windows_remembers("c:\\games\\thing\\thing.exe"));
        assert!(!index.windows_remembers("c:\\games\\thing\\other.exe"));
    }
}
