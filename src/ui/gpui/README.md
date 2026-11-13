# fancy-gpui

The native view of Fancy Mumble, drawn with [GPUI](https://gpui.rs). It is
meant to be the cheapest way to keep the client open: no web view, no script
runtime, and nothing drawn while nothing changes.

It looks like the web UI's default design (Nebula) and paints with the same
thirteen themes, each in a light and a dark mode. It runs on the same engine
as the Tauri application.

## State

A working client: it connects to Mumble and Starling servers through the
real engine and does text and voice.

- **Servers.** Saved servers and their identities, each pinged for whether
  it is up; add, edit and forget them; a certificate per identity, made on
  first use; a server password typed for the connect at hand. Several
  servers at once, one tile each on the rail: `+` adds another, a click
  switches, a right click says what the server is or leaves it. A lost
  connection is retried.
- **On a server.** The channel tree in order with unread counts, who is in
  each channel, who is talking; read a channel with a click, enter it with
  a double click or Join; listen to one without joining; channel passwords;
  create, rename and delete channels; the welcome message, comments and
  descriptions.
- **Messages.** Rich text with live links and embedded pictures, day rules
  and local time, several lines (Shift+Enter), direct messages,
  notifications and the unread count in the window's title. On a Fancy
  server: edit and delete your own, react, pin, see who is writing, and
  channels that keep their messages for whoever comes later.
- **People.** Pictures, comments, what the server knows of a connection;
  per-user volume; kick, ban, mute, deafen, move, register, priority
  speaker; your own comment and picture.
- **Voice.** The microphone button turns voice on, then mutes and unmutes;
  the headphones deafen. Devices, push to talk, the activation threshold,
  noise suppression and automatic gain are behind the sliders button on
  the user tile.
- **Look.** The thirteen themes in light and dark, from the picker in the
  band. Theme, devices and voice settings are remembered.
- **Keys.** `Ctrl+F` search, `Escape` close what is open, `Ctrl+Shift+T`
  next theme, `Ctrl+Shift+L` light/dark, `Ctrl+Q` quit. Fields take
  composed input (dead keys, an input method), pointer and shift-arrow
  selection, and cut, copy and paste.

What the web UI has and this does not, yet: sending pictures and files,
link previews, polls, read receipts, end-to-end encrypted channels' key
handling, message search and paging far back, certificate management,
screen sharing, and the admin surfaces (bans, registered users, ACLs,
server settings).

## Testing

    cargo test

runs the views with simulated clicks and keys, with no display, against an
engine that exists only in memory (`src/demo.rs`).

    FANCY_GPUI_TEST_SERVER=127.0.0.1:64738 cargo test -- --ignored live

runs two real engines against a live server: connect, see each other, a
message there and back, voice on and heard. Run it where no speakers are
attached, or expect a tone: the microphone is the engine's virtual one.

    FANCY_GPUI_TEST_SERVERS=host:port,host:port   one client on two servers
    FANCY_GPUI_TEST_FANCY=host:port                edits, reactions, typing
    FANCY_GPUI_TEST_SUPERUSER=<password>           with the above: kept
                                                   history, deletion, pins

name what the other live tests need; each is skipped by filter when its
server is not there (`-- --ignored live_fancy`).

How the views look is checked by eye, against screenshots of the web UI.

## The engine

The view never names a concrete engine. `src/engine.rs` is the whole of what
it asks for: a snapshot of the server, the messages of a channel, a handful
of commands, and a stream of events that say what to read again.
`src/real.rs` puts the real engine behind that trait; it is a mapping, and
what it adds is what the engine has no notion of - the saved servers, kept
in `servers.json`, and their pings.

The engine still lives inside the `mumble-tauri` package. This package
links it with `default-features = false`, which leaves the Tauri view - and
every dependency only it needs - out of the build, and talks to it through
`mumble_tauri_lib::engine_api`. When the engine becomes a crate of its own,
the dependency line changes and nothing else.

Files live in the platform's data directory under `fancy-mumble-native`
(`FANCY_GPUI_DATA_DIR` overrides it): the engine's identities and keys, and
the view's `servers.json` and `view.json`. Not the Tauri application's
directory: two programs writing one set of keys is how a key gets lost.

## Themes

`assets/themes.json` is generated, not written. The web UI's catalogue
(`crates/mumble-tauri/ui/src/ui/nebula/themeCatalog.ts`) is the source, and a
test next to it resolves every theme in both modes and compares the result
with the file, so the two views cannot drift apart. After changing the
catalogue:

    cd crates/mumble-tauri/ui
    npx vitest run src/ui/nebula/nativeThemes.test.ts -u

Left out on purpose, because they are what costs the most to draw: the
radial window mesh, backdrop blur and clip paths. Chrome the web UI draws as
glass over a mesh is the same colour over the flat window here.

No font is bundled. Each theme's font stack is resolved against the fonts
the system has, falling back to a static sans, serif or monospace of the
same voice.

## Building

    cd src/ui/gpui
    cargo run

The package is excluded from the workspace and keeps its own `Cargo.lock`,
so GPUI's dependencies and Tauri's cannot move each other's versions.

On Linux it needs the development files of `libxkbcommon` and
`libxkbcommon-x11`, Wayland and/or XCB, fontconfig, freetype and a Vulkan
driver. `--no-default-features --features wayland` (or `x11`) builds for one
window system only.

`Cargo.lock` holds `libc` at 0.2.186: GPUI 0.2.2 depends on `xattr` 0.2.3,
which does not build against a newer `libc`.

For development:

| Variable | Effect |
| --- | --- |
| `FANCY_GPUI_DATA_DIR` | Keep every file here instead of the platform's place. |
| `FANCY_GPUI_THEME`, `FANCY_GPUI_MODE` | Start in this theme (`dark`, `rose`, ...) and mode (`light`, `dark`), without choosing it. |
| `FANCY_GPUI_OPEN` | Start with `picker`, `devices` or `editor` open. |
| `FANCY_GPUI_CONNECT` | Connect at once as the saved identity with this id (`FANCY_GPUI_PASSWORD` for the server's password). |
| `FANCY_GPUI_SAY` | With `FANCY_GPUI_CONNECT`: say this once connected. |
| `FANCY_GPUI_FRAME` | `client` draws the window's own controls even where the compositor frames it. |
| `FANCY_GPUI_ENGINE` | `demo` runs on the engine that exists only in memory. With it, `FANCY_GPUI_DEMO=connected` starts on the demo server and `FANCY_GPUI_DEMO_TALKING=<session>` has that user talking. |

## Icons

The icons in `assets/icons` are from [Lucide](https://lucide.dev), under the
ISC licence (`assets/icons/LICENSE`).
