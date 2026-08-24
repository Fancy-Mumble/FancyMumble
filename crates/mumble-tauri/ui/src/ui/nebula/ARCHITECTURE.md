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

- Rich text: the composer is plain text plus GIFs, not the TipTap editor. No
  markdown toolbar, no code blocks, no tables.
- No custom server emotes.
- No poll creator. Polls that arrive are rendered and can be voted on.
- No drag-and-drop onto the composer, and no pasted-image tray: a file is
  attached through the picker.
- No scheduled messages, calendar/meeting composer, or LiveDoc. Note that the
  runtime already runs `useCalendarReminders`, so calendar reminders fire with
  no calendar to open them in.

**Reading**

- No render windowing. Every in-memory message of the open conversation is
  mounted, where Standard mounts a tail-anchored slice (`chatWindowing`,
  `useChatScroll`). Fetching older history works; holding thousands of rows in
  the DOM is the part that does not scale.
- No per-message translation, and no multi-select or bulk delete. Copy, reply,
  edit, pin and delete are present.

**Channels and users**

- No drag-and-drop: channels cannot be reordered by dragging and users cannot
  be dragged between channels. Reordering is the channel editor's `position`
  field.
- No blocking, ignoring or user notes. Existing relations are still honoured
  when filtering messages; they just cannot be edited here.

**Screen sharing**

- The strip starts, stops, watches, configures quality and shows statistics.
  There is no focused single-stream view and no annotation overlay, and the
  stream popout window exists but nothing here opens it.

**Elsewhere**

- No watch-together host controls. An active session's card renders; starting
  one does not.
- No first-run onboarding wizard, friends page, shared-files panel or
  rich-presence panel.
- No mobile layout. Nebula assumes a desktop window.

## What a message is

A chat body is HTML, but not every body is text: some are a marker standing in
for an object the server broadcast separately. `messageContent` in
`selectors.ts` decides which, and `MessageRow` draws the card - Standard's, in
both cases, because a poll and a file card are self-contained widgets rather
than layout. Rendering a marker as HTML prints its neighbours and drops the
object, which is what happened here until a poll showed up as bare question
text and an attachment as nothing at all.

Editing runs the composer's encoding backwards. `composerHtml` and
`editableText` are one round trip and live together for that reason: an edit
that re-encoded text differently from the way it was first sent would rewrite
the message every time it was saved. The editor is on the row rather than in
the composer, which may be holding an unsent draft.

Several things are about the *conversation* rather than about what is on
screen - the read watermark, where reading stopped, the lightbox gallery - so
`NebulaClientApp` keeps `conversationMessages` apart from the searched list.
Deriving them from the filtered list would let typing in the search box move
this client's read receipt.

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

Uploading is not a design decision, so it is not one Nebula makes: pick, ask
how it may be shared, stream, announce. That order lives in
`core/features/chat/useFileUpload`, and what the pack owns is where the
progress row sits. The attach button is rendered only when the file server has
said both that it is there and that this user may share - a button that opens a
picker and then fails on upload wastes the choice the user just made. Standard
still has its own copy of this lifecycle inside `ChatView`; moving it onto the
shared hook is worth doing and has not been done.


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
