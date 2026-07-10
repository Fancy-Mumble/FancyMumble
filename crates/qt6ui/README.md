# qt6ui — minimal native Qt 6 Mumble client

A small, low-RAM native GUI for `mumble-protocol`, built with
[cxx-qt](https://github.com/KDAB/cxx-qt) + QML. It exists to prove that the
whole client (connect, chat, channel tree, live audio) can run on the shared
workspace crates **without** the Tauri/WebView stack.

## What it does

- **Connect** to a Mumble server (TLS, self-signed certs accepted).
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

All of that logic lives in the reused crates — this crate is only the UI glue:

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

## Why it is not in the workspace

`qt6ui` is listed under `exclude` in the workspace `Cargo.toml`. Only a **MinGW**
Qt 6 kit is installed (`C:\Qt\6.10.0\mingw_64`), and MSVC/MinGW have
incompatible C++ ABIs, so this crate must be built with the
`x86_64-pc-windows-gnu` Rust toolchain and the MinGW `g++` that matches the Qt
kit. Keeping it excluded means the normal MSVC workspace build is unaffected.

## Build & run (Windows)

Prerequisites (already present on the dev machine):

- Rust GNU toolchain: `rustup toolchain install stable-x86_64-pc-windows-gnu`
- Qt 6 MinGW kit at `C:\Qt\6.10.0\mingw_64`
- MinGW g++ at `C:\Qt\Tools\mingw1310_64`

```powershell
cd crates/qt6ui
.\build.ps1 --release      # or: .\build.ps1            (debug)
.\build.ps1 run --release  # build and launch
```

The helper sets `QMAKE` and prepends the MinGW + Qt `bin` dirs to `PATH`.
Override locations with the `QT6_MINGW_DIR` / `QT6_MINGW_GCC` env vars.

To run the resulting binary standalone, either keep `C:\Qt\6.10.0\mingw_64\bin`
on `PATH` or run `windeployqt` against `target\release\qt6ui.exe`.

Logging: set `RUST_LOG` (e.g. `RUST_LOG=qt6ui=debug,mumble_protocol=info`).

## RAM

Measured RSS of the release build on Windows (Qt 6.10, idle after load):

| Configuration | RSS |
|---|---|
| **Default GPU/RHI backend (this app's default)** | **~105 MB** |
| Software renderer (`QT_QUICK_BACKEND=software`) | ~60 MB |
| Offscreen (bare QtQuick+QML floor) | ~40 MB |

The binary itself is ~3.6 MB (`opt-level = "z"`, LTO, `strip`, `panic =
"abort"`), and the runtime uses a single tokio worker thread, so the Rust side
is small. The cost is Qt: **QtQuick pulls in the scene-graph and the V4 QML/JS
engine, which alone floor at ~40 MB** — sub-30 MB is not reachable with QtQuick.

The app keeps the full hardware-accelerated GPU backend by default (users who
want to trade rendering quality for ~40 MB less RAM can set
`QT_QUICK_BACKEND=software` in the environment). To stay reasonably lean it:

- uses the `Basic` Controls style (no native theme engine);
- runs one tokio worker thread.

If sub-30 MB is a hard requirement, the same `AppCore` + `fancy-audio-device`
back-end can be driven by a **QtWidgets** front-end (no QML/JS engine, ~15-25 MB
floor) with zero changes to the connection/chat/channel/audio logic — only the
`Backend` bridge + QML would be replaced.
