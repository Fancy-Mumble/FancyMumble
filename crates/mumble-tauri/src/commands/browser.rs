//! Opening a link in the default browser's *private* window.
//!
//! No operating system has an "open this privately" verb. `ShellExecute`,
//! `xdg-open` and macOS `open` each hand a URL to whichever application claims
//! the scheme and let that application decide everything else, which is what
//! `tauri_plugin_opener` does and why every link the client opens today lands
//! in an ordinary window. Private browsing exists only as a *browser's own
//! command-line switch*, so offering it at all means working out which browser
//! is the default and launching that binary ourselves, with its flag.
//!
//! Three things follow from that, and the UI is built around them:
//!
//! * It is a private **window**, never a private tab. No browser will put a
//!   private tab in an ordinary window - on all of them the profile boundary
//!   *is* the window - so the menu says "window" and means it.
//! * A browser nobody here recognises gets no guess. An unknown switch is not
//!   ignored by a browser, it is treated as a URL or a profile path, so the
//!   answer to "which flag?" is either a known one or none at all.
//! * Safari has no such switch. A Mac whose default is Safari simply cannot do
//!   this, and [`can_open_url_private`] says so before a row is drawn that
//!   could only fail.
//!
//! Nothing here ever reaches a shell: the URL is one element of an argument
//! vector, and [`checked_url`] is what makes it safe to be there.

use std::path::{Path, PathBuf};
use std::process::Command;

use url::Url;

/// Longest URL handed to a browser as a process argument.
///
/// Browsers stop parsing a command line somewhere past this anyway, and a
/// megabyte `data:`-shaped string arriving from a message body has no business
/// being spawned even though [`checked_url`] would already have refused it for
/// its scheme.
const MAX_URL_LEN: usize = 8192;

/// How a browser is launched into a private window.
#[derive(Debug, Clone)]
struct PrivateLaunch {
    /// Program plus every argument that must precede ours, program first.
    argv: Vec<String>,
    /// This browser's private-window switch.
    flag: &'static str,
}

// -- Recognising a browser -----------------------------------------

/// The switch each browser family spells private browsing with.
///
/// Keyed by [`browser_key`]'s normalised form, so one row covers
/// `C:\Program Files\Mozilla Firefox\firefox.exe`, `/snap/bin/firefox` and
/// `/usr/lib/firefox-esr/firefox-esr` alike.
///
/// Chromium and Gecko both accept their switch while the browser is already
/// running: the second process hands its command line to the first, which
/// opens the private window. That is what makes this usable at all - the
/// alternative would be a second browser instance per link.
const PRIVATE_FLAGS: &[(&str, &str)] = &[
    // Chromium family.
    ("chrome", "--incognito"),
    ("chrome-stable", "--incognito"),
    ("google-chrome", "--incognito"),
    ("google-chrome-stable", "--incognito"),
    ("google-chrome-beta", "--incognito"),
    ("google-chrome-unstable", "--incognito"),
    ("chromium", "--incognito"),
    ("chromium-browser", "--incognito"),
    ("brave", "--incognito"),
    ("brave-browser", "--incognito"),
    ("brave-browser-stable", "--incognito"),
    ("vivaldi", "--incognito"),
    ("vivaldi-stable", "--incognito"),
    ("thorium", "--incognito"),
    ("thorium-browser", "--incognito"),
    ("ungoogled-chromium", "--incognito"),
    ("yandex", "--incognito"),
    ("yandex_browser", "--incognito"),
    // Edge. Spelled `--inprivate`, and it is the one Chromium derivative that
    // does not also answer to `--incognito`.
    ("msedge", "--inprivate"),
    ("microsoft-edge", "--inprivate"),
    ("microsoft-edge-stable", "--inprivate"),
    ("microsoft-edge-beta", "--inprivate"),
    ("microsoft-edge-dev", "--inprivate"),
    // Opera, which is Chromium underneath but keeps its own spelling.
    ("opera", "--private"),
    ("opera-stable", "--private"),
    ("opera-beta", "--private"),
    ("opera_gx", "--private"),
    ("opera-gx", "--private"),
    // Gecko family. Firefox accepts one dash or two; two keeps the table
    // uniform and both have worked for as long as the switch has existed.
    ("firefox", "--private-window"),
    ("firefox-esr", "--private-window"),
    ("firefox-bin", "--private-window"),
    ("firefox-developer-edition", "--private-window"),
    ("librewolf", "--private-window"),
    ("waterfox", "--private-window"),
    ("floorp", "--private-window"),
    ("zen", "--private-window"),
    ("zen-browser", "--private-window"),
    ("mullvad-browser", "--private-window"),
    ("icecat", "--private-window"),
    ("palemoon", "--private-window"),
    // Application ids rather than executables: a Flatpak's Exec line names the
    // browser nowhere else (`flatpak run ... org.mozilla.firefox`), and macOS
    // knows its default browser only as a bundle id.
    ("org.mozilla.firefox", "--private-window"),
    ("io.gitlab.librewolf-community", "--private-window"),
    ("net.waterfox.waterfox", "--private-window"),
    ("one.ablaze.floorp", "--private-window"),
    ("app.zen_browser.zen", "--private-window"),
    ("com.google.chrome", "--incognito"),
    ("com.brave.browser", "--incognito"),
    ("org.chromium.chromium", "--incognito"),
    ("com.vivaldi.vivaldi", "--incognito"),
    ("com.microsoft.edge", "--inprivate"),
    ("com.microsoft.edgemac", "--inprivate"),
    ("com.operasoftware.opera", "--private"),
    ("com.operasoftware.operagx", "--private"),
];

/// The name a command-line token would be known by, or `None` where it is not
/// a name at all.
///
/// Everything before the last separator goes, a `.exe` suffix goes, and what
/// is left is lowercased - the same browser is `firefox`, `Firefox.exe` and
/// `/usr/bin/firefox` depending on who is being asked. A token that opens with
/// a dash is a switch rather than a name and is refused here, so a browser
/// already being passed `--profile-directory=chrome` is not mistaken for one.
fn browser_key(token: &str) -> Option<String> {
    if token.is_empty() || token.starts_with('-') {
        return None;
    }
    let base = token.rsplit(['/', '\\']).next().unwrap_or(token);
    if base.is_empty() {
        return None;
    }
    let stem = base
        .strip_suffix(".exe")
        .or_else(|| base.strip_suffix(".EXE"))
        .unwrap_or(base);
    Some(stem.to_ascii_lowercase())
}

/// The private-window switch for one normalised name.
fn flag_for_key(key: &str) -> Option<&'static str> {
    PRIVATE_FLAGS
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, flag)| *flag)
}

/// The directory a path token sits in, normalised the same way as a name.
///
/// The second guess, and only ever a guess. Opera registers a generic
/// `launcher.exe` as its URL handler, which names no browser at all - but it
/// lives in `...\Programs\Opera\`, and the folder a browser installs itself
/// into is its own name far more often than it is anything else.
fn parent_key(token: &str) -> Option<String> {
    let parent = Path::new(token).parent()?.file_name()?.to_str()?;
    browser_key(parent)
}

/// The private-window switch for a whole command line, or `None` when nothing
/// in it names a browser this code knows how to ask.
///
/// Every token is considered, not only the program: a Flatpak wrapper's
/// browser is its last argument, and macOS `open` carries a bundle id in the
/// middle. Executable names are tried across the whole line before any
/// directory name is, so the weaker guess never outranks a real answer.
fn flag_for_argv(argv: &[String]) -> Option<&'static str> {
    argv.iter()
        .filter_map(|token| browser_key(token))
        .find_map(|key| flag_for_key(&key))
        .or_else(|| {
            argv.iter()
                .filter_map(|token| parent_key(token))
                .find_map(|key| flag_for_key(&key))
        })
}

// -- The URL -------------------------------------------------------

/// The URL as it may be spawned, or why it may not be.
///
/// What comes back is the *parse*, re-serialised, and never the caller's
/// string. That is the whole defence: a browser reads its command line as
/// switches, so a link body of `--profile-directory=...` or
/// `--load-extension=...` reaching `argv` would be a browser flag rather than
/// a page, and `file:`/`javascript:` would be a local read or a script. Only
/// `http` and `https` survive, and a URL that parsed as either cannot come
/// back out of the parser leading with a dash - which is asserted rather than
/// assumed, because that is the property everything else here rests on.
fn checked_url(raw: &str) -> Result<String, String> {
    if raw.len() > MAX_URL_LEN {
        return Err("link is too long to open".to_owned());
    }
    let parsed = Url::parse(raw).map_err(|_| "not a valid link".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http and https links can be opened".to_owned());
    }
    let text = parsed.to_string();
    if text.starts_with('-') {
        return Err("not a valid link".to_owned());
    }
    Ok(text)
}

// -- Finding the default browser: Windows --------------------------

/// The default browser's command line, as Windows records it.
///
/// The user's own choice lives under `UrlAssociations`, which is what the
/// Settings app writes and what the browsers themselves ask people to set; the
/// machine-wide `https` association is only the fallback for a profile that
/// has never chosen. Either way it ends at a `shell\open\command` string.
///
/// Only the program is kept. The registered command line is written for
/// `ShellExecute` and carries pieces that would wreck an appended flag -
/// Chromium's `--single-argument %1` swallows everything after it as one URL,
/// and Firefox's `-osint` restricts the process to exactly the one URL that
/// follows. A browser launched directly needs none of it.
#[cfg(target_os = "windows")]
fn windows_browser_argv() -> Result<Vec<String>, String> {
    use windows_registry::{CLASSES_ROOT, CURRENT_USER};

    const USER_CHOICE: &str =
        r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice";

    let registered = CURRENT_USER
        .open(USER_CHOICE)
        .and_then(|key| key.get_string("ProgId"))
        .ok()
        .and_then(|prog_id| {
            CLASSES_ROOT
                .open(format!(r"{prog_id}\shell\open\command"))
                .and_then(|key| key.get_string(""))
                .ok()
        })
        .or_else(|| {
            CLASSES_ROOT
                .open(r"https\shell\open\command")
                .and_then(|key| key.get_string(""))
                .ok()
        })
        .ok_or_else(|| "no default browser is registered".to_owned())?;

    let program = windows_program(&registered)
        .ok_or_else(|| "the registered browser command is empty".to_owned())?;
    Ok(vec![program])
}

/// The program out of a registered Windows command string.
///
/// Windows quotes a path containing spaces and leaves it bare otherwise, which
/// is the whole of the grammar that matters here - everything after the
/// program is dropped by the caller, so the argument quoting never has to be
/// understood.
#[cfg_attr(
    not(target_os = "windows"),
    allow(
        dead_code,
        reason = "parsed only on Windows, but tested on every platform"
    )
)]
fn windows_program(command: &str) -> Option<String> {
    let command = command.trim();
    let program = match command.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?,
        None => command.split_whitespace().next()?,
    };
    if program.is_empty() {
        None
    } else {
        Some(program.to_owned())
    }
}

// -- Finding the default browser: Linux ----------------------------

/// The default browser's command line, as the desktop records it.
///
/// `xdg-settings` is asked first because it is the question actually being
/// asked - "which browser?" - and falls back to the `https` scheme handler,
/// which is the same answer by a longer route on a desktop too small to ship
/// `xdg-settings`. Both name a `.desktop` file, whose `Exec` line is the
/// command; keeping its arguments matters here, unlike on Windows, because a
/// Flatpak browser *is* `flatpak run <app-id>` and nothing without those.
#[cfg_attr(
    not(target_os = "linux"),
    allow(
        dead_code,
        reason = "only called on Linux, but type-checked on every platform"
    )
)]
fn linux_browser_argv() -> Result<Vec<String>, String> {
    let id = query_line("xdg-settings", &["get", "default-web-browser"])
        .or_else(|| query_line("xdg-mime", &["query", "default", "x-scheme-handler/https"]))
        .ok_or_else(|| "no default browser is set".to_owned())?;

    let path = desktop_file_path(&id)
        .ok_or_else(|| format!("the default browser's {id} was not found"))?;
    let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let exec =
        desktop_exec(&contents).ok_or_else(|| format!("{} has no Exec line", path.display()))?;
    let argv = split_exec(&exec);
    if argv.is_empty() {
        return Err(format!("{} has an empty Exec line", path.display()));
    }
    Ok(argv)
}

/// First line of a helper's output, or `None` if it did not run or said
/// nothing useful.
#[cfg_attr(
    not(target_os = "linux"),
    allow(
        dead_code,
        reason = "only called on Linux, but type-checked on every platform"
    )
)]
fn query_line(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        None
    } else {
        Some(line.to_owned())
    }
}

/// Where a desktop entry with this id lives.
///
/// The search order is the XDG one: the user's own applications win over the
/// system's. An id carrying a dash may have been filed in a subdirectory
/// instead - `kde-firefox.desktop` as `kde/firefox.desktop` - which the spec
/// allows and some desktops do.
#[cfg_attr(
    not(target_os = "linux"),
    allow(
        dead_code,
        reason = "only called on Linux, but type-checked on every platform"
    )
)]
fn desktop_file_path(id: &str) -> Option<PathBuf> {
    for dir in application_dirs() {
        let direct = dir.join(id);
        if direct.is_file() {
            return Some(direct);
        }
        if let Some((prefix, rest)) = id.split_once('-') {
            let nested = dir.join(prefix).join(rest);
            if nested.is_file() {
                return Some(nested);
            }
        }
    }
    None
}

/// Every `applications` directory, most specific first.
#[cfg_attr(
    not(target_os = "linux"),
    allow(
        dead_code,
        reason = "only called on Linux, but type-checked on every platform"
    )
)]
fn application_dirs() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("XDG_DATA_HOME").map(PathBuf::from) {
        roots.push(home);
    } else if let Ok(home) = std::env::var("HOME") {
        roots.push(Path::new(&home).join(".local/share"));
    }
    let system =
        std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".to_owned());
    roots.extend(
        system
            .split(':')
            .filter(|s| !s.is_empty())
            .map(PathBuf::from),
    );
    // Flatpak exports normally arrive through XDG_DATA_DIRS, but a session
    // that never sourced the profile snippet still has the browser installed.
    if let Ok(home) = std::env::var("HOME") {
        roots.push(Path::new(&home).join(".local/share/flatpak/exports/share"));
    }
    roots.push(PathBuf::from("/var/lib/flatpak/exports/share"));
    roots
        .into_iter()
        .map(|root| root.join("applications"))
        .collect()
}

/// The `Exec` line of a desktop entry's own group.
///
/// Only `[Desktop Entry]` is read. A file's later groups are its actions -
/// "Open a New Private Window" among them on some browsers - and each carries
/// an `Exec` of its own that the first match would otherwise pick up.
#[cfg_attr(
    not(target_os = "linux"),
    allow(
        dead_code,
        reason = "parsed only on Linux, but tested on every platform"
    )
)]
fn desktop_exec(contents: &str) -> Option<String> {
    let mut in_entry = false;
    for line in contents.lines() {
        let line = line.trim();
        if let Some(group) = line.strip_prefix('[') {
            in_entry = group.strip_suffix(']') == Some("Desktop Entry");
            continue;
        }
        if !in_entry {
            continue;
        }
        if let Some(rest) = line.strip_prefix("Exec=") {
            return Some(rest.to_owned());
        }
    }
    None
}

/// An `Exec` line split the way the desktop entry specification says to.
///
/// Quoting is the spec's: double quotes group, a backslash escapes the next
/// character inside them. Field codes are dropped rather than expanded - `%u`
/// is where the launcher would have put the URL, and the URL is appended after
/// the flag instead, so leaving one in would open the page twice, the second
/// time in an ordinary window.
#[cfg_attr(
    not(target_os = "linux"),
    allow(
        dead_code,
        reason = "parsed only on Linux, but tested on every platform"
    )
)]
fn split_exec(exec: &str) -> Vec<String> {
    const FIELD_CODES: &[&str] = &[
        "%f", "%F", "%u", "%U", "%d", "%D", "%n", "%N", "%i", "%c", "%k", "%v", "%m",
    ];

    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut started = false;
    let mut quoted = false;
    let mut chars = exec.chars();

    while let Some(c) = chars.next() {
        match c {
            '\\' if quoted => current.extend(chars.next()),
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    tokens.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            c => {
                current.push(c);
                started = true;
            }
        }
    }
    if started {
        tokens.push(current);
    }
    tokens.retain(|token| !FIELD_CODES.contains(&token.as_str()));
    tokens
        .iter_mut()
        .for_each(|token| *token = token.replace("%%", "%"));
    tokens
}

// -- Finding the default browser: macOS ----------------------------

/// The default browser's command line, as `LaunchServices` records it.
///
/// The handler map is a binary plist, so `plutil` converts it rather than this
/// code learning the format. An `https` entry missing altogether means nobody
/// has ever changed the default, which on macOS means Safari - and Safari has
/// no private-window switch, so that is reported as unsupported rather than
/// guessed at.
///
/// The launch goes through `open -n`, whose `--args` reach the browser only on
/// a fresh process: an already-running Chromium or Firefox sees the second
/// process start, takes its command line, and opens the private window in the
/// window it already has.
#[cfg_attr(
    not(target_os = "macos"),
    allow(
        dead_code,
        reason = "only called on macOS, but type-checked on every platform"
    )
)]
fn macos_browser_argv() -> Result<Vec<String>, String> {
    let home = std::env::var("HOME").map_err(|_| "no home directory".to_owned())?;
    let plist = Path::new(&home)
        .join("Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist");

    let output = Command::new("plutil")
        .args(["-convert", "json", "-o", "-"])
        .arg(&plist)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("could not read the browser handler list".to_owned());
    }
    let parsed: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;

    let bundle_id = https_handler(&parsed)
        .ok_or_else(|| "the default browser has no private-window mode".to_owned())?;
    Ok(vec![
        "open".to_owned(),
        "-n".to_owned(),
        "-b".to_owned(),
        bundle_id,
        "--args".to_owned(),
    ])
}

/// The bundle id claiming `https` in a converted `LaunchServices` plist.
///
/// The last matching entry wins: the list is append-ordered, so a browser set
/// as default twice appears twice and the later row is the live one.
#[cfg_attr(
    not(target_os = "macos"),
    allow(
        dead_code,
        reason = "only called on macOS, but type-checked on every platform"
    )
)]
fn https_handler(parsed: &serde_json::Value) -> Option<String> {
    parsed
        .get("LSHandlers")?
        .as_array()?
        .iter()
        .filter(|entry| {
            entry
                .get("LSHandlerURLScheme")
                .and_then(serde_json::Value::as_str)
                == Some("https")
        })
        .filter_map(|entry| {
            entry
                .get("LSHandlerRoleAll")
                .and_then(serde_json::Value::as_str)
        })
        .next_back()
        .map(str::to_owned)
}

// -- Putting it together -------------------------------------------

/// The default browser's command line on whichever desktop this is.
///
/// Only the dispatch is conditional. Each resolver above is compiled on every
/// platform - they are plain `std`, apart from the Windows registry - so a
/// mistake in the Linux path is a compile error on a Windows machine rather
/// than a broken Linux build discovered in CI. Android reaches the last arm:
/// it has no default-browser command line to find, and no browser there takes
/// a private-mode switch from another application.
fn default_browser_argv() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        windows_browser_argv()
    }
    #[cfg(target_os = "linux")]
    {
        linux_browser_argv()
    }
    #[cfg(target_os = "macos")]
    {
        macos_browser_argv()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Err("private windows are not available on this platform".to_owned())
    }
}

/// The default browser and the switch that opens it privately.
fn resolve() -> Result<PrivateLaunch, String> {
    let argv = default_browser_argv()?;
    let flag = flag_for_argv(&argv)
        .ok_or_else(|| "your default browser has no private-window mode".to_owned())?;
    Ok(PrivateLaunch { argv, flag })
}

// -- Commands ------------------------------------------------------

/// Whether "open in a private window" can be honoured on this machine.
///
/// Asked before the row is drawn, because there is no honest way to fail at
/// the click: silently opening an ordinary window would be the opposite of
/// what was asked for, and an error where a page was expected is worse than a
/// menu that never offered it. False covers all three ways this can be off -
/// no default browser, an unrecognised one, and Safari.
#[tauri::command]
pub(crate) fn can_open_url_private() -> bool {
    resolve().is_ok()
}

/// Open one `http`/`https` URL in a new private window of the default browser.
///
/// Deliberately without a fallback: a caller that wanted an ordinary window
/// would have used the opener plugin, and a private request quietly served by
/// a normal window is a privacy promise broken silently. A failure comes back
/// as a message for the caller to show.
#[tauri::command]
pub(crate) fn open_url_private(url: String) -> Result<(), String> {
    let url = checked_url(&url)?;
    let launch = resolve()?;
    let (program, leading) = launch
        .argv
        .split_first()
        .ok_or_else(|| "the default browser has no command".to_owned())?;

    let child = Command::new(program)
        .args(leading)
        .arg(launch.flag)
        .arg(&url)
        .spawn()
        .map_err(|e| format!("could not start {program}: {e}"))?;
    // Nothing waits for it: the browser outlives this client, and a `Child`
    // dropped without a wait is exactly the "launch and forget" wanted here.
    drop(child);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_key_normalises_paths_and_extensions() {
        assert_eq!(
            browser_key(r"C:\Program Files\Mozilla Firefox\firefox.exe").as_deref(),
            Some("firefox")
        );
        assert_eq!(browser_key("/snap/bin/firefox").as_deref(), Some("firefox"));
        assert_eq!(browser_key("MSEDGE.EXE").as_deref(), Some("msedge"));
        assert_eq!(
            browser_key("org.mozilla.firefox").as_deref(),
            Some("org.mozilla.firefox")
        );
    }

    #[test]
    fn a_switch_is_never_read_as_a_browser_name() {
        assert_eq!(browser_key("--profile-directory=chrome"), None);
        assert_eq!(browser_key("-osint"), None);
        assert_eq!(browser_key(""), None);
    }

    #[test]
    fn each_family_gets_its_own_switch() {
        let flag = |token: &str| flag_for_argv(&[token.to_owned()]);
        assert_eq!(flag("/usr/bin/google-chrome-stable"), Some("--incognito"));
        assert_eq!(
            flag(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
            Some("--inprivate")
        );
        assert_eq!(flag("/usr/bin/firefox"), Some("--private-window"));
        assert_eq!(flag("/usr/bin/opera"), Some("--private"));
    }

    #[test]
    fn an_unknown_browser_gets_no_guess() {
        assert_eq!(flag_for_argv(&["/usr/bin/lynx".to_owned()]), None);
        assert_eq!(flag_for_argv(&[]), None);
    }

    #[test]
    fn a_flatpak_wrapper_is_recognised_by_its_app_id() {
        let argv: Vec<String> = [
            "/usr/bin/flatpak",
            "run",
            "--branch=stable",
            "org.mozilla.firefox",
        ]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
        assert_eq!(flag_for_argv(&argv), Some("--private-window"));
    }

    #[test]
    fn a_generic_launcher_falls_back_to_its_directory() {
        let argv = vec![r"C:\Users\a\AppData\Local\Programs\Opera\launcher.exe".to_owned()];
        assert_eq!(flag_for_argv(&argv), Some("--private"));
    }

    #[test]
    fn a_real_name_outranks_a_directory_name() {
        // The folder says Opera, the program says Firefox. The program wins,
        // or a rename would silently hand Firefox a switch it does not have.
        let argv = vec![r"C:\Programs\Opera\firefox.exe".to_owned()];
        assert_eq!(flag_for_argv(&argv), Some("--private-window"));
    }

    #[test]
    fn only_http_and_https_survive_checking() {
        assert!(checked_url("https://example.com/a?b=c#d").is_ok());
        assert!(checked_url("http://example.com").is_ok());
        assert!(checked_url("file:///etc/passwd").is_err());
        assert!(checked_url("javascript:alert(1)").is_err());
        assert!(checked_url("not a url").is_err());
        assert!(checked_url(&format!("https://example.com/{}", "a".repeat(MAX_URL_LEN))).is_err());
    }

    #[test]
    fn a_checked_url_can_never_read_as_a_switch() {
        // The reason the whole argument vector is safe to build.
        for raw in ["--incognito", "-osint", "--load-extension=/tmp/x"] {
            assert!(checked_url(raw).is_err());
        }
        assert!(
            !checked_url("https://example.com/--load-extension")
                .unwrap()
                .starts_with('-')
        );
    }

    #[test]
    fn a_registered_windows_command_yields_its_program() {
        assert_eq!(
            windows_program(r#""C:\Program Files\Mozilla Firefox\firefox.exe" -osint -url "%1""#)
                .as_deref(),
            Some(r"C:\Program Files\Mozilla Firefox\firefox.exe"),
        );
        assert_eq!(
            windows_program(r"C:\Windows\explorer.exe %1").as_deref(),
            Some(r"C:\Windows\explorer.exe"),
        );
        assert_eq!(windows_program("   "), None);
    }

    #[test]
    fn only_the_desktop_entrys_own_exec_is_read() {
        let file = "[Desktop Entry]\nName=Firefox\nExec=/usr/lib/firefox/firefox %u\n\n\
                    [Desktop Action new-private-window]\nExec=/usr/lib/firefox/firefox --private-window %u\n";
        assert_eq!(
            desktop_exec(file).as_deref(),
            Some("/usr/lib/firefox/firefox %u")
        );
        assert_eq!(desktop_exec("[Desktop Entry]\nName=X\n"), None);
    }

    #[test]
    fn an_exec_line_splits_and_drops_its_field_codes() {
        assert_eq!(
            split_exec(r#""/opt/My Browser/br" --foo %u"#),
            vec!["/opt/My Browser/br".to_owned(), "--foo".to_owned()],
        );
        assert_eq!(
            split_exec("/usr/bin/flatpak run --branch=stable org.mozilla.firefox @@u %u @@"),
            vec![
                "/usr/bin/flatpak".to_owned(),
                "run".to_owned(),
                "--branch=stable".to_owned(),
                "org.mozilla.firefox".to_owned(),
                "@@u".to_owned(),
                "@@".to_owned(),
            ],
        );
    }
}
