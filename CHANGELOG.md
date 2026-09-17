# Changelog

What changed between releases of Fancy Mumble, written for the people who use
it. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Releases before 0.4.0 are described on the
[Releases page](https://github.com/Fancy-Mumble/FancyMumble/releases).

The release job publishes the section of the version it is tagging as the
release notes, so write the section before merging to `main` - see
[docs/RELEASING.md](docs/RELEASING.md).

## [0.4.0] - Unreleased

Three months and some three hundred commits after 0.3.0. The short version: a
new default interface, screen sharing rebuilt natively, a voice path with less
delay in it, and a protocol that now speaks to Starling, the Fancy Mumble server
written in Rust.

### Added

**Nebula, a new default interface**

- Nebula replaces Standard as the interface new profiles open in. It has
  thirteen skins, a server rail you can reorder, pin open or move into title-bar
  tabs, global search, a member panel, a media gallery, and its own settings and
  administration pages.
- A one-handed layout for phones and narrow windows, drawing into the display
  cutout on Android.
- It stays quick in a long conversation: a reaction, a roster refresh, a menu
  opening or somebody starting to talk redraws the row it concerns and nothing
  else, and a skin without glass pays for no blur.
- Standard stays available and gained a Nimbus theme, a picture context menu and
  lightbox, dragging a user into another channel, and a bundled Saira font
  instead of a fetched one.
- A first-run setup and a redesigned onboarding, including the questionnaire a
  server can put in front of new members.

**Screen and camera sharing**

- Screen sharing rebuilt as a native Rust pipeline on Windows and Linux, with
  hardware encoding through Media Foundation, NVENC and VA-API.
- Share a screen and a camera at the same time, and share the desktop's audio
  with the picture.
- Draw on the picture you are sharing; viewers' drawings stay pinned to what is
  actually being streamed.
- The bitrate adapts to the uplink, and a statistics panel reports loss, jitter
  and round trip.
- Watching a stream works on Android.

**Chat**

- Scheduled messages: write now, deliver later, and list or cancel what is
  pending.
- Photographs sent together are batched into a gallery; pictures can be marked
  as spoilers, and copied, saved or resized from the message menu.
- Link preview cards, filed under the link they belong to, and a private-window
  option for opening a link.
- Mentions that reach a whole role.
- A message that failed to send says so.
- Markdown lists render as lists.
- A channel opens on its newest messages and pages back through its history as
  you scroll, in both directions, and the client puts away message bodies nobody
  is looking at, which keeps memory flat in busy channels.
- GIF search, emotes and file sharing provided by the server itself, with no
  plugin needed.

**Voice**

- Whisper targets.
- Noticeably less receive-side latency: inbound voice is decoded on a thread of
  its own, the jitter buffer had three defects fixed, and the playback ring is
  smaller on PipeWire.
- Any input sample rate is resampled rather than refused, WASAPI exclusive
  capture, and a clear message when another program holds the microphone.
- The denoiser rests while the gate is closed.
- "Hear yourself" plays back more than its last 400 ms.
- XChaCha20-Poly1305 voice encryption when the server is a Fancy server at 0.4.0
  or later.

**Working together**

- A calendar with a month and a week view, server-provisioned end-to-end
  encrypted meeting rooms, invite links and reminders.
- Friends: a friends list with presence, and direct messages in detached
  end-to-end encrypted rooms.
- Hidden and expiring private channels.
- A notepad.

**Accounts and security**

- An account page with optional TOTP two-factor login.
- Persistent chat enforces the countersignature and the consensus threshold
  when it accepts a key, and keeps the old identity files if a migration fails.
- The TLS library is past a TLS 1.3 handshake advisory (RUSTSEC-2026-0285), in
  the full client and in the minimal one.

**Server administration**

- A searchable audit log with a dashboard.
- A welcome screen built from blocks, with pictures, a node editor and undo.
- Server branding ("livery"): a server can dress the client in its own colours
  and mark, edited over the connection.
- A "users with access" view and channel filters for ACLs, a wizard for creating
  roles, unregistering users, and deleting a channel from the panel.
- Server settings are read from the schema the server publishes.
- A round-trip chart and a list of what the server supports in the server info.

**Around the game**

- Game detection on Windows and Linux (Steam, Epic, Heroic and others), shown as
  rich presence.
- An overlay card drawn over the game.

**Platforms and packaging**

- A minimal native Qt 6 client for machines where a webview is too heavy. It
  shares its configuration and saved servers with the full client.
- An opt-in beta update channel: Settings -> Advanced -> Beta updates.
- Packaging recipes for the AUR and for Flathub, and a build without the
  self-updater for distributions that update the package themselves.

### Changed

- The protocol extension moved to the epoch-1 wire canon, the one Starling
  speaks. The extension's fields live at 100 and above and the client announces
  its wire epoch when it connects. Voice and plain text chat against a stock
  Mumble server are unaffected.
- Persistent chat can be managed by the server as well as end to end.
- The workspace is on Rust 2024.
- Settings and administration load as their own chunks, so the first window
  appears sooner.
- The Aurora interface is deprecated. It still ships in this release and will be
  removed in a later one; Nebula replaces it.

### Fixed

- A disconnect left a ghost session on the server.
- An "is typing" mark lasts from the last keystroke, not from the first.
- A join that never left the client was reported as a success.
- "Reset app data" now clears the identities it promises to.
- Preferences are read from the directory they are written to.
- A desktop notification could abort the app on Linux.
- The microphone is captured at its native sample rate.
- Screen sharing survives a device handoff, a bare X server and a still screen,
  and skips a frame it cannot scale instead of sending black.
- A remote poll vote shows up when it arrives rather than on the next redraw.
- Blocking administration commands no longer stall audio.

[0.4.0]: https://github.com/Fancy-Mumble/FancyMumble/compare/v0.3.0...v0.4.0
