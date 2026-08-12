# New UI functionality roadmap

Status legend: `[x]` implemented in the new UI, `[~]` partially implemented, `[ ]` missing.

This list tracks feature parity with the classic UI. A checked item must be backed by working client logic, not only a design-sheet example.

## Present but incomplete or nonfunctional

- [x] Make channel search filter the visible channel tree.
- [x] Connect the create-channel action to the channel editor and backend permission enforcement.
- [x] Connect the user-card direct-message action and DM conversation surface.
- [~] Connect the composer attachment action and upload lifecycle (inline images and session-scoped file-server uploads work; upload-mode and progress controls remain).
- [x] Preserve and sanitize supported rich message markup instead of flattening every message to text.
- [x] Expand the composer beyond basic formatting with mentions, emoji, GIF search, quotes, uploads, and polls.
- [ ] Make server and channel information actionable where permissions allow.
- [x] Add user-card actions and moderation controls.
- [ ] Complete rich link-preview behavior and embed controls.
- [ ] Bring all preference sections into the new settings surface.
- [x] Implement functional appearance controls for shared themes, font family, text size, density, and message-action visibility.
- [ ] Replace fixed screen-share quality labels with real configuration.
- [~] Add member-list search, grouping, modes, and server-wide results (channel/server modes and offline registered-user search work; role grouping remains).
- [~] Add message-history loading and pagination (older-history loading works; page controls and scroll anchoring remain).
- [x] Add connection recovery and reconnect status UI.
- [ ] Keep design-sheet examples isolated from production functionality.

## Server connection and discovery

- [x] List, add, edit, remove, and connect to saved servers.
- [x] Switch between connected server sessions.
- [x] Disconnect from a server.
- [x] Browse the public server directory with an explicit privacy-consent gate.
- [x] Search, filter, and sort public servers.
- [x] Display public-server availability, ping, users, capacity, country, and version.
- [x] Connect directly without saving a server.
- [x] Search and sort saved servers.
- [x] Favorite and unfavorite servers.
- [ ] Show recent servers and connection history.
- [x] Handle server passwords in the new UI, including optional saved-password storage.
- [x] Handle TOTP/two-factor challenges in the new UI.
- [ ] Select and manage certificate identities per server.
- [ ] Display certificate warnings and trust decisions.
- [x] Show connection bootstrap progress and surfaced failures.
- [x] Show reconnect countdown, retry, cancel, and backoff status.
- [ ] Present server welcome messages.
- [ ] Import and export saved-server configurations.
- [ ] Configure connection-specific identity and audio behavior.

## Channels

- [x] Display channels and their current occupants.
- [x] Select a text channel and join a voice channel.
- [x] Optionally hide empty channels.
- [x] Search/filter channels while retaining matching ancestors.
- [x] Render the channel hierarchy with expand/collapse state.
- [x] Create persistent and temporary channels.
- [~] Edit channel name, description, position, capacity, password, visibility, and persistence (expiry controls remain).
- [x] Delete channels with confirmation.
- [x] Move channels between parents and reorder siblings from the channel context menu.
- [x] Support channel passwords and join prompts.
- [ ] Create and manage channel links.
- [ ] Display and edit channel ACLs, access users, groups, and filter rules.
- [ ] Drag or move users between channels.
- [x] Add channel context menus.
- [ ] Add channel recording controls.
- [ ] Add channel-specific sidebar tabs and tools.
- [ ] Remember or favorite channels.

## Users, moderation, and permissions

- [~] Add a complete user context menu (the composed action panel covers the actions; a compact right-click menu remains).
- [x] Open direct/private messages from user surfaces.
- [x] Register and unregister users.
- [~] Mute, deafen, suppress, kick, and ban users where permitted (mute, deafen, kick, and ban work; explicit suppress remains).
- [x] Move users between channels.
- [x] Adjust individual user volume.
- [x] Add local mute, ignore, friend, block, notes, and priority-speaker controls.
- [~] Show identity/certificate and effective permission details (certificate and effective channel access are shown; full ACL provenance remains).
- [x] Configure per-user shortcuts.
- [x] Assign registered users to groups and roles from the new administration surface.
- [x] Search server members, including offline registered users where the server grants list permission.

## Text chat

- [~] Implement direct messages, conversation list, popouts, and friends page (direct conversations, a searchable cross-server friends hub, offline chat, reconnect, and routed DM popouts work; a persistent recent-conversation list remains).
- [x] Edit and delete messages.
- [x] Add message context menus, selection, and bulk actions.
- [~] Add replies, threads, quotes, and jump-to-message behavior (quotes work; replies, threads, and jump targets remain).
- [x] Add reactions, emoji picker, mentions, and mention autocomplete.
- [x] Add GIF search and Klipy provider integration.
- [~] Add file attachments, previews, password protection, uploads, and downloads (session uploads, password downloads, expiry, and image/audio/video previews work; public/password upload configuration remains).
- [x] Add pinned messages, polls, read receipts, and typing indicators.
- [~] Add history pagination, search, unread markers, and unread navigation (history loading and search work; in-stream markers/navigation remain).
- [~] Render supported Markdown, spoilers, syntax-highlighted code, and rich media (sanitized rich HTML, code, images, audio, and video work; spoilers and syntax highlighting remain).
- [~] Add complete rich embeds and external-embed permission handling (link cards and external-embed preference work; per-card consent remains).
- [ ] Add watch-together, event cards, calendar actions, and mobile chat actions.

## Voice and audio

- [x] Add input/output device selection and volume controls.
- [x] Add activation mode, push-to-talk, and voice-activity thresholds.
- [x] Add calibration, VU meter, microphone preview, sample playback, and diagnostics.
- [~] Add denoising, echo cancellation, gain control, positional audio, and quality settings (available denoisers, gain, gate, bitrate, and frame duration work; backend-exposed echo and positional controls remain).
- [x] Add per-user volume and audio-backend settings.
- [x] Apply persisted audio and shortcut state during new-UI startup.

## Screen sharing, streaming, and media

- [x] Select a screen, window, or camera and start, replace, or stop a share.
- [x] Add an inline stream viewer with simultaneous-broadcaster switching, focused viewing, fullscreen, camera picture-in-picture, and popout windows.
- [~] Configure resolution, frame rate, bitrate, audio, camera, and combined sources (resolution, frame rate, and combined display/camera sources work; the native encoder currently derives bitrate and does not expose system-audio capture).
- [x] Add stream statistics, quality and stall state, collaborative annotation overlay, and viewer controls.
- [x] Handle native capture permissions and failures and remember safe sharing preferences such as quality; source IDs are intentionally not persisted because they are volatile and may expose a previously shared window.

## Profiles and identities

- [x] Edit avatar, banner, biography, display-name style, and profile data.
- [x] Preview profile changes.
- [x] Create, import, export, delete, and select certificate identities.
- [x] Support server-specific profile overrides, including automatic application on reconnect.

## Settings

- [~] Port account, audio, voice, calibration, notification, localization, privacy, profile, identity, shortcuts, plugins, GIF, streaming, update, advanced, and developer settings (general, profile/identity, audio/voice, shortcut capture and global registration, localization, notification, privacy, plugin trust, GIF credentials, updater policy, welcome-message policy, and logging are functional; streaming-default and complete developer editors remain).
- [~] Add settings search, validation, reset, and import/export (cross-section search and confirmed application reset work; broader validation and import/export remain).
- [~] Add functional theme, density, typography, contrast, and accessibility settings (theme, font, text size, density, and message-action visibility work; explicit contrast and accessibility controls remain).

## Server administration

- [~] Port the admin dashboard and server configuration (schema-driven runtime server and plugin settings are editable; dashboard metrics/charts remain).
- [~] Port bans, registered users, roles, permissions, members, and groups (ban and registered-user mutation, role/group creation and deletion, display metadata, inheritance, member assignment, exclusions, and ACL permission editing are functional; richer registered-user profiles and full ACL provenance remain).
- [~] Port channel ACL/access/filter administration (channel ACL selection, inheritance, rule creation/removal, and allow/deny editing are functional; access filters remain).
- [~] Port custom emotes, audit log, file server, documents, marketplace, and server plugins (custom-emote administration, documents, marketplace, runtime plugin settings, and server plugin lifecycle are functional; audit log and file-server administration remain).
- [ ] Port the SQL editor and administrative charts.

## Plugins, marketplace, documents, and auxiliary features

- [x] Port the plugin interaction/trust layer and plugin settings, including capability review and trust revocation.
- [x] Port marketplace browsing, details, installation, compatibility checks, manifest hash pinning, and deep links.
- [x] Port collaborative-document creation, saved-document browsing, private/published opening, and the complete shared editor toolset.
- [x] Port shared files, downloads, calendar, meetings, reminders, drawing, translation, and watch-together, including inline watch start/playback and screen annotations.

## Desktop and global integration

- [x] Register global, in-app, and per-user shortcuts and react to shortcut changes.
- [x] Initialize notification sounds and native-notification preferences, including streamer-mode suppression.
- [x] Initialize saved audio state and microphone probing.
- [x] Handle calendar reminders and marketplace/meeting application deep links.
- [x] Restore spoiler reveal, syntax highlighting, and watch-session lifecycle behavior.
- [x] Configure updater state and route dedicated updater windows independently of the selected UI.
- [x] Support image, stream, DM, translation, and drawing popouts while the new UI is selected.
- [x] Restore plugin initialization/interactions, server welcome messages, and a new-UI quick switcher/search.
- [x] Add password, TOTP, connection recovery, fullscreen shortcuts, and native-window routing flows.
