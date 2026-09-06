//! Release channels: which manifest a build is offered from, and which of
//! two candidate versions wins.
//!
//! There are two channels. **Stable** is what every install polls by
//! default: `releases/latest/download/latest.json`, which GitHub resolves to
//! the newest release that is *not* flagged as a pre-release. **Beta** is
//! opt-in (`betaUpdates` in `preferences.json`) and lives at a fixed URL on
//! the repository's orphan `updater` branch, because GitHub publishes no
//! "latest pre-release" download alias.
//!
//! Beta versions carry a semver pre-release part (`0.4.0-beta.7`), so the
//! ordering that falls out of plain semver is exactly the one we want:
//!
//! ```text
//! 0.3.0  <  0.4.0-beta.1  <  0.4.0-beta.2  <  0.4.0
//! ```
//!
//! An opted-in client therefore rolls onto the stable `0.4.0` on its own the
//! moment it ships, and a client that opts back out simply stops being
//! offered anything until stable overtakes the beta it is running.

/// Where the beta manifest lives.
///
/// Written by the `release` job in `.github/workflows/ci.yml`, which copies
/// the generated `latest.json` to `beta.json` on the orphan `updater` branch
/// after the pre-release itself is published. Served by
/// `raw.githubusercontent.com`, which caches for a few minutes - a beta build
/// can lag its release by that much, which is fine for an opt-in channel.
pub(crate) const BETA_MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/Fancy-Mumble/FancyMumble/updater/beta.json";

/// Environment override for the beta endpoint, honoured in debug builds only.
///
/// Lets the channel logic be exercised against a local file server without
/// publishing anything: see the "Releases and update channels" section of
/// `README.md`.
#[cfg(debug_assertions)]
const BETA_URL_ENV: &str = "FANCY_UPDATER_BETA_URL";

/// The beta manifest URL this build should ask for.
pub(crate) fn beta_manifest_url() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(url) = std::env::var(BETA_URL_ENV) {
            if !url.is_empty() {
                tracing::info!("Updater: beta endpoint overridden by {BETA_URL_ENV}: {url}");
                return url;
            }
        }
    }
    BETA_MANIFEST_URL.to_string()
}

/// True when `version` is a pre-release (i.e. a beta build).
///
/// Anything unparsable is reported as stable: the string still reaches the
/// user as-is, and a wrong badge is a better failure than a panic.
pub(crate) fn is_prerelease(version: &str) -> bool {
    semver::Version::parse(version).is_ok_and(|v| !v.pre.is_empty())
}

/// Index of the newest version in `versions`, or `None` when none of them
/// parses.
///
/// Entries that are not valid semver are skipped rather than treated as
/// oldest, so a malformed manifest can never win. Ties keep the earliest
/// index, which is how the caller expresses "prefer stable at equal
/// versions".
pub(crate) fn pick_newest(versions: &[&str]) -> Option<usize> {
    versions
        .iter()
        .enumerate()
        .filter_map(|(i, raw)| semver::Version::parse(raw).ok().map(|v| (i, v)))
        // `max_by` keeps the *last* maximum, so compare in a way that makes an
        // equal version lose to the one already held: reverse the index.
        .max_by(|(ia, a), (ib, b)| a.cmp(b).then(ib.cmp(ia)))
        .map(|(i, _)| i)
}

#[cfg(test)]
mod tests {
    use super::{is_prerelease, pick_newest};

    #[test]
    fn nothing_to_pick_from() {
        assert_eq!(pick_newest(&[]), None);
        assert_eq!(pick_newest(&["not-a-version", ""]), None);
    }

    #[test]
    fn a_single_candidate_wins_by_default() {
        assert_eq!(pick_newest(&["0.4.0"]), Some(0));
        assert_eq!(pick_newest(&["0.4.0-beta.1"]), Some(0));
    }

    #[test]
    fn a_stable_release_outranks_its_own_betas() {
        // The case that matters most: 0.4.0 ships while a beta user is on
        // 0.4.0-beta.3 and beta.json still advertises it. Stable must win, or
        // the user would sit on the last beta forever.
        assert_eq!(pick_newest(&["0.4.0", "0.4.0-beta.3"]), Some(0));
    }

    #[test]
    fn betas_order_numerically_not_alphabetically() {
        assert_eq!(pick_newest(&["0.4.0-beta.9", "0.4.0-beta.10"]), Some(1));
    }

    #[test]
    fn an_unreleased_beta_outranks_the_current_stable() {
        assert_eq!(pick_newest(&["0.3.0", "0.4.0-beta.1"]), Some(1));
    }

    #[test]
    fn an_equal_version_leaves_the_incumbent_in_place() {
        // Stable is passed first, so an identical beta must not displace it.
        assert_eq!(pick_newest(&["0.4.0", "0.4.0"]), Some(0));
    }

    #[test]
    fn a_malformed_candidate_never_wins() {
        assert_eq!(pick_newest(&["0.3.0", "garbage"]), Some(0));
        assert_eq!(pick_newest(&["garbage", "0.3.0"]), Some(1));
    }

    #[test]
    fn prerelease_detection_drives_the_badge() {
        assert!(is_prerelease("0.4.0-beta.1"));
        assert!(!is_prerelease("0.4.0"));
        assert!(!is_prerelease("nonsense"));
    }
}
