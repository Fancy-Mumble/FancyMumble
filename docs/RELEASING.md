# Releasing

How a version of Fancy Mumble goes out, step by step. The mechanics - which
branch publishes what, how the beta channel works - are in the README under
[Releases and update channels](../README.md#releases-and-update-channels); this
is the checklist that goes with them.

A release is cut by CI from a push to `main` (or `beta`). Nobody tags by hand:
the release job reads the version out of `tauri.conf.json`, creates the tag
`vX.Y.Z` itself, and uploads the installers and `latest.json`.

## Before the pull request into `main`

CI does not run on pushes to `develop`, only on pull requests. If `develop` took
direct pushes since the last release, the pull request into `main` is the first
time that code meets the Linux jobs, `cargo-deny` and Miri. Open it early and
expect to iterate.

1. **Versions agree.** CI checks the first three and fails the build otherwise;
   the rest are not checked by anything.
   - `crates/mumble-tauri/tauri.conf.json` - the source of truth
   - `crates/mumble-tauri/ui/package.json`
   - `crates/mumble-protocol/Cargo.toml`
   - `crates/mumble-tauri/Cargo.toml`
   - `crates/mumble-tauri/ui/package-lock.json` (two places at the top;
     `npm install --package-lock-only` rewrites them)
   - `Cargo.lock` (any `cargo` command rewrites it)
2. **The changelog has the section.** `CHANGELOG.md` needs a `## [X.Y.Z] - DATE`
   heading for the version being released, with today's date in place of
   `Unreleased`, and a compare link at the foot. The release job publishes that
   section as the release notes; `scripts/changelog-section.sh X.Y.Z` prints
   what it will publish.
3. **The gates are green locally**, since they are cheaper to fail here:
   ```bash
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --package mumble-protocol --features opus-codec --lib
   cd crates/mumble-tauri/ui && npx tsc --noEmit && npm run lint && npm test
   ```
   A green clippy on Windows says nothing about the Linux-only code; only CI
   compiles that.
4. **`deny.toml`'s ignore list was read.** Every entry under
   `[advisories].ignore` is a known vulnerability the release ships with. Drop
   the ones a dependency update has since cleared.

## The release itself

5. Open the pull request `develop` -> `main` and wait for every job.
6. Merge. The push to `main` runs CI again, and its `Release` job tags and
   publishes. Check the release page for: `-setup.exe` and `.msi` with their
   `.sig`, `.AppImage` with its `.sig`, `.deb`, `.apk`, the two minimal-client
   archives, and `latest.json`.
7. Install the previous version and let it update itself. `latest.json` is what
   every installed client reads, so this is the one check that cannot be skipped.

## After the tag exists

These all pin the tag or a checksum of it, so they cannot be done earlier.

8. **AUR** (`packaging/aur/`, details in its README): set `pkgver` in all three
   `PKGBUILD`s, run `updpkgsums` and `makepkg --printsrcinfo > .SRCINFO` in each
   directory, and push each to its AUR repository. From 0.4.0 on,
   `fancy-mumble` builds with `--no-default-features --features custom-protocol`
   so the package does not try to update itself.
9. **Flatpak** (`packaging/flatpak/`, details in its README): point `tag:` and
   `commit:` in both manifests at the new tag, re-run `generate-sources.sh`
   (the three `*-sources.json` files must describe the lockfiles at that tag),
   add a `<release>` entry to both `metainfo.xml` files, and move the screenshot
   URLs in the metainfo to the new tag.
10. Merge `main` back into `develop`, and set the version files to the next
    version so a `beta` branch can be cut from it.

## A beta

A beta is tagged `vX.Y.Z-beta.N` and flagged as a pre-release, so it never
becomes `releases/latest` and no stable client is offered it.

1. `develop` is green - through a pull request, since pushes to it run nothing.
2. The version files name the *next* stable version. CI refuses a beta whose
   base version is not above the latest stable release.
3. Create or fast-forward `beta` from `develop` and push it:
   ```bash
   git push origin origin/develop:refs/heads/beta
   ```
   That push is the release: CI builds the NSIS installer, the AppImage, the APK
   and the minimal clients, tags `vX.Y.Z-beta.<run number>`, and then writes
   `beta.json` to the orphan `updater` branch, creating the branch the first
   time. N is the repository's CI run number, so betas count upwards but not
   consecutively.
4. The release notes are the changelog section of the version it is a beta of,
   so the `Unreleased` section is what testers read.
5. Testers opt in under Settings -> Advanced -> Beta updates. A client older
   than 0.4.0 has no such setting, so the first beta has to be installed by
   hand from the Releases page; from then on betas update themselves.

To fix a beta, push the fix to `develop` and fast-forward `beta` again. Do not
commit to `beta` directly, or it and `develop` drift apart.
