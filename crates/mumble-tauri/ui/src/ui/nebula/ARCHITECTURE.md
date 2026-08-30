# Nebula

Nebula is the third UI pack: a single-window client built on **MUI 9**, styled
to the "Fancy Mumble 2026" design mock.

## What is Nebula's, and what isn't

Nebula owns the client shell - the window chrome, the 290px left column, the
conversation, and the surfaces that float over them - and every settings and
administration page, drawn in its own language rather than handed off.

Settings and administration are **one screen with one nav**, not two surfaces:
the sidebar lists the settings pages and, for a user with Write on the root
channel, an administration section under them. Standard splits these into a
settings page and an admin page reached from different places; here the
question "where do I change this?" has one answer.

Nebula's settings pages write the same records Standard's do - `FancyProfile`,
`AudioSettings`, `PersonalizationData`, `UserPreferences`, the same ACL
documents - so anything set in one design is set in the other, and switching
designs never strands a setting.

Behaviour is shared, not re-derived. Where a decision is about *what a thing
means* rather than what it looks like, Nebula calls the same code Standard
does: the audit query parser, the livery contrast clamp, the ACL access
derivation, the locale format previews, the file-server admin client. What is
redrawn is the page.

`usePreferenceSettings` is the one piece of state worth sharing across these
pages. Nearly every preference is merely persisted, but several also have to
reach the backend or the store at the moment they change - notifications,
streamer mode, dual-path, log level, rich presence. A page that wrote the
preference and skipped its effect would appear to work and change nothing until
the next launch. That table lives in the hook, applied for every caller, so no
page has to remember which of its switches is one of those.

Nebula may import from `standard`; it must never import from `aurora`, and
nothing in `standard` or `aurora` may import from here. Packs are peers.

## Where the design lives

The mock is a flat set of CSS custom properties (`--bg0`, `--card`, `--ln`, …)
applied to hand-written elements. That translates into three layers:

1. `tokens.ts` - the mock's two palettes, transcribed verbatim.
2. `theme.ts` - the MUI theme. Every surface, radius and hairline the mock
   repeats is a component default here, so screens compose plain MUI components
   instead of restating the same `sx` block.
3. `useNebulaAppearance.ts` - reads the app's active colour theme off `:root`
   and picks a light or dark Nebula scheme plus an accent from it. Colour themes
   are independent of UI packs, so Nebula tracks the user's choice rather than
   pinning the mock's two schemes.

`palette.nebula` carries the raw tokens for the handful of things MUI has no
slot for: the radial tint, the glass fills, the long shadow.

## Corners

Rounding is a four-step scale - `sm` 6, `md` 10, `lg` 14, `xl` 20 - declared in
`tokens.ts` and published by the theme as `--nebula-radius-*` on `:root`. A step
is chosen by what an element is, not by eye: `sm` for inset detail, `md` for
controls, `lg` for surfaces, `xl` for overlays and the window's own corner.

Write `radius("lg")`, never a pixel value; the variable is what makes the scale
adjustable from one place. Circles (`50%`) and pills (`999px`) are shapes rather
than radii and stay written out. Chart.js draws to canvas and cannot read a
custom property, so charts take `NEBULA_RADIUS.sm` directly.

## Unbranded servers

Most servers send no branding, and the mock does not leave those grey: the
sidebar tile, the connect banner and the big icon all draw from one muted
gradient assigned to the address. `serverTint` in `selectors.ts` derives it -
the mock's saturation and lightness fixed, hue hashed from `host:port` - so a
server keeps its colour across launches and every surface agrees on it.

## The profile card

The mock draws a plain profile card and a styled one. They are not two
components: they are one card with and without a `FancyProfile` behind it. Nor
are the floating card, the pointer preview and the settings preview three cards
- they are that same one, in `src/shared/profilecard`, which the standalone
channel viewer mounts too. Nebula's part is three small things: `nebulaCardTokens`
lends it the window's colour ramp, `useUserCardModel` fills in what this session
knows about a person, and `components/user/ProfileCard` decides where it sits and
what its buttons do. A row that shows a name anywhere - the channel tree, the
roster, a message author, a DM - hands the same hook the same user, so there is
nothing left to drift.

Hovering and clicking do not open two cards. `NebulaClientApp` mounts
`ProfileCard` once, for the person pinned by a click or - with nothing pinned -
the one the pointer is resting on, so what a hover shows is exactly what the
click keeps. Unpinned it only stops taking the pointer, which would otherwise
pull it off the row that is showing the card. A pinned card is dismissed by the
next click outside it, watched for on the capture phase so that click still
reaches what it was aimed at - going straight from one person's card to another
person's row opens theirs rather than being spent closing this one.

Badges come off the server: today a user's groups, minted by `badgeFromGroup`,
with the group metadata keys reserved for the catalogue a server will send
later. Live voice flags are badges too, but marked as such, so a passing mute
cannot push a granted badge off the strip. What the server does not say, the
card does not claim - `mutualServers` is null here because this client holds
users for the active server only, and the row hides rather than inventing a
number.

## The User Information sheet

The card is what you open to see who someone is; `components/user/UserInfoDialog`
is what you open to see how they are connected - Mumble's "User Information"
dialog, drawn as the mock draws it, from the (i) at the end of every roster
row and from the user menu. `UserInfoSheet` is presentation only and takes
every fact as a prop, so it can be previewed and tested without a server; the
dialog gathers them. The figures come from `useLiveUserStats`, which asks the
server once a second while the sheet is open and keeps the last 45 readings
for the charts - Standard's `useUserStats` asks once, which is right for a
card and wrong for a live chart. The pure derivations - the loss figure, the
certificate line, what the ban list holds against this person - live in
`userInfoModel.ts`.

What the server does not say, the sheet does not claim. The address arrives
only for yourself and for holders of Register on the root, so the Network
card - address, the resolver's name for it (`reverse_dns`, on the backend,
since a webview cannot ask), the place, the map - is marked admin-only and
absent for everyone else. The map is OSM vector tiles from OpenFreeMap,
painted by `protomaps-leaflet` with no label rules, because the mock's map
is roads on a flat ground and a raster tile cannot shed its place names. The place comes from `useUserLocation` through the
same `geolocateIp` Standard uses, and stops at the Privacy page's maps switch
and at streamer mode: the lookup is the thing that leaves the machine, so the
switch has to stop it rather than hide its result. The moderation buttons are
gated by `userMenuActions`, exactly as the menu's entries are, and run the
menu's own `invokeModeration`, so the two surfaces cannot disagree about
what the viewer may do.

## The user menu

Right-clicking a person opens `components/user/UserMenu`, and there is exactly
one of it: the shell mounts it, and the channel tree, the roster, the DM
column, a message's author, the dock and mini mode all hand it the same target.
A row that shows a name gets the same actions as any other row showing that
name - the alternative is six menus that agree until one of them is changed.

It has two halves. Above the rule is what you can do on your own account -
their volume here, whether you keep them as a friend, following them into their
channel, opening a conversation. Below it is moderation, and every entry there
is gated on a permission the server has actually sent: `userMenuActions` reads
mute, deafen and move on the channel the *target* is sitting in, and kick, ban,
registration and content resets at the root. Checking "any channel" would offer
Move to someone who owns a temporary channel but holds nothing over the room
the target is in, and the server would refuse an action the menu had promised.
Someone with no permissions sees no second half rather than a row of dead
verbs, and nothing is ever offered against yourself.

Actions that cannot be taken back ask first, and the confirmations and the
move-to-channel picker hold their own copy of the target: dismissing the menu
to show a dialog must not take the dialog's subject with it. Deregistering is
the one that deletes an account, so SuperUser - `user_id` 0, which reads as
unregistered - is never offered it.

Cards open *beside* the row they are about, centred on it, flipping sides and
clamping to the viewport instead of overflowing (`placement.ts`). A card that
drops from the pointer covers the row it describes and then grows off the bottom
of the list, which is worst exactly where rosters are longest.

## Composition

1. `NebulaClientApp` owns state selection and decides which screen and surfaces
   are showing.
2. Screens (`ChatHeader` + `MessageList` + `Composer`, `ConnectScreen`, the
   sidebar lists) compose feature components.
3. Feature components compose the primitives in `components/primitives`.

Rules:

- Derivations go in `selectors.ts` as pure functions, not in `useMemo` bodies -
  the tree ordering, day grouping and conversation list are all testable
  without mounting a screen.
- Pack-local UI state goes in `clientState.ts`, one hook per concern. The shared
  store is for things every pack agrees on.
- `Stack` is imported from `components/primitives`, not from `@mui/material`.
  MUI 9 removed the flex shorthands (`alignItems`, `gap`, …) from Stack's props;
  the local shim folds them back into `sx` so rows stay one line.

## The server list is one list

The connect screen used to draw its own Servers column beside the rail, and the
rail's own list - pinned open - said the same things about the same servers a
few pixels to the left. So on that screen the rail is pinned open and *is* the
column: `ServerRail` renders `ServerRailPanel` alone, the tiles give way to the
rows rather than sitting beside a second copy of themselves, and the search
field and the favourite star the old sidebar owned moved onto the panel.

Pinned it takes part in the layout; opened from a tile on any other screen it
still floats over that screen's sidebar and keeps its collapse button. The
search narrows the rows only - the tiles stay put, because a rail that emptied
as you typed would stop being a fixed place to aim at.

With the switcher in the title bar there is no rail to pin, and the connect
screen keeps the `SidebarShell` list.

## Quick connect

The "+" beside the open server sits in the title bar rather than on the connect
screen, because a second server is a second tab and the tab strip is where tabs
are made. It lists saved logins most-recently-joined first - `last_joined` on
`SavedServer`, stamped by `connectTo` on every successful connect.

What is already open is a _live login_, not an address. The backend keys a tab
on host, port and username, so a second identity on a server you are already in
gets its own tab; and a session that has disconnected is a slot kept for reuse,
which the title bar draws nothing for. Filtering by address would hide the
second identity, and counting disconnected slots as open would hide the way back
into a server the user has just left - both leave the menu claiming everything
is open while the user is in one place. So a server stays in the list as long as
it has an identity with no live session, and the row names the identity it will
use whenever the address has more than one.

`groupSavedServers` applies the same liveness test, so the Servers list does not
label a dead tab "connected" or switch into one.

One click is one connect, so the menu never asks which identity to arrive as; it
repeats the last login used on that address out of the ones still free.
Choosing a specific one is still the connect screen's job.

## Shortcuts

The bindings are the client's, not the pack's: one `shortcuts.json`, written by
the Shortcuts page and matched by Standard's `useInAppShortcuts`, so a key does
the same thing in whichever design the user is running. `shortcuts.ts` holds
what is Nebula's - the actions each binding reaches, and `shortcutLabel`, which
is what a hint chip prints. The chip is derived from the binding rather than
written beside it, so a rebound key can never leave a search box advertising a
combination that does nothing.

Two of the actions have no Standard equivalent to copy. Alt+Up/Down steps
through the sidebar's _displayed_ order, not the stored one, since a channel the
filter has dropped is not somewhere the key can appear to go. And the global
search on Ctrl+Shift+F is drawn here rather than reusing Standard's palette,
because it draws from both ends: channels, people and open servers come from the
store, so the panel opens with a list already in it and keeps one while a query
is being typed, and `super_search` adds the message history and its looser fuzzy
matches when the answer lands. Neither source displaces the other - a search
that fails outright degrades to the local list rather than to nothing.

Rows are gathered into groups, because a list interleaving a channel, a person
and a message is read a row at a time rather than scanned. Which group comes
first follows the match rather than a fixed running order: a message saying
exactly what was typed is what was being looked for, and a channel that merely
contains those letters must not bury it. Both sources score on one scale for
this to work, which is why `substringScore` mirrors the substring half of the
backend's `fuzzy_score`. Each group is capped at six, or a server with a few
dozen channels fills the panel with them and appears to have no people in it.

## Leaving a server

Three controls mean "leave": the dock's `Leave`, mini mode's `Leave`, and the
title bar's ✕. All three go through `useLeaveServer`, which calls
`disconnectSession` - the multi-session path, so the backend rebinds to a
remaining tab rather than leaving the client showing a connection that is gone.

Whether to confirm first is not Nebula's decision to make: `showDisconnectWarning`
is the preference Standard's Advanced settings own and its tab bar obeys, and
the dialog's "don't ask again" writes that same flag. A user who silenced the
prompt in one design does not meet it again in another.

`Leave` used to stop voice instead, which left the server running and the button
lying. Turning voice off is now in Settings -> Voice, next to the rest of the
capture controls; the dock keeps mute and deafen, which is what it is asked for
mid-conversation.

## Leaving for the browser

A live anchor inside a webview navigates the app's own window: click a link in a
message and the window becomes that page, with nothing left to click back with.
`useExternalLinkGuard` is what stops that, and it is shared - it intercepts the
anchors `sanitizeHtml` marked `data-external`, decides whether to ask, and hands
the URL to the system browser. `LinkGuard` wraps a subtree in it; what Nebula
adds is `LinkWarningDialog`, the surface it asks on, for the same reason
`LeaveServerDialog` exists.

The dialog draws the host apart from the rest of the URL, because the host is
the whole question - it is what the tick would trust, and the only part worth
reading before deciding. One even weight invites reading left to right and
stopping at whatever looks familiar, which is the mistake a long deceptive path
is built to cause. The host is printed as `URL` gives it: lowercased, and
punycode for an internationalised name, so a homograph registration shows as
`xn--pple-43d.com` rather than as something indistinguishable from `apple.com`.

"Trust <host>" writes `trustedLinkHosts`, and that is a preference rather than a
Nebula-local flag - a host vouched for here is not asked about again in
Standard, whose dialog offers no tick of its own but honours the list. Trust is
recorded on confirm, not on the tick, so a dialog that is ticked and then
cancelled leaves nothing behind; it is keyed on the exact host, port included,
since a suffix test would let `example.com.evil.tld` inherit `example.com`. A
trusted host still leaves by the browser - trust silences the question, it is
never permission to navigate this window.

## Glass

The channel header and the composer are translucent over the conversation
backdrop, which is why `ChatBackdrop` always paints a textured wash even when
the user has set no wallpaper: `backdrop-filter` over a flat fill is
indistinguishable from a plain tint, and the bar reads as a solid slab. There is
no opaque fallback for webviews that cannot blur - nothing scrolls behind that
chrome, so there is nothing to obscure, and an opaque fill would reintroduce the
slab on exactly the platforms that need the fix.

## The window frame

The mock draws the client as a rounded card floating on a desk. The Tauri window
is opaque (`transparent: false`), so Nebula paints the desk itself and insets the
shell into it. True rounded _window_ corners would need window transparency,
which is a shared `tauri.conf.json` change with a per-compositor failure mode on
Linux - deliberately not taken here.

## Deviations from Standard

Nebula is a design, not a fork: it shares Standard's stores, types and backend
bindings, so anything it does render behaves identically. What follows is what
it does _not_ render. Kept current - if you add a screen, move its line.

### Reached through Standard's pages

- The auxiliary windows - updater, chat/DM/stream popouts, drawing overlay -
  render correctly when opened, though nothing in Nebula's chrome opens them.

Settings and administration used to be here. They are not any more: every page
is drawn in Nebula, and the "All settings…" and "Server admin…" escape hatches
are gone with the surfaces they opened.

### Borrowed leaf widgets

A handful of self-contained controls are Standard's, mounted inside Nebula's
pages: the VU meter, the role colour/icon pickers and preview card, the member
picker, the file preview and thumbnail, the chart canvas, the audit query
autocomplete and SQL editor, and the sanitising HTML renderer. These are
measurement and picker widgets rather than layout, they already draw from the
active colour theme, and there is no second version of any of them worth
having. Pages are Nebula's; these are not.

The voice calibration *card* used to be on that list and is not any more. A
whole card is layout - the mock disagrees with Standard about every box in it -
so what is shared is the behaviour behind it: `useVoiceCalibration` owns the mic
test, the level stream, the speech timer, the calibrator's answer and the replay
recorder, and Standard's `CalibrationPanel` and Nebula's `VoiceGate` are two
drawings of it. The meter inside both is still Standard's, because a dB axis
with draggable thresholds is a measurement widget and a second one would be a
second set of numbers to keep honest.

### Absent

Kept honest by reading the code, not by memory: entries here have been false
before, because a feature landed and its line was never struck.

**Composing**

- No custom server emotes beyond what the body already carries.
- No scheduled messages, calendar/meeting composer, or LiveDoc. Note that the
  runtime already runs `useCalendarReminders`, so calendar reminders fire with
  no calendar to open them in.

**Reading**

- No per-message translation trigger. The overlay itself is mounted and works
  the way it does in Standard, which drives it from selection rather than from
  a row.

**Channels and users**

- No drag-and-drop: channels cannot be reordered by dragging and users cannot
  be dragged between channels. Reordering is the channel editor's `position`
  field, and moving a user is on their menu.
- No blocking, ignoring or user notes. Existing relations are still honoured
  when filtering messages; they just cannot be edited here.

**Screen sharing**

- The strip starts, stops, watches, configures quality and shows statistics.
  There is no focused single-stream view and no annotation overlay, and the
  stream popout window exists but nothing here opens it.

**Elsewhere**

- No watch-together host controls. An active session's card renders; starting
  one does not.
- No first-run onboarding wizard, friends page, shared-files panel,
  rich-presence panel, saved-server editor or channel recording.
- No mobile layout. Nebula assumes a desktop window.


## Form controls

Nebula borrows Standard's pickers but deliberately does not load Standard's
`global.css`, whose "form control baseline" is what stops half-styled controls
drifting. A widget that leaves its input to the host - the emoji picker's search
box among them - therefore arrived as a raw browser input in the middle of the
mock.

The equivalent baseline lives in `theme.ts`, under `MuiCssBaseline`, in Nebula's
own tokens rather than Standard's. It is element-level on purpose, so a single
class still wins: `MarkdownInput`'s invisible textarea sets its own padding,
colour and border and is untouched by it.

## What a message is

A chat body is HTML, but not every body is text: some are a marker standing in
for an object the server broadcast separately. `messageContent` in
`selectors.ts` decides which - poll, file, the quotes a reply carries - and
`MessageRow` draws the card. Rendering a marker as HTML prints its neighbours
and drops the object, which is what happened here until a poll showed up as
bare question text and an attachment as nothing at all.

Editing runs the composer's encoding backwards. `composerHtml` and
`editableText` are one round trip and live together for that reason. Which row
is being edited is the shell's state rather than the row's, because the message
menu is mounted once for the whole conversation and is one of the things that
starts an edit.

The hover strip carries what is wanted mid-conversation - react, reply, edit,
copy, pin, delete. Everything else is on the right-click menu, so the strip does
not grow into a toolbar covering the message it belongs to. Reacting had to be
on both: the reaction bar owns the "+" that adds one, and the bar only draws
once a reaction exists, so the first one could never be placed.

Several things are about the *conversation* rather than about what is on
screen - the read watermark, where reading stopped, the lightbox gallery - so
`NebulaClientApp` keeps `conversationMessages` apart from the searched list.

## What is mounted

Only the newest `BASE_WINDOW` messages are live DOM. The window grows as the
reader climbs towards the top and snaps back at the bottom; the policy is
core's `chatWindowing`, shared with Standard, so the two packs agree about what
"near the top" means.

Three things move rows above the reader and all three are corrected the same
way, by the first *rendered* id changing: a fetched page of history, a window
that has grown, and nothing else. Following a quote into unfetched history
therefore takes two passes - the first widens the window, the second finds the
row - which is why the jump carries a nonce and remembers the last one served.

## Encryption state

Persistent chat is end-to-end encrypted, and its trust decisions are the user's
to make: which key belongs to whom, who may be handed one, what to do when two
keys claim the same person. Nebula does not re-draw those flows - it mounts
Standard's `usePersistentChat`, puts its banners directly under the channel
header and its dialogs at the window root, and honours `sendBlocked` so a
revoked key disables the composer instead of letting sends fail quietly.

This was missing while the row's delete button already called
`deletePchatMessages`: the pack acted on encrypted history while showing none
of the state that says whether it is trustworthy. A design may draw a warning
differently. It may not decline to draw it.

The header says it as two chips, not one: whether the history is kept, and who
can read it. They agree today - persistence is derived from the same
`pchat_protocol` the encryption is - but they answer different questions, and a
single badge would leave the reader unable to tell which one it meant. Each
trust level carries its own glyph and its own word, so the four are told apart
without reading the colour; the tone only makes disputed hard to miss. A key
that has not been judged yet says `Encrypted` rather than `Unverified`, which is
a verdict on a key that may simply not have arrived. The trust chip is the way
in to the verification dialog, so the fact and the action to change it are the
same target.


## Who belongs to a channel

An ordinary channel has no membership beyond who is standing in it, so the
header says "3 in voice" and stops. A persisted one does: the server names the
holders of the key its history is stored under, and someone who has stepped out
still belongs to the room their messages are kept in. `channelPresence` adds
those to the occupants, and the second half of the subtitle appears only when
it is not restating the first.

Absent members are counted by key rather than by "offline". Counting the
offline ones - which is what the channel info panel does, because it labels
them - would make the number drop as one of them connected and sat somewhere
else, and a membership that shrinks when a member appears is worse than none.
The count is only ever asked for once per persisted channel opened, since
`query_key_holders` is a round trip.


## Where history comes from

Persistent-chat scrollback is paged, and the thing that asks for the next page
is a sentinel inside `PersistenceBanner`. That is why `MessageList` takes a
`header` slot rather than the shell drawing the banner above it: an
intersection observer watching an element in fixed chrome is permanently
intersecting, and would page the whole archive in as fast as the server could
answer. The banner belongs at the top of the scroller, where scrolling up to it
means the reader has actually reached the end of what is loaded.

A page landing above the reader must not move what they are reading, while a
message arriving below should follow them down if they are at the bottom.
`MessageList` tells the two apart by the id of the first message: it only
changes when something was prepended, and the scroll offset is then corrected
by the height the list grew by.

What Nebula still does not do is *window* the render. Standard mounts a
tail-anchored slice of the conversation; Nebula mounts all of it.

## The composer

The pill is Nebula's. The three things that can open over it while typing - the
mention list, the slash-command list, the emoji grid - are pickers, so all
three are Standard's, and the trigger detection under them (`parseMentionTrigger`,
`extractSlashQuery`, `parseSlashLine`) is core's. What is left here is the
arithmetic of a plain textarea: the draft is a string and the caret an offset
into it, so inserting a pick is a splice plus a `setSelectionRange`, scheduled
after the commit because the value React is about to render is not in the
element yet.

An open list owns the arrow keys and Enter. Only when nothing is open does
Enter mean send - otherwise choosing someone from the mention list would send
the half-typed name instead of completing it.

Selecting text raises a formatting bar at the height those lists dock at, and
centred over the words it is about. It is drawn only while there is a
selection: a toolbar that is always there is a row of controls to skip past on
every glance at an empty composer, and the canvas gives that space to the
message river. Its buttons refuse focus on mousedown, because taking it would
collapse the selection they are about to act on.

Where it sits is measured, not derived. The textarea underneath is one opaque
box with no per-character geometry to ask for, so `MarkdownInput` publishes
`selectionRect` instead: its overlay has drawn the selected run as its own
spans and therefore laid it out glyph by glyph. A selection that wraps reports
only its first line - the union of every line is just the whole pane. The
measurement runs in a layout effect so the bar is placed before the frame is
painted rather than a frame late, and it is clamped to the pane's inset, so a
word at either edge does not push it off the glass.

The bar decides *which* mark, never what a mark is. `MarkdownInput` publishes
`wrapSelection` and `toggleList` - the same two entry points Ctrl+B and Ctrl+I
already go through - so there is one answer to what `**` means rather than one
per pack. The `Ctrl+B` chip on the right of the bar exists to say so: it
teaches the keyboard while the mouse is being used.

Lists are the one block-level thing the shared converter draws, and they were
added for those two buttons. `markdownToHtml` lifts each run of `- ` or `1. `
lines out before its newline pass, because a `<br>` between two `<li>`s is a
blank line drawn inside the list; `htmlToMarkdown` puts the lines back, and the
pair is an exact round trip so that editing a message does not rewrite it.

`composerHtml` is that converter now, not an escape. Nebula used to send the
draft escaped, which meant the formatting stopped at the composer's edge - what
was drawn bold while it was being typed arrived at everyone else as a word
between four asterisks. Standard's converter is called rather than a second one
written here: both packs send into the same channels, and a dialect that
differed between them would read as one client's messages formatting and the
other's not.

Uploading is not a design decision, so it is not one Nebula makes: stream,
announce. That order lives in `core/features/chat/useFileUpload`, and what the
pack owns is where the progress row sits and when a file joins `staged` in the
first place - see **Staging** below, which is where "ask how it may be shared"
moved to. The attach button is rendered only when the file server has said
both that it is there and that this user may share - a button that opens a
picker and then fails on upload wastes the choice the user just made. Standard
still has its own copy of this lifecycle inside `ChatView`; moving it onto the
shared hook is worth doing and has not been done.

A photo staged for the "compressed" choice gets its smaller copy from
`resizeImage` (`core/features/settings/imageUtils.ts`) - a canvas, the same one
every other place in the client that shrinks an image already uses, not a
second resizer written for this pack. The one piece Rust does is putting the
result back on disk: the uploader streams from a path, a canvas produces a
data-URL, and `write_attachment_bytes` is the one command that turns one into
the other. A pasted image goes through the same command, from bytes the
webview is already holding rather than a canvas resize.


## Chunks

The client is what loads at launch. Settings and administration are not the
client - they are two surfaces reached by a deliberate click - and neither is
any single page inside them. So the pack is split three ways:

1. `NebulaClientApp` and everything the window always shows.
2. `SettingsScreen` and `AdminScreen`, each its own chunk.
3. Every settings page and every administration page, one chunk each.

That took the eagerly-loaded pack from **792 kB to 170 kB** (gzip 234 kB to
52 kB). Opening Settings now fetches a 6 kB shell plus the one page asked for -
Voice is 14 kB, Privacy 3 kB - where before, showing a connect screen had
already paid for the ACL editor, the audit log and the marketplace.

The rule that keeps it that way: **`components/index.ts` must not re-export a
screen.** A barrel is imported whole, so one `import { TitleBar } from
"./components"` would pull every settings page back into the client's graph and
silently undo the split. `SettingsScreen` and `AdminScreen` are therefore
imported from their own modules, and the barrels say so where the export used
to be.

Boundaries are placed where a pane is, not around each component: one
`Suspense` in `NebulaClientApp` covers both screens - they share a pane and
never show together - and one inside each screen covers whichever page is
chosen. The fallback holds the pane's shape rather than drawing a spinner; a
local chunk resolves in a frame or two, and a spinner that brief reads as a
flicker.

What is *not* split is anything the window shows at rest. The composer's
pickers, the profile card and the message row are all on screen in the first
second of a session, so deferring them would only add a round trip to the thing
the user is already looking at.


## The composer surface

Drawn from the "Chat Composer" canvas, artboard 8a — "Final: floating
composer, docked status bar". The canvas argues its way there over eight
boards, and two of the turns matter because they reverse each other:

- 5a moved the composer from a card to a footer, because a card "looked out of
  place - an opaque slab floating on the wallpaper with a second field boxed
  inside it".
- 8a floats it again, but on a **10px inset** rather than as a slab: tight
  enough to read as part of the pane, loose enough to show the wallpaper on all
  four sides.

So the panel is inset 10px, 16px radius, blurred at 32, and the text shares one
52px row with the tools. 4a's two-row arrangement is gone, and so is its
"⇧↵ new line" hint - the row has no space for a caption that only repeats what
Shift+Enter already does.

**The panel only ever grows upward.** Replies and files dock *above* the input
row inside the same panel, each on its own bottom hairline; the inset never
changes. A quote is a full-width 40px row - reply glyph, author, message,
dismiss - so two replies are two rows rather than a wrapping cluster of chips.

**Progress is the hairline.** An upload fills the divider under its own row
with the accent instead of adding a bar, so nothing new appears while a file
goes up. Send stays disabled until it lands, because the message carries the
file's marker and there is no marker until the server has answered - sending
early would send a reference to nothing. A *failed* upload does not hold send:
it is never going to land.

**One accent, one press.** It is on send alone, plus the upload hairline and
the panel's own edge while it holds the caret. `onAccent` is a token because
both schemes' accents are light enough that white on them is thin.

**Focus is drawn on the panel, because the panel is the field.** A ring around
the words inside it would be 5a's "second field boxed inside" all over again,
so the hairline that is already there turns accent instead, throws one more
hairline of soft accent just outside itself, and the fill comes up a step -
held as a wash of accent over the neutral one rather than swapped for a tinted
token, because the light scheme's tinted card is *darker* than its wash and
lighting a surface by darkening it reads as the panel going away. The
placeholder comes up with it, from `dim` to `muted`: it names the channel the
next line is going to, which is worth most right as it is about to be typed.
The editor draws its own caret and takes its colour from `--color-caret`, so
the caret lights with the rest. A disabled composer never lights - an accent
edge on it would promise a keystroke it will not take.

Geometry is the canvas's and lives in constants at the top of `Composer.tsx`,
outside the radius scale - the scale tops out at 20 and this surface is drawn
to its own. Colour is *not* taken from the canvas: it comes from the theme, so
the composer follows the user's light or dark scheme rather than pinning the
artboard's palette.

Files are dropped through Tauri's own drag-drop event, not the DOM's: a dropped
`File` carries no path and the uploader streams from one. The composer only
draws the target, and is told when to; the shell stages the drop straight into
`staged` the instant it lands, the same call the picker makes - no panel in
between, nothing pressed first. The drop is gated on the same `canAttach` as
the button, not on a selected channel: a direct message has none, and the
uploader takes the DM session instead. And the shell hands over the drag's URI
list with only `file://` stripped, so an image dragged out of a browser or out
of the chat arrives as `http://…`; those are turned away with a notice rather
than staged, because the uploader streams from a path and a URL is not one.

A paste takes the other route in: the composer reads images off the clipboard
itself (`DataTransferItemList` first, the async Clipboard API as the fallback
WebKitGTK on Linux needs - it leaves a pasted image's `clipboardData` empty)
and hands the shell a `File`. The shell writes it to a scratch file
(`write_attachment_bytes`, the same command a photo's compressed copy is
written by) and stages it exactly as a drop would.

**Trays.** Everything the composer is holding but has not sent - replies,
staged files, uploads in flight - is drawn as a strip docked above the input
row, in that order. They share one shape (`Tray`): 5px of padding on a
`washLine` hairline, rows inset by 4px, and a lighter inset rule between rows
of the same tray. Two replies are therefore two lines under one edge rather
than two bands, which is what keeps a second reply from doubling the chrome.

The three differ in what a row is worth looking at. A reply is a line of text,
so it is one: arrow, name in accent, body in muted, cross. A staged file is
something you need to *recognise*, so an image gets a 54px square and nothing
else - the picture is the label - while a file with no picture gets the
opposite, a type badge with its name and size, because for those three facts
are the file. An upload is a name plus a claim about time, so it gets a 40px
thumb, a line that says size, percentage and estimate, and a 3px bar inside the
row. Each part of that line is left out until it is true rather than stood in
for by a zero: the size is known before a byte moves, the percentage from the
first event, the estimate only once there is a rate to estimate from. A failure
stops the bar where it stopped - filling it would say the file arrived.

**Staging.** Picking a file no longer starts an upload, and it no longer asks a
question first either. The picker, a drop, and a paste all put a file straight
into `staged` - that is what the tray draws - and how the batch may be seen
lives on the tray itself (`AttachmentTray`, `ShareOptions`), folded away behind
an "Options" row that only appears when there is a choice worth showing: a
server that can share a link, or a photo with a compressed copy waiting. One
answer for the whole batch, not one dialog per file, because visibility is a
property of the message being written. Send is what uploads them, in order,
with whatever was typed riding on the first so a photo and the sentence about
it stay one thing in the river - and each file's quality is read off it
individually, since a compressed copy that never turned out smaller falls back
to the original rather than holding the batch to whichever one finished. That
is the only reason the tray exists: without it a message could carry one file
and no words about it, because the upload had already gone.

**Selection.** The browser's own highlight is a slab of system blue that owes
nothing to the scheme, and the editor hides it to draw its own. Nebula tells it
what to draw through `--color-selection`, `--selection-ring` and
`--selection-radius`: a wash of accent inside a hairline of it, rounded, the
same way a code span is marked. The edge is what keeps it legible over glass,
where a fill at this alpha is barely a change of shade.


## Wide windows

Nothing stretches. Two caps and one centre line, from artboard 10a:

- the composer grows to **1360px** - about a 16:9 pane - then centres;
- the message column caps earlier at **980px**, because prose is read by the
  line and a paragraph spanning an ultrawide pane loses the reader on the way
  back to the left.

On 21:9 the leftover width falls outside both rather than being filled. Below
about 1000px neither cap bites, so a laptop keeps the 10px inset edge to edge
and nothing changes.

Popovers keep their own width and hang off the icon that opened them - a GIF
grid spanning the whole footer is unusable however wide the window is. The GIF
browser is a panel on the composer's own inset rather than a centred modal:
9a asks for popovers, not dialogs, and explicitly for no scrim over the
conversation.

## The hover menu

One pill, standing just off the bubble's top edge rather than sitting inside
the header row - so it never reflows the text underneath, and clear of the
message rather than hanging half into it: a pill lying over the first line
covers whatever is on that line, and a link there stops being clickable. The
4px it stands off by is air to look at, not to walk through - a pseudo-element
bridges it, because a pointer crossing a real hole leaves the row, and a row
that is no longer hovered takes the pill away before it is reached. It carries
the composer's rhythm at 80% scale: bare 15px icons, 34px tall, and exactly one
divider, only ever before the destructive end.
