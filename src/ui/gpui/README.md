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
  click on a picture looks at it large, and saves it; a picture stands on
  no plate, in the room its file says it takes, so the row is its size
  before the picture is decoded;
  day rules
  and local time, several lines (Shift+Enter), direct messages,
  notifications and the unread count in the window's title. A long
  conversation opens on its newest page and steps back on asking; an
  arrival does not move a reader who has scrolled up. The search field
  finds messages as well as channels. What is typed with `**bold**`,
  `*italic*`, `***both***`, `__underlined__`, `~~struck~~`, `||hidden||`,
  `` `code` ``, `[words](https://address)`, a fenced block or
  a quoting `>` is sent set that way, and is set that way in the composer
  while it is typed, its marks faint: one reading of the text (the
  engine's `markup`) says both. `Ctrl+B`, `Ctrl+I`, `Ctrl+U` (underlined),
  `Ctrl+E` (code), `Ctrl+Shift+X` (struck) and `Ctrl+Shift+H` (hidden) put
  the marks round the selection or take them away; a selection only partly
  marked is marked all through. So do the buttons of the bar that floats
  over a selection, which show which marks it has, ask for a link's address,
  and open the emoji picker. On a Fancy server:
  reply, mention somebody (`@name`, finished with Tab), edit and delete
  your own, pick several messages and delete them together, react (six at a click, the rest from a picker that also
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
- **Profiles.** Somebody's card, in the measures of the web UI's: their
  banner (or a rake of colours hashed from who they are), how they are and
  where on a pill over it, their face with its pip, their name as their
  profile sets it and a tick if they have an account, pronouns, contact and
  status, what they wrote about themselves, every role they hold, what they
  have said here, how loud they are played here on a bar, a line that writes
  to them, and a button that silences them here. It comes up beside a name
  in the channel list or the member panel while the pointer rests there,
  where the pointer cannot reach it; a click keeps it until a press lands
  anywhere else. What they wrote is the profile's "about" (blocks with small
  thumbnails, in a room that scrolls and fades); a profile of the older
  format shows only its basic words and says so, and its owner can convert
  it. A full profile, where there is one, is fetched from the server's own
  file store only when "View full profile" is pressed; nothing else in a
  profile is ever fetched. The format is [PROFILE_FORMAT.md](PROFILE_FORMAT.md);
  "Edit about…" on one's own menu edits it as blocks. What the
  server knows of somebody's connection is "User information" on their
  menu. Text keeps the colour its writer gave it, there and in messages.
- **People.** Pictures, comments, what the server knows of a connection;
  per-user volume; kick, ban, mute, deafen, move, register, priority
  speaker, moving everyone in your channel along to another, and for a
  moderator taking away a comment or a picture, or deleting what one
  person said in a channel or all that the server keeps of it; your own
  comment and picture. A channel can be made to last only while somebody
  is in it.
- **Members and roles.** The people button in the header lists who is in
  the channel under the role the server files each of them under, and a
  name wears its role's colour wherever it is drawn. Roles are the groups
  of the server's root channel, which most servers show only to their
  administrators; without them everybody is listed as a member.
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
- **Settings.** As the web UI's: from the menu of your own tile or
  `Ctrl+,`, a column of pages beside the rail (Profile, Voice,
  Personalize, Notifications, Privacy, Language & format, Shortcuts,
  Identities, Advanced, and what the server lets you look after) with a
  search over them that lights what it found, each page built from the
  same controls as the web UI's. A setting the web UI has and this client
  has nothing behind is left out, not drawn dead. The theme picker opens
  from the connect screen, the voice panel only with `FANCY_GPUI_OPEN`.
- **Your own dock.** Your face, name and voice state at the foot of the
  column, with mute, deafen and share; a drawn theme (Nimbus) stands
  them across the card as a bank of plated switches. Its menu is the web
  UI's sheet grown out of the dock: the server's head, Share your camera
  (the share picker, on its cameras), Hide empty channels, Settings,
  Server admin (where you may look after something), Record audio (the
  web UI offers it in developer mode only), Leave server.
- **Profile page.** The display name new servers are joined under, the
  card's words (a status that takes bold, italic, underline), what you say
  about yourself in the block editor, picture and banner, the card's
  style, which rows the card shows, and beside it your card itself,
  changed as you type, with example content on asking.
- **Privacy.** Whether others are told that you are writing and what you
  have read, and whether a server is asked what lies behind a link: three
  switches on the settings page.
- **Recording.** What is heard, written to a WAV file in a folder of
  your choosing, from the menu on your own tile, until stopped.
- **Look.** The thirteen themes in light and dark, from the menu on the
  user's own tile (and under the saved servers, before there is a tile).
  Theme, devices and voice settings are remembered.
- **Keys.** `Ctrl+Shift+M` mute, `Ctrl+Shift+D` deafen, `Alt+Up` and
  `Alt+Down` the channel above and below, `Alt+Home` the first, `Ctrl+U`
  who is here, `Ctrl+,` settings, `F11` the whole screen,
  `Ctrl+F` search, `Escape` close what is open, `Ctrl+Shift+T`
  next theme, `Ctrl+Shift+L` light/dark, `Ctrl+Q` quit. Fields take
  composed input (dead keys, an input method), pointer and shift-arrow
  selection, and cut, copy and paste.

- **Since the parity plan** (each step is in [PARITY_PLAN.md](PARITY_PLAN.md)
  under Progress, with how it was checked):
  - *What the server allows.* Menus offer only what would not be refused:
    moderation by the rights held where somebody is and at the root, a
    channel's own entries by its rights, the ban and account lists by the
    root's. A channel behind a password shows a lock and asks for it on
    every way in. The header's Join also turns voice on.
  - *A lost connection* shows a band at the foot of the window: the seconds
    to the next attempt, which attempt it is, Retry now, Cancel. Advanced
    settings can switch reconnecting off.
  - *Reading.* Message text is laid out in blocks (quotes, code that
    scrolls instead of wrapping, sized headings, numbered and nested
    lists); a link that is its own address is printed as its host and the
    start of its path; a link is asked about before it opens in the
    browser, unless its host was trusted; a rule marks where reading left
    off, a pill says messages arrived below; one person's run ends after
    an hour's pause and its time stands once; a message that names you is
    marked; several pictures of a message are one block of tiles, and the
    arrows go from picture to picture once one is open.
  - *Acting on a message.* A pill of actions stands off the message under
    the pointer. The header's pin lists everything pinned, with who pinned
    it, and a click goes to the message; so does a click on the quote of
    what a message answers, and on a message the search found.
  - *Writing.* An `@` opens a list of names (arrows, Enter, Tab or a
    click); the emoji picker has every emoji in its groups, found by
    name, the last used first; what was being written waits in the
    conversation it was written in.
  - *People and servers.* A click on somebody keeps their card (the menu's
    "User information" is the sheet of facts); "Move to…" and "Move
    everyone in here to…" choose a channel from the tree; registering and
    deregistering are asked about first; the member panel lists the room,
    then everybody else by role, and can be searched; how loud somebody is
    played is remembered by their certificate; saved servers nobody is on
    have fainter tiles on the rail.
  - *Profiles.* More of a profile is read: the name's weight, face and a
    colour held to what reads on the card, a banner in two colours, a
    status with markup, and the rows its owner switched off.
  - *Settings.* Text size, the clock (12 or 24 hours), reconnecting, the
    log folder, trusted sites; the voice levels are bars to drag.
  - *From the web client.* Its saved servers and certificates on this
    computer are offered once, to be brought over: the other directory is
    read, only this one is written, and nothing here is written over.
  - *Keys.* Also `Ctrl+B`, which puts the channel column away (while
    writing it still sets bold, as `Ctrl+U` underlines), and the system's light or dark setting
    can be followed (the picker's switch goes dark, light, system).
  - *Looking after a server.* A ban is added by hand and changed (an
    address or a network such as `203.0.113.0/24`, how long as `30m`,
    `12h`, `7d`); the registered accounts come in order of name, of who was
    on last or of channel, and say who is here now; a channel's rules offer
    every permission the server has, and a rule can be for one person;
    "New channel inside…" makes a channel with its description, password,
    limit, place and what it keeps in one form.
  - *Pictures, held small.* A picture is never drawn from its file: a copy
    is read at the size of the room it is shown in, kept while it is looked
    at, and let go of after; an animation is read a frame at a time; a heavy
    message is put away on disk and read back for the rows that are drawn;
    and what is not in use is given back to the system once a burst is
    over. `src/pictures/`, `src/away.rs`, `src/trim.rs` say why and how.
  - *Sending files.* A file chosen or dropped waits above the composer and
    goes out with what is typed, as one message. Under one button: whether
    large pictures go up smaller, who can see it (this channel, anyone with
    the link, a password), and how long the server keeps it.
  - *Pictures of one's own.* "Change banner…" puts a picture across the
    head of one's card; Appearance has a picture for behind every
    conversation, with how far it is washed out and blurred.
  - *Sounds.* Off until turned on, on the Notifications page: which sound
    each happening plays and how loud.
  - *Keys from other programs* (Windows). "Keys work in other programs
    too" on the Voice page binds the talk key, the whisper key, mute and
    deafen with the system, so they work while another program has the
    keyboard. Off until switched on: a key bound that way is taken from
    every other program. A key another program already holds is said to be
    taken, and the rest still work.
  - *The tray* (Windows). An icon in the notification area, as the web
    client puts there: its menu mutes and deafens (ticked as they are, and
    only on a server), disconnects, shows the window and quits; a click on
    it shows the window, and it wears a green dot while you talk. Only with
    the real engine, so demo runs leave the tray alone;
    `FANCY_GPUI_TRAY=on` or `off` says otherwise. Closing the window still
    quits.
  - *Kept.* What the engine does is written to a file a day under `logs` in
    the data directory.
  - *A server's livery.* What its operator says it looks like is drawn on
    its page before connecting: its banner (cut around the point it names),
    icon, name, a line under it, its chips and its greeting, with a mark on
    the address saying where that came from. From the open connection, else
    a copy kept from the last visit (under `liveries` in the data directory)
    that the ping's digest vouches for, else asked of the server without
    joining it; nothing is asked before the page is on screen. While
    connected, its name and icon are on the rail and in the band, and its
    colours are worn, held to a contrast floor. `src/livery/` says how.
  - *Screen sharing.* The button on the user's tile opens the picker:
    screens, windows and cameras with a small picture of each, SD, HD or
    as large as it is, the stream mode's presets, size and rate, and the
    computer's sound. The shares in the user's channel stand on a stage
    over the conversation, one large and the others in a strip, laid in
    whole, filling it or pixel for pixel (then moved round by dragging,
    the wheel or the arrow keys), over the whole window if asked; a camera
    shared beside a screen is a feed of its own. A feed can be popped out
    into a window of its own, kept over the others, and brought back. A
    watched share's sound plays through the voice output, with its own
    volume and mute. The sharer can lay what viewers draw over the shared
    screen or window itself, in a window the pointer passes through and
    that captures leave out.
    a mark says who shares in the channel list and the member list. What
    is shared can be drawn on, by the sharer and by those watching, in the
    web client's colours and on its wire, so both draw on each other's
    shares; a frame can be copied, and the statistics are a menu entry
    away. An account on several devices is one user: a share from another
    device of one's own is shown as one's own, watched, and not stopped
    from here. Each stream's frames go into one texture where it lies, at
    the size it is drawn, and a stream out of sight is not decoded.
    `src/share/` says how.

What the web UI has and this does not, yet: the blur behind a picture
looked at large on Linux and macOS (it is drawn on Windows, see
[Building](#building)), the overlay of viewers' drawings on Linux and
macOS, friends on servers the
view is not connected to, and a Fancy server's own settings. That is the
short of it: [PARITY.md](PARITY.md) goes through both clients feature by
feature.

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
    FANCY_GPUI_TEST_CONTAINER=<name>               the server's Docker container, for the
                                                   test that stops and starts it
    FANCY_GPUI_TEST_SFU=1 FANCY_GPUI_SHARE_PATTERN=1
                                                   with a server whose SFU is reachable:
                                                   the pattern shared, watched and read back
                                                   (`live_fancy_share_sfu`)

The Signal test (`live_fancy_a_signal`) also wants `libsignal_bridge.so`
beside the test binary, in `target/.../debug/deps`.
The recording test runs alone: `-- --ignored alone_what_is_heard`.

name what the other live tests need; each is skipped by filter when its
server is not there (`-- --ignored live_fancy`).

What a release build holds on its first screens, against stated bounds
(Windows; exits 1 when a figure is over; the figures and what each
megabyte buys are in `MEMORY.md`):

    tools\memory.ps1 -Exe target\release\fancy-gpui.exe [-Pictures <folder>]

With `-Pictures` it also stages every file of that folder and holds the
peak to the budget. Measuring what making pictures ready takes, alone and
side by side (watch the test process's commit from outside):

    FANCY_GPUI_TEST_PICTURES=<folder> cargo test --release -- --ignored \
        --exact tests_picture_memory::pictures_made_ready_to_send --nocapture

## Measuring the look

Figures are comparable from 14 November 2026, 18:25 on: before then the
preview's stubbed store failed every read but the saved servers, so the web
UI never applied its theme's typeface (it drew in Segoe UI) and its rail held
one server where this view's demo holds three.

The main screen is measured against the web UI, not judged by eye. The web
UI's side is `crates/mumble-tauri/ui/preview/native.tsx`: the whole client
on a stubbed backend, serving the same small server as this view's plain
demo. Both are drawn at 1410 by 758 and compared pixel for pixel:

    # the web UI (from crates/mumble-tauri/ui)
    node_modules/.bin/vite --config preview/vite.rail.config.ts --port 5393
    node tools/webshot.mjs --out web.png \
        --url 'http://localhost:5393/native.html?mode=dark'

    # this view, in a compositor that gives it the same size
    FANCY_GPUI_ENGINE=demo FANCY_GPUI_DEMO=plain FANCY_GPUI_MODE=dark \
        FANCY_GPUI_FRAME=client fancy-gpui

    tools/compare.py web.png native.png overlay.png

`tools/webshot.mjs` drives headless Chrome over its DevTools protocol, with
nothing but Node. It gives the page its size (`--width`, `--height`, 1410
by 758 unless said) before it loads, runs it on virtual time for
`--budget` ms (9000), waits for its fonts, and with `--click <selector>`
presses something and runs `--after` ms (3000) more, to photograph a menu
or a dialog (given more than once, each `--click` is pressed in turn, as a
hand opens a page and then one of its tabs); `--dump boxes.txt` writes every box on the page with what is
drawn in it. It stops the Chrome it started, and gives up after
`--timeout` ms (90000). It replaced `chrome --screenshot`, which ran the
page about 94 pixels shorter than the picture it took and grew it only for
the picture: what a script had placed (a menu, a popover, a tooltip, the
sheet over the dock) was photographed about 94 pixels from where the page
puts it. Figures of anything floating are comparable from 14 November
2026, 19:00 on.

The connect screen is the same page with `&screen=connect`, against this
view started without `FANCY_GPUI_DEMO`. A page of the settings is the same
page with `&settings=<page>` (`voice`, `personalize`, ...: the web UI's
ids), against this view started with `FANCY_GPUI_OPEN=settings:<page>`.

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
and no work per frame. The two patterned layers some themes add (Nimbus's
dots, Midnight's scanlines) are drawn as quads where they are in view, and
a theme's shapes and marks as paths: the cuts of its controls, rows and
cards (`clipPlate`, `clipSelection`, `clipBubble`) and everything a drawn
skin (`chrome: "stencil"`, Nimbus) puts besides colour - tape, rings, the
room's name hollowed out, halos, plates, tracked italic capitals. They are
said in the theme (`src/theme/cut.rs`, `src/theme/marks.rs`) and drawn by
the kit (`src/ui/kit/shape.rs`, `marks.rs`, `plates.rs`); nothing of them
is kept between frames, and a theme that says none costs nothing. Left out:
backdrop blur, and the window's own notch (`clipWindow`), which cuts the
window to the desktop. The one blur drawn is behind a picture looked at
large, for as long as it is open.

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

GPUI itself is built from `vendor/gpui`: version 0.2.2 with a backdrop blur
added (`Styled::backdrop_blur`), which a renderer cannot be given from
outside. `vendor/gpui/FANCY_CHANGES.md` lists what was changed. Only the
DirectX renderer draws the blur so far; on Linux and macOS the element is
drawn without it. A release build on Windows compiles GPUI's shaders with
`fxc.exe` from the Windows SDK, as it did before.

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
| `FANCY_GPUI_THEME`, `FANCY_GPUI_MODE` | Start in this theme (`dark`, `rose`, ...) and mode (`light`, `dark`, `system`), without choosing it. |
| `FANCY_GPUI_IMPORT_FROM` | The data directory of another install to offer bringing servers and certificates over from. Without it the web client's own place is looked in, unless `FANCY_GPUI_DATA_DIR` is set: a run with a directory of its own is not shown the user's data. |
| `FANCY_GPUI_DEMO_POLL` | With the demo engine: put a poll to the lounge. |
| `FANCY_GPUI_DEMO_LIVERY` | `on`: with the demo engine, the server it is on says the made-up livery (the one `kumo.jp` has) is its own, so the rail, the band and the colours show one. |
| `FANCY_GPUI_DEMO_VOICE` | With the demo engine: have Rin and Alex say this many voice messages in the lounge, taking turns. |
| `FANCY_GPUI_DEMO_PICTURES`, `FANCY_GPUI_DEMO_FACES` | With the demo engine: have Rin show every picture in this folder (the files of a folder inside it together in one message), and give everybody a face and a banner made from the pictures in this one. |
| `FANCY_GPUI_DEMO_SHARE` | With the demo engine: the local user has shared these files (separated by `;`) in the lounge in one message by a link that lasts a week: a picture card, or an album for several pictures. The web preview's `?share=1` and `?album=<n>` share the same files from `preview/shares/`. |
| `FANCY_GPUI_DEMO_BIO`, `FANCY_GPUI_DEMO_BIO_FORMAT` | With the demo engine: give Rin a profile of the older format with every picture in this folder pasted into it whole, for measuring a heavy card; with `new`, the same profile converted. |
| `FANCY_GPUI_WALL`, `FANCY_GPUI_STAGE` | Put this picture behind the conversation for this run; have the files in this folder wait above the composer. |
| `FANCY_GPUI_HOLDS` | Every so many seconds, write into the log what the conversation holds: for looking into memory. |
| `FANCY_GPUI_OPEN` | Start with `picker`, `devices`, `certificates`, `permissions`, `bans`, `channel` (the form that makes one), `members`, `profile`, `settings` (or `settings:<page>`, on that page, or `settings:<page>@<px>`, that page scrolled that many pixels down: the web preview's `&settings=<page>&scroll=<px>` shows the same), `emoji` or `editor` open; with the demo engine's shares, `share:popout` (the feed shown large in its own window), `share:camera` (the camera beside a screen shown large), `share:actual` (pixel for pixel, moved off the middle) or `share:overlay` (one's own share of the pattern, with the overlay of drawings over it). |
| `FANCY_GPUI_CONNECT` | Connect at once as the saved identity with this id (`FANCY_GPUI_PASSWORD` for the server's password). |
| `FANCY_GPUI_SAY` | With `FANCY_GPUI_CONNECT`: say this once connected. |
| `FANCY_GPUI_LOG` | What is kept of what the engine says, in `logs` under the data directory: a filter as `RUST_LOG` takes one (`debug`, `mumble_protocol=trace`), or `off` for no file. Left alone it is `info`. |
| `FANCY_GPUI_SHARE_PATTERN` | Any value: the real engine offers the test pattern to share instead of this computer's screens, windows and cameras, and shares it through the real encoder and peer. Nothing of the desktop is captured and nothing is heard. For every run that is not the user's own. |
| `FANCY_GPUI_SHARE_PATTERN_AT` | `x,y,w,h` in the screen's own pixels: where the overlay of viewers' drawings lies over a share of the test pattern (which lies on no screen). Without it no overlay opens for the pattern. Put it over a window of your own. |
| `FANCY_GPUI_SILENT` | Any value: nothing is played through the speakers, neither the sounds that say something happened, voice messages, nor a watched share's sound (it is decoded and dropped). `FANCY_GPUI_SHARE_PATTERN` silences the same. The engine touches no audio device either: every capture (voice, the Voice page's meter and sample, a voice message) is a voice made up on the spot, and every playback goes nowhere at the pace it would be heard. |
| `FANCY_GPUI_DEMO_SHARES`, `FANCY_GPUI_DEMO_DRAW` | With the demo engine: have this many in the lounge share their screens (the test pattern), `elsewhere` for the user's own account sharing from another device, or `camera` for Rin sharing a screen and a camera beside it; and have Rin draw on it. |
| `FANCY_GPUI_DEMO_SHARE_CODEC` | With the demo engine: its shares go through the real H.264 encoder and decoder, for measuring what watching and sharing cost without a server. |
| `FANCY_GPUI_VOICE_MESSAGES` | `silent`: voice messages make no sound and hear no microphone. A recording is a tone made up on the spot, written as a real one is; playing one decodes it to no device, at the pace it would be heard. For every run that is looked at or captured. |
| `FANCY_GPUI_FRAME` | `client` draws the window's own controls even where the compositor frames it. |
| `FANCY_GPUI_ENGINE` | `demo` runs on the engine that exists only in memory. With it, `FANCY_GPUI_DEMO=connected` starts on the demo server, `FANCY_GPUI_DEMO=plain` on the same server with nothing of Fancy Mumble's on it, `FANCY_GPUI_DEMO_TALKING=<session>` has that user talking, and `FANCY_GPUI_DEMO_SAY=<html>` has Rin say that in the lounge, for looking at how a message is drawn. |

## Icons

The icons in `assets/icons` are from [Lucide](https://lucide.dev), under the
ISC licence (`assets/icons/LICENSE`).
