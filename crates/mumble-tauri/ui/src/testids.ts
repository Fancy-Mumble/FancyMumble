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

  // -- Saved-server list ----------------------------------------------------
  /** One card per saved server; carries `data-server-id`. */
  serverCard: "server-card",

  // -- Chat composer --------------------------------------------------------
  /** Wrapper around the (contenteditable) markdown input. */
  chatComposerInput: "chat-composer-input",
  chatSend: "chat-send",
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
  /** The shared password-entry dialog (channel-join / file-download). Its
   *  presence means a password is being demanded. */
  passwordPromptDialog: "password-prompt-dialog",
  /** The chat header's end-to-end-encrypted badge. Present only when the open
   *  chat is E2E (a signal/fancy persisted channel) - e.g. a friend chat that
   *  upgraded to its detached signal channel. */
  chatE2EBadge: "chat-e2e-badge",
  /** A channel row in the admin "Channels / ACL" tree. Carries `data-channel-id`
   *  and `data-channel-name`; right-click opens the delete context menu. Detached
   *  (private) channels carry `data-private="true"`. */
  aclChannelItem: "acl-channel-item",
  /** The "Delete channel" item in the ACL tree's right-click context menu. */
  aclDeleteChannel: "acl-delete-channel",
  /** The confirm button shown after clicking {@link aclDeleteChannel}. */
  aclDeleteConfirm: "acl-delete-confirm",
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
  /** Root of the source-picker dialog (the 2-tab Entire Screen / Window
   *  chooser). Its presence means the picker is open. */
  screenSharePicker: "screen-share-picker",
  /** A tab button inside the picker; carries `data-tab` ("screens"|"windows"). */
  screenSharePickerTab: "screen-share-picker-tab",
  /** A selectable capture-source card in the picker. Carries `data-source-id`,
   *  `data-source-kind` ("screen"|"window") and `data-source-title`. */
  screenShareSource: "screen-share-source",
  /** Confirm button in the picker that starts the broadcast for the selected
   *  source. */
  screenShareConfirm: "screen-share-confirm",
  /** The stream `<video>` element (own loopback preview or a remote viewer).
   *  Carries `data-session` (the broadcaster's session) and `data-own`
   *  ("true" for the broadcaster's own loopback, "false" for a remote view) so
   *  a test can read back the decoded pixels of a specific stream. */
  streamViewerVideo: "stream-viewer-video",
  /** A "someone is sharing" banner row; carries `data-broadcaster-name`. */
  broadcastBanner: "broadcast-banner",
  /** The "Watch" button inside a {@link broadcastBanner}; carries
   *  `data-session` (the broadcaster to watch). */
  broadcastWatch: "broadcast-watch",
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
/** Data attribute key carrying a capture source's window/screen title,
 *  used alongside {@link TID.screenShareSource}. */
export const STREAM_SOURCE_TITLE_ATTR = "data-source-title";
/** Data attribute key carrying a broadcaster's display name, used alongside
 *  {@link TID.broadcastBanner}. */
export const BROADCASTER_NAME_ATTR = "data-broadcaster-name";
