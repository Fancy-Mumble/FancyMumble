/**
 * Stable `data-testid` registry shared between the app UI and the e2e
 * (Selenium/tauri-driver) suite under `<repo>/e2e`.
 *
 * The e2e package imports this exact file (see `e2e/src/selectors.ts`) so
 * selectors can never drift from the markup.  Keep this module dependency
 * free - it must be importable from a plain Node/tsx context with no React,
 * Vite or Tauri imports.
 *
 * Conventions:
 *  - kebab-case, namespaced by area (`connect-`, `chat-`, `member-`, ...).
 *  - Row-level elements additionally carry a `data-*` key (e.g. a member's
 *    `data-user-name`) so a specific row can be addressed without relying
 *    on translated text or hashed CSS-module class names.
 */
export const TID = {
  // -- Discord rich presence ------------------------------------------------
  /** The rich-presence side panel. */
  richPresencePanel: "rich-presence-panel",
  /** One observed activity; carries `data-application-id`. */
  richPresenceEntry: "rich-presence-entry",

  // -- Connect page / wizard ------------------------------------------------
  connectHostInput: "connect-host-input",
  connectPortInput: "connect-port-input",
  connectUsernameInput: "connect-username-input",
  /** Advances the wizard to the next step. */
  wizardContinue: "wizard-continue",
  /** Final wizard action: persist the server and connect. */
  connectAndSave: "connect-and-save",
  /** Final wizard action: connect without saving. */
  quickConnect: "quick-connect",
  /** The dot on the address chip reporting where this page's livery came from.
   *  Its `data-livery-status` carries the exact state. */
  connectLiveryStatus: "connect-livery-status",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  connectIdentityHandle: "connect-identity-handle",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  sessionStatus: "session-status",

  // -- Saved-server list ----------------------------------------------------
  /** One card per saved server; carries `data-server-id`. */
  serverCard: "server-card",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  addServer: "add-server",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  connectCertificate: "connect-certificate",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  adminPanel: "admin-panel",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  adminBack: "admin-back",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  disconnectServer: "disconnect-server",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  disconnectConfirm: "disconnect-confirm",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  selfDockMenu: "self-dock-menu",

  // -- Chat composer --------------------------------------------------------
  /** Wrapper around the (contenteditable) markdown input. */
  chatComposerInput: "chat-composer-input",
  chatSend: "chat-send",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  chatAttachMenu: "chat-attach-menu",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  chatCreatePoll: "chat-create-poll",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  pollQuestionInput: "poll-question-input",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  pollOptionInput: "poll-option-input",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  pollMultiple: "poll-multiple",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  pollSubmit: "poll-submit",
  /**
   * The sender-name label on a rendered message (the first message in a
   * consecutive same-sender group). Carries `data-sender-name` so a message's
   * attributed author can be asserted without relying on hashed CSS classes -
   * e.g. to prove a hidden-channel user's message is shown as that user and not
   * as "Server".
   */
  chatMessageSender: "chat-message-sender",

  // -- Channel list ---------------------------------------------------------
  /**
   * A channel row in the sidebar list. Carries `data-channel-id` and
   * `data-channel-name`. Right-click opens the channel context menu
   * (create/edit/delete); double-click joins.
   */
  channelItem: "channel-item",
  /** Flat list (above the channel tree) of private/hidden rooms the user is in
   *  (private rooms + scheduled meeting rooms). */
  privateChannelsViewer: "private-channels-viewer",
  /** Context-menu action that leaves a meeting room (removes it from the
   *  user's Meetings list; rejoining happens via the calendar event). */
  leaveMeeting: "leave-meeting",
  /** The shared password-entry dialog (channel-join / file-download). Its
   *  presence means a password is being demanded. */
  passwordPromptDialog: "password-prompt-dialog",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  connectPasswordInput: "connect-password-input",
  /** Recovered from the built bundle after a disk-full truncation;
   *  the name and value are exact, the description is not. */
  connectPasswordSubmit: "connect-password-submit",
  /** The chat header's end-to-end-encrypted badge. Present only when the open
   *  chat is E2E (a signal/fancy persisted channel) - e.g. a friend chat that
   *  upgraded to its detached signal channel. */
  chatE2EBadge: "chat-e2e-badge",
  /** A channel row in the admin "Channels / ACL" tree. Carries `data-channel-id`
   *  and `data-channel-name`; right-click opens the delete context menu. Detached
   *  (private) channels carry `data-private="true"`. */
  aclChannelItem: "acl-channel-item",
  /** Checkbox on the "Channels / ACL" tab that hides `__dm:` (friend-chat /
   *  self-notepad) channels from the tree. */
  aclHideDmChannels: "acl-hide-dm-channels",
  /** Checkbox in the ACL tab's filters panel that hides channels with no
   *  online members. */
  aclHideEmptyChannels: "acl-hide-empty-channels",
  /** Checkbox in the ACL tab's filters panel that shows only detached
   *  (private/meeting-room/DM) channels. */
  aclPrivateOnly: "acl-private-only",
  /** Checkbox in the ACL tab's filters panel that flattens the tree to the
   *  root channel and its direct children. */
  aclTopLevelOnly: "acl-top-level-only",
  /** Checkbox in the ACL tab's filters panel that shows only channels with
   *  a non-inherited ACL override (triggers a bulk `request_acl` fetch). */
  aclCustomAclOnly: "acl-custom-acl-only",
  /** The "Delete channel" item in the ACL tree's right-click context menu. */
  aclDeleteChannel: "acl-delete-channel",
  /** The confirm button shown after clicking {@link aclDeleteChannel}. */
  aclDeleteConfirm: "acl-delete-confirm",
  /** A row in the admin "Users" (registered users) table. Carries
   *  `data-user-name` ({@link MEMBER_NAME_ATTR}). */
  registeredUserRow: "registered-user-row",
  /** The "Reset channel key" action on the key-challenge-failed banner
   *  (shown to KeyOwner admins; performs a key takeover). */
  pchatResetKey: "pchat-reset-key",
  /** Root of the generic ConfirmDialog modal (register/unregister user,
   *  delete messages, ...). */
  confirmDialog: "confirm-dialog",
  /** The ConfirmDialog's confirm (primary/danger) button. */
  confirmDialogConfirm: "confirm-dialog-confirm",
  /** The ConfirmDialog's cancel button. */
  confirmDialogCancel: "confirm-dialog-cancel",
  /** The "+ Create role" button on the admin "Roles" tab. */
  rolesCreateButton: "roles-create-button",
  /** A role row on the admin "Roles" tab list. Carries `data-role-name`. */
  roleListRow: "role-list-row",
  /** The "Role {{name}} not found." message body shown on `/admin/role/:name`
   *  when the requested role isn't in the fetched ACL's group list. Carries
   *  `data-role-name`. */
  roleEditorNotFound: "role-editor-not-found",
  /** The role-name text input on the role editor's "Display" sub-tab. */
  roleNameInput: "role-name-input",
  /** The new-role wizard's "Previous" step button (`/admin/roles/new`). */
  roleWizardPrev: "role-wizard-prev",
  /** The new-role wizard's "Next" step button. */
  roleWizardNext: "role-wizard-next",
  /** The new-role wizard's final-step "Create role" button - only this
   *  actually persists the draft role to the server. */
  roleWizardCreate: "role-wizard-create",
  /** The new-role wizard's "Cancel" button; discards the draft. */
  roleWizardCancel: "role-wizard-cancel",
  /** The chat header's title (`<h2>`). Carries the channel/peer display name -
   *  e.g. a friend chat shows the peer's name and a self-chat shows your own
   *  name (it is listed as "yourself", not a special "Notepad"). */
  chatHeaderTitle: "chat-header-title",
  /** A member row rendered *under a channel* in the flat channel tree (distinct
   *  from {@link memberItem}, which is the members roster / DM list). Carries
   *  `data-user-name`. Lets tests assert a user is shown inside the channel tree
   *  (vs merely online in the roster). */
  channelMember: "channel-member",
  /** The add/remove-friend toggle in the user context menu. */
  userMenuFriendToggle: "user-menu-friend-toggle",
  /** A row on the Friends page. Carries `data-friend-name` and `data-online`
   *  ("true"/"false") - the online state is resolved by cert hash over the live
   *  user list, so it reflects presence even for a friend in a hidden channel. */
  friendRow: "friend-row",
  /** The "connect to this friend's server" prompt shown in the Friends chat
   *  pane when you click a friend whose server you aren't connected to. */
  friendsConnectPrompt: "friends-connect-prompt",
  /** The button in {@link friendsConnectPrompt} that (re)connects to the
   *  friend's server, then auto-opens the chat. */
  friendsConnect: "friends-connect",

  // -- Member / user list ---------------------------------------------------
  /**
   * A user row (anywhere it renders: channel list, members panel, self
   * section). Carries `data-user-name`, plus `data-talking` / `data-muted` /
   * `data-deaf` / `data-offline` reflecting that user's live state.
   */
  memberItem: "member-item",
  /** The scrollable members panel container. */
  memberList: "member-list",

  // -- Self voice controls (ChannelSidebar) ---------------------------------
  toggleMute: "toggle-mute",
  toggleDeafen: "toggle-deafen",

  // -- Calendar (fancy-calendar plugin) -------------------------------------
  /** Header action that opens the calendar split-view. Only rendered when the
   *  server has the `fancy-calendar` plugin loaded, so its presence is the
   *  end-to-end signal that the plugin is available + gating works. */
  calendarHeaderButton: "header-calendar-button",
  /** Root of the calendar split-view panel (readiness marker). */
  calendarPanel: "calendar-panel",
  /** Toolbar "New meeting" button. */
  calendarNewMeeting: "calendar-new-meeting",
  /** A view-switch button; carries `data-view` (day|workweek|week|month). */
  calendarViewButton: "calendar-view-button",
  /** Root of the create/edit meeting dialog. */
  calendarDialog: "calendar-dialog",
  /** Meeting title text input in the dialog. */
  calendarTitleInput: "calendar-title-input",
  /** The invitee MemberPicker text input in the dialog (accepts a numeric
   *  user id + Enter, so a participant can be added deterministically). */
  calendarInviteeInput: "calendar-invitee-input",
  /** Save button in the meeting dialog. */
  calendarSave: "calendar-save",
  /** Start date input (`type=date`, YYYY-MM-DD) in the meeting dialog. */
  calendarStartDate: "calendar-start-date",
  /** Start time input (`type=time`, HH:MM) in the meeting dialog. */
  calendarStartTime: "calendar-start-time",
  /** Reminder offset `<select>` in the meeting dialog (value: "none"|minutes). */
  calendarReminderSelect: "calendar-reminder-select",
  /** A rendered meeting chip in any view; carries `data-event-title`. */
  calendarEvent: "calendar-event",
  /** The detail popover shown when an event chip is clicked. */
  calendarDetailCard: "calendar-detail-card",
  /** "Join meeting" button on the event detail card (provisions/enters the room). */
  calendarJoinMeeting: "calendar-join-meeting",
  /** Organiser-only "Copy invite link" button on the event detail card. */
  calendarCopyInviteLink: "calendar-copy-invite-link",

  // -- Screen sharing (Rust capture + WebRTC) -------------------------------
  /** Chat-header "Share screen" / "Stop sharing" toggle. Opens the source
   *  picker (when not sharing) or stops the broadcast. */
  screenShareToggle: "screen-share-toggle",
  /** Chat-header camera share button (GNOME portal flow only, where the
   *  in-app picker is hidden): system camera consent, then the camera-only
   *  picker. */
  cameraShareToggle: "camera-share-toggle",
  /** Root of the source-picker dialog (the Entire Screen / Window / Device
   *  chooser). Its presence means the picker is open. */
  screenSharePicker: "screen-share-picker",
  /** A tab button inside the picker; carries `data-tab`
   *  ("screens"|"windows"|"devices"). */
  screenSharePickerTab: "screen-share-picker-tab",
  /** A selectable capture-source card in the picker. Carries `data-source-id`,
   *  `data-source-kind` ("screen"|"window"|"device") and `data-source-title`.
   *  One screen/window and one device can be selected together (screen +
   *  camera share). */
  screenShareSource: "screen-share-source",
  /** Confirm button in the picker that starts the broadcast for the selected
   *  source(s). */
  screenShareConfirm: "screen-share-confirm",
  /** The stream `<video>` element (own loopback preview or a remote viewer).
   *  Carries `data-session` (the broadcaster's session) and `data-own`
   *  ("true" for the broadcaster's own loopback, "false" for a remote view) so
   *  a test can read back the decoded pixels of a specific stream. */
  streamViewerVideo: "stream-viewer-video",
  /** The camera picture-in-picture `<video>` overlaid on a stream when the
   *  broadcaster shares screen + camera together. Same `data-session` /
   *  `data-own` attributes as {@link streamViewerVideo}. A camera-ONLY share
   *  renders in the main {@link streamViewerVideo} element instead. */
  streamCameraVideo: "stream-camera-video",
  /** The native-viewer `<canvas>` frame sink used where the webview has no
   *  WebRTC (Linux WebKitGTK): the Rust peer receives the stream and the
   *  frames are painted here (WebCodecs-decoded H.264, or the JPEG
   *  fallback). Carries `data-session` / `data-own` like
   *  {@link streamViewerVideo}. */
  streamNativeView: "stream-native-view",
  /** A "someone is sharing" banner row; carries `data-broadcaster-name`. */
  broadcastBanner: "broadcast-banner",
  /** The "Watch" button inside a {@link broadcastBanner}; carries
   *  `data-session` (the broadcaster to watch). */
  broadcastWatch: "broadcast-watch",
  /** A clickable stream tile inside the focus view (secondary pane or bottom
   *  drawer) that switches the primary stream to that broadcaster. Carries
   *  `data-session` and `data-broadcaster-name`. This is how a user who is
   *  ALREADY broadcasting watches someone else (the banner is only shown to
   *  idle viewers). */
  streamWatchTile: "stream-watch-tile",
  /** The focus view's bottom-drawer toggle (the drawer starts collapsed). */
  streamDrawerToggle: "stream-drawer-toggle",
  /** Nebula's grab bar under the share stage: dragging it trades stage height
   *  for conversation height. Carries the current height in `aria-valuenow`. */
  streamStageResizeHandle: "stream-stage-resize-handle",
  /** Kebab/burger button opening the own-broadcast stream-config menu
   *  (stop / change source / quality), beside the stop-stream × button. */
  streamConfigMenu: "stream-config-menu",
  /** Config-menu switch hiding this app's windows from screen capture
   *  (checked = hidden, i.e. the client cannot be screenshotted). */
  streamHideSelfToggle: "stream-hide-self-toggle",
  streamShareAudioToggle: "stream-share-audio-toggle",
  /** Gear button in the source picker opening the "Stream Mode" popover
   *  (presets + screen-resolution / frame-rate submenus). */
  screenShareSettings: "screen-share-settings",
  /** One chip in the picker's selection summary row (a picked screen/window
   *  or camera; `data-chip-kind` holds the source kind). */
  screenShareSelectionChip: "screen-share-selection-chip",
  /** Own-stream control-bar shortcut that adds the missing source kind
   *  (screen or camera) to the live broadcast via the seeded picker. */
  streamAddSource: "stream-add-source",
  /** × on the own camera PiP tile that ends just the camera track. */
  streamEndCamera: "stream-end-camera",
  /** Per-track "Current resolution" row in the stats panel (one per inbound
   *  video track - a screen+camera share has two). */
  streamStatsResolution: "stream-stats-resolution",
  /** Per-track "Freezes" row in the stats panel ("n (x.x s total)"). */
  streamStatsFreezes: "stream-stats-freezes",
  /** Connection-level "FPS" row in the stats panel (decoded frames/s). */
  streamStatsFps: "stream-stats-fps",
  /** Sender-side uplink target row; present only while this client shares. */
  streamStatsUplinkTarget: "stream-stats-uplink-target",
  /** Advisory banner on the own-broadcast preview when the Linux/GNOME
   *  compositor stops delivering fresh monitor frames (fullscreen scanout). */
  streamCaptureStallHint: "stream-capture-stall-hint",

  // -- Settings: Account (self-service registration) ------------------------
  /** Overview block showing name / user id / auth mode / 2FA state. */
  accountOverview: "account-overview",
  /** The account's *existing* password, which every change here is proved by. */
  accountCurrentPasswordInput: "account-current-password-input",
  accountPasswordInput: "account-password-input",
  accountPasswordConfirmInput: "account-password-confirm-input",
  /** Enables password auth / changes the password. */
  accountPasswordSave: "account-password-save",
  /** Switches back to certificate-only login (clears the password). */
  accountPasswordClear: "account-password-clear",
  accountRenameInput: "account-rename-input",
  accountRenameSave: "account-rename-save",
  accountEmailInput: "account-email-input",
  accountEmailSave: "account-email-save",
  /** Starts TOTP enrolment (server replies with the shared secret). */
  accountTotpBegin: "account-totp-begin",
  /** The QR code of the otpauth:// URI - the happy path of enrolment. */
  accountTotpQr: "account-totp-qr",
  /** "Can't scan?" - reveals the otpauth:// setup link as the first fallback. */
  accountTotpCantScan: "account-totp-cant-scan",
  /** Read-only input holding the otpauth:// setup link (behind "can't scan"). */
  accountTotpUri: "account-totp-uri",
  /** Reveals the bare base32 secret, the last resort behind the setup link. */
  accountTotpRevealSecret: "account-totp-reveal-secret",
  /** Read-only input holding the base32 TOTP secret during enrolment. */
  accountTotpSecret: "account-totp-secret",
  /** 6-digit code input during enrolment. */
  accountTotpCodeInput: "account-totp-code-input",
  accountTotpVerify: "account-totp-verify",
  /** 6-digit code input required to disable 2FA. */
  accountTotpDisableInput: "account-totp-disable-input",
  accountTotpDisable: "account-totp-disable",
  /** Opens the type-name-to-confirm unregister flow. */
  accountUnregisterBegin: "account-unregister-begin",
  accountUnregisterConfirmInput: "account-unregister-confirm-input",
  accountUnregisterConfirm: "account-unregister-confirm",
  /** TOTP code input on the login (connect) dialog. */
  connectTotpInput: "connect-totp-input",
  /** Submit button of the login TOTP dialog. */
  connectTotpSubmit: "connect-totp-submit",

  // -- Admin: Audit Log tab --------------------------------------------------
  /** Root container of the Audit Log admin tab. */
  auditTab: "audit-tab",
  /** Dual-mode search input (DSL text box, or SQL editor in advanced mode). */
  auditQueryInput: "audit-query-input",
  /** Autocomplete suggestion listbox under the query input. */
  auditQuerySuggestions: "audit-query-suggestions",
  /** One autocomplete row; carries `data-suggest-kind` and `data-active`. */
  auditQuerySuggestionItem: "audit-query-suggestion-item",
  /** Runs the current search. */
  auditRunQuery: "audit-run-query",
  /** Live-tail toggle; carries `data-live`. */
  auditLiveToggle: "audit-live-toggle",
  /** Inline parse / server rejection message. */
  auditQueryError: "audit-query-error",
  /** Sub-page tabs (Dashboard / Results / Configuration). */
  auditSubTabs: "audit-sub-tabs",
  /** Dashboard sub-page tab. */
  auditDashboardTab: "audit-dashboard-tab",
  /** Results (table) sub-page tab. */
  auditResultsTab: "audit-results-tab",
  /** Collapsible quick-filter ("EZ search") rail; carries `data-open`. */
  auditFilterRail: "audit-filter-rail",
  /** Collapse/expand control on the quick-filter rail. */
  auditFilterRailToggle: "audit-filter-rail-toggle",
  /** Endless-scroll vs. pagination checkbox in the quick-filter rail. */
  auditEndlessToggle: "audit-endless-toggle",
  /** Previous-page control (pagination mode). */
  auditPagePrev: "audit-page-prev",
  /** Next-page control (pagination mode). */
  auditPageNext: "audit-page-next",
  /** KPI stat-tile row. */
  auditKpiRow: "audit-kpi-row",
  /** Results table; rows are {@link TID.auditRow}. */
  auditTable: "audit-table",
  /** One result row; carries `data-entry-id`. */
  auditRow: "audit-row",
  /** Detail drawer opened by clicking a row. */
  auditDetailDrawer: "audit-detail-drawer",
  /** Switch to the Configuration half. */
  auditConfigHalf: "audit-config-half",
  /** Chain-status card in the Configuration half. */
  auditChainCard: "audit-chain-card",
  /** Runs the hash-chain verification. */
  auditVerifyChain: "audit-verify-chain",
  /** Saves changed audit configuration. */
  auditConfigSave: "audit-config-save",

  // -- Chat header kebab menu -----------------------------------------------
  /** The chat header's kebab (overflow) menu trigger. */
  chatHeaderKebab: "chat-header-kebab",
  /** An entry in an open kebab menu. Carries `data-item-id`
   *  ({@link KEBAB_ITEM_ATTR}) with the item's stable id (e.g.
   *  "scheduled-messages"). */
  kebabMenuItem: "kebab-menu-item",

  // -- Scheduled messages -----------------------------------------------
  /** Root of the ScheduledMessagesPanel split view. */
  scheduledPanel: "scheduled-panel",
  scheduledBodyInput: "scheduled-body-input",
  /** The `datetime-local` delivery-time input. */
  scheduledTimeInput: "scheduled-time-input",
  scheduledSubmit: "scheduled-submit",
  /** Client-side validation / server rejection error line. */
  scheduledError: "scheduled-error",
  /** A pending scheduled message row. */
  scheduledItem: "scheduled-item",
  /** Per-row cancel button. */
  scheduledItemCancel: "scheduled-item-cancel",
  scheduledRefresh: "scheduled-refresh",
  /** Empty-state ("no pending messages") placeholder. */
  scheduledEmpty: "scheduled-empty",
} as const;

export type TestId = (typeof TID)[keyof typeof TID];

/** Data attribute key used alongside {@link TID.memberItem}. */
export const MEMBER_NAME_ATTR = "data-user-name";
/** Data attribute key used alongside {@link TID.serverCard}. */
export const SERVER_ID_ATTR = "data-server-id";
/** Data attribute key used alongside {@link TID.calendarEvent}. */
export const CALENDAR_EVENT_TITLE_ATTR = "data-event-title";
/** Data attribute key used alongside {@link TID.calendarViewButton}. */
export const CALENDAR_VIEW_ATTR = "data-view";
/** Data attribute key marking the channel the client is currently in, used
 *  alongside {@link TID.channelItem}. Recovered from the markup that emits
 *  it after a disk-full truncation: the value is exact. */
export const CHANNEL_JOINED_ATTR = "data-joined";
/** Data attribute key marking a registered (non-guest) member, used
 *  alongside {@link TID.memberRow}. Recovered the same way. */
export const MEMBER_REGISTERED_ATTR = "data-registered";
/** Data attribute key carrying a settings tab's stable id. Recovered from
 *  the built bundle after a disk-full truncation: the value is exact. */
export const TAB_ID_ATTR = "data-tab-id";
/** Data attribute key carrying a capture source's window/screen title,
 *  used alongside {@link TID.screenShareSource}. */
export const STREAM_SOURCE_TITLE_ATTR = "data-source-title";
/** Data attribute key carrying a broadcaster's display name, used alongside
 *  {@link TID.broadcastBanner}. */
export const BROADCASTER_NAME_ATTR = "data-broadcaster-name";
/** Data attribute key carrying a kebab menu entry's stable id, used alongside
 *  {@link TID.kebabMenuItem}. */
export const KEBAB_ITEM_ATTR = "data-item-id";
