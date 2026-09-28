# Copilot Instructions - Fancy Mumble

> Context document for GitHub Copilot.  Kept up-to-date so the assistant
> can skip expensive context-gathering on every request.

## Project overview

**Fancy Mumble** is a modern Mumble (VoIP) client for Windows, Linux and
Android: voice, rich and end-to-end encrypted persistent chat, screen sharing,
profile customisation, server administration.  Licensed MIT.  Written in
Rust + TypeScript/React.  The server it is developed against is Starling
(<https://github.com/Fancy-Mumble/starling>); voice and plain text chat work
against any Mumble server.

| Layer | Crate / package | Tech |
|-------|-----------------|------|
| Protocol library | `crates/mumble-protocol` | Rust, tokio, prost (protobuf), rustls, optional Opus codec |
| OMLSA denoiser | `crates/mumble-protocol` | Inlined in `src/audio/filter/denoiser/omlsa/` (Cohen 2001/2003), uses `realfft` |
| DeepFilterNet denoiser | `crates/fancy-denoiser-deepfilter` | Standalone Rust crate, `DeepFilterNet3` (Schroeter et al. 2023) via upstream `deep_filter` git dep + pinned `tract-onnx`/`ndarray` |
| Tauri backend | `crates/mumble-tauri` | Rust, Tauri 2, rcgen (self-signed certs), oboe (Android audio) |
| Audio devices | `crates/fancy-audio-device` | cpal capture and mixing playback shared by both clients, plus a WASAPI path |
| Screen sharing | `crates/fancy-screenshare` | Capture, hardware encode (Media Foundation, NVENC, VA-API), WebRTC |
| Game detection | `crates/fancy-gamedetect` | Foreground-window probe and launcher indexes (Steam, Epic, Heroic, registry) |
| Rich presence | `crates/fancy-presence` | Hosts Discord's IPC endpoint |
| Shared helpers | `crates/fancy-utils` | Permissions table, markdown, version and net helpers |
| Tauri frontend | `crates/mumble-tauri/ui` | React 19, Vite 8, Zustand 5, react-router-dom 7, TypeScript 5, MUI 9 (Nebula), CSS Modules (Standard) |
| Tauri Android | `crates/mumble-tauri/gen/android` | Gradle/Kotlin, Android API 34, NDK 27 |
| Signal bridge | `crates/signal-bridge` | AGPL-3.0 cdylib, excluded from the workspace, `dlopen`ed at runtime so the client stays MIT |
| Minimal client | `crates/qt6ui` | LGPL-3.0 Qt 6 / QML client, excluded from the workspace, same protocol lib |

## Workspace layout

Only the parts worth knowing before opening a file.  Anything finer than this
goes stale faster than it helps - list the directory instead.

```
Cargo.toml                      # workspace root (resolver = "3"); excludes signal-bridge and qt6ui
config/constants.json           # cross-client constants, baked in by each build.rs
deny.toml  .clippy.toml  rustfmt.toml
docs/                           # RELEASING.md, design notes
packaging/                      # aur/, flatpak/
scripts/                        # android helpers, update manifest, changelog section
crates/
  mumble-protocol/
    proto/                      # Mumble.proto, MumbleUDP.proto, fancy/*.proto (the epoch-1 canon)
    src/
      client.rs  work_queue.rs  event.rs  state.rs  message.rs
      canon.rs  fancy_codec.rs  fancy_message_support.rs
      command/                  # one file per user action (CommandAction)
      transport/                # tcp, udp, ocb2, modern_crypt (XChaCha20-Poly1305)
      audio/                    # capture/playback traits, mixer, resampler, filter/ (AGC, gate, denoiser/)
      persistent/               # end-to-end encrypted persistent chat: keys, encryption, protocol
      proto/                    # prost output, written by build.rs and checked in
    doc/                        # architecture, detailed design, persistent chat, diagrams
    tests/                      # integration.rs (Docker), denoiser corpus
  mumble-tauri/
    build.rs                    # tauri-build, signal-bridge, generated TS (see below)
    capabilities/               # Tauri ACL, hand-written
    gen/android/                # Kotlin sources and Gradle project - hand-edited despite the name
    src/
      app/                      # bootstrap
      commands/                 # #[tauri::command] functions, one file per area; registry.rs registers them
      state/                    # AppState, handler/ (server events), pchat/, per-feature state
      audio/                    # desktop, pipewire, android (oboe), stream audio
      platform/                 # per-OS window, webview and desktop integration
      updater/                  # self-updater (feature `self-updater`) and channels
    ui/                         # the React frontend - see below
```

### Frontend (`crates/mumble-tauri/ui/src`)

Read `src/README.md`, `src/ui/README.md` and `src/ui/nebula/ARCHITECTURE.md`
first; they are kept current.  In short:

```
main.tsx                        # entry: picks the UI pack from the registry
core/                           # everything that is not drawing: no pack imports from another pack
  store/                        # the Zustand store and its slices
  features/                     # per-feature logic and hooks (chat, admin, onboarding, settings, ...)
  types/  utils/  i18n/  locales/  plugins/
  utils/appConstants.ts         # GENERATED by mumble-tauri/build.rs - do not edit
  utils/permissions.ts          # GENERATED by mumble-tauri/build.rs - do not edit
shared/                         # components more than one pack draws (profilecard/, serverinfo/)
ui/
  registry.ts                   # the packs and the default (Nebula)
  standard/                     # the classic pack: CSS Modules, themes/*.css
  nebula/                       # the default pack: MUI 9 + `sx`, tokens.ts, theme.ts
  aurora/                       # deprecated; do not extend
preview/                        # scratch entries for eyeballing one component headlessly; not part of the app
```

Path aliases (`tsconfig.json`, `vite.config.ts`, `vitest.config.ts` must agree):
`@core`, `@shared`, `@standard`, `@nebula`, `@aurora`, `@ui`.

## Key architecture decisions

1. **Command pattern** - every user action (join channel, send message, set
   texture, etc.) is a self-contained struct implementing `CommandAction`.
   Adding a new command = new file + struct, no central dispatcher changes.

2. **Priority work queue** - the client event loop drains UDP (audio) first,
   then TCP (control), then user commands.  Audio is never starved.

3. **Event handler trait** - `EventHandler` has default no-op methods so
   consumers override only what they need.

4. **Backend ↔ Frontend bridge** - the Tauri backend exposes `#[tauri::command]`
   functions called via `invoke()` from React, and pushes updates via
   Tauri events consumed by `listen()` in the Zustand store.

5. **FancyMumble profile format** - profile customisation data is stored in
   the Mumble user `comment` field as `<!--FANCY:{"v":1,...}-->` followed by
   the bio HTML.  Legacy clients ignore the HTML comment.  Avatar bytes use
   the standard `UserState.texture` protobuf field.

6. **Base122 encoding** - binary data inside the profile comment (which must
   be valid UTF-8) is encoded with a custom base122 codec
   (`core/profileFormat.ts`: `b122Encode` / `b122Decode`).  The alphabet is
   ASCII 0-127 minus 6 illegal chars (NUL, LF, CR, `"`, `&`, `\`).  ~14 %
   smaller than base64.  Data URLs use `;base122,` as the encoding tag.
   `dataUrlToBytes` reads both `;base122` and legacy `;base64` for backwards
   compatibility.

7. **Persistent storage** - saved servers and user preferences are stored
   via `@tauri-apps/plugin-store` as JSON files (`servers.json`,
   `preferences.json`).  TLS client certificates are PEM files under
   `{app_data_dir}/certs/`.

8. **Audio pipeline** - trait-based: `AudioCapture` -> `FilterChain` (AGC,
   a denoiser, noise gate) -> `OpusEncoder` -> network; inbound is the
   reverse, decoded on a thread of its own and mixed for playback.  The
   denoiser is one of four backends under `audio/filter/denoiser/`
   (`rnnoise`, `spectral_subtraction`, `omlsa`, `deepfilter`); `rnnoise` and
   `deepfilter` sit behind the `rnnoise-denoiser` and `deepfilternet-denoiser`
   cargo features of `mumble-protocol`.  OS audio I/O lives in
   `fancy-audio-device` on desktop (cpal, WASAPI) with a PipeWire path in
   `mumble-tauri/src/audio/pipewire.rs`, and in `audio/android.rs` (oboe)
   on Android.

9. **Android platform gating** - desktop-only dependencies (`cpal`,
   `tauri-plugin-global-shortcut`, screen capture) are gated with
   `#[cfg(not(target_os = "android"))]`; Android has its own audio backend
   rather than stubs.

10. **Responsive UI** - each pack owns its handheld layout.  Standard
    switches at a 768 px CSS breakpoint (drawer sidebar, 44 px touch
    targets, no TitleBar).  Nebula switches on `useIsHandheld` - a media
    query OR'd with the platform - and lays out a separate one-handed shell
    (`nebula/components/mobile/`).  Platform detection uses
    `isMobilePlatform()` from `core/utils/platform.ts`.

11. **Onboarding workflow** - native Mumble.proto extension (wire IDs
    136-140) for a Discord-style join-time questionnaire.  Requires a
    Fancy Mumble server running **0.3.1 or newer**: the protocol crate
    declares `(0, 3, 1) FancyOnboarding* => ServerOnly` in
    `fancy_message_support!`, and the UI gates everything on
    `isOnboardingSupported(serverFancyVersion)` from
    `core/features/onboarding/onboardingStore.ts`.  On legacy / pre-0.3.1
    servers the modal never opens, the Settings "Channels &amp; Roles"
    tab and the Admin "Onboarding" tab are hidden, and `hydrate()` is a
    no-op.  Server broadcasts `FancyOnboardingConfig` after
    `ServerSync` (or on admin edit); clients show `OnboardingModal` if
    the user has not answered the current revision.  Admin edits go
    through `FancyOnboardingConfigUpdate` which the server stamps with
    revision/updated_by/updated_at and re-broadcasts.  Users submit via
    `FancyOnboardingResponse`; the server stores per-cert-hash and
    applies the answer-mapped Mumble ACL group memberships.
    Frontend logic lives under `ui/src/core/features/onboarding/`, drawn by
    each pack; backend
    handler in `state/handler/onboarding.rs`, state methods in
    `state/onboarding.rs`, commands in `commands/onboarding.rs`.

## Boy Scout Rule

> **"Always leave the campground cleaner than you found it."**

When working in any file, apply this rule proactively:

- **Fix issues you encounter** - if you spot a compiler warning, a lint
  error, an unused import, or a `TODO`/`FIXME` comment that has an obvious
  fix, clean it up as part of your change rather than leaving it for later.
- **Fix TypeScript errors** - unused variables, missing types, incorrect
  `noUnusedLocals` violations and similar issues must be resolved whenever
  they are found in a file being edited.
- **Fix SonarQube / linter suggestions** - style suggestions reported by
  SonarQube or other linters must also be fixed in files being edited.
  This includes, but is not limited to:
  - Cognitive complexity violations - refactor functions that exceed the
    allowed complexity threshold (e.g. extract helpers, simplify branches).
  - `String#replaceAll()` preference - replace `String#replace()` with a
    global regex with `String#replaceAll()` where applicable.
  - Any other "code smell" or maintainability issue flagged by the linter.
- **Fix Rust warnings** - dead code, unused imports, `clippy` warnings and
  similar diagnostics should be addressed whenever they appear in touched
  files.
- **Fix build-log warnings immediately** - any warning that appears in the
  output of a build (`cargo build`, `cargo check`, `cargo test`, `npm run
  build`, `tsc`, etc.) must be resolved before the task is considered
  complete.  Do not leave warnings for the next developer to clean up.
- **Suggest improvements proactively** - if you notice a code smell,
  a performance issue, or a pattern inconsistent with the rest of the
  codebase while working in a file, point it out and offer (or apply) a
  fix.  Examples: duplicate logic that could be extracted, a `clone()` that
  could be avoided, a React hook dependency array that is stale.
- **Scope**: apply the rule to files you are *already editing*.  Do not
  refactor unrelated files without being asked - only clean up what you
  touch.
- **pre-existing issues** - if you encounter an issue that predates your
  change and is non-trivial to fix, it's okay to leave a `TODO` comment with
  a brief description of the problem and (optionally) a link to an issue or PR
  for tracking.  The key is to avoid introducing new issues and to clean up what
  you can in the files you edit. But if you can easily fix an existing issue
  while working in the file, please do so.

## Quality gates after every implementation

After completing any non-trivial feature or bug fix, always perform these
steps before declaring the task done:

1. **Maximum File length** - if your change adds more than 200 lines to a file, consider
   whether it can be split into multiple smaller files.  If a file exceeds
   600 lines after your change, refactor it to reduce the length (e.g.
   extract helper modules, split frontend components into separate files).
2. **Run Clippy** (`cargo clippy --all-targets -- -D warnings`) and fix
   every diagnostic it reports.  Clippy failures are treated as build
   failures. Do not add `#[allow]` attributes to silence warnings -
   fix the underlying issue.  In particular:
   - **`#[allow(clippy::too_many_lines)]` is absolutely forbidden.**
     The workspace sets `too_many_lines = "deny"` for a reason.
     When a function exceeds the line limit, **refactor it** by
     extracting helper functions, introducing structs, or splitting
     the logic into smaller pieces.  Never suppress the lint.
   - The same applies to `#[allow(clippy::excessive_nesting)]` and
     other `deny`-level lints.  The fix is always to restructure the
     code, not to silence the warning.
3. **Write regression tests** - add at least one automated test that
   exercises the new behaviour and would fail if the feature were removed
   or regressed.  Place Rust unit tests in the same file as the code under
   test (in a `#[cfg(test)] mod tests { ... }` block) or in the relevant
   integration test file under `tests/`.  Frontend tests sit beside the
   file they test as `*.test.ts(x)`, or in a `__tests__/` directory next
   to it.
4. **Fix all build-log warnings** - run `cargo build` (or the appropriate
   build command) and resolve every warning before finishing.  A clean,
   warning-free build is a hard requirement.

## Coding conventions

### Rust
- Edition 2024, `resolver = "3"`; `rustfmt.toml` pins the style and CI runs `cargo fmt --all -- --check`
- Workspace-wide Clippy lints: `correctness = deny`, `suspicious/style/perf = warn`
- `thiserror` for error enums, `Result<T>` type alias per crate
- `tracing` for logging (not `log`)
- Async runtime: `tokio` with `rt-multi-thread`
- TLS: `rustls` with `ring` crypto provider
- Protobuf: `prost` + `prost-build`
- **Utility functions** - place new helper/utility functions in the `utils`
  module (i.e. `src/utils.rs` or `src/utils/`) of the crate being worked in.
  If a utility is general-purpose enough to benefit multiple crates, add it
  to the `fancy-utils` crate instead and depend on it from the consuming
  crate. Before creating a new utility function, check if one already exists
  in the `fancy-utils` crate to avoid duplication.
- When you need to add a comment  to explain what your code is doing, ask yourself:
  "Could I rewrite this code in a clearer way that doesn't require a comment?"
  If the answer is yes, refactor the code to be self-explanatory instead of adding
  a comment.  If the answer is no and a comment is truly necessary, keep it concise
  and focused on the "why" rather than the "what".  Avoid comments that simply restate
  what the code does or explain "how" - the code itself should make that clear.  Strive
  for code that is clean and readable enough to minimize the need for comments. Also,
  try to use function and variable names that convey intent clearly, which can further
  reduce the need for explanatory comments.

### TypeScript / React
- React 19 with function components and hooks
- State: Zustand 5 (`create` store, not context-based)
- Routing: react-router-dom 7 (`Routes`/`Route`)
- Styling: per pack - CSS Modules (`*.module.css`) in Standard, MUI 9 with
  `sx` and the theme tokens in Nebula.  Never import one pack from another;
  what two packs need goes in `core/` (logic) or `shared/` (drawing).
- Build: Vite 8
- ESLint (`npm run lint`), Prettier (`.prettierrc.json`) and `tsc --noEmit`
  must all pass
- `type` imports preferred (`import type { ... }`)
- **Reusable UI elements** - new primitive UI components (buttons, inputs,
  badges, tables, tooltips, modals, etc.) go in the pack's own primitives
  folder: `ui/src/ui/standard/components/elements/` or
  `ui/src/ui/nebula/components/primitives/`.  If you encounter an existing component
  elsewhere in the codebase that is clearly a generic, reusable primitive,
  move it into that folder as part of your change (Boy Scout Rule).

### General
- MIT license
- CI: GitHub Actions (`.github/workflows/ci.yml`) - lint, test, build,
  Android APK build, auto-release on `main`, and beta pre-releases on `beta`
  (see "Releases and update channels" in `README.md`)
- Workspace managed with `cargo` (Rust) and `npm` (frontend, in `crates/mumble-tauri/ui`)
- **No non-ASCII characters in code comments** (Rust `//`/`/* */`, TypeScript `//`/`/* */`).
  Box-drawing characters and other Unicode glyphs (e.g. `┌──┐`, `│`, `└──┘`, `▼`, `─`)
  are forbidden in source-code comments.  They are fine in Markdown documentation
  files (`.md`).

## Common workflows

```bash
# Run the Tauri dev server (auto-starts Vite + cargo build)
cd crates/mumble-tauri
cargo tauri dev

# Run the Tauri Android dev server (requires emulator/device)
# See ANDROID_DEV.md for prerequisites
cd crates/mumble-tauri
cargo tauri android dev

# Android development helper script (Windows only)
# scripts/android-dev.ps1 - validates all prerequisites (JDK, ANDROID_HOME,
# NDK_HOME, Rust targets, Tauri CLI, ADB, emulator AVDs) and optionally
# launches the dev server or sets up WebView DevTools port-forwarding.
# It also auto-detects JAVA_HOME from common install locations and injects
# NDK CMake/ninja env vars so cargo builds find the toolchain.
#
# Prerequisites checked: Windows Developer Mode, JAVA_HOME, ANDROID_HOME,
# NDK_HOME (NDK 27), Rust targets aarch64-linux-android + x86_64-linux-android,
# Tauri CLI (cargo-tauri), ADB, emulator AVDs.
#
# Usage:
.\scripts\android-dev.ps1                        # Check prerequisites only
.\scripts\android-dev.ps1 -Run                   # Check + start dev server (cargo tauri android dev)
.\scripts\android-dev.ps1 -Emulator              # Launch an emulator (pick AVD interactively)
.\scripts\android-dev.ps1 -Emulator -Run         # Launch emulator, then start dev server
.\scripts\android-dev.ps1 -Inspect               # Set up WebView DevTools forwarding for chrome://inspect
.\scripts\android-dev.ps1 -Inspect -Serial emulator-5554  # Target a specific device
#
# To perform a release APK/AAB build instead of the dev server:
cd crates/mumble-tauri
cargo tauri android build

# Build the protocol library only
cargo build -p mumble-protocol

# Run unit tests (no Docker required)
cargo test --package mumble-protocol --features opus-codec --lib

# Run integration tests (requires Docker - see section below)
cd crates/mumble-protocol
docker compose -f docker-compose.test.yml up -d --wait
cargo test --package mumble-protocol --test integration
docker compose -f docker-compose.test.yml down

# Frontend only (standalone Vite dev server for UI iteration)
cd crates/mumble-tauri/ui
npm run dev

# Run frontend unit tests, lint and type check
cd crates/mumble-tauri/ui
npm test
npm run lint
npx tsc --noEmit
```

## Integration tests

The protocol library includes integration tests that run against a real
Mumble server in Docker.  They live in
`crates/mumble-protocol/tests/integration.rs`.

### Prerequisites

- **Docker** (or Docker Desktop) must be running.
- No other process may occupy port **64738** (TCP + UDP).
- **Windows / Hyper-V note**: Hyper-V may reserve port 64738.  Check with
  `netsh interface ipv4 show excludedportrange protocol=udp`.  If blocked,
  set `MUMBLE_TEST_PORT` to a free port (e.g. `63738`) before starting
  Docker Compose and running tests.  Both `docker-compose.test.yml` and
  `integration.rs` read this env var (default 64738).

### Server configuration

The Docker Compose file
(`crates/mumble-protocol/docker-compose.test.yml`) starts a
`mumblevoip/mumble-server:latest` container configured via
`MUMBLE_CONFIG_*` environment variables that relax limits for testing:

| Setting | Value | Purpose |
|---------|-------|---------|
| `textmessagelength` | 128 KiB | Allow large text messages |
| `imagemessagelength` | 10 MiB | Allow large inline images |
| `allowhtml` | true | HTML-formatted messages |
| `certrequired` | false | No client certs needed |
| `autobanAttempts` | 0 | Disable auto-banning |

### Running

```bash
# 1. Start the test server (waits for healthy status)
cd crates/mumble-protocol
docker compose -f docker-compose.test.yml up -d --wait

# On Windows with Hyper-V port conflict, set an alternative port first:
# export MUMBLE_TEST_PORT=63738   # bash
# $env:MUMBLE_TEST_PORT="63738"   # PowerShell

# 2. Run all integration tests
cargo test --package mumble-protocol --test integration

# 3. Run a specific integration test
cargo test --package mumble-protocol --test integration -- test_plugin_data_transmission_between_two_clients

# 4. Tear down
docker compose -f docker-compose.test.yml down
```

### Test coverage

| Test | What it verifies |
|------|-----------------|
| `test_tcp_connect_and_version_exchange` | TLS handshake and version exchange |
| `test_full_authentication_flow` | Authenticate → ServerSync, session ID assigned |
| `test_send_text_message` | Send and (optionally) receive text message echo |
| `test_send_large_image_message` | Large base64 image within server limits |
| `test_set_self_mute_and_deaf` | Self-mute/deaf UserState round-trip |
| `test_set_comment` | Comment set and echoed by server |
| `test_ping_keepalive` | TCP ping/pong |
| `test_multiple_concurrent_connections` | Two clients see each other |
| `test_server_config_has_large_limits` | Server config matches test-mumble.ini |
| `test_plugin_data_transmission_between_two_clients` | Client A sends `PluginDataTransmission` → Client B receives it with correct payload and sender session |
| `test_plugin_data_empty_receivers_not_delivered` | Empty `receiver_sessions` → message not forwarded (confirms Mumble server behaviour) |
| `test_poll_roundtrip_create_and_vote` | Full poll flow: create poll → deliver → vote → deliver vote back |
| `test_poll_bidirectional_sending` | Both A→B and B→A poll delivery works (not one-directional) |
| `test_poll_multiple_senders_same_channel` | Three users each send polls, all receive each other's |
| `test_poll_cross_channel_is_delivered` | PluginData IS delivered to explicitly-listed sessions across channels |
| `test_poll_mixed_channels_only_same_channel_receives` | Mixed-channel scenario: all explicitly-listed targets receive regardless of channel |

> **Note:** The Mumble server delivers `PluginDataTransmission` to ALL
> explicitly listed `receiver_sessions` regardless of channel membership.
> Channel-scoped poll delivery is enforced by the UI (only listing
> same-channel users as targets).

### Graceful skip

All tests call `ensure_server_available()` first.  If the server is
unreachable they print a warning and return early instead of failing,
so `cargo test` still passes without Docker.

## Frontend tests

The React frontend has unit tests using **Vitest** + **@testing-library/react**
(some 280 files).  A test sits beside the file it tests as `*.test.ts(x)`, or in
a `__tests__/` directory next to it.  Nebula components render through
`withNebulaTheme` from `@nebula/testTheme`.

```bash
cd crates/mumble-tauri/ui
npm test                                  # single run
npm run test:watch                        # watch mode
npx vitest run src/ui/nebula/theme.test.tsx   # one file
```

Vitest blanks every stylesheet it is not told to process; `vitest.config.ts`
lists the ones a test reads as text.

## Tauri commands (Rust -> JS bridge)

There are several hundred, so there is no table here to go stale.  They live in
`crates/mumble-tauri/src/commands/`, one file per area (`connection.rs`,
`messaging.rs`, `channels.rs`, `audio.rs`, `screenshare.rs`, `admin.rs`, ...),
and are registered in `commands/registry.rs`.  A new command needs its
function, its registration, and - if it is not covered by an existing
permission - an entry under `crates/mumble-tauri/capabilities/`.

Blocking work inside a command goes through `spawn_blocking`: a command that
blocks a runtime worker starves the protocol event loop, and the first symptom
is audio dropping out.

## Key types

TypeScript types live in `ui/src/core/types/` (split by area; `chat.ts` holds
`UserEntry`, `ChannelEntry` and the message types).  The store is
`ui/src/core/store/index.ts` with its slices under `store/slices/`.

On the Rust side: `ClientHandle`, `CommandAction` and `EventHandler` in
`mumble-protocol` (`client.rs`, `command/mod.rs`, `event.rs`), `ServerState` in
`state.rs`, `ControlMessage` in `message.rs`, and `AppState` in
`mumble-tauri/src/state/mod.rs`.
