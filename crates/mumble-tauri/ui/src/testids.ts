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

  // -- Member / user list ---------------------------------------------------
  /** A user row in the members panel; carries `data-user-name`. */
  memberItem: "member-item",
  /** The scrollable members panel container. */
  memberList: "member-list",
} as const;

export type TestId = (typeof TID)[keyof typeof TID];

/** Data attribute key used alongside {@link TID.memberItem}. */
export const MEMBER_NAME_ATTR = "data-user-name";
/** Data attribute key used alongside {@link TID.serverCard}. */
export const SERVER_ID_ATTR = "data-server-id";
