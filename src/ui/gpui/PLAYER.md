# What a video costs

The in-place `YouTube` player (`src/player`, `src/ui/playing.rs`): what it
holds when it is not playing, and what it costs while it plays. Measured on
Windows 11 (Ryzen 9 9900X, GeForce RTX 3090, a 200 Hz display), release
build, 2026-11-14/15. The video is the same one throughout
(`aqz-KE-bpKQ`, which `YouTube` serves at 854x480, 30 fps, at card size),
muted (`FANCY_GPUI_PLAYER_MUTED=1`).

## Method

The scripts are in the session's scratch folder (`agent-embeds`), outside
the repository:

- `life.ps1`, `minimise.ps1`: the client on the demo engine
  (`FANCY_GPUI_DEMO_NAME=player-test`) through play, pause, play on,
  scrolled out of sight and minimised. After each step `count` reads our
  WebView2 processes (by the profile folder on their command line), the
  client's commit, working set and threads, and its CPU over 5 s;
  `modules` lists what of a web view the client has loaded.
  `FANCY_GPUI_PLAYER_TIMES=1` makes the player say how long it took to be
  made and to report "playing".
- `suspects2.ps1`, `suspend.ps1`: a bare wry web view (`exp-wry`, a child
  of a plain window, at card size, the client's browser arguments), one
  change at a time, sampled by `sample.ps1`: CPU of each process over 30 s,
  private working set, commit, and the graphics card's engines per process.
- `playing.ps1`: the client playing, three 30 s samples.

CPU is percent of one core; the machine has 24 logical processors, so 10 %
of one core is 0.4 % in Task Manager's terms. The machine was never quiet:
other agents built and ran beside these measurements, and `dwm` used 35 to
60 % of a core in every sample, so a single sample varies by a few points.

## Not playing: nothing

Only a video that is playing has a player. Paused or over, the web view and
every process of it go after a grace of 1.5 s (a pause and play again inside
it keeps the player); the card shows its still with the play mark, and where
the video stood and how fast it ran are kept. A press makes a new player
that starts there (`start=` and a seek to the exact moment, the speed set
again). Scrolled out of sight, or with the window minimised (a WinEvent hook
on the player's thread: the system tells, nothing polls), a playing video is
paused first, so that moment is known, and then let go of the same way.
Under a menu or a dialog it is hidden and plays on, for its sound.

| Moment | WebView2 processes | Client commit | Client CPU (5 s) |
| --- | --- | --- | --- |
| Started, nothing played | 0 (no web view module loaded) | 98 MB | 0.3 % |
| Playing | 5 | 102 MB | 0 % |
| Paused, 5 s later | 0 | 102 MB | 0 % |
| Paused, 30 s later | 0 | 102 MB | 0 % |
| Scrolled out, 5 s later | 0 | 103 MB | 0.3 % |
| Minimised, 5 s and 30 s later | 0 | 103 / 102 MB | 0 / 0.9 % |

The 4 MB the client keeps after the first play is the WebView2 loader
(`EmbeddedBrowserWebView.dll`), which stays loaded.

Playing on in a new player: made in 280 to 380 ms, "playing" 873 to 943 ms
after the press (the first player of a run: 396 and 900 ms). The still
stays on the card until the video draws over it, so there is no blank
step, but it is about 0.9 s.

The alternative measured: keep the player and suspend it
(`ICoreWebView2_3::TrySuspend` after pausing and hiding). Suspended, it
uses 0.1 % of a core (the browser process) and 15 MB of working set, but
keeps its 5 processes and 316 MB of commit; resumed, it reports "playing"
300 ms after it is asked. That is not "nothing", so the player is let go
of instead. A press could hide most of the 0.9 s by making the player when
the pointer comes onto the still (it usually rests there a few hundred
milliseconds before the press); not done.

## Playing: what the CPU is spent on

Bare web view at card size, 30 s each:

| Change | Total | GPU process | Renderer | Media Foundation service | Private WS | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| The client's arguments (three runs) | 17.9 / 22.7 / 24.3 | 11.4-15.7 | 5.9-8.2 | - | 223-242 MB | 347-405 MB |
| `--limit-fps=30` | 19.8 | 10.3 | 8.7 | - | 230 MB | 361 MB |
| `MediaFoundationClearPlayback` (three runs) | 9.0 / 12.2 / 8.5 | 0.2-0.4 | 1.9-4.6 | about 5.5 | 257-278 MB | 466-505 MB |
| ... with `--limit-fps=30` | 14.3 / 10.6 | 0.2-0.3 | 3.8-4.2 | | 258-263 MB | 464-469 MB |
| ... with `controls=0` | 12.3 / 12.9 | 0-0.1 | 3.7-4.1 | | 258-270 MB | 460-476 MB |
| ... with both and a page that never listens | 12.6 / 9.0 | 0.1-0.2 | 4.0-4.8 | | 257-259 MB | 446-455 MB |
| `playsinline=1&rel=0&iv_load_policy=3` | 25.1 | 14.4 | 10.1 | - | 221 MB | 341 MB |
| `controls=0` alone | 17.7 | 12.0 | 5.1 | - | 232 MB | 363 MB |
| A page that never listens alone | 19.7 | 11.8 | 7.2 | - | 236 MB | 382 MB |

- **The graphics process was the cost.** Decoding was already on the
  card's video engine (1 to 1.3 %), but Chromium's own pipeline copied and
  composited every frame. With `MediaFoundationClearPlayback` the system's
  Media Foundation pipeline plays clear (unprotected) video and presents it
  on a composition surface: the GPU process falls to under 0.5 %, a
  `MediaFoundationServiceBroker` process does the work at about 5.5 % with
  the video engine, and the total halves. It costs about 40 MB of working
  set and 100 MB of commit more, for that process, while playing only.
  Kept (`src/player/settings.rs`).
- **The display's 200 Hz.** `--limit-fps=30` (a `ui/compositor` switch)
  took the GPU process from about 15 to 10 % on the Chromium path in one
  sample, and does nothing measurable once Media Foundation presents the
  video. Not kept.
- **`YouTube`'s page (the renderer, 2 to 5 %).** `controls=0` saves about
  3 points on Chromium's path and nothing measurable on Media Foundation's,
  and would oblige the client to draw play, seek, volume and captions of
  its own through the `IFrame` API. The terms do not forbid that parameter,
  but III.I.6 forbids to "modify, build upon, or block any portion or
  functionality of a YouTube player". For no measurable gain it was left
  alone. A framing page that never asks the player to report
  ("listening") saves nothing measurable either, and the page needs it.
- **What is left** while playing at card size: about 9 to 12 % of one core
  (0.4 to 0.5 % of the machine): Media Foundation's service about 5.5 %,
  `YouTube`'s page 2 to 5 %, the browser process about 0.5 %, the client
  under 0.3 %. That is not "under 3 %". Going lower would need a page that
  does not run `YouTube`'s player script while it plays, which the terms
  do not allow, or a presenter that is not a browser at all.

Not measured, and owed: whether the video is promoted to a hardware overlay
(the DirectComposition layer tree while playing, controls shown and
hidden); the Media Foundation path presents on its own surface, which is
the shape a composition-hosted web view (the port's `player/composed.rs`)
would give the system compositor directly; and a 60 Hz comparison (the
display's settings were not changed).

## Where it lives

- The life cycle: `src/ui/playing.rs` (`GRACE`, `let_player_go`,
  `play_on`, `video_unseen`), through `src/player/mod.rs` (`Screen::pause`,
  `Stage::settle` saying whether the card was out of sight). Nothing of it
  is in the wry-specific file.
- The browser's arguments, each with why: `src/player/settings.rs`. The
  player's parameters, each with why: `PARAMETERS` in
  `src/player/page.rs`.
- The minimise hook: `src/player/win32.rs` (`Minimising`), started by the
  player's thread in `src/player/web_view.rs`. A composition-hosted player
  needs the same signal from wherever it lives.
