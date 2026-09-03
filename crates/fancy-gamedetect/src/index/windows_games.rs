//! Windows' own opinion of which executables are games.
//!
//! `HKCU\System\GameConfigStore\Children` holds one subkey per executable the
//! system has classified as a game - written when Fullscreen Optimizations
//! recognises a title and when the user ticks Game Bar's "Remember this is a
//! game". Each subkey's `MatchedExeFullPath` is the executable it refers to.
//!
//! This is the closest thing to an authoritative local answer, and it costs
//! one shallow registry enumeration.

/// Every executable Windows remembers as a game, lowercased.
#[cfg(windows)]
pub(super) fn remembered_executables() -> Vec<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(children) = hkcu.open_subkey("System\\GameConfigStore\\Children") else {
        return Vec::new();
    };
    children
        .enum_keys()
        .flatten()
        .filter_map(|name| children.open_subkey(&name).ok())
        .filter_map(|child| child.get_value::<String, _>("MatchedExeFullPath").ok())
        .map(|path| path.trim().to_ascii_lowercase())
        .filter(|path| !path.is_empty())
        .collect()
}

#[cfg(not(windows))]
pub(super) fn remembered_executables() -> Vec<String> {
    Vec::new()
}
