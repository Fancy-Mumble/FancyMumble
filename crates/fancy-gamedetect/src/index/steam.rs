//! Steam's installed games, from the files Steam already keeps.
//!
//! `libraryfolders.vdf` lists every library folder the user has added; each
//! library's `steamapps` directory holds one `appmanifest_<appid>.acf` per
//! installed game, naming the game and the directory under `common/` that
//! holds it. Both are Valve's `KeyValues` text format, of which we need only
//! the "a quoted key followed by a quoted value" case.

use super::{normalise_dir, InstalledGame, Store};

/// Add every Steam game on this machine.
pub(super) fn collect(out: &mut Vec<InstalledGame>) {
    let Some(root) = steam_root() else { return };
    for library in library_folders(&root) {
        collect_library(&library, out);
    }
}

/// Where Steam itself is installed.
#[cfg(windows)]
fn steam_root() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey("Software\\Valve\\Steam").ok()?;
    key.get_value::<String, _>("SteamPath").ok()
}

#[cfg(not(windows))]
fn steam_root() -> Option<String> {
    None
}

/// Every library folder, including the one Steam itself lives in.
fn library_folders(root: &str) -> Vec<String> {
    let mut folders = vec![root.to_owned()];
    let vdf = std::path::Path::new(root)
        .join("steamapps")
        .join("libraryfolders.vdf");
    if let Ok(text) = std::fs::read_to_string(&vdf) {
        folders.extend(parse_library_paths(&text));
    }
    folders.sort();
    folders.dedup();
    folders
}

/// Read one library's `appmanifest_*.acf` files.
fn collect_library(library: &str, out: &mut Vec<InstalledGame>) {
    let steamapps = std::path::Path::new(library).join("steamapps");
    let Ok(entries) = std::fs::read_dir(&steamapps) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_manifest = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("appmanifest_") && n.ends_with(".acf"));
        if !is_manifest {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Some((name, install_dir)) = parse_manifest(&text) else {
            continue;
        };
        out.push(InstalledGame {
            store: Store::Steam,
            name,
            install_dir: normalise_dir(
                &steamapps.join("common").join(install_dir).to_string_lossy(),
            ),
        });
    }
}

/// Pull every `"path"` value out of a `libraryfolders.vdf`.
fn parse_library_paths(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| kv(line, "path"))
        .map(|p| unescape(&p))
        .collect()
}

/// Pull `(name, installdir)` out of an `appmanifest_*.acf`.
fn parse_manifest(text: &str) -> Option<(String, String)> {
    let mut name = None;
    let mut install_dir = None;
    for line in text.lines() {
        if name.is_none() {
            name = kv(line, "name");
        }
        if install_dir.is_none() {
            install_dir = kv(line, "installdir");
        }
        if name.is_some() && install_dir.is_some() {
            break;
        }
    }
    Some((unescape(&name?), unescape(&install_dir?)))
}

/// Read the value of `"key"  "value"` on one `KeyValues` line.
fn kv(line: &str, key: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let rest = trimmed.strip_prefix(&format!("\"{key}\""))?;
    let start = rest.find('"')? + 1;
    let value = &rest[start..];
    let end = value.find('"')?;
    Some(value[..end].to_owned())
}

/// `KeyValues` escapes backslashes; paths are the only place it matters here.
fn unescape(value: &str) -> String {
    value.replace("\\\\", "\\")
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIBRARY_FOLDERS: &str = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
		"totalsize"		"0"
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}
"#;

    const MANIFEST: &str = r#"
"AppState"
{
	"appid"		"1245620"
	"Universe"		"1"
	"name"		"ELDEN RING"
	"StateFlags"		"4"
	"installdir"		"ELDEN RING"
	"LastUpdated"		"1700000000"
}
"#;

    #[test]
    fn library_paths_are_unescaped() {
        let paths = parse_library_paths(LIBRARY_FOLDERS);
        assert_eq!(
            paths,
            vec![
                "C:\\Program Files (x86)\\Steam".to_owned(),
                "D:\\SteamLibrary".to_owned(),
            ]
        );
    }

    #[test]
    fn manifest_yields_name_and_install_dir() {
        assert_eq!(
            parse_manifest(MANIFEST),
            Some(("ELDEN RING".to_owned(), "ELDEN RING".to_owned()))
        );
    }

    #[test]
    fn a_manifest_without_an_installdir_is_skipped() {
        assert_eq!(
            parse_manifest("\"AppState\"\n{\n\t\"name\"\t\"X\"\n}"),
            None
        );
    }

    #[test]
    fn kv_ignores_a_key_that_merely_appears_in_a_value() {
        assert_eq!(kv("\t\"label\"\t\"path\"", "path"), None);
        assert_eq!(
            kv("\t\"path\"\t\"D:\\\\Games\"", "path"),
            Some("D:\\\\Games".to_owned())
        );
    }
}
