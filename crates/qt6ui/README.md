# qt6ui - minimal native Qt 6 Mumble client

A small, low-RAM native GUI for `mumble-protocol`, built with
[cxx-qt](https://github.com/KDAB/cxx-qt) + QML. It exists to prove that the
whole client (connect, chat, channel tree, live audio) can run on the shared
workspace crates **without** the Tauri/WebView stack.

## What it does

- **Connect** to a Mumble server (TLS, self-signed certs accepted).
- **Saved servers** (start screen, mirroring the web client's ConnectPage):
  the list, search, favourites and "Connect & Save" all operate on the
  **same** store files the full client uses (`servers.json`,
  `passwords.json` in the shared config dir - see
  [`src/store.rs`](src/store.rs)), so servers saved in either client appear
  in both. Connecting to a saved entry uses its stored password and TLS
  identity (`identities/{label}/tls.{cert,key}.pem`). Preferences are
  shared the same way (currently `hideEmptyChannels`), written back on
  change so the two clients never drift.
- **Chat**: send to your current channel, receive channel/broadcast messages.
- **WYSIWYG markdown input** (`qml/MarkdownField.qml`, reusable): the value
  stays plain markdown while `**bold**`, `*italic*`, `__underline__`,
  `~~strike~~`, `` `code` ``, ``` fences, `||spoilers||`, URLs and `<@id>`
  mentions are decorated live. Enter sends, Shift+Enter inserts a newline,
  Ctrl+B/I/U and Ctrl+Shift+H wrap the selection; the field auto-grows
  40-200px. Unlike the web front-end's invisible-textarea/overlay hack, the
  native version applies a `QSyntaxHighlighter`
  ([`cpp/markdown_highlighter.cpp`](cpp/markdown_highlighter.cpp)) to the
  TextArea's document - parsing lives in Rust
  (`fancy_utils::markdown::line_spans` via the cxx bridge). On send the
  markdown is converted to the same HTML the web client produces
  (`fancy_utils::markdown::markdown_to_html`), and incoming bodies are
  reduced to Qt's StyledText subset so formatting renders in the bubbles.
- **Channels**: live channel tree with the members in each channel; click a
  channel to join it.
- **Name cards** (`qml/NameCard.qml`, reusable): hovering a member row or a
  chat avatar for 250ms shows the profile card in the web front-end's
  ProfilePreviewCard style - banner, ringed avatar, styled name (custom
  color/bold/italic from the Fancy profile), registered badge, status and
  bio. The Fancy profile is parsed from the user's Mumble comment in
  `src/profile.rs`; per-user data travels in the channels JSON. Image
  avatars/banners and the online/idle stat pills are not wired yet.
- **Audio**: hear other speakers immediately; toggle **Voice** to transmit
  from your microphone (Opus, with a noise gate).
- **Native Fancy Mumble look**: `qml/main.qml` mirrors the Tauri front-end's
  dark theme (frameless window with custom 40px titlebar, gradient background
  with accent/purple glows, glass connect card, 320px glass sidebar with flat
  channel cards, chat bubbles with the own-message gradient). The design
  tokens are copied 1:1 from `mumble-tauri/ui/src/themes/dark.css` +
  `theme.css` into the `theme` object at the top of the QML; icons use the
  system "Segoe Fluent Icons" font.

All of that logic lives in the reused crates - this crate is only the UI glue:

| Layer | Crate |
|-------|-------|
| Protocol, state, audio pipeline, Opus | `mumble-protocol` |
| cpal mic capture + speaker mixing | `fancy-audio-device` |
| HTML→text for chat | `fancy-utils` |
| **UI only** (QObject bridge + QML) | `qt6ui` (this crate) |

The `Backend` QObject ([`src/bridge.rs`](src/bridge.rs)) is a thin shell over
[`AppCore`](src/app.rs), which owns a small tokio runtime and drives the
protocol client. [`QtEventHandler`](src/events.rs) keeps a private
`ServerState` and marshals updates onto the Qt thread via `CxxQtThread`.

## Minimal ↔ full mode switching

This client is the app's **minimal mode**. The full (Tauri) client and this
binary share a `ui-mode` marker file (`full`/`minimal`) in the app config dir
(`%APPDATA%\com.fancymumble.app`, or `FANCY_E2E_DATA_DIR` when set):

- FancyMumble reads the marker at startup and hands off to `qt6ui` when it
  says `minimal` (Settings → Advanced has the switch; a first-run prompt
  offers it on low-RAM machines).
- The connect page's "Switch to the full interface" link
  ([`src/mode.rs`](src/mode.rs)) writes `full` back and relaunches the
  FancyMumble binary (override its location with `FANCY_FULL_CLIENT_BIN`;
  the full client finds this binary via `FANCY_QT6UI_BIN`).

## Shared constants & translations

- Integration constants (app identifier, marker file name, binary names,
  env-var names, default port, weak-PC thresholds, locale list) live in the
  repo-root **`constants.json`** - the single source of truth. `build.rs`
  bakes them into `src/constants.rs` at compile time (the full client and
  the React UI generate their own copies the same way), so changing a value
  means editing one file and rebuilding.
- UI strings come from the **same locale bundles as the web front-end**
  (`crates/mumble-tauri/ui/src/locales/{lang}/{ns}.json`), embedded at build
  time and exposed to QML as `backend.t("ns.path.key")` /
  `backend.tr_n("ns.path.key", count)` ([`src/i18n.rs`](src/i18n.rs)).
  Language is auto-detected from the OS (override with `FANCY_LANG=de`).
  Strings unique to this client live under `common.json → "minimal"`.

## Why it is not in the workspace

`qt6ui` is listed under `exclude` in the workspace `Cargo.toml`. Only a **MinGW**
Qt 6 kit is installed (`C:\Qt\6.11.1\mingw_64`), and MSVC/MinGW have
incompatible C++ ABIs, so this crate must be built with the
`x86_64-pc-windows-gnu` Rust toolchain and the MinGW `g++` that matches the Qt
kit. Keeping it excluded means the normal MSVC workspace build is unaffected.

## Build & run (Windows)

Prerequisites (already present on the dev machine):

- Rust GNU toolchain: `rustup toolchain install stable-x86_64-pc-windows-gnu`
- Qt 6 MinGW kit at `C:\Qt\6.11.1\mingw_64`
- MinGW g++ at `C:\Qt\Tools\mingw1310_64`

```powershell
cd crates/qt6ui
.\build.ps1 --release      # or: .\build.ps1            (debug)
.\build.ps1 run --release  # build and launch
```

You normally don't need to run this by hand: `mumble-tauri/build.rs` also
builds this crate (and copies `qt6ui.exe` next to the full client's binary),
the same way it builds `signal-bridge`. The step probes for the Qt kit,
MinGW and the GNU Rust toolchain and skips with a warning when they are
missing; set `SKIP_QT6UI=1` to opt out explicitly.

**Dev-loop note:** in **debug** builds, `mumble-tauri/build.rs` *skips* this
nested rebuild once a `qt6ui.exe` already exists in `crates/qt6ui/target/`,
because rebuilding the whole Qt client (a separate toolchain + C++ QML
codegen) inside the full client's build script stalled every
`cargo build` / `cargo tauri dev` for minutes at *"Compiling mumble-tauri"*.
The full client's launcher then picks up whichever of `target/{debug,release}`
is newest, so **rebuild this crate yourself** (`.\build.ps1`) after changing
its sources during a debug session. **Release** builds always do the nested
rebuild (so bundles are fresh); set `FORCE_QT6UI_BUILD=1` to force it in debug.

The helper sets `QMAKE` and prepends the MinGW + Qt `bin` dirs to `PATH`.
Override locations with the `QT6_MINGW_DIR` / `QT6_MINGW_GCC` env vars.

To run the resulting binary standalone, either keep `C:\Qt\6.11.1\mingw_64\bin`
on `PATH` or run `windeployqt` against `target\release\qt6ui.exe`.

Logging: set `RUST_LOG` (e.g. `RUST_LOG=qt6ui=debug,mumble_protocol=info`).

## CI note: Qt version pin

The Windows CI job (`.github/workflows/ci.yml`) installs Qt with
`jurplel/install-qt-action`, which drives `aqtinstall`. Qt reorganised its
Windows online repository at **6.11.0**: the desktop packages moved from a
single `Updates.xml` per version (`qt6_<ver>/qt6_<ver>/Updates.xml`) to
per-arch subdirs nested under the version dir
(`qt6_6111/qt6_6111_mingw/Updates.xml`, `.../qt6_6111_msvc2022_64/…`, …).
`aqtinstall` 3.3.0 (latest) still looks for the old
`qt6_6111/qt6_6111/Updates.xml` (404) and fails with *"Failed to locate XML
data for Qt version 6.11.1"*. Only the Windows repo migrated, so the Linux Qt
job still passes on 6.11.x.

CI is therefore **pinned to 6.10.3** - the newest version served under the old
layout that still provides the `win64_mingw` kit + `tools_mingw1310`. Local dev
installs (via Qt's own maintenance tool / offline installer) are unaffected and
can use 6.11.x. Bump the CI pin back once `aqtinstall` gains new-layout support.

## License

This crate - **and only this crate** - is licensed **LGPL-3.0-or-later**
(see [`COPYING.LESSER`](COPYING.LESSER) and [`COPYING`](COPYING)): it is the
Qt-facing front-end and links dynamically against the open-source
(LGPL-3.0) Qt 6 libraries. Because `qt6ui` is a separate executable, the
rest of the repository remains MIT-licensed, including the shared crates
this binary consumes (`mumble-protocol`, `fancy-audio-device`,
`fancy-utils` - MIT code may be incorporated into an LGPL work).

Qt itself is © The Qt Company, used under LGPL-3.0; sources are available
at <https://code.qt.io>. Keep Qt dynamically linked (the default here) so
users can swap in their own Qt build, as the LGPL requires.

## RAM

**Hard budget: RSS must never exceed 400 MB, and typical (average) usage
must stay under 200 MB.** Every feature has to fit inside this envelope;
anything unbounded has to be offloaded to disk and streamed back on demand.
Chat images follow this rule: message bodies never carry base64 payloads
into the UI - images are spilled to `{temp}/qt6ui-chat-images/{pid}` (large
ones with an extra `.thumb.jpg`), the model holds only file paths, bubbles
decode just the thumbnail while the message is on screen (`sourceSize`-capped,
uncached), and the full-size file is decoded only while the lightbox is open.

Measured RSS of the release build on Windows (Qt 6.10, idle after load):

| Configuration | RSS |
|---|---|
| **Default GPU/RHI backend (this app's default)** | **~105 MB** |
| Software renderer (`QT_QUICK_BACKEND=software`) | ~60 MB |
| Offscreen (bare QtQuick+QML floor) | ~40 MB |

The binary itself is ~3.6 MB (`opt-level = "z"`, LTO, `strip`, `panic =
"abort"`), and the runtime uses a single tokio worker thread, so the Rust side
is small. The cost is Qt: **QtQuick pulls in the scene-graph and the V4 QML/JS
engine, which alone floor at ~40 MB** - sub-30 MB is not reachable with QtQuick.

The app keeps the full hardware-accelerated GPU backend by default (users who
want to trade rendering quality for ~40 MB less RAM can set
`QT_QUICK_BACKEND=software` in the environment). To stay reasonably lean it:

- uses the `Basic` Controls style (no native theme engine);
- runs one tokio worker thread.

If sub-30 MB is a hard requirement, the same `AppCore` + `fancy-audio-device`
back-end can be driven by a **QtWidgets** front-end (no QML/JS engine, ~15-25 MB
floor) with zero changes to the connection/chat/channel/audio logic - only the
`Backend` bridge + QML would be replaced.
