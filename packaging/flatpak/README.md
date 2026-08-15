# Fancy Mumble on Flathub

> **Not submittable as it stands - one step is missing, and it is not optional.**
>
> The manifests pin tag `v0.3.0`, but two things are true of that tag:
>
> 1. It does not contain this directory, so the build fails at
>    `install ... packaging/flatpak/...: No such file or directory`.
> 2. Its `Cargo.lock` and `package-lock.json` differ substantially from the
>    working tree these `*-sources.json` were generated from (~2400 lines of
>    `Cargo.lock` alone), so the offline build would not match them anyway.
>
> Both are fixed by the same move: **cut a release that contains this
> directory**, point `tag:`/`commit:` at it, and re-run `generate-sources.sh`.
> Until then the packaging is verified but not shippable. See
> "Releasing a new version" below.

```
flatpak install flathub com.fancy_mumble.FancyMumble

# encrypted private chat (AGPL, opt-in - see below)
flatpak install flathub com.fancy_mumble.FancyMumble.SignalBridge
```

## Files

| File | What it is |
|---|---|
| `com.fancy_mumble.FancyMumble.yml` | The app manifest |
| `com.fancy_mumble.FancyMumble.desktop` | Desktop entry, named after the app ID |
| `com.fancy_mumble.FancyMumble.metainfo.xml` | AppStream metadata |
| `com.fancy_mumble.FancyMumble.SignalBridge.yml` | The AGPL add-on, built as a Flatpak extension |
| `com.fancy_mumble.FancyMumble.SignalBridge.metainfo.xml` | AppStream metadata for the add-on (`addon`) |
| `cargo-sources.json` | Generated. Every crate in the workspace `Cargo.lock` |
| `signal-bridge-cargo-sources.json` | Generated. Every crate in `crates/signal-bridge/Cargo.lock` |
| `node-sources.json` | Generated. Every npm package in `ui/package-lock.json` |
| `generate-sources.sh` | Regenerates all three |

## Two refs, one licence boundary

`crates/signal-bridge` links libsignal-protocol, which is **AGPL-3.0-only**.
The client is **MIT**. Upstream keeps those apart by building the bridge as a
cdylib in its own workspace and `dlopen`ing it at runtime; the AUR packaging
keeps them apart by shipping two packages.

A Flatpak app is a single immutable ref with no `optdepends`, so the equivalent
here is an **extension**:

```
com.fancy_mumble.FancyMumble              MIT       mounts an empty /app/lib/fancy-mumble
com.fancy_mumble.FancyMumble.SignalBridge AGPL-3.0  installs libsignal_bridge.so there
```

`load_signal_bridge()` in `src/state/pchat/signal_bridge.rs` already searches
`../lib/fancy-mumble/` relative to the executable, which from
`/app/bin/mumble-tauri` is exactly the extension's mount point. So there is no
runtime configuration: installing the extension is what turns the feature on,
and without it the app runs normally with encrypted private chat unavailable.
The extension is declared `no-autodownload`, so installing Fancy Mumble puts no
AGPL code on the machine.

To be clear about what this does and does not settle: it is the same separation
upstream already ships, and it makes the licence of each ref accurate and
checkable. It is not a legal opinion. Whether a `dlopen`ed plugin and its host
count as one work under the AGPL is contested, and two refs from the same store
under the same brand is a weaker separation than two unrelated projects. If the
goal is certainty rather than consistency, that is a question for a lawyer.

## The self-updater is off in this build

Flathub updates apps itself, and a bundled updater cannot work against a
read-only `/app` anyway. So the Flatpak builds with:

```
cargo build --release --no-default-features --features custom-protocol
```

which drops the `self-updater` feature added for this purpose
(`crates/mumble-tauri/Cargo.toml`). That takes `updater/{commands,manager}.rs`,
the six `updater_*` commands and the `updater`/`process` plugins out of the
binary, and `build.rs` narrows the capability glob so
`capabilities/self-updater/` is not fed to the ACL. Everything else - including
the window plumbing that reveals the main window on launch - is unchanged, and
the default build is exactly as it was.

**Known cosmetic gap:** the Settings > Advanced "auto-update on startup" toggle
is still rendered in the frontend. Its `invoke()` calls are all
`.catch()`-guarded so nothing breaks, but the toggle does nothing in a Flatpak
build. Hiding it needs a build-time flag through Vite (the Rust-side constants
generator runs after the frontend is built, so it cannot carry this). Worth
doing; not a submission blocker.

## What the runtime does and does not provide

Built against `org.gnome.Platform//50`, which has webkit2gtk-4.1, libsoup3,
GTK 3, PipeWire, libva/libdrm/gbm and Opus. What it does not have, the manifest
builds:

- **protoc** - `prost-build` shells one out. Pinned to protobuf 21.12, the last
  release before the abseil dependency; every `.proto` here is plain proto3, so
  it generates identical Rust. Build-time only.
- **libclang** - via the `llvm21` SDK extension, with `LIBCLANG_PATH` set.
  `libspa-sys` (PipeWire, reached through fancy-screenshare's default-on `gpu`
  feature) runs bindgen in its build script and panics without it.
- **The tray stack** - `libappindicator-sys` `dlopen`s
  `libayatana-appindicator3.so.1` rather than linking it, so none of this is
  needed to *build* the client; without it in `/app/lib` the dlopen fails and
  the tray silently never appears. Four modules, in dependency order:
  `libdbusmenu` -> `ayatana-ido` -> `libayatana-indicator` ->
  `libayatana-appindicator`, plus `intltool` (build-time only) because
  libdbusmenu's 2016 configure hard-requires it and the SDK has none.

Three things in that chain needed workarounds, all commented in the manifest,
all found by building it rather than by reading:

| Module | Problem | Fix |
|---|---|---|
| `libdbusmenu` | configure aborts: no intltool in the SDK | added an `intltool` module |
| `libdbusmenu` | `-Werror` + current glib deprecates `g_type_class_add_private`, which it uses throughout | `-Wno-error` and `--enable-compile-warnings=minimum` |
| `libayatana-appindicator` | CMake takes `-l` names from pkg-config but no library dirs, so the link cannot find the four libs just installed | `ldflags: -L/app/lib` |

Screen sharing goes through the ScreenCast portal, which hands over the
PipeWire remote as an fd - so no `--socket=pipewire`, and VA-API encode runs on
the `--device=dri` node.

## DeepFilterNet comes from a tarball, not a git clone

`generate-sources.sh` rewrites the `deep_filter` source after generating
`cargo-sources.json`, swapping the `type: git` entry for a `type: archive` of
the GitHub source tarball at the same commit.

The clone does not work. Upstream uses git-lfs and at least one LFS object 404s,
which makes flatpak-builder abort during source download, before compiling
anything:

```
[4afcd87f...] Object does not exist on the server: [404]
error: failed to fetch some objects from
       'https://github.com/rikorose/deepfilternet.git/info/lfs'
```

The obvious shortcut - just drop the package, since the non-default
`deepfilternet-denoiser` feature leaves it uncompiled - does not work either.
`crates/fancy-denoiser-deepfilter` is a workspace member and depends on it
unconditionally, so cargo resolves it whatever features are on:

```
error: no matching package named `deep_filter` found
required by package `fancy-denoiser-deepfilter`
```

It has to be present; it never has to build. A source tarball satisfies
resolution and involves no LFS. The generator's own `cp libDF ->
cargo/vendor/deep_filter` step is untouched, because the archive unpacks to
exactly the path the clone would have produced.

Still true, and worth being explicit about: **the Flathub build ships without
DeepFilterNet3 AI noise suppression**, exactly as the AUR package and upstream's
own `.deb`/AppImage do - none of them enable that feature. The other filters
(AGC, noise gate, spectral subtraction) are unaffected. Turning it on here means
fixing the LFS objects upstream first, because the models *are* those objects.

## One source change outside packaging: `ui/tsconfig.json`

`"lib"` was `ES2021` and is now `ES2022`.

`clientSelectors.test.ts` calls `out.at(-1)`, and `Array.prototype.at` is
ES2022. `"include": ["src"]` covers test files, so `npm run build`
(`tsc && vite build`) type-checks it. Inside the Flatpak build - SDK Node 22,
a fresh `npm ci` from the committed lockfile - that fails, reproducibly:

```
src/ui/aurora/clientSelectors.test.ts(164,16): error TS2550:
  Property 'at' does not exist on type 'UserEntry[]'.
  Do you need to change your target library? Try changing the 'lib'
  compiler option to 'es2022' or later.
```

Worth knowing: it does **not** fail on this machine outside the sandbox
(Node 24), with the same sources, the same `tsconfig.json` and the very
node_modules that `npm ci` produced inside it. I could not pin down what makes
the difference - `bwrap` cannot nest, so the build shell was not reachable to
probe from. What is not in doubt is that the code asks for something its
declared `lib` does not include, which is why one environment forgives it and
another does not.

`target` is left at `ES2021` on purpose: `noEmit` is set, so `tsc` never
transpiles here and `target` only affects checking - Vite owns the real output
target. The alternative fix is to stop using `.at()` in that test.

The manifests pin one exact commit and the three generated files describe that
commit's lockfiles. They move together or the offline build fails:

1. Tag and push the release.
2. Update `tag:` and `commit:` in **both** manifests.
3. Run `./packaging/flatpak/generate-sources.sh` (needs network, takes minutes).
4. Add a `<release>` entry to both metainfo files.
5. Commit together, then open PRs against `flathub/com.fancy_mumble.FancyMumble`
   and `flathub/com.fancy_mumble.FancyMumble.SignalBridge`.

## Checking it locally

```
flatpak run --command=flatpak-builder-lint org.flatpak.Builder \
    manifest packaging/flatpak/com.fancy_mumble.FancyMumble.yml

flatpak run org.flatpak.Builder --user --install-deps-from=flathub \
    --force-clean --install builddir \
    packaging/flatpak/com.fancy_mumble.FancyMumble.yml
```

A local `builddir` lint reports one error, and it is expected:

```
"errors": ["appstream-external-screenshot-url"]
"appstream-external-screenshot-url: Screenshots are not mirrored to
 https://dl.flathub.org/media"
```

The check requires every screenshot URL to start with `https://dl.flathub.org/media`.
Nothing upstream can satisfy that: those URLs do not exist until Flathub creates
them. Flathub's buildbot runs flatpak-builder with
`--mirror-screenshots-url=https://dl.flathub.org/media`, which downloads the
screenshots and rewrites the catalogue file, and the check then passes. The
metainfo here is meant to carry the real external URLs. To reproduce their
result locally, pass the same flag.

The extension builds *against* the app, so the app has to be installed first -
and on the `stable` branch, which is what Flathub publishes to and what
`add-extensions` and the extension manifest both name. flatpak-builder defaults
to `master` locally, so say so explicitly or the extension build cannot find its
runtime:

```
# note --default-branch=stable
flatpak run org.flatpak.Builder --user --install-deps-from=flathub \
    --force-clean --install --default-branch=stable builddir \
    packaging/flatpak/com.fancy_mumble.FancyMumble.yml

flatpak run org.flatpak.Builder --user --force-clean --install builddir-bridge \
    packaging/flatpak/com.fancy_mumble.FancyMumble.SignalBridge.yml
```

## Before the first submission

- [ ] Serve the verification token at
      `https://fancy-mumble.com/.well-known/org.flathub.VerifiedApps.txt`.
      Flathub maps the app ID `com.fancy_mumble.FancyMumble` back to the domain
      `fancy-mumble.com` (underscore for hyphen), which is what earns the
      verified badge.
- [ ] Submit the app first and the extension second - the extension cannot
      build until the app ref exists on Flathub.
- [ ] The screenshots in the metainfo point at `images/*.png` at tag `v0.3.0`.
      Re-point them when those images change, or they will drift from the UI
      being shipped.
- [ ] Ship a scalable icon if there is one. Only a 128x128 PNG exists today
      (`crates/mumble-tauri/icons/icon.png`), which meets the minimum but looks
      soft on HiDPI.
- [ ] `tauri.conf.json` still carries the `updater` plugin config and
      `createUpdaterArtifacts`. Both are correct for the .deb/AppImage/Windows
      builds and are simply unused here - leave them alone.
