<div align="center">

# Fancy Mumble

### A Modern, Feature-Rich Mumble Client

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-%23000000.svg?style=flat&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/react-%2320232a.svg?style=flat&logo=react&logoColor=%2361DAFB)](https://reactjs.org/)
[![Tauri](https://img.shields.io/badge/tauri-%2324C8DB.svg?style=flat&logo=tauri&logoColor=%23FFFFFF)](https://tauri.app/)

**Fancy Mumble** brings modern UI/UX design and powerful customization features to the legendary [Mumble](https://www.mumble.info/) voice chat platform.

Built with **Rust** for rock-solid performance and **React** for a sleek, responsive interface.

[Features](#features) • [Screenshots](#screenshots) • [Installing](#installing) • [Getting Started](#getting-started) • [Building](#building) • [Changelog](CHANGELOG.md) • [Server](#related-projects)

</div>

---

## Overview

Fancy Mumble is a next-generation desktop and Android client for Mumble that combines the reliability of the battle-tested Mumble protocol with modern features users expect in 2026. Whether you're coordinating with your gaming guild, hosting a podcast, or running a community server, Fancy Mumble delivers crystal-clear voice communication with style.

> **Status:** Active development - Core features are functional, but expect some rough edges as we polish the experience.

---

## Features

- **Crystal-clear voice** - Opus with a choice of noise suppressors (RNNoise, DeepFilterNet3), AGC and a noise gate, on a receive path tuned for low latency
- **Flexible voice controls** - Push-to-talk, voice activity detection, whisper targets, per-channel listening, channel recording
- **Screen and camera sharing** - Both at once, with the desktop's audio, hardware encoding (Media Foundation, NVENC, VA-API), drawing on the shared picture, and live statistics
- **Rich chat** - Markdown, picture galleries, spoilers, GIFs, polls, reactions, link previews, mentions that reach a role, read receipts, scheduled messages, file sharing
- **Persistent, end-to-end encrypted history** - Chat that survives a restart without the server being able to read it, plus XChaCha20-Poly1305 voice on Fancy servers
- **Working together** - Live documents edited by several people at once, a calendar with meeting rooms and invite links, friends and direct messages across servers, in-place translation
- **Profile customization** - Avatar frames, banners, nameplates, a WYSIWYG bio editor, and profile cards
- **A look of your own** - Nebula, the default interface, ships thirteen skins and a one-handed layout for phones; Standard keeps the classic glass look with its own theme catalogue
- **Server administration** - Channels, ACLs, roles and bans, a searchable audit log, a block-based welcome screen editor, server branding, and a plugin marketplace
- **Around the game** - Game detection with rich presence, and an in-game overlay
- **Secure** - TLS everywhere, certificate identities, optional TOTP two-factor login, no telemetry
- **Cross-platform** - Windows, Linux and Android, plus a minimal Qt 6 client for machines where a webview is too heavy
- **Stays current** - A built-in updater with an opt-in beta channel

Voice and plain text chat work against any Mumble server. Most of the rest needs
a Fancy server - see [Related Projects](#related-projects).

---

## Screenshots

### Main Interface
![Main Chat Interface](images/chat.png)
*The main view - channels on the left, chat in the middle, user info on the right*

### Profile Customization
![Profile Editor](images/profileeditor.png)
*Customize your profile with frames, banners, and a bio editor*


### Audio Settings
![Audio Pipeline](images/audiosettings.png)
*Configure your mic settings and enable AI noise suppression*

---

## Architecture

Fancy Mumble is built as a Rust workspace with multiple crates:

| Crate | Purpose |
|-------|---------|
| [`mumble-protocol`](crates/mumble-protocol) | Core Mumble protocol implementation - TCP/UDP, TLS, Opus, the audio pipeline, persistent chat |
| [`mumble-tauri`](crates/mumble-tauri) | Tauri app for desktop and Android - backend commands, state management, updater |
| [`mumble-tauri/ui`](crates/mumble-tauri/ui) | React frontend - a shared core and the UI packs drawn on top of it |
| [`fancy-audio-device`](crates/fancy-audio-device) | Audio capture and mixing playback shared by both clients (cpal, with a WASAPI path of its own) |
| [`fancy-screenshare`](crates/fancy-screenshare) | Screen and camera capture, hardware encoding, WebRTC delivery |
| [`fancy-denoiser-deepfilter`](crates/fancy-denoiser-deepfilter) | AI noise suppression using DeepFilterNet3 |
| [`fancy-gamedetect`](crates/fancy-gamedetect) | Finds the game in the foreground and the launchers that installed it |
| [`fancy-presence`](crates/fancy-presence) | Rich presence over Discord's IPC endpoint |
| [`fancy-utils`](crates/fancy-utils) | Shared utility functions |
| [`signal-bridge`](crates/signal-bridge) | Signal sender keys for encrypted chat. AGPL-3.0, built on its own and loaded at runtime, so the client stays MIT |
| [`qt6ui`](crates/qt6ui) | Minimal native Qt 6 / QML client. LGPL-3.0, built outside the workspace |

**Tech Stack:** Rust 2024 + Tauri 2 + React 19 + TypeScript 5 + MUI + Tokio async runtime

For detailed documentation, see [`crates/mumble-protocol/doc/`](crates/mumble-protocol/doc/)
for the protocol library and [`crates/mumble-tauri/ui/src/README.md`](crates/mumble-tauri/ui/src/README.md)
for how the frontend is laid out.

---

## Installing

Installers for every release are on the
[Releases page](https://github.com/Fancy-Mumble/FancyMumble/releases/latest):

| Platform | File |
|----------|------|
| Windows | `-setup.exe` (updates itself) or `.msi` |
| Linux | `.AppImage` (updates itself) or `.deb` |
| Android | `.apk` |
| Minimal Qt client | `.zip` (Windows) or `.tar.gz` (Linux) |

Packaging recipes for the AUR and Flathub live under [`packaging/`](packaging/).
What changed between versions is in the [changelog](CHANGELOG.md).

---

## Getting Started

### Prerequisites

- **Rust** (stable, 1.85 or later - the workspace is on edition 2024) - [Install via rustup](https://rustup.rs/)
- **Node.js** (v22 or later) - [Download from nodejs.org](https://nodejs.org/)
- **Tauri CLI** - Install with: `cargo install tauri-cli --version "^2"`

#### Platform-Specific Dependencies

**Linux:**
```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libasound2-dev \
  libgtk-3-dev \
  libglib2.0-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev \
  protobuf-compiler \
  libpipewire-0.3-dev \
  libva-dev \
  libdrm-dev \
  libgbm-dev
```

**Windows:** `protoc` has to be on the `PATH`
([protobuf releases](https://github.com/protocolbuffers/protobuf/releases)).

**Android:**
See [ANDROID_DEV.md](ANDROID_DEV.md) for complete Android development setup instructions.

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/Fancy-Mumble/FancyMumble.git
   cd FancyMumble
   ```

2. **Install frontend dependencies**
   ```bash
   cd crates/mumble-tauri/ui
   npm install
   cd ../../..
   ```

3. **Run the development server**
   ```bash
   cd crates/mumble-tauri
   cargo tauri dev
   ```

The app will launch with hot-reloading enabled for both Rust and TypeScript changes.

---

## Building

### Desktop (Windows/Linux)

```bash
cd crates/mumble-tauri
cargo tauri build
```

Production installers will be generated in `target/release/bundle/`:
- **Windows:** `.exe` installer, `.msi` package
- **Linux:** `.deb`, `.AppImage`, `.rpm`

### Android

```bash
cd crates/mumble-tauri
cargo tauri android build
```

APK/AAB files will be in `gen/android/app/build/outputs/`.

For development with hot-reload:
```bash
cargo tauri android dev
```

Or use the helper script (Windows):
```powershell
.\scripts\android-dev.ps1 -Run
```

### Releases and update channels

Releases are cut by CI from a branch, never by hand. The version in
`crates/mumble-tauri/tauri.conf.json` is the source of truth for the tag, and
`ui/package.json` plus `crates/mumble-protocol/Cargo.toml` must agree with it
or the build fails before anything is published.

| Branch | Publishes | Visible to |
| --- | --- | --- |
| `main` | `vX.Y.Z`, flagged latest | everyone |
| `beta` | `vX.Y.Z-beta.N`, flagged pre-release | users who opted in |

A pre-release is listed on the Releases tab with GitHub's "Pre-release" marker,
but it is excluded from `releases/latest`, which is where every stable client
looks. Beta clients read a separate manifest, `beta.json`, which CI publishes on
the orphan `updater` branch after the release itself exists. It is served from
`raw.githubusercontent.com` and can lag a release by a few minutes of CDN cache.

**Cutting a beta.** Branch `beta` off `develop`, set all three version files to
the *next* stable version (e.g. `0.4.0` while `0.3.0` is released), and push. CI
appends `-beta.<run number>`, so successive pushes give `0.4.0-beta.1`,
`0.4.0-beta.2` and so on. Pushing a `beta` branch whose version is not above the
latest stable release fails the build on purpose: such a build would sort below
what testers already have and reach nobody.

**Opting in.** Settings -> Advanced -> Beta updates. The updater then checks both
manifests and offers whichever version is higher, so a tester moves onto the
stable `0.4.0` on their own the moment it ships. Turning the setting back off
does not roll an installed beta back; the client simply waits until a stable
release overtakes it. For the same reason a tester on `0.4.0-beta.3` is not
offered a `0.3.1` stable hotfix.

**What beta builds contain.** Windows NSIS installer, Linux AppImage, and the
Android APK. No MSI (the bundler rejects a non-numeric pre-release identifier)
and no `.deb` (dpkg reads `-beta.N` as a Debian revision and sorts it *above* the
final `0.4.0`, which would block the upgrade to stable). The auto-updater only
ever uses the NSIS installer and the AppImage. Every beta of a version shares one
Android `versionCode`, so betas can be sideloaded over each other but could not
be uploaded to a store alongside the stable build.

To exercise the channel logic locally without publishing anything, serve a
manifest and point a debug build at it:

```bash
python3 -m http.server 8787          # serving a directory containing beta.json
FANCY_UPDATER_BETA_URL=http://127.0.0.1:8787/beta.json cargo tauri dev
```

---

## Testing

### Frontend Unit Tests
```bash
cd crates/mumble-tauri/ui
npm test              # Single run
npm run test:watch    # Watch mode
npm run lint          # ESLint
npx tsc --noEmit      # Type check
```

### Rust Unit Tests
```bash
cargo test --package mumble-protocol --features opus-codec --lib
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

### Integration Tests

Integration tests run against a real Mumble server in Docker:

```bash
cd crates/mumble-protocol

# Start test server
docker compose -f docker-compose.test.yml up -d --wait

# Run tests
cargo test --package mumble-protocol --test integration

# Run specific test
cargo test --package mumble-protocol --test integration -- test_plugin_data_transmission_between_two_clients

# Cleanup
docker compose -f docker-compose.test.yml down
```

**Note:** Docker must be running, and port 64738 (TCP+UDP) must be available.

---

## Related Projects

### Server Implementation

Fancy Mumble connects to any standard Mumble server for voice and plain text
chat. Everything beyond that - persistent encrypted history, file sharing, screen
sharing, the calendar, server branding and the rest - is spoken over a protocol
extension that a Fancy server implements:

- **Starling** - [github.com/Fancy-Mumble/starling](https://github.com/Fancy-Mumble/starling) -
  the Fancy Mumble server, written in Rust. This is the server the client is
  developed and tested against.
- **SetZero/mumble-server** - [github.com/SetZero/mumble-server](https://github.com/SetZero/mumble-server) -
  the earlier fork of the C++ Mumble server, kept as a reference.

### Official Resources

- [Mumble Official Website](https://www.mumble.info/)
- [Mumble Protocol Documentation](https://mumble-protocol.readthedocs.io/)
- [Mumble GitHub](https://github.com/mumble-voip/mumble)

---

## Contributing

We welcome contributions! Whether you're fixing bugs, adding features, improving documentation, or suggesting ideas, your help is appreciated.

**Before contributing:**
1. Check existing issues and pull requests to avoid duplicates
2. Read the [CONTRIBUTING.md](.github/CONTRIBUTING.md) guidelines
3. Review the [Copilot Instructions](.github/copilot-instructions.md) for coding conventions
4. Follow the Boy Scout Rule: leave code cleaner than you found it

**Development workflow:**
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with clear, descriptive commits
4. Run tests and linters (`cargo fmt`, `cargo clippy`, `cargo test`, `npm test`, `npm run lint`)
5. Push to your fork and open a pull request

---

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- **Mumble Team** - For creating and maintaining the excellent Mumble protocol
- **Tauri Team** - For the amazing cross-platform framework
- **Rust Community** - For the incredible ecosystem and tools
- All contributors who help make Fancy Mumble better

---

<div align="center">

**Built with ❤️ by the Fancy Mumble Team**

[Report Bug](https://github.com/Fancy-Mumble/FancyMumble/issues) • [Request Feature](https://github.com/Fancy-Mumble/FancyMumble/issues) • [Join Discussion](https://github.com/Fancy-Mumble/FancyMumble/discussions)

</div>
