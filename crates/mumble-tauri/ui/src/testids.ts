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

  // -- Channel list ---------------------------------------------------------
  /**
   * A channel row in the sidebar list. Carries `data-channel-id` and
   * `data-channel-name`. Right-click opens the channel context menu
   * (create/edit/delete); double-click joins.
   */
  channelItem: "channel-item",

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
  /** A rendered meeting chip in any view; carries `data-event-title`. */
  calendarEvent: "calendar-event",
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
