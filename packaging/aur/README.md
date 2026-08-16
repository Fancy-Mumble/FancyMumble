# AUR packaging

Three packages:

| Directory                     | Package                      | What it does                                          |
| ----------------------------- | ---------------------------- | ----------------------------------------------------- |
| `fancy-mumble/`               | `fancy-mumble`               | Builds from the tagged source (MIT)                    |
| `fancy-mumble-signal-bridge/` | `fancy-mumble-signal-bridge` | The AGPL Signal bridge, optional (AGPL-3.0-only)       |
| `fancy-mumble-bin/`           | `fancy-mumble-bin`           | Repackages the published `.deb` (MIT)                  |

`fancy-mumble` and `fancy-mumble-bin` conflict; the bridge installs alongside
either. The names match the package name upstream's own `.deb` already uses
(`fancy-mumble`), and the binary stays `/usr/bin/mumble-tauri` for the same
reason — that is what the shipped `.desktop` entry's `StartupWMClass` matches.

## Why the bridge is its own package

`crates/signal-bridge` links `libsignal-protocol`, which is AGPL-3.0, and the
client `dlopen`s it at runtime rather than linking it — a boundary the crate's
own header comment says is deliberate. Splitting it keeps `fancy-mumble` MIT and
lets a user decline the AGPL half.

Nothing has to be configured to connect the two. `load_signal_bridge()` in
`mumble-protocol` walks a candidate list relative to the executable, and
`../lib/fancy-mumble/` is already on it, so installing the bridge package puts
`libsignal_bridge.so` exactly where `/usr/bin/mumble-tauri` looks. Without it,
private chat is unavailable — which is what upstream's own `.deb` and AppImage
ship today, since neither contains the library.

## Two things the source package works around

Both are `build.rs` behaviours that would otherwise reach the network from
inside `build()`, which a clean chroot forbids:

- **`SKIP_SIGNAL_BRIDGE=1`** — `mumble-tauri`'s `build.rs` otherwise shells out
  to a second `cargo build` for the workspace-excluded `signal-bridge` crate,
  which has its own lockfile and a git dependency on `signalapp/libsignal`.
  That crate is packaged separately instead.
- **`SKIP_QT6UI=1`** — the `qt6ui` crate needs the `x86_64-pc-windows-gnu`
  toolchain and a MinGW Qt 6 kit. It already skips with a warning when the kit
  is absent; setting the variable makes that explicit rather than incidental.

`--features custom-protocol` is the third thing worth knowing: it makes the
binary serve the embedded `ui/dist` instead of loading `devUrl`
(`localhost:1420`). The Tauri CLI sets it for `cargo tauri build`; a plain
`cargo build` has to ask. Building this way rather than through
`cargo tauri build` also avoids producing a `.deb`/AppImage nobody wants here.

## npm

`prepare()` runs `npm ci`. This is the one step that needs the network beyond
makepkg's own source fetching: the tree ships `package-lock.json` but not the
packages it pins, and there is no npm equivalent of `cargo vendor` that makepkg
understands. Running it in `prepare()` rather than `build()` is the convention
the AUR's other Tauri and Electron packages follow.

## Before the first submission

- Check none of the three names is taken: <https://aur.archlinux.org/packages>
  (the RPC endpoint is behind a bot check, so use the web search).
- Re-run `updpkgsums` and `makepkg --printsrcinfo > .SRCINFO` in each directory
  on every version bump. `fancy-mumble-bin` has three sums: the `.deb`, the
  licence fetched from the tag, and the local `.desktop` file.
- `crates/signal-bridge` carries no licence text of its own — only the AGPL
  declaration in its `Cargo.toml` header. AGPL-3.0 is in Arch's common licences
  so the package needs nothing installed, but adding a `LICENSE` to that
  directory upstream would be worth doing.
- The updater plugin is compiled in and unconditional, and its configured
  endpoint still names `FancyMumbleNext` (GitHub redirects it to `FancyMumble`,
  so it works, but the redirect is one rename away from breaking). A distro
  package should not update itself; a cargo feature to gate
  `tauri-plugin-updater` would let the PKGBUILD turn it off.

## Submitting

```sh
git clone ssh://aur@aur.archlinux.org/fancy-mumble.git aur-fancy-mumble
cp packaging/aur/fancy-mumble/{PKGBUILD,.SRCINFO,fancy-mumble.desktop} aur-fancy-mumble/
cd aur-fancy-mumble && git add -A && git commit -m 'fancy-mumble 0.3.0-1' && git push
```
