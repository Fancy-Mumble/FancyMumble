# Parity with the web UI

What the web UI (Nebula, `src/ui/tauri/ui/src/ui/nebula`) has and this native client does not, feature by feature. Taken on 2026-11-14 by reading both sources, area by area. Nothing was run for it, and where a component was only skimmed the section says so at its end.

## How to read it

- **Native** says what this client has: `present`, `partial` (the row says what is missing), `absent`, `different`, or `unverified` (could not be settled from the source).
- **Effort** is a rough size for the native side alone: S is hours, M is days, L is a week or more.
- **Engine** says whether `src/engine.rs` already offers what the feature needs. "no" means the engine API has to grow first; "state has it" means the engine implements it and only the thin API layer is missing; "Tauri-only" means the code is compiled only into the web client today.

## The size of it

| Area | Rows | Present | Partial | Absent |
|---|---|---|---|---|
| 1. Chat and the composer | 111 | 22 | 39 | 49 |
| 2. Window shell | 105 | 21 | 30 | 53 |
| 3. Settings | 116 | 12 | 23 | 80 |
| 4. Server administration | 65 | 19 | 13 | 32 |
| 5. Profile cards, people, voice, media | 84 | 9 | 31 | 43 |
| 6. Underneath and around the window | 93 | 14 | 21 | 56 |
| **All** | **574** | **97** | **157** | **313** |

A few features are counted in two areas (notification sounds, plugins, screen sharing), so the total is a little high. Roughly one row in six is at parity.

## Three things that explain most of it

1. **The engine API is the bottleneck.** The web UI reaches 319 commands; the native `Engine` trait has about 54 methods. Around half of the absent rows need the engine surface widened before any screen can be drawn. Much of that is implemented in the engine's state already and only needs exposing.
2. **The view does not know what the user may do.** The snapshot carries no permissions, so every admin and moderation entry is offered to everyone. It also merges self-mute with server mute, has no session state on the rail, and no level stream from the microphone.
3. **There is no application shell.** No tray, no global hotkeys, no notifications on Windows, no sounds, no tooltips, no translations, no keyboard navigation, no memory of the window's place, one window only.

## Defects found on the way

These were wrong, not merely missing. Eight are fixed (2026-11-14); two wait for something that is not there yet.

| Defect | Now |
|---|---|
| "Change comment…" sent the text as the whole comment, wiping a profile set from the web client | Fixed: the profile a comment carries is kept |
| "Unmute for everyone" was offered for a user who muted themselves | Fixed: the engine tells server mute from self-mute |
| Voice could not be turned off again | Fixed: "Turn voice off" on the own-tile menu |
| "Typing indicators" off only stopped sending them | Fixed: other people's are hidden too |
| Editing a message lost its formatting on save | Fixed: an edit starts from what was typed |
| The hover card showed three lines of the bio; Nebula shows the full card | Fixed as far as the bio goes; the card itself is phase 3 |
| Spoilers were drawn in the clear | Fixed: hidden until clicked |
| Auto-reconnect gave up after 10 attempts | Fixed: it retries for as long as the server is wanted |
| The engine's "request attention" event is dropped, so the taskbar never flashes | Open: GPUI has no call for it; phase 4, in the GPUI copy |
| The pin count and the pinned view cover only the loaded page | Open: needs the full pin list from the engine; phase 1 |

## A suggested order

1. The defects above. All are small.
2. View-only gaps that are small and seen constantly: tooltips, separate mute badges, unread divider and "new messages" pill, a click pinning the profile card, leave confirmation, in-window keys for mute and deafen, window geometry, following the system's light or dark setting, notifications on Windows.
3. The profile card rebuilt as the web's card, reading the rest of the profile.
4. The engine widened where one change unlocks many rows: permissions in the snapshot, self and server mute apart, session state for the rail, the missing voice settings and a microphone level stream.
5. Media in the conversation: remote pictures, tiled galleries, the attachment tray with upload progress, the lightbox stepping through pictures.
6. The large features, each a project: screen sharing, translations, plugins, the eleven missing administration pages, calendar, watch-together, live documents.

## 1. Chat and the composer

The native conversation covers the basic loop (read, send, reply, react, edit, pin, poll, send later, files, read ticks, typing), but nearly every one of those is a reduced version of the web one, and whole surfaces are missing. The largest absences are media and collaboration: no remote images or GIFs, no video, audio or voice messages, no gallery, no watch-together, no live documents, no screen-share stage, and a link card that shows one fixed layout for the first link only. The composer has no staging tray, share options, upload progress, mention list, slash commands, GIF picker or searchable emoji; files and pasted pictures go out the instant they are chosen, with no caption. Reading aids are missing too: no unread divider, no "new messages" pill, no jump-to-message, no hover actions, no selectable message text, no search inside a conversation. About half the gaps need new engine surface.

Three native behaviours are wrong rather than missing:
- **Spoilers are drawn in the clear.**
- **Editing a message starts from its plain text, so its formatting is lost on save.**
- **The pin count and the pinned view only cover the loaded page.**

Web sources are under `ui/nebula/components/chat/` unless a row says otherwise.

### Message list and layout (`MessageList.tsx`, `MessageRow.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Windowed list that opens on the newest page | present | | - | yes |
| Older history loads on reaching the top | partial | A "Show earlier messages" button, not automatic | S | yes |
| Arrival does not move a reader who scrolled up; own send follows | present | | - | yes |
| "N new messages" pill / jump to latest | present |  | - | yes |
| Unread rule above the first unread message | present |  | - | partial (count only, no first-unread id) |
| Day dividers | present | | - | yes |
| Grouping a sender's run into one block | present | No one-hour window: any gap still groups | - | yes |
| Time once per block | present | Time and tick under every own bubble | - | yes |
| Sticky avatar that travels down a run | absent | Avatar on the run's first row only | M | yes |
| Message style: bubbles / flat / compact | absent | Bubbles only | M | yes |
| Chat text size | present | Fixed 14 px | - | yes |
| Clock: 12 h / 24 h / auto, server time | partial | Auto reads as 24-hour (the system's preference is not asked); no server time | S | yes |
| Column capped and centred on wide windows | present | Rows span the pane | - | yes |
| Own accent bubble, others' card | present | | - | yes |
| Conversation wallpaper (picture or clip, blur, dim) | partial | A picture behind every conversation, washed out and blurred as far as two bars say; no clip, no focus point, no recents | M | yes |
| Empty conversation text, loading label | partial | Says 'No messages yet.'; nothing while history loads | S | unknown |
| Jump to a message and flash it (from quote, pin, search) | partial | From a pin, from the quote of what a message answers and from a found message; not to history that is not held | M | partial (not for unloaded history) |
| Row highlight when you are mentioned | present |  | - | no |
| External-link guard (confirm before leaving) | present | Links open directly | - | yes |
| Heavy bodies moved to cold storage with a placeholder | absent | | M | no |

### Message content (`MessageRow.tsx`, `MediaGallery.tsx`, `LinkPreviewCard.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Bold, italic, underline, strike, writer's colour | present |  | - | yes |
| Inline code | present | A background chip, not a monospace face | - | yes |
| Code block: monospace, horizontal scroll, syntax highlighting | partial | No syntax highlighting | M | yes |
| Block quote (side rule, dimmed) | present | Just a line break in received messages | - | yes |
| Lists | present | Every item gets a bullet; numbers lost; no indent | - | yes |
| Headings sized | present | Bold only | - | yes |
| Tables | partial | Row text on lines, no grid | M | yes |
| Spoilers (click to reveal) | present |  | - | yes |
| Math | absent | (Web rendering in Nebula unverified) | M | yes |
| Links, bare addresses, scheme allow-list | present | | - | yes |
| Shortened link text | present | Full address printed | - | yes |
| Link preview card | partial | First link only, one small layout. Missing: several embeds, poster shapes, source chip and favicon, author, duration, price / stock facts, age, link-only message collapsing into the card, "Load content" gate, inline video, Watch together | L | no |
| Pictures embedded in the message | present | | - | yes |
| Remote pictures, including GIFs a web user picked | absent | Drawn as the text `[image]`; nothing is fetched | M | no |
| Several pictures as one tiled block | present | Stacked one under another | - | yes |
| Animated GIF playback | present |  | - | - |
| File card: name, size, save | partial | A picture shared as a file is shown as one; a link or a password share says which. Missing: open after save, saved state, expiry shown, password asked for in place | M | no |
| Visibility flag on a sent file (public / password link) | present |  | - | no |
| Shared photos and clips drawn as pictures; batch block with "Save all" | absent | Every shared file is the same generic card | L | no |
| Inline video and audio players | absent | | L | no |
| Voice messages (record, play, seek, speed) | absent | | L | no |
| Poll card | partial | Web locks after voting; native toggles and can un-vote; no total voters | S | yes |
| Poll is a message (reply, react, pin) | partial | Native polls are separate rows, only those seen while connected | M | partial |
| Reply quote above a message | partial | One line; a click goes to what it answers. Missing: author-colour bar, thumbnail, several quotes | M | partial |
| Mention chips | partial | Styled only. Missing: click opens the card, role / everyone / here lists | M | partial |
| Reaction pills | partial | Missing: who reacted, "+" on the bar, custom image reactions, reactions in direct messages | S-M | no |
| "edited" and pinned markers | present | | - | yes |
| Failed send | partial | "not sent" on the bubble; no Retry / Dismiss | S | no |
| Read tick on own message | partial | Missing "read by everyone" state | S | yes |
| Plugin badge, "legacy / unencrypted" badge | absent | | S | no |
| Author: click opens card | present | The face keeps the card and has the user menu; the name does neither yet | - | yes |
| Sender name in role colour | present | | - | yes |
| Server welcome | partial | A dismissible card; not re-readable as a pin | S | yes |

### Message actions (`MessageMenu.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Right-click menu | present | | - | yes |
| Hover pill (react, reply, edit, copy, pin, more) | present | Right click is the only way in | - | yes |
| Quick reactions and full picker | present | | - | yes |
| Reply | present | Fancy servers only | - | yes |
| Edit own message | partial | In the composer, not in place; channels only. Formatting is kept: the edit starts from what was typed | M | partial |
| Delete (own anywhere; others' with permission) | present | Own messages in kept channels only | - | unknown |
| Pin / unpin | present | | - | yes |
| Copy text | present | | - | yes |
| Copy a selection | absent | Message text cannot be selected | M | yes |
| Select several and delete | present | | - | yes |
| Picture menu: copy image, save, copy link, pop out, open in browser | partial | Save and Copy stand under the open picture; no menu on the picture itself, no link to copy, no pop-out | M | partial |
| Open link in private window | absent | | S | yes |
| "Read by" list with avatars | absent | Only the "Seen by" line | S | yes |

### Composer (`Composer.tsx`, `FormatBar.tsx`, `AttachmentTray.tsx`, `popover/*`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Multi-line, Enter sends, grows to a cap | present | | - | yes |
| Live styling of typed marks | partial | Missing: bulleted and numbered lists, auto-links, math, fence language | M | no |
| Format bar over a selection | partial | Missing: link, bulleted list, numbered list, emoji | S | no |
| Shortcuts | partial | Missing `Ctrl+O`; no undo / redo found | S-M | yes |
| `@` mention list (people, roles, everyone, here) | partial | A list at the @: people (those in the room first), everyone, here; arrows, Enter, Tab or a click take one. No roles | M | partial |
| Slash commands (plugin commands) | absent | | M-L | no |
| Emoji picker | partial | Every emoji in its groups, found by name, those last used first. Missing: server emoji, skin tones, a popover at the button (it is a dialog) | M | no for custom |
| GIF picker | absent | | L | no |
| Poll composer | partial | A text prompt; web has option rows and a single / multi toggle | S-M | yes |
| Paperclip | present | Several files a pick; they wait above the composer | - | yes |
| Staging tray: files wait, previewed, removable, sent with the typed text as one message | present | No preview at full size from the tray, no upload progress | - | no |
| Share options: who can open, expiry, photo quality | present | No upload cancel; a password link is opened in the browser | - | no |
| Upload rows: size, percent, time left, cancel | absent | Outcome arrives as a notice | M | no |
| Drag and drop files | partial | Dropped files wait above the composer; no drop overlay | S | yes |
| Paste a picture | partial | Sent at once rather than staged | with tray | yes |
| Reply strip | partial | One reply at a time; web stacks several | S | no |
| Preview of the link being typed | absent | | M | yes |
| Voice message recording | absent | | L | no |
| Typing: tell others, and "X is typing…" | present | No animated dots | S | yes |
| Composer disabled (no channel, key revoked) | absent | Never disabled | S | no |
| Send later | partial | A prompt taking `18:30`, `15m`…; web has a date-time picker | S | yes |
| Drafts per conversation | present | One composer whose text carries over on switching | - | yes |

### Search, pinned, scheduled

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Search inside the open conversation | partial | The column's search finds messages everywhere and a click goes to the message itself; no search scoped to the open conversation | M | yes |
| Message search results | partial | Listed under the channels; a click opens the conversation but not the message | M | partial |
| Pin button with count | present | **Counts the loaded page only** | - | no |
| Pinned panel (author, age, preview, pinned by, jump, unpin) | partial | No new-pin mark; a pin on a message further back than what is held is listed but cannot be gone to | M | partial |
| New-pin dot, "mark read" | absent | | S-M | no |
| Waiting scheduled messages with cancel | present | | - | yes |
| Warning that a scheduled message is stored in plain text in an encrypted channel | present |  | - | yes |

### Header, encryption state, direct messages (`ChatHeader.tsx`, `KeyTrustBadge.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Title, subtitle, channel menu, people count, search, pins, Join | present | | - | yes |
| "History kept" chip and key-trust chip (four levels, verification) | partial | Words in the subtitle only | L | no |
| Key-share request strip | present | | - | yes |
| Persistence, key dispute, revoked-key and Signal error banners | absent | | L | no |
| Downloads list, my shared files, rich presence panel | absent | | M each | no |
| Direct message header: partner's face, pop out to a window | partial | An "@" glyph and the name | S-M | partial |
| Direct messages: send, reply, pictures, files | present | | - | yes |
| Direct messages: react, edit, delete | absent | Menu is Reply and Copy only | M | no |
| Notepad / notes to self | absent | | M | no |

### Lightbox (`standard/.../Lightbox.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Picture large over a blurred veil; click or Escape closes; save | present | Blur on Windows only | - | yes |
| Step through the conversation's pictures | present | One picture, no navigation | - | yes |
| Zoom and pan | present |  | - | yes |
| Right-click menu, video, preview of a staged file | absent | | M | partial |

### Whole features absent (`watch/*`, `livedoc/*`, `share/*`)

| Feature | What it does on the web | Effort | Engine |
|---|---|---|---|
| Watch together | Floating mini player and theatre mode, host badge, sync lock, seek, speed, party count, marker in the starting message | L | no |
| Live documents | Dock beside the conversation, library, launch dialog, "join" banner | L | no |
| Screen share stage | One feed large plus filmstrip, fit / fill / 1:1, fullscreen, pop out, copy frame, live resolution and latency, drawing on the picture, source and camera choice. Native button says "not in this view yet" | L | no |

Not read in depth by the researcher: the bodies of the watch, share, live-document, attachment-tray and key-trust components, and the Standard components Nebula borrows (inventoried from labels and doc comments). Not settled: whether the native client animates GIFs; whether Nebula renders math.

## 2. Window shell: server rail, connect screen, channel list, voice dock

Whole surfaces are missing: calendar, game overlay, invite links, public server directory, first-run setup, server onboarding, plugin prompts, server branding, device linking, a global search palette. The multi-server rail is much thinner: live sessions only, an always-green pip, no unread badges, hover cards, reordering or quick connect, and leaving is not confirmed. The connection lifecycle is one red line of text where the web has a password dialog with "remember", a reconnect banner with countdown and Retry, and a per-session status card. The channel list lacks most indicators (lock, custom icon, history badge) and all direct manipulation (drag a user, arrange channels). The member panel and friends list are reduced.

Web sources are under `ui/nebula/components/`; `App` is `NebulaClientApp.tsx`.

### Window frame and title bar (`chrome/*`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Frameless window: drag band, double-click maximise, controls, resize edges | present | | - | n/a |
| Brand mark, active server name centred | present | Shows the saved label; web prefers the server's own display name | S | yes |
| Server tab strip in the title bar | absent | | M | yes |
| Quick connect "+" menu (saved logins, last joined, add by address, browse public) | absent | "+" opens the whole connect screen | M | partial |
| Unread count shown to the OS | partial | In the window title; no taskbar badge | S | yes |

### Server rail (`sidebar/ServerRail*.tsx`, `ServerMenu.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Several servers at once, a tile each, ring on the active one | present | | - | yes |
| Saved servers that are not connected also on the rail | present | Live sessions only | - | yes |
| Tile artwork from the server's branding | absent | Initials on a tint | L | no |
| Connection pip: green connected, amber while connecting | present | Always green | - | no |
| Unread badge per server | absent | | S | no |
| Hover card per server (address, latency, where you are, unread, Switch / Connect) | absent | | M | partial |
| Expanded rail with subtitles, search, favourite star | partial | Names only | M | yes |
| Drag to reorder servers | absent | | M | n/a |
| Tile menu: switch, favourite, copy address, edit, disconnect, remove | partial | No 'remove' | S | yes |
| Leave, with confirmation and "don't ask again" | partial | Asked before leaving; no "don't ask again" | S | yes |
| Friends tile with unread badge | partial | Opens a dialog; no badge | S | partial |
| A dropped session keeps its tile and shows a status card | partial | Falls back to the connect screen with a notice | M | no |

### Connect screen and connection lifecycle (`connect/*`, `runtime/*`, `setup/*`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Saved servers grouped by address with online and identity counts | present | | - | yes |
| Search servers | present | Matches the label only, not the host | - | yes |
| "Checking…" while a ping is pending | partial | Shows "offline" until the ping answers | S | no |
| Landing page: banner, name, online / latency / version chips, address | present | | - | yes |
| Server branding on the landing page (banner image, operator name, tags, MOTD) | absent | | L | no |
| "Join as" identity cards, new identity, connect button, auto-connect switch | present | | - | yes |
| Reorder identities | absent | The grip is drawn but does nothing | S | n/a |
| Add / edit dialog: name, address, port, username | present | | - | yes |
| Certificate chooser (any existing certificate, or anonymous) | partial | A checkbox; an existing certificate cannot be picked | S | yes |
| Saved server password | absent | Typed for each connect; the field appears only after a refusal; never stored | M | no |
| "Link from another device" | absent | | M | no |
| Forget a server (all its identities), confirmed | partial | Removes one identity from inside the editor, unconfirmed | S | yes |
| Favourite star on hover | partial | Via right-click and the editor | S | yes |
| Public server directory | absent | | L | no |
| Follow an invite link | absent | | M | no |
| First-run setup wizard (name, theme, default certificate) | absent | First launch is an empty connect screen | M | n/a |
| Server onboarding questionnaire | absent | | M | no |
| Password / one-time code dialog after a refusal, with "remember" | partial | Fields appear inline after any notice; no remember | S | yes |
| "Use a different username" after a refusal | absent | | S | yes |
| Reconnect banner: countdown, attempt number, Retry now, Cancel | present | No pulse on the dot | - | no |
| Session status card (stage, reason, Reconnect, choose another server) | partial | "Connecting…" on the button; reason as a red line | S | partial |

### Channel list (`sidebar/ChannelList.tsx`, `ChannelMenu.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Tree in server order | present | | - | yes |
| Search (`Ctrl+F`), hide empty channels | present | Native also lists matching messages | - | yes |
| Click reads, double-click joins | present | | - | yes |
| Click the occupancy count to join | present |  | - | yes |
| Password prompt appears by itself for a restricted channel | present | A manual menu entry; a plain join fails without explanation | - | no |
| Header "Join voice" also turns voice on | present | Join only moves you | - | yes |
| Unread mark | present | | - | yes |
| Lock icon on restricted channels | present | Every channel shows "#" | - | no |
| Custom channel icon | absent | | M | partial |
| History badge on the row | present | Only words in the header | - | partial |
| Listening mark | present | | - | yes |
| Occupants under the channel with role-coloured names | present | | - | yes |
| Stacked-faces channel style | absent | | S | yes |
| Screen-share LIVE badge on users and rooms | absent | No screen sharing | L | no |
| "Private rooms" section for meeting rooms | absent | | M | no |
| Category channels | absent | | S | no |
| Arrange mode: drag channels among siblings | absent | | M | no |
| Drag a user onto a channel to move them | absent | | M | yes |
| Menu: open, join, listen in | present | | - | yes |
| Menu: invite people | absent | | M | no |
| Menu: mute this channel's notifications | absent | | S | no |
| Channel info, edit, create, move all, purge, delete, permissions | see administration | | | |
| Menu entries gated on your permissions | present | Everything is always offered | - | no |
| `Alt+Up` / `Alt+Down` steps channels; `Ctrl+B` hides the column | present | The steps work; Ctrl+B does not hide the column yet | - | yes |

### Users in the channel list (`primitives/SpeakerBadges.tsx`, `user/UserMenu.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Talking ring, plus talking bars | partial | Ring only | S | yes |
| Separate badges for server-muted, server-deafened, self-muted, self-deafened | present |  | - | no |
| Priority speaker badge | present |  | - | yes |
| "Whisper" / "Shout" badge while someone targets you | absent | | S | no |
| Unread badge on a user | present | | - | yes |
| Hover shows a profile card | present | | - | yes |
| Click on a user | present |  | - | yes |
| Menu: message, information, friend | present | | - | yes |
| Per-user volume slider, remembered | present | A slider on their card; four steps in the menu; forgotten on restart | - | yes |
| "Join their channel" | present |  | - | yes |
| Result toasts ("friend added", "moved X to Y") | partial | Friend added or removed, copied, moved, brought over; not yet for the rest of moderation | S | n/a |

### Voice dock / own tile (`sidebar/VoiceDock.tsx`, `recording/*`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Avatar, name, status line | partial | Says "Voice on / Muted / …"; web shows the joined channel | S | yes |
| Click own avatar for the profile card; right-click for the menu | present |  | - | yes |
| Mic and deafen buttons | present | | - | yes |
| "Microphone in use by <app>" warning | absent | | S | no |
| Screen share, camera | absent | Button says it is not available | L | no |
| Whisper status: denied in a channel, target unresolved | partial | "Whispering to X" only | S | no |
| Dock menu: hide empty channels, settings | present | | - | n/a |
| Record audio dialog: folder, file name template, clock, remembered target | partial | A menu toggle and folder picker | S | partial |

### Member list (`chat/MemberPanel.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Open from the header's people button | present | | - | yes |
| Toggle with `Ctrl+U` | present |  | - | n/a |
| The channel's people first, then everyone on the server by role | present | Only the open channel's occupants | - | yes |
| Search | present | | - | n/a |
| "Show offline" registered members | absent | | M | partial |
| Row: voice badges, talking bars, info button, where they are | partial | Voice marks, the priority bolt and where they are; no talking bars, no info button | S | partial |
| Right-click a member | present |  | - | yes |

### Friends (`sidebar/FriendsPanel.tsx`, `FriendList.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Add / remove a friend from the user menu | present | | - | yes |
| Friends as a column beside the conversation | partial | A modal dialog | M | n/a |
| Grouped by server, with counts and search | absent | Flat list | S | n/a |
| Presence across every open connection | partial | "here now" or "not here", for the active server only | M | no |
| Unread count per friend | absent | | S | partial |
| Chat with an offline friend | absent | | L | no |
| Offer to connect to a friend's server | absent | | M | partial |
| Notepad (yourself as a friend) | absent | | L | no |
| Cached avatar for an absent friend | absent | | S | n/a |

### Search, toasts, tooltips

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Global search palette (`Ctrl+Shift+F`): channels, people, messages, servers; Photos / Links filters; arrow keys | partial | The sidebar field lists channels and messages only | M | partial |
| Tooltips on icon buttons and badges | partial | On every icon button; not yet on badges | M | n/a |
| Toasts for results and refusals | partial | Results are toasts at the foot of the window; refusals are still one red notice strip | S | yes |
| External link warning with "trust host" | present |  | - | n/a |

### Welcome and server information (`welcome/*`, `server/ServerInfoPanel.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Welcome message after joining, with a hide / once / always preference | partial | A card every connection until dismissed | S | yes |
| Rich welcome markup: pictures, backdrops, live "online now" faces | absent | Drawn as ordinary message HTML | M | no |
| Server info panel: banner, connection and server cards, plugins, activity log | partial | A name / value list plus the welcome text | M | partial |

### Calendar and game overlay (`calendar/*`, `overlay/*`)

| Feature | What it does on the web | Effort | Engine |
|---|---|---|---|
| Calendar | Day / week / month views, create and edit meetings (invitees, repeat, reminder, time zone), respond, join, drag to move, reminders as toasts and OS notifications | L | no |
| Game overlay | A window over a detected game with the channel roster, talking state and last message; a per-program prompt | L | no |

Skimmed rather than read in full by the researcher: the server rail, connect screen, member panel and user menu components; calendar, overlay, invites, setup and onboarding were read by delegation.

## 3. Settings

The native settings page has 5 sections (Appearance, Voice, Privacy, Channels, Certificates) against the web UI's 13 pages plus a settings search. Eight web pages have no native counterpart: Profile editor, Account, Notifications, Language & format, Shortcuts, Overlay, Plugins, Advanced. A ninth, "Channels & roles", is something else on the web (the native "Channels" section is one unrelated switch). Appearance is theme plus light/dark only. Voice covers the basics, but the engine's `VoiceSettings` carries 8 fields, so the voice gate, denoiser choice, max gain, packet size and audio statistics are missing in view and engine trait alike. Nothing is rebindable and no key is global.

One finding here is a bug rather than a gap: "Change comment…" sends raw text as the whole comment, which replaces any Fancy profile header (pronouns, banner, name style) set from the web client.

Web sources are under `ui/nebula/components/settings/`.

### Settings shell (`SettingsNav.tsx`, `SettingsSearch.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Full-screen page with section nav | partial | 5 sections against 13 pages | - | n/a |
| Search settings by name | absent | | S-M | n/a |
| Pages shown only when the server supports them | absent | The gated pages do not exist | - | no |
| Expert / developer mode gating of options | absent | No user-mode concept | S | n/a |

### Profile (`ProfileSettings.tsx`, `ProfilePreview.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Identity picker (whose profile is edited) | absent | No per-identity profile storage | M | n/a |
| Display name | absent | Username exists only per saved server | S | n/a |
| Pronouns, contact, status | absent | Read-only on other people's cards | M once (needs a profile writer), then S each | yes (`SetComment`) |
| Bio with bold, italic, underline, strike, colour, image | partial | A plain-text prompt; the profile a comment carries is now kept | M | yes |
| Avatar: pick, crop, remove | partial | No crop (auto-scaled); lives in the own-tile menu | S-M | yes |
| Avatar / banner from a GIF picker | absent | No GIF search | L | no |
| Banner: image (cropped), colour, clear | partial | Image from a file, cut to the banner's shape, and clear; no colour, no crop by hand | M | yes |
| Card colours (up to 5), frosted glass, custom background | absent | Not editable and not drawn either | M | yes |
| Avatar frame (presets, custom) | absent | Not editable, not drawn | M | yes |
| Sticker (presets, own image) | absent | Not editable, not drawn | M | yes |
| Nameplate (presets) | absent | Not editable, not drawn | S-M | yes |
| Name style: font, bold, italic, gradient, glow, colour | absent | Card reads only colour, first gradient colour, bold, italic | M | yes |
| Profile effect (presets) | absent | Not editable, not drawn | M | yes |
| "What the card shows": 9 switches | absent | | S | yes |
| Live preview card | absent | | M | n/a |
| Debounced save with "too large / denied" banner | partial | Sent at once; refusal is a generic notice | S | yes |

### Account (`AccountSettings.tsx`, `AccountDevices.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Overview (name, id, sign-in method, 2FA state) | absent | No account page | L (page) | no |
| Password sign-in: enable, change, disable | absent | | M | no |
| Rename own account | absent | | S | no |
| Contact email | absent | | S | no |
| Two-factor: enrol (QR, secret), verify, disable | absent | A code can only be typed when connecting | L | no |
| Devices: list, rename, sign out | absent | | M | no |
| Link a new device (QR, code, link) | absent | | L | no |
| Delete registration | absent | | S | no |
| Register on this server | present | In the own-tile menu | - | yes |

### Voice (`VoiceSettings.tsx`, `VoiceGate.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Turn voice on / off | present | Off from the own-tile menu | - | no |
| Input and output device | present | | - | yes |
| Mic and speaker volume sliders, 0-200 % in 1 % steps | present | Buttons in 10 % steps | - | yes |
| Exclusive microphone mode (Windows) | absent | | S | no |
| Activation: voice activity / continuous / push to talk | partial | Only a push-to-talk switch; no continuous | S | yes |
| Push-to-talk key | partial | One unmodified key; from other programs too on Windows once switched on | M | yes |
| Voice gate: automatic calibration (speak 5 s) or manual | absent | | L | no |
| Manual gate: live level meter with open and close markers | partial | "Activation level" as a percentage with buttons; no meter, no close threshold | L | no |
| Gate hold time | absent | | S | no |
| Test microphone (live level, "transmitting") | absent | | M | no |
| Hear yourself (record and replay) | absent | | M | no |
| Auto gain | present | | - | yes |
| Max amplification | absent | | S | no |
| Noise suppression algorithm (Off / RNNoise / DeepFilterNet / OMLSA / Spectral) | partial | On/off only | M | no |
| Denoiser fine tuning | absent | | M | no |
| Bitrate 8-320 kbit/s | present | Seven steps, 16-128 kbit/s | - | yes |
| Audio per packet 10 / 20 / 40 / 60 ms | absent | | S | no |
| Force TCP audio | present | | - | yes |
| Legacy audio backend | absent | | S | no |
| Audio statistics (good / late / lost / resync) | absent | | M | no |
| Settings remembered | present | | - | yes |

### Appearance ("Personalize": `PersonalizeSettings.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| 13 themes | present | List rows with swatches instead of preview cards | - | n/a |
| Theme skin fidelity | partial | Blur, clip paths, patterned layers left out by design; letter tracking, stencil chrome, selection glow and glass not read | L | n/a |
| System / Light / Dark | present | No "follow system" | - | n/a |
| Message style: bubbles / flat / compact | absent | One bubble style | M | n/a |
| Text size: small / medium / large, custom 10-24 px | partial | The three sizes; no custom size | M | n/a |
| Compact mode | absent | | M | n/a |
| Always show message actions | absent | | S | n/a |
| Chat background: image or video, recent wallpapers | partial | Image only; no recents | L | n/a |
| Chat background focus point, blur, opacity, dim | partial | Blur and wash; no focus point, no separate opacity | M | n/a |
| Server list placement: rail / title bar / both | absent | Rail only | M | n/a |
| Channel viewer: flat / modern | absent | One layout | M | n/a |
| Server livery (server-supplied colours) | absent | Server branding never recolours the theme | L | no |
| Theme and mode remembered | present | | - | n/a |

### Notifications (`NotificationsSettings.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Notification sounds | present | A page of its own; off until turned on, as in the web client | M | no |
| Desktop notifications | partial | On Linux, Windows and macOS; no switch | S-M | partial |
| Welcome message: hide / once / always | partial | Shown on every connection until dismissed | S | n/a |
| Per-event switches (chat, DM, mention, join, leave, channel join/leave, stream start, voice activity, self muted) | absent | | M | no |
| Per-event sound choice, preview, volume | present |  | - | no |

### Privacy (`PrivacySettings.tsx`, `NotepadSettings.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Read receipts off | present | | - | yes |
| Typing indicators off | present |  | - | yes |
| Link previews off | present | | - | yes |
| Dual-path delivery | absent | | S | no |
| Maps (OpenStreetMap / geolocation off) | absent | The native client may have no maps at all (not checked) | S | n/a |
| External embeds (YouTube, watch together) | absent | | M-L | no |
| Streamer mode | absent | | M | n/a |
| Rich presence (Discord), with artwork | absent | | L | no |
| Notepad: location, encryption, migrate or delete notes | absent | No notepad | L | no |

### Language & format (`LocalizationSettings.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Language (English, Deutsch, Français, 中文) | absent | Every string is hard-coded English | L | n/a |
| Time display: auto / 12 h / 24 h | partial | Auto reads as 24-hour | S | n/a |
| Convert to local time | partial | Always local | S | n/a |
| Date display: auto / DMY / MDY / YMD | absent | | S | n/a |
| Number format | absent | | S | n/a |

### Shortcuts (`ShortcutsSettings.tsx`, `WhisperTargetsSection.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Shortcut recorder (rebind any action) | absent | Thirteen fixed bindings | M | n/a |
| Global push to talk | partial | On Windows, behind a switch on the Voice page: the talk key, the whisper key, mute and deafen are bound with the system. One unmodified key for talking; nothing on Linux yet | M | yes |
| Global toggle mute, toggle deafen | partial | In the window: Ctrl+Shift+M and Ctrl+Shift+D. Not system-wide | S in-window, M global | yes |
| Global voice priority (hold) | absent | | M | no |
| Toggle activation mode | absent | | S | yes |
| Move a channel up / down, jump to root | present |  | - | yes |
| Toggle channel sidebar, toggle member panel | absent | | S | n/a |
| Quick search (`Ctrl+F`) | present | Not rebindable | - | n/a |
| Quick switcher (`Ctrl+Shift+F`) | absent | | M | n/a |
| Open settings (`Ctrl+,`), fullscreen (`F11`) | present |  | - | n/a |
| Whisper and shout targets: several named targets, each with a hotkey | partial | One key and one target, not remembered | M-L | no |
| Whisper to several users, kept by certificate | partial | One user, by session | M | no |
| Whisper to a channel: current channel, linked, sub-channels, a group | partial | Fixed channel only | M | no |
| Jump-to-user hotkeys | absent | | M | n/a |
| List of built-in chat keys | absent | Only in the README | S | n/a |

### Overlay (`OverlaySettings.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Game overlay: when to show, corner, last message, hide from capture, diagnostics, per-game rules | absent | No overlay | L | no |

### Identities (native "Certificates": `IdentitiesSettings.tsx`, `RecoveryPhraseSection.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| List, export, import, delete | present | Export file name differs (`.fancy-identity.json` against `.fmid`); interchange not checked | - | yes |
| "Connected" badge on the identity in use | different | Shows "used by N saved identities" | S | yes |
| Create a new identity by name | absent | A certificate is only made on first connect | S | no (API has it) |
| Recovery phrase: show 24 words, restore from them | absent | | M | no |

### Channels & roles (`ChannelsRolesSettings.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Your visible channels and roles | absent | | M | no |
| Change onboarding answers / start over | absent | | L | no |
| Hide channels nobody is in | present | In Settings > Channels and the channel menu | - | n/a |

### Plugins (`PluginsSettings.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Signal bridge: status, version, install | partial | The view only knows whether it is available | M | partial |
| Server plugin list, trust (once / this server / always), plugin settings panels | absent | | L | no |

### Advanced (`AdvancedSettings.tsx`)

| Option | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Expert mode, developer mode | absent | | S | n/a |
| Klipy API key (GIF search) | absent | No GIF search | with GIFs | no |
| Stream viewer backend | absent | No screen-share viewing | - | no |
| Log level, log to file, compress, terminal logging, open or export logs | partial | A file a day at info, and a button to open its folder; no level or switches in the window | S each | no |
| Auto reconnect switch | present | Always retries; cannot be turned off | - | n/a |
| Auto-update, beta updates | absent | No updater | L | no |
| Persist DM history | absent | | M | no |
| Disconnect confirmation | present | Asked on the rail's leave button; no switch to turn the asking off | - | n/a |
| Reset all app data | absent | | S-M | no |

Asked about but not offered by the web UI either: echo cancellation, proxy, QoS, text-to-speech, sound packs, an accent-colour picker, UI zoom, an About page, a "check for updates" button, cache clearing.

"Engine: no" rests on a name search of `engine_api.rs`, not a full read, so some of those could exist under an unexpected name.

## 4. Server administration

The web UI has 14 administration pages in one area, shown only where the server grants them. The native client has thin versions of three (registered users, bans, channel permissions) and nothing for the other eleven: roles, emotes, onboarding, server plugins, marketplace, file server, server settings, livery, welcome message, audit log, invites. None of those eleven has a call in `src/engine.rs` or in `engine_api.rs`, so each needs engine plumbing as well as a screen. The native client also has no notion of the user's own permissions: every admin and moderation entry is offered to everyone and left for the server to refuse. Live user moderation and message moderation are close to parity.

Web sources are under `ui/nebula/components/admin/` unless a row says otherwise.

### Entry, layout, gating (`AdminScreen.tsx`, `capabilities.ts`)

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| One admin area with 14 pages | absent | Two lists behind a right click on the server tile, ACL behind the channel menu, each a modal dialog | M | n/a |
| Pages and menu entries shown only when the server grants them | present | Bans, Registered users, Permissions and every moderation entry are offered to every user; refusal arrives as a notice | - | no |
| Deep links between pages (role chip to Roles, channel menu to that channel's ACL, marketplace links) | partial | Only channel menu to that channel's ACL | S | n/a |

### Registered users (`UsersAdmin.tsx`)

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| List with search | present | No explicit refresh | S | yes |
| Sortable columns: name, last seen (relative), last channel | present | No sorting; last seen is the server's raw string | - | yes |
| Rename an account | present | Prompt instead of inline edit | - | yes |
| Unregister, with confirmation | present | Click twice instead of a dialog | - | yes |
| Roles column with role chips | absent | List shows no roles | S | partial (no role icon) |
| "Manage roles" dialog per account | absent | Nothing assigns roles from the user list | M | yes |
| Online accounts highlighted | present |  | - | yes |

### Roles (`RolesAdmin.tsx`, `role/*`)

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Roles page: list with chip, member count, style; search | absent | Roles are only read, to group the member panel and colour names | M | partial |
| Create and delete a role | absent | | M | no |
| Role display: rename, colour, icon, style preset, metadata, live preview | absent | The native `AclGroup` carries only name and members | L | no (API has the fields) |
| Role permissions: one switch per permission | partial | Only as a hand-made group rule in the root channel's ACL panel | M | yes |
| Role members: any registered account (offline too), exclusions, inherit flags | partial | Only among connected registered users; no exclusions, no flags | M | partial |

### Ban list (`BansAdmin.tsx`)

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| View bans | present | Native also shows duration and start, and has a filter | - | yes |
| Remove a ban | present | Sent at once rather than staged | - | yes |
| Add a ban by hand | present |  | - | yes |
| Edit an entry (name, address, mask, reason, certificate hash, start, duration) | partial | Everything but when it started, which is shown and kept; the address and its bits are one field (203.0.113.0/24), how long is written 30m, 12h, 7d | M | yes |
| Refresh, staged save | absent | | S | yes |

### Channel permissions and groups (`AclAdmin.tsx`)

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Three-column page: channel tree with search, the channel's ACL, filters | absent | One channel at a time from its menu | M | yes |
| "Inherit from parent" toggle | present | | - | yes |
| Rules: list, add, remove, applies here / in sub-channels | partial | Add is group-only, by typed name | S | yes |
| Rule for one registered user | partial | For whoever is here and registered, and for the first forty of the server's accounts by name; no search among more | S | yes |
| Allow/Deny grid over 26 permissions | present | 17 of 26: missing Delete Message, Subscribe Push, Share Files, Share Files (Public), Key Owner, Manage Emotes, List Registered Users, See Hidden Channel, Send Voice Message | - | yes |
| Groups: add, rename, remove; inherit flags; members to add and exclude; inherited members | partial | Only member toggling among connected registered users | M | no for rename/remove/flags |
| "Who can actually enter" derived from the rules | absent | | M | yes (derivable) |
| Member names resolved from the registered list | present | Offline members show as "account N" | - | yes |

### Channel management (`ChannelEditorDialog.tsx`, `chat/ChannelInfoSheet.tsx`, `sidebar/*`)

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Create channel: one form with all options | present | No expiry, invitees or custom icon | - | partial |
| Edit name, description | present | Separate prompts; description is plain text | - | yes |
| Channel password | present | | - | yes |
| Position, and drag-to-arrange among siblings | partial | A place can be given when the channel is made; not changed later, not dragged | M | no |
| Max users | partial | Given when the channel is made; not changed later | S | no |
| Hidden channel, invitees on create | partial | Hidden can be chosen when the channel is made; nobody can be invited | M | no |
| Temporary channel | present | | - | yes |
| Persistence on create (none / archive / server / Signal) | present | | - | yes |
| Change persistence later; max history; retention days | absent | | M | no |
| Channel expiry (absolute / sliding) | absent | | M | no |
| Delete with confirmation | present | | - | yes |
| Move everyone to a searched destination | present | Only "move everyone with me here" | - | yes |
| Purge stored history | present | | - | yes |
| Channel icon and banner | absent | | M | no |
| Reset key ownership of an encrypted channel | absent | | M | no |
| Channel info sheet (id, parent, limits, keys, activity, permissions) | partial | Kind, parent, people and limit, what is kept, id; no keys, activity or list of permissions | M | no |
| Category / structural channels | unverified | Not settled how the native client draws them | ? | unknown |

### Live user moderation (`user/UserMenu.tsx`)

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Kick, ban | present | Native asks for a reason | - | yes |
| Server mute / deafen, priority speaker | present | | - | yes |
| Move a user to any channel, with a picker | present | Only "move to my channel" | - | yes |
| Register a user; register oneself | present | | - | yes |
| Deregister a connected user from their menu | present | Only from the registered list | - | yes |
| Reset comment, remove avatar | present | | - | yes |
| Delete one user's messages in the channel | present | | - | yes |

### Message moderation

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Delete somebody else's message from its menu | present | Only through "Select…" then Delete | - | yes |
| Select several and delete | present | | - | yes |
| Pin / unpin, view pinned | present | A "pinned only" filter rather than a panel | - | yes |

### Absent pages (each needs engine work too)

| Page | What it does on the web | Effort |
|---|---|---|
| Server settings (`ServerSettingsAdmin.tsx`) | Schema-driven runtime settings form (text, HTML, bool, int, enum, country, secret); welcome text in rich / source / preview modes | L |
| Welcome message editor (`WelcomeAdmin.tsx`, `welcome/*`, `nodes/*`) | Node-graph editor of conditions and greetings, templates, annotations, undo; body as plain / rich / HTML / "Screen"; a design editor with artboard, layers and per-client overrides; preview and reachability check | L |
| Onboarding questionnaire (`OnboardingAdmin.tsx`, `onboarding/*`) | Steps, questions and answers mapped to channels and groups, templates, canvas view, member preview. The member side (answering it on joining, reviewing answers later) is absent too | L |
| Livery / server branding (`LiveryAdmin.tsx`) | Display name, tagline, MOTD, tags; banner and icon upload; accent / surface / aura colours for light and dark; live preview | L |
| Custom emotes (`EmotesAdmin.tsx`) | Add (shortcode, alias, image), list, delete | M |
| Invites (`InvitesAdmin.tsx`, `invites/InviteDialog.tsx`) | List and revoke open invites; mint one from a channel's menu with lifetime and use limit | M |
| File server (`FileServerAdmin.tsx`) | Storage dashboard with health and charts; files table with search, sort, preview, bulk delete; live documents and calendars tables | L |
| Server plugins (`ServerPluginsAdmin.tsx`) | Installed plugins with state, enable / disable, reload, uninstall | M |
| Marketplace (`MarketplaceAdmin.tsx`, `MarketplacePluginPage.tsx`) | Searchable index, install pinned to a hash, listing page with screenshots, reviews, versions | L |
| Audit log (`AuditAdmin.tsx`) | Query bar with autocomplete and SQL mode, dashboard charts, sortable results with live tail and detail panel, logging configuration | L |

Looked for and found on neither side: webhooks, backups, cluster or federation views, a server statistics page, channel links, reparenting a channel, timed bans from the user menu.

Not read in depth by the researcher: the bodies of the welcome design editor, node canvas, audit, file server, livery and marketplace components (inventoried from their headers, labels and backend calls).

## 5. Profile cards, people, voice and media

The native profile card is a different and much smaller thing than the web one: a left-aligned head (84 px flat banner, 56 px avatar, name, one line of text) inside a generic 460 px dialog with a "Close" button. The web card is a 310 px centred card that paints itself from the profile: 150 px banner, presence pill, ringed avatar with a pip, badges, roles, activity, stats, a volume slider, a message field and a local-mute button. `src/profile.rs` reads 8 of the profile's roughly 20 fields, so card colours, glass, custom background, avatar frame, sticker, nameplate, name gradient, glow and font, and the owner's section switches are all ignored.

Two things to know before the tables:
- **Nebula shows the full card on hover**, with the pointer unable to reach it. It does not use the shared card's small three-line hover variant. The native hover card's three-line glimpse therefore matches a variant Nebula never shows.
- **Likely native bug:** "Unmute for everyone" is offered whenever a user's `muted` flag is set, but the engine sets that flag for self-mute, server mute and suppression alike, so a self-muted user gets "Unmute for everyone".

Voice basics are there (mute, deafen, push to talk, one whisper target, listening, devices, recording). The calibration and metering side, global hotkeys, several whisper targets, marks for incoming whispers, and "turn voice off" are missing. Screen sharing, camera, watch-together, rich presence, game overlay and notification sounds are absent entirely, and none has an engine surface yet.

Web sources: `ui/src/shared/profilecard/` and `ui/nebula/components/user/` for the card; `ui/nebula/components/` for the rest.

### Profile card: shell, opening, placement

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| One card for hover and click | present |  | - | yes |
| Card geometry: 310 px, radius 22, own surface and shadow, centred content | present |  | - | yes |
| Hover after 350 ms, cleared on leave | present | | - | yes |
| Hover from tree rows, member panel, message authors | partial | Not from message authors | S | yes |
| A click on a person pins their card | present |  | - | yes |
| Your own card (click own avatar) | present |  | - | yes |
| Placement beside the row, flipping to the roomier side | partial | Beside the pointer that asked, on the side with room; not measured against the row | M | yes |
| Pinned card closes on the next click outside, and that click still lands | present |  | - | yes |
| Round close button on the banner | present |  | - | yes |
| Card stays live (presence, talking, mute) while open | present |  | - | yes |

### Profile card: banner and avatar

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Banner 150 px, inset in the card | present |  | - | yes |
| Banner colour, including a gradient | present | A gradient is drawn from its first colour to its last | - | yes |
| Banner image | present | | - | yes |
| Fallback banner: gradient hashed from the person | partial | The same hue, as a rake of two of its three colours | S | yes |
| Banner scrim (gloss, fade under a photo) | absent | | S | yes |
| Presence pill on the banner ("In #channel") | present |  | - | yes |
| Avatar 76 px, centred, overlapping the banner | present |  | - | yes |
| Avatar ring from the profile: 10 presets with glow, custom, accent gradient | absent | Not read | M | yes |
| Presence pip on the avatar | present |  | - | yes |
| Initials filled with the person's tint | present |  | - | yes |
| Sticker over the corner (presets or own image) | absent | | M | yes |

### Profile card: name and identity

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Name colour, nudged until readable on the card | present | Held to a contrast of 3 by WCAG's measure; the web measures with APCA | - | yes |
| Name gradient | partial | First stop only | M | yes |
| Name weight | present | A profile with no `bold` key draws medium; web draws bold | - | yes |
| Name italic | present | | - | yes |
| Name font (serif, mono, cursive, fantasy) | present | Not read | - | yes |
| Name glow | absent | Not read | M | yes |
| Nameplate pill behind the name | absent | | S | yes |
| Verified tick for a registered account | present |  | - | yes |
| Identity line "pronouns · contact" | present |  | - | yes |
| Status as its own rich line | present | Its own italic line; a plain string, so markup in it would show as tags | - | yes |
| Owner's section switches hide rows | present | Not read; hidden rows would show | - | yes |

### Profile card: badges, roles, activity, stats

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Badge strip (up to 4, "+N") | absent | | M | partial |
| Badges granted by server groups | absent | | M | no |
| Live badges: priority, muted, deafened | present |  | - | yes |
| Role chips for every group the account is in | present |  | - | yes |
| Activity row: "In voice · #channel", time online, talking state | present | Time online once the server has said it | - | partial |
| Activity on your own card: detected game with artwork | absent | | L | no |
| Stats row: messages, time in voice, account | present | Messages are those loaded in the open conversation | - | partial |

### Profile card: bio

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Tags, text colours, links | present | Native reads more tags; only the 16 named colours plus hex and rgb | - | yes |
| Images in the flow of the text | partial | Drawn after all the text | M | yes |
| 12 px, muted ink, paragraph spacing | partial | 12 px in muted ink; paragraphs are single breaks | S | yes |
| Bio capped at 208 px, scrolling inside itself | present |  | - | yes |
| Fade at an edge with more text | absent | Hard cut | M | yes |
| Hover shows the full bio | present | As much as fits its 208 px, since the pointer cannot scroll it | - | yes |

### Profile card: foot and paint

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Volume slider 0-200 % on the card, kept per certificate | partial | On the card and live while dragged; forgotten on reconnect | M (needs a slider) | yes |
| "Message @name" field on the card | present |  | - | yes |
| Local-mute button beside it | present |  | - | yes |
| Card colours: 1-5 colours as a gradient surface with tinted border and glow | absent | Not read | M | yes |
| Frosted glass card | absent | | M | yes |
| Custom background | absent | | L | yes |
| Whole text ramp derived from the card surface, contrast-corrected | absent | Theme inks always | M | yes |

### User menu (`user/UserMenu.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Same menu from tree, roster, message authors, own avatar | present |  | - | yes |
| Volume slider | present | On the card; the menu keeps its four steps | - | yes |
| Message, add / remove friend | present | No confirmation toast | S | yes |
| User information | partial | The sheet of what the server knows, with 7 facts; not offered on yourself | M | partial |
| Join their channel | present |  | - | yes |
| Moderation shown only where granted | absent | Every verb always shown | M | no |
| Mute / deafen on the server | present |  | - | no |
| Priority speaker, reset comment, remove avatar, delete their messages, kick, ban | present | | - | yes |
| Move to channel with a searchable picker; drag onto a channel | partial | The picker; no dragging somebody onto a channel | M | yes |
| Register, deregister, with confirmation | present | No confirmation; shown even for registered users; no deregister here | - | yes |

### User information sheet (`user/UserInfoSheet.tsx`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| A dedicated sheet, also for yourself | partial | Facts folded into the profile dialog | M | yes |
| Facts: session id, channel, registered, joined, idle, client, OS | partial | Lacks session id, channel, registered | S | yes |
| Certificate strength, Opus support | absent | | S | no |
| Admin network card: address, reverse DNS, location and map, groups | partial | A plain address | L / S | partial |
| Live connection quality: round-trip chart, bandwidth and packet-loss bars | absent | Two ping numbers, fetched once | L | no |
| Packet tables, codec | absent | | M | no |
| Moderation card with prior bans | partial | Buttons live in the right-click menu; no prior-bans lookup | M | yes |

### Voice: live controls

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Mic and deafen buttons | present | | - | yes |
| Turn voice off again | present | From the own-tile menu | - | no |
| Listen to a channel without joining | present | | - | yes |
| Push to talk | partial | One unmodified key; only while the window has focus | M | yes |
| Shortcuts: mute, deafen, voice priority, activation mode | partial | Mute and deafen have keys in the window; no voice priority key, no activation mode key | M | partial |
| Whisper / shout: any number of named targets with their own keys; several users; current channel, linked, sub-channels, a group | partial | One target, one key | M | no |
| Marks for somebody whispering or shouting to you | absent | | M | no |
| Voice settings (devices, gate, meter, denoiser, bitrate, statistics) | see settings | | | |

### Whole media features absent

| Feature | What it does on the web | Effort | Engine |
|---|---|---|---|
| Screen sharing and camera | Source picker with live thumbnails, quality and frame rate, stream audio, stage with filmstrip, fit modes, fullscreen, pop out, copy frame, drawing on the stream, statistics panel, LIVE badges | L | no |
| Watch together | Start from a message or link card; floating dock and theatre mode; host transport; guest sync lock; speed and volume | L | no |
| Rich presence / now playing | Detected app with artwork on your card and in a panel; privacy switches | L | no |
| Game overlay | See the shell section | L | no |
| Notification sounds | See the settings section | M | no |

### Recording (`recording/*`)

| Feature | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Start and stop | present | | - | yes |
| Dialog: remembered folder, file name template | partial | A folder picker every time; fixed file name | M | partial |
| Running indicator: red dot, clock, path | partial | A "Recording" status line and one notice | S | no |

Read by the researcher's own helpers and not re-verified by it line by line: screen sharing, watch-together, recording, presence, overlay, sounds, the user information sheet. Nothing was run.

## 6. What sits underneath and around the window

The native client has almost none of the application shell around its one window: no tray, no deep-link handler, no single-instance forwarding, no updater, no global hotkeys, no memory of where the window was, no second window of any kind, no log output, and system notifications on Linux only. It is not translated: every string is an English literal, where the web UI ships four languages. It has no tooltips, no animations, no keyboard focus traversal and no screen-reader tree.

The engine surface is the structural gap. The web UI reaches 319 Tauri commands; `engine_api.rs` exposes about 110 calls and the native `Engine` trait about 54 methods. Whole families are implemented in the engine's state but not exposed to the native client: plugins, livery, invites, onboarding, audit, server settings, account and device linking, emotes, GIFs, voice messages, forums, the file library, message offload, Discord presence. In the Engine column below, "state has it" means exposing it is a thin layer; "Tauri-only" means the code sits behind the Tauri feature and the native build does not compile it.

Roughly at parity: the theme catalogue, lazy history paging, list virtualisation, several servers at once, auto-connect at launch, reconnect with backoff, safe HTML rendering.

Web and Tauri sources are under `src/ui/tauri/src/` (Tauri side) and `src/ui/tauri/ui/src/` (web side).

### App shell and OS integration

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| System tray with Mute / Deafen / Disconnect / Show / Quit, green dot while talking | absent | No tray | M | yes for the actions; needs a tray crate |
| Deep links (`fancy://invite/…`, marketplace, meeting, device link) | absent | No scheme registration, parsing or routing | M | Tauri-only |
| Single instance: a second launch forwards its link to the running app | absent | Two instances would share one data directory | S-M | Tauri-only |
| Linux desktop entry with quick actions | absent | Only the app id is set | S | Tauri-only |
| Auto-update (startup check, updater window, skip version, beta channel) | absent | No update mechanism | L | Tauri-only |
| Auto-connect at launch | present | | - | yes |
| Data directory | partial | Its own directory still; the web client's saved servers and certificates are offered once to be brought over. Friends, settings and saved passwords are not | M (import) | n/a |
| Switch between full and minimal client | absent | The web client's switch launches the Qt client, not this one; no way back from here | S-M | Tauri-only |
| App icon redrawn in the theme's accent | partial | Static icon | S | n/a |
| Discord Rich Presence | absent | | M | state has it |
| Clean shutdown flush | present | | - | yes |

### Windows and layout

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Window size, position and maximised state restored | present |  | - | n/a |
| Frameless window with own title band, drag, controls, edge resize | present | | - | n/a |
| Pop-out windows: picture, stream, direct message | absent | Exactly one window | M each | n/a |
| Mini mode: window shrinks to a compact call card | absent | | M | yes |
| Game overlay | absent | | L | Tauri-only |
| Drawing overlay on a shared screen | absent | Depends on screen sharing | L | Tauri-only |
| Fullscreen (`F11`) | present |  | - | n/a |
| Collapsible channel sidebar and member panel | absent | Fixed column; members are a dialog | S-M | n/a |
| Server switcher as title-bar tabs, draggable order, quick-connect by last joined | partial | Rail only | M | yes |

### Notifications, sounds, attention

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| OS notification for messages while unfocused | partial | Sent on Windows and macOS too now (written, not yet seen arriving); filed under the system's fallback name until an installer registers the app's own; a click does not open the conversation | S-M | yes |
| Master switch; per-channel silence | absent | | S-M | no |
| Notification sounds (10 events, 7 sounds, per-event volume) | present | Nine of the ten happenings: a stream starting has nothing to raise it yet. Not heard playing yet | - | no (needs a playback path) |
| Taskbar unread badge | partial | The count goes in the window title | S-M | yes |
| Taskbar flash / request attention | absent | The engine emits the event; the adapter drops it | S | yes |
| Calendar reminders | absent | No calendar | L | no |

### Hotkeys

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Global push-to-talk, mute, deafen, priority key | absent | Keys work only while the window has focus; one bare key each | M-L (hard on Wayland) | yes except priority |
| Rebindable in-app shortcuts (16 actions) | partial | Thirteen fixed bindings, the web UI's defaults; none rebindable | M | n/a |
| Per-friend "jump to direct message" hotkeys | absent | | M | no |

### Languages and formats

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Translated UI: English, German, French, Chinese | absent | Every string is an English literal in Rust | L | n/a |
| User-authored languages and translation editor | absent | | L | n/a |
| Time, date and number formats | partial | Local time, fixed 24 h, English day and month names | S | n/a |
| Input methods and dead keys | present | | - | n/a |

### Accessibility, motion, pointer

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Tab through buttons, rows, dialogs; visible focus rings | absent | Only text fields hold focus; everything else is pointer-only | L | n/a |
| Arrow keys and Enter inside menus, pickers, lists | absent | Menus take clicks only | M | n/a |
| Screen-reader support | absent | GPUI 0.2.2 has no accessibility tree to fill | L (blocked on the toolkit) | n/a |
| Tooltips on icon-only controls | partial | On every icon button; not yet on badges, tiles or the rail's server tiles | S-M | n/a |
| Animations and transitions | absent | State changes snap | M | n/a |
| Hover feedback, pointer cursors, hover card after a rest | present | | - | n/a |

### Theming extras

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| 13 themes from one catalogue | present | | - | n/a |
| Follow the system's light / dark setting | present |  | - | n/a |
| Glass: blur behind header, composer, floating surfaces | partial | Left out on purpose; only the lightbox blurs, on Windows | M | n/a |
| Clip paths (notched panels) | absent | Left out on purpose | M | n/a |
| Patterned layers (scanlines, dots) | absent | Dropped | S-M | n/a |
| Chat wallpaper | absent | | M-L | Tauri-only |
| Server livery: banner, icon, palette, tags, greeting, shown before connecting | absent | Servers are drawn with a hashed tint | L | state has it |

### Links, markup, emoji

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Safe rendering of untrusted HTML | present | | - | n/a |
| External-link warning with a trusted-hosts list | present | A scheme allow-list only; links open at once | - | n/a |
| Open in a private window | absent | | S | Tauri-only |
| Code highlighting, spoilers, maths, tables | absent | | M | n/a |
| Full emoji picker with search | partial | About 80 fixed emoji | M | n/a |
| Custom server emotes | absent | | M | state has it |
| GIF search | absent | | M | state has it |
| Link preview cards | present | Reduced; see the chat section | - | yes |

### Server plugins that draw UI

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Slash commands with typed options and autocomplete | absent | | L | state has it |
| Plugin component trees in messages (buttons, selects, galleries) and their interactions | absent | Plugin messages are not drawn | L | no |
| Plugin modals | absent | | M-L | no |
| Plugin trust prompt and records | absent | | M | no |
| Plugin settings panels | absent | | M | no |
| Polls | present | Only for the session; not restored from history | - | yes |
| Plugin-backed features: live documents, calendar and meetings, file library, friends rooms, notepad | absent | | L each | no |

### Connection, servers, accounts

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Auto-reconnect after a lost connection | present | Retries for as long as the server is wanted, as the web does; no switch to turn it off | - | yes |
| Disconnected-session surface saying what happened | partial | Falls back to the connect screen with a notice line | S | yes |
| Voice restored after reconnect | unverified (likely absent) | | S | yes |
| Password and one-time code mid-connect | partial | Asked for; nothing is remembered; no rename-and-retry | S-M | yes |
| Several servers at once; several identities per server | present | | - | yes |
| Public server directory | absent | Saved servers only | M | Tauri-only |
| Invite links | absent | | M | state has it |
| First-run setup, onboarding forms | partial | A welcome banner only | M | partial |
| Account self-service, device linking, recovery phrase | absent | Certificate export and import by file only | L | state has it |
| Encrypted-channel key custody (custodians, takeover, verification) | partial | Only "share the key with a newcomer, or not" | M | partial |
| Signal bridge install | partial | Used if the library is beside the executable; no installer | S-M | partial |
| Friends across servers | partial | Shown only on the server on screen | M | no |
| Streamer mode | absent | | S | n/a |

### Stored data and sync

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Settings store | partial | 11 fields against about 50 preferences | grows with features | n/a |
| Saved servers | present | No saved passwords | - | n/a |
| Per-user volume remembered | present | In memory; lost on restart or reconnect | - | yes |
| Local direct-message history, notes | absent | | M | no |
| Preferences and server list synced between an account's devices | absent | | M | state has it |
| Factory reset | absent | | S | Tauri-only |

### Performance

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Only on-screen rows are built | present | Ahead of the web here | - | yes |
| History paged on demand; bursts of events coalesced | present | | - | yes |
| Heavy message bodies offloaded to disk | absent | Bodies stay in memory | M | state has it |
| Avatars fetched lazily and bounded | partial | Fetched for every user; no bound | S-M | yes |
| Disk cache directory | absent | Engine started with no cache directory | S | yes |

### Diagnostics

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Log level, file logging with rotation, open or export logs | partial | A file of the day under `logs`, level by `FANCY_GPUI_LOG`, a button that opens the folder; no switches in the window | S-M | Tauri-only |
| Voice and end-to-end statistics panels | absent | Only per-user connection facts | M | partial |

### Other engine families

| Capability | Native | Missing or different | Effort | Engine |
|---|---|---|---|---|
| Global search palette (people, servers, photos, links) | partial | Channels and held messages only | M | partial |
| File sharing: progress, cancel, library, management | partial | Share one file and save one | M-L | partial |
| Voice messages | absent | | M | state has it |
| Recording what is heard | present | | - | yes |
| Forums | absent | | M | state has it |
| Reverse DNS of a user's address | absent | | S | no |

Asked about and present on neither side: close-to-tray, launch at login, media keys, text-to-speech, soundboard, portable mode, crash reporting, telemetry, a `mumble://` URL handler.

Not checked: macOS behaviour on either side; whether the engine itself restores voice on reconnect; whether leaving a server asks for confirmation.

