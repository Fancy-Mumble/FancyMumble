# fancy-gpui

The native view of Fancy Mumble, drawn with [GPUI](https://gpui.rs). It is
meant to be the cheapest way to keep the client open: no web view, no script
runtime, and nothing drawn while nothing changes.

It looks like the web UI's default design (Nebula) and paints with the same
thirteen themes, each in a light and a dark mode.

## State

A start. The shell is drawn and themed, and it runs against an engine that
exists only in memory.

- Drawn: the band, the server rail, the channel column (search, channel tree,
  who is in the current channel, the user tile with mute and deafen), the
  conversation (header, day rule, message runs, own messages) and the
  composer.
- Works against the demo engine: joining a channel, sending a message,
  muting and deafening, narrowing the channel list, switching theme and mode.
- Not yet: the real engine, avatars and other pictures, rich message content,
  text selection and composed input (IME) in the fields, window resize
  handles, settings, and everything else the web UI has.

## The engine

The view never names a concrete engine. `src/engine.rs` is the whole of what
it asks for: a snapshot of the server, the messages of a channel, a handful
of commands, and a stream of events that say what to read again. The events
are named after the engine's own `CoreEvent`s, so putting the real engine
behind the trait is a mapping.

That adapter cannot be written yet: the engine still lives inside the
`mumble-tauri` crate. Once it is a crate of its own, this package depends on
it and `src/demo.rs` becomes a development aid.

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
| `FANCY_GPUI_THEME` | Start in this theme (`dark`, `rose`, `nimbus`, ...). |
| `FANCY_GPUI_MODE` | `light` or `dark`. |
| `FANCY_GPUI_PICKER` | Start with the theme picker open. |
| `FANCY_GPUI_DEMO_TALKING` | A demo session id that is talking. |
| `FANCY_GPUI_FRAME` | `client` draws the window's own controls even where the compositor frames it. |

`Ctrl+Shift+T` moves to the next theme, `Ctrl+Shift+L` flips light and dark.

## Icons

The icons in `assets/icons` are from [Lucide](https://lucide.dev), under the
ISC licence (`assets/icons/LICENSE`).
