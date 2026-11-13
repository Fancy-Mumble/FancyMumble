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
  first use; a server password, and the one-time code of an account
  with a second factor, asked for once a server has turned the user away
  (the code path has not been tried against a server that demands one); one identity to connect as at every launch; a right click marks a
  server a favourite or copies its address. Several
  servers at once, one tile each on the rail: `+` adds another, a click
  switches, a right click says what the server is or leaves it. A lost
  connection is retried.
- **On a server.** The channel tree in order with unread counts (the
  empty channels left out, if asked), who is in
  each channel, who is talking; read a channel with a click, enter it with
  a double click or Join; listen to one without joining; channel passwords;
  create, rename, describe and delete channels, and set a channel's
  password; the welcome message, comments and
  descriptions.
- **Messages.** Rich text with live links and embedded pictures; send a
  picture from a file or the clipboard, scaled to what the server takes; a
  click on a picture looks at it large, and saves it;
  day rules
  and local time, several lines (Shift+Enter), direct messages,
  notifications and the unread count in the window's title. A long
  conversation opens on its newest page and steps back on asking; an
  arrival does not move a reader who has scrolled up. The search field
  finds messages as well as channels. On a Fancy server:
  reply, mention somebody (`@name`, finished with Tab), edit and delete
  your own, react (six at a click, the rest from a picker that also
  writes into the composer), pin, see who is writing and who has
  read what you wrote, ask a poll and answer one, leave a message with
  the server to send later (at `18:30`, or in `15m`, `2h`, `1d`) and call
  one off while it waits, share a file (the paperclip, or dropped on the
  conversation) and save one shared, a card for
  what lies behind a link, and channels that keep their messages for
  whoever comes later: on the server, or end-to-end encrypted, with the
  key passed on to a newcomer when somebody who holds it agrees; or
  sealed the Signal way, read only by who is in the channel when something
  is said, where the Signal bridge library is installed (it is a library
  of its own and is looked for beside the executable).
- **People.** Pictures, comments, what the server knows of a connection;
  per-user volume; kick, ban, mute, deafen, move, register, priority
  speaker, moving everyone in your channel along to another, and for a
  moderator taking away a comment or a picture, or deleting what one
  person said in a channel or all that the server keeps of it; your own
  comment and picture. A channel can be made to last only while somebody
  is in it.
- **Friends.** Kept from somebody's menu, by their certificate, so they
  are the same person on any server; the list says who is here now and
  opens the conversation with one who is.
- **Administration.** The ban list and the registered accounts, behind a
  right click on the server's tile: filter them, lift a ban, rename an
  account or remove its registration (asked twice). Only the rows in view are built. A channel's
  permissions from its menu: its rules one at a time, each allowing or
  denying a permission for a group, here or in the channels below, and
  under a group's rule who is in it: a click puts somebody who is here
  and registered in, or takes a member out.
- **Certificates.** Listed with who uses each, from the foot of the
  server list; export one to carry it to another machine, import one,
  delete one (asked twice).
- **Voice.** The microphone button turns voice on, then mutes and unmutes;
  the headphones deafen. Devices, push to talk, the activation level,
  noise suppression, automatic gain, input and output volume, voice
  quality and voice over TCP are behind the sliders button on the user
  tile. A whisper key speaks to one user, or shouts into one channel,
  chosen from their menu, and to nobody else while it is held.
- **Privacy.** Whether others are told that you are writing and what you
  have read, and whether a server is asked what lies behind a link: three
  switches under Settings, on the menu of your own tile.
- **Recording.** What is heard, written to a WAV file in a folder of
  your choosing, from the menu on your own tile, until stopped.
- **Look.** The thirteen themes in light and dark, from the menu on the
  user's own tile (and under the saved servers, before there is a tile).
  Theme, devices and voice settings are remembered.
- **Keys.** `Ctrl+F` search, `Escape` close what is open, `Ctrl+Shift+T`
  next theme, `Ctrl+Shift+L` light/dark, `Ctrl+Q` quit. Fields take
  composed input (dead keys, an input method), pointer and shift-arrow
  selection, and cut, copy and paste.

What the web UI has and this does not, yet: screen sharing (its button
is drawn where the web UI has it, and says so), friends on servers the
view is not connected to, and a Fancy server's own settings.

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

The Signal test (`live_fancy_a_signal`) also wants `libsignal_bridge.so`
beside the test binary, in `target/.../debug/deps`.
The recording test runs alone: `-- --ignored alone_what_is_heard`.

name what the other live tests need; each is skipped by filter when its
server is not there (`-- --ignored live_fancy`).

## Measuring the look

The main screen is measured against the web UI, not judged by eye. The web
UI's side is `crates/mumble-tauri/ui/preview/native.tsx`: the whole client
on a stubbed backend, serving the same small server as this view's plain
demo. Both are drawn at 1410 by 758 and compared pixel for pixel:

    # the web UI (from crates/mumble-tauri/ui)
    node_modules/.bin/vite --config preview/vite.rail.config.ts --port 5393
    google-chrome --headless=new --use-angle=swiftshader \
        --enable-gpu-rasterization --window-size=1410,758 --hide-scrollbars \
        --virtual-time-budget=9000 --screenshot=web.png \
        'http://localhost:5393/native.html?mode=dark'

    # this view, in a compositor that gives it the same size
    FANCY_GPUI_ENGINE=demo FANCY_GPUI_DEMO=plain FANCY_GPUI_MODE=dark \
        FANCY_GPUI_FRAME=client fancy-gpui

    tools/compare.py web.png native.png overlay.png

The connect screen is the same page with `&screen=connect`, against this
view started without `FANCY_GPUI_DEMO`.

As of the last measurement the default theme's main screen deviates by
0.26 % (dark) and 0.28 % (light), mean absolute, over the whole window, and
its connect screen by 0.39 % and 0.41 %. About half of that is
channels one level apart, which is the browser dithering its gradients; the
same page drawn by Chrome's two rasterisers differs from itself by 0.22 %.
The rest is the edges of glyphs and icons, where two rasterisers never
agree. Every box is where the web UI puts it, to the pixel; `?dump` on the
page lists where that is.

Only those two screens, in that theme, have been brought to measure. Three
other themes were measured on the main screen and left as they came out
(rose 0.31 %, aurora 0.31 %, ply 0.60 %). The dialogs and menus take the web
UI's floating surface - the window's colour under the theme's tint, its
hairline and its shadow - but have not been compared pixel for pixel.

## Components

Screens are built from a small kit, `src/ui/kit`, in the manner of a
component library: a builder that reads the theme itself and turns into an
element.

| Component | What it is |
| --- | --- |
| `IconButton` | A button that is an icon: `Variant` (ghost, dashed, tonal, soft, filled, solid), `Tone`, `Corner`, any size. |
| `Button` | A button that is a word, with an icon before it if wanted: text or contained, small or medium. |
| `Avatar` | A face or a server's tile: picture or initials, presence pip, the ring of somebody speaking. |
| `Paper` | A card cut as the web UI cuts them, edge under fill: raised, a field, or a plain plate (a message's bubble). |
| `Sheet`, `Dialog` | An opaque surface that floats, and one in the middle of a veil, with a title. |
| `MenuItem` | A row of a menu or of a list of choices. |
| `SwitchRow` | A setting that is on or off: its name and its switch on a row that takes the click. |
| `Switch`, `Radio`, `Badge`, `Kbd` | The small marks. |
| `Backdrop` | A surface filled with one of the theme's gradient stacks. |

    IconButton::new("leave", "log-out")
        .tone(Tone::Danger)
        .on_click(cx.listener(|shell, _, _, _| shell.engine.disconnect()))

A new screen should need no colours or corner sizes of its own; where one
does, that is a component missing from the kit.

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

The window's mesh and the conversation's backdrop are CSS gradient stacks
in that file. They are drawn here (`src/paint.rs`) once per size into a
picture an eighth of the area each way and stretched: tens of kilobytes,
and no work per frame. Left out on purpose, because they are what costs the
most to draw: backdrop blur, clip paths, and the two patterned layers
(scanlines, dots) some themes add.

Inter is bundled (`assets/fonts`, OFL): six static faces cut from the
variable font the web UI ships, one of them the bold of its display cut
for headings, about 1.7 MiB in memory. It is what the web
UI sets everything in, and without it the two views break lines in
different places. A theme whose stack names another family the system has
still gets that family.

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
| `FANCY_GPUI_DEMO_POLL` | With the demo engine: put a poll to the lounge. |
| `FANCY_GPUI_OPEN` | Start with `picker`, `devices`, `certificates`, `permissions` or `editor` open. |
| `FANCY_GPUI_CONNECT` | Connect at once as the saved identity with this id (`FANCY_GPUI_PASSWORD` for the server's password). |
| `FANCY_GPUI_SAY` | With `FANCY_GPUI_CONNECT`: say this once connected. |
| `FANCY_GPUI_FRAME` | `client` draws the window's own controls even where the compositor frames it. |
| `FANCY_GPUI_ENGINE` | `demo` runs on the engine that exists only in memory. With it, `FANCY_GPUI_DEMO=connected` starts on the demo server, `FANCY_GPUI_DEMO=plain` on the same server with nothing of Fancy Mumble's on it, and `FANCY_GPUI_DEMO_TALKING=<session>` has that user talking. |

## Icons

The icons in `assets/icons` are from [Lucide](https://lucide.dev), under the
ISC licence (`assets/icons/LICENSE`).
