# What it holds

Measured on Windows 11 (Ryzen 9 9900X, GeForce RTX 3090, release build), on
2026-11-14. Commit is the process's private bytes. The client trims its
working set in the background (`src/trim.rs`), so the working set shown a
few seconds after start says little; the peak working set and the peak
commit say what start-up took. GPU memory is the system's count for the
process (`\GPU Process Memory(pid_*)`). The budget is 300 MB at the peak and
150 MB on average.

`tools\memory.ps1 -Exe <release exe> [-Pictures <folder>]` measures the
first screens against the bounds written in it and exits 1 when one is over.

## The first screens

Demo engine (`FANCY_GPUI_ENGINE=demo`, `FANCY_GPUI_DEMO=connected`), its
lounge with a handful of messages, the window at its default size
(1410 x 758), three runs each, at 5, 30 and 120 seconds:

| Screen | Commit | Peak commit | Peak working set | GPU dedicated | GPU shared |
| --- | --- | --- | --- | --- | --- |
| Connect screen, default theme | 71-72 | 72-73 | 63-65 | 28-29 | 1-2 |
| Connect screen, Nimbus | 74-75 | 74-75 | 65-66 | 30 | 1 |
| Server, default theme | 78 | 79 | 69-71 | 30 | 2 |
| Server, Nimbus | 107-108 | 109-110 | 81 | 49 | 5 |

At 2560 x 1392 (a maximised window), scrolled (commit / GPU dedicated, MB):
connect 73 / 57, server 79 / 58, connect in Nimbus 75 / 58, server in
Nimbus 168 / 126. Before the path textures followed the paths (the 15th,
00:00) every one of these paid for a window-sized path texture as well:
connect 92 / 29 at the default size and 143 / 57 maximised, the server
screen 96-99 and 146 / 126, with peaks of commit 130-170 at start.

What the megabytes buy:

- About 72 MB of commit is the client before it shows a message: the
  engine, GPUI and its text system, the WebRTC stack and codecs linked in,
  90 threads (each with its stack). The same in every build of the day.
- Nimbus adds about 8 MB of commit: its lattice, rings and lettering are
  paths, and their vertices go to the GPU every frame (20 bytes each, about
  25,000 of them for the lattice).
- The textures paths are drawn into (four samples a pixel, plus the one
  they are resolved into) are now as large as the paths drawn and held only
  while paths are drawn (`vendor/gpui/FANCY_CHANGES.md`). On Nimbus's
  server screen the dot lattice covers the whole conversation, so they are
  still nearly the window: about 20 MB of GPU memory and 30 MB of commit at
  the default size, about 70 MB of each maximised. Taking that off changes
  what is seen (two samples a pixel, or the lattice drawn as rounded quads
  rather than a path); neither is done, and that is the user's choice.

## What went wrong on the 14th, and was put right

During the day Nimbus went from 96 MB of commit to 165-229 MB on the same
screen (the user's own window: 229 MB, peak working set 272 MB), and to
360-493 MB maximised. The default theme never moved. Builds of the day,
server screen, commit at 6 s:

| Build | Default | Nimbus | Nimbus GPU shared |
| --- | --- | --- | --- |
| 13:39, 14:36 | 96 | 95-96 | 2 |
| 16:33 to 18:05 | 96-97 | 118-126 | 17-19 |
| 20:56 | 100 | 228 | 126 |
| 21:23 | 98 | 164 | 64 |
| 21:41 | 98 | 165-189 | 65 |
| with the fix | 95-99 | 104-107 | 5-6 |

The cause was in GPUI's DirectX renderer: paths are drawn in a batch for
each run of draw order, and each batch overwrote the one path buffer with
`WRITE_DISCARD`. The driver keeps a fresh copy of the buffer for every
discard while the GPU may still read the old, so several batches a frame
(Nimbus's lattice, rings and hollow lettering) kept tens of copies of a
buffer of megabytes in shared memory, which is counted in commit. Each
vertex also carried its path's colour and bounds, 104 bytes in all. Now
batches are appended (`WRITE_NO_OVERWRITE`, discarded only when full) and
a vertex is 20 bytes; see `vendor/gpui/FANCY_CHANGES.md`. What is drawn is
the same to the pixel (`tools/compare.py`, old and new renderer on the same
tree, still and scrolling, both themes, the connect screen).

## Pictures sent and staged

Thirteen large pictures (21 KB to 23 MB, the largest a 5130 x 6400 PNG,
131 MB decoded), in a test process of its own
(`tests_picture_memory::pictures_made_ready_to_send`), peak commit:

| Step | Before | After |
| --- | --- | --- |
| Staged one after another | 174 | 159 |
| Made ready to send one after another | 159 | 158 |
| Staged four times at once | 654 | 197 |
| Staged while others are made ready to send | 315 | 166 |

Before, every way in decoded a picture whole on a thread of its own, and
staging decoded each twice; pictures staged while others went up were
decoded side by side. Now one picture is decoded whole at a time
(`picture::with_opened`), staging decodes each once (`picture::staged`),
and the whole picture is let go of before its copies are encoded. What is
left is one picture decoded whole: a PNG cannot be read at a smaller size,
so a picture of 33 megapixels takes 131 MB while it is made ready, on top
of what the client holds. In the client, the thirteen staged as the window
opens (`tools\memory.ps1 -Pictures`) peak at 316 MB of commit: the start-up
burst and that one decode together; on a settled client (about 110 MB) the
same picture would peak near 265.

Reading a PNG row by row into its small copies, and a JPEG at an eighth of
its size, would take the decode itself off that peak; that is not done.
