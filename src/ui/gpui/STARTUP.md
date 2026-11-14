# How long it takes to start

Measured on Windows 11 (Ryzen 9 9900X, GeForce RTX 3090, release build), on
2026-11-14. Times are milliseconds from the moment the system created the
process.

## Method

The scripts are kept outside the repository, in the session's scratch folder
(`agent-startup`): `Probe.cs` does the timing, `start.ps1` starts the client
a number of times, `campaign.ps1` runs the whole measurement for one binary,
`connected.ps1` and `summarize.py` read the results. Nothing touches the
pointer or the keyboard.

- **Window**: the first top-level window of class `Zed::Window` owned by the
  process (polled every millisecond).
- **First frame**: the first picture of the window (`PrintWindow`, flag 3)
  that is not all one colour. Polled every 2 ms or so.
- **Responds**: once that frame is there, a click is posted on "+ Add"
  (`WM_LBUTTONDOWN`, 30 ms, `WM_LBUTTONUP`), and the time is taken when the
  "Add a server" dialog shows in the picture. The 30 ms between press and
  release are part of it.
- **Connected**: with `FANCY_GPUI_CONNECT=1` and one saved server, the first
  picture whose channel list matches the one the window settles on. The
  server is Starling v0.2.20 (`ghcr.io/fancy-mumble/starling:latest`) in
  Docker on the same machine.

Three sets, each with the real engine on a data directory of its own:
**empty** (a new empty directory every run: a first launch), **saved** (one
saved server, pinged at start, not connected) and **connect**. Each set is a
start after 45 s of rest (**cold**) and five starts 1.5 s apart (**warm**).
Two rounds, the old and the new binary taking turns, so each figure is two
cold starts and ten warm ones. The table gives the median and, in brackets,
the lowest and the highest.

"Cold" is only that: the executable and the graphics driver are in the
system's file cache either way. Once, after the screen had been locked, the
GPU device alone took 820 ms; a first start after booting is likely nearer
that than these figures.

The client also writes its own account into the log once the first frame is
drawn (`src/startup.rs`), for example:

    started in 170.1 ms: platform 105.4, engine 1.2, fonts 1.2, theme 1.8,
    window 41.9, waiting for the first frame 11.6, drawing it 7.1,

counted from the start of `main`, which the system reaches 5 to 15 ms after
creating the process.

## Before and after

| | Before, warm | After, warm | Before, cold | After, cold |
| --- | --- | --- | --- | --- |
| Empty: window | 280 (264-293) | 139 (137-155) | 297 (295-298) | 146 |
| Empty: first frame | 336 (315-348) | 193 (183-201) | 363 (355-372) | 204 |
| Empty: responds | 404 (373-621) | 266 (246-294) | 432 (426-438) | 266 |
| Saved: window | 279 (264-341) | 141 (137-230) | 314 (302-326) | 159 (158-160) |
| Saved: first frame | 325 (315-397) | 198 (171-309) | 370 (350-389) | 226 (218-233) |
| Saved: responds | 390 (367-462) | 261 (233-376) | 433 (409-456) | 293 (286-300) |
| Connect: connected, channels drawn | 344 (320-421) | 211 (189-240) | 399 (362-436) | 230 (221-239) |

Left out: four runs in which the probe followed a window that is never
shown (the input method's), and in the empty set after the change three runs
taken while the machine was busy with something else (every step slower,
2.3 s, 560 ms and 424 ms to the first frame).

Against Starling the connection is made while the window is still being
created: the first frame already shows the channel list, in every run, before
and after. The server answers within 5 ms of the TCP connect. (The C++
`mumble-server` image held every client for about fifteen seconds after a
connect; no figures were taken on it.)

From the first frame, a click is answered in 50 to 60 ms, 30 of which are the
probe's own pause between press and release. It was so before as well.

Memory is unchanged: the peak working set was 61 to 71 MB after, 63 to 70 MB
before.

## Where the time went

Before, in the client's own account (warm, median): 313 ms from `main` to the
first frame drawn, of which

| Step | ms | What it is |
| --- | --- | --- |
| platform | 250 | GPUI's Windows platform: the GPU device (see below) and the system fonts |
| window | 35 | Creating the window (7-10), placing and showing it (8-13), the renderer (4), the shell (under 1), the first layout and paint (7-14) |
| waiting for the first frame | 16 | The rest of the start-up closure, then the first vertical blank |
| drawing it | 7 | Presenting it |
| engine, fonts, theme | 5 | The engine's runtime and files, the bundled Inter, the theme table |

Inside the platform: the DXGI factory 12-16 ms; a Direct3D device made to
check the adapter, 110-135 ms (it loads the graphics driver); a second device
made right after for use, 60-95 ms; the system font collection, 45-55 ms.
The shaders are compiled at build time and cost nothing measurable.

## What was changed

Both in the vendored GPUI (`vendor/gpui/FANCY_CHANGES.md`):

1. **One GPU device, not two.** The device made to check that the adapter
   does Direct3D 11 is kept. Saves 60-95 ms.
2. **The system fonts are read on another thread** while the device is made,
   which takes longer, so they no longer cost anything. Saves 45-55 ms.

Together the platform went from 250 to about 115 ms, and the first frame from 336
to 193 ms (warm). Nothing the user sees has changed.

`src/startup.rs` is new: the line above in the log.

## Found and not changed

- **The GPU device, 100-130 ms, is now most of the start.** It is the driver
  loading. It could be made on a thread from the first instant and waited
  for only when the window is created, overlapping the drop helper, the app,
  the engine and the theme: some 15-25 ms, for a larger change to GPUI (the
  text system and the platform window both take the device when they are
  made).
- **The window is shown before it has a frame**, blank, for 30-45 ms. GPUI
  shows it in `Window::new`; showing it once the first frame is presented
  would take the flash away without saving time.
- **The first frame waits for the vertical blank** (8-16 ms after the
  start-up closure ends): GPUI presents on its vsync thread, which starts
  after the closure. Presenting the first frame at once would save up to one
  refresh, for a change to GPUI's frame loop.
- **`PrintWindow` sees the frame 20-40 ms after it is presented**: that is
  the compositor, not the client.
- **`view.json` is read and parsed five times at start** (`start_engine`,
  `install_theme`, the window's placement, `Shell::new`, `Chrome`) and the
  store is opened twice. Each read is well under a millisecond: not worth the
  change.
- **Every start logs `Inter Display not found, use Segoe UI instead`**,
  although the bundled `Inter-DisplayBold.ttf` names its family
  `Inter Display`. Not a matter of time, but a heading may be drawn in Segoe
  UI where Inter Display is meant.
- **One start took 1.8 s in the theme step** (the whole machine was slow at
  that moment, every step was). The theme step reads the system's font names
  (`all_font_names`); that is the one call there that waits on a system
  service.

There are no start-up figures for the web client written down
(`scripts/perf/README.md` measures memory and CPU at rest, not starting); it
was measured later, below.

## Against the web client (2026-11-14, evening)

Five warm starts each, one saved server, not connected, the same probe
(`both.ps1`). The native client at the time of this measurement (the tree
had grown since the figures above); the web client is a test copy of the
release build under its own identifier and folders.

| | Window exists | Shown | First frame | Server list drawn |
| --- | --- | --- | --- | --- |
| Native | 154-190 | 169-199 | 223-273 | same frame |
| Web | 31-121 | 964-1427 (once 6616) | 1087-1522 (once 6673) | 1230-1648 (once 6870) |

The web client makes its window at once and keeps it hidden until its
update check returns: 300 ms of waiting by design, then a request to
GitHub, at most 6 s (it ran out once in six). Its first frame after that is
an empty shell, and the server list follows 140-230 ms later. Without the
update check its window would show some 0.9 to 1.3 s sooner, which the
probe cannot see (a hidden window gives no picture).

## At rest

What the client costs while nothing happens, per thread, over 30 s
(`idle.ps1`: CPU time per thread, context switches from the system's
thread counters, each thread's name and the module it started in).

| State | Before | After |
| --- | --- | --- |
| Demo engine, connect screen | 1.78 % of a core, 1,525 wakes/s | 0.10 %, 75/s |
| Demo engine, on its server | 1.53 %, 1,538/s | 0.15 %, 74/s |
| Real engine, connect screen | 2.17 %, 1,465/s | 0.05 %, 66/s |
| Real engine, connected (Starling, native) | 1.76 %, 1,575/s | 0.05 %, 82/s |
| Same, minimised | 4.95 %, 1,494/s | 0.25 %, 85/s |

The cause was GPUI's Windows frame loop: its vsync thread woke every
window on every refresh (200 Hz here), whether or not anything had changed.
Before, `main` had 35,000 context switches in 30 s and `VSyncProvider`
10,000-12,000; the engine's threads together had about 50. Now a window
asks for frames only while it has something to draw (`vendor/gpui`,
"No frames while nothing changes"). What remains is one NVIDIA driver
thread waking on its own timer (about 65 times a second, no measurable CPU),
and the main thread a few times a second.

There are 89 to 94 threads. 79 are the NVIDIA driver's own, started with
the Direct3D device; the rest are the main thread, the vsync thread, seven
or eight Windows thread-pool workers (GPUI's background executor), the
engine's two runtime workers, and once connected a voice decoder and a
socket thread. Creating the device with
`D3D11_CREATE_DEVICE_PREVENT_INTERNAL_THREADING_OPTIMIZATIONS` leaves the
driver 28 threads (38 in all) and the peak working set about 6 MB lower,
with the same start and the same response to a click over five starts each.
It is not done: Microsoft documents the flag as not for general use.

## A Windows program

The release build was a console program: every start from Explorer, a
shortcut or the tray made a console host (and a console window). Starting a
trivial console program with a console of its own takes about 30 ms more
than with an inherited one (40 against 10 ms here), so that much was on top
of every such start. Now a release build is a Windows program (`main.rs`),
it attaches to the terminal it was started from (`src/console.rs`), and a
panic is also written into the log (`src/panics.rs`). Debug builds and tests
are console programs as before; a run with its output redirected writes
there as before.

## The evening's slower start, looked into

The first frame was at 223-273 ms in the evening against 183-201 ms in the
morning. Run side by side, three rounds of four starts each, taking turns,
the morning's binary and the evening's start alike (first frame, median:
373 against 347 ms; every step of the client's own account within a few
milliseconds of the other's): the machine was busy (70-85 % of all cores),
not the client slower. The client's own steps (engine, fonts, theme) are
still 5 ms together, and the window and the first paint cost the same.

One thing had grown: the executable imported Media Foundation (`mf.dll`,
`mfplat.dll`, `mfreadwrite.dll`, for the camera and screen sharing), which
the system loaded before `main` on every start, with `mfcore.dll` and
`rtworkq.dll` behind them. `build.rs` now has them loaded at their first
call: five libraries fewer at the first frame (83 to 78). Warm, the gain is
inside the noise of a busy machine (process creation to `main`, median of
twelve: 20.3 against 20.2 ms); it is reading them from a cold disk that it
spares. And `tests/imports.rs` fails when the executable imports a library that is not
on its list, so a new one is added on purpose or not at all.
