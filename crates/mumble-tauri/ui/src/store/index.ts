/**
 * Global Zustand store for the Mumble Tauri client.
 *
 * All complex logic lives in the Rust backend - the frontend only
 * invokes Tauri commands and reacts to events.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { reconnectDelayMs } from "../utils/reconnectBackoff";
import {
  isPermissionGranted,
  requestPermission,
  createChannel,
  Importance,
  Visibility,
} from "@tauri-apps/plugin-notification";
import type {
  ChannelEntry,
  UserEntry,
  ChatMessage,
  ConnectionStatus,
  MumbleServerConfig,
  VoiceState,
  PersistenceMode,
  ChannelPersistenceState,
  PchatProtocol,
  ServerInfo,
  ServerLogEntry,
  ReadReceiptDeliverPayload,
  FileServerConfig,
  FileServerCapabilities,
  LiveDocPluginConfig,
  FileAccessMode,
  UploadResponse,
  CustomServerEmote,
  PluginInfoRecord,
  PendingMessage,
} from "../types";
import type { PollPayload, PollVotePayload } from "../components/chat/poll/PollCreator";
import { registerPoll, registerVote } from "../components/chat/poll/PollCard";
import type { WatchSession, WatchSyncPayload } from "../components/chat/watch/watchTypes";
import { applyWatchSyncEvent } from "../components/chat/watch/watchStore";
import { resetReactions, setServerCustomReactions, type ServerCustomReaction } from "../components/chat/reaction/reactionStore";
import {
  applyInteractionResponse,
  decodeInteractionResponse,
  emptyPluginTier1Slice,
  manifestPermitsResponse,
  type PluginTier1Slice,
} from "../plugins/tier1/store";
import type { InteractionResponse } from "../plugins/tier1/types";
import { parseClientManifest } from "../plugins/tier1/manifest";
import { applyReadStates, clearReadReceipts } from "../components/chat/readreceipt/readReceiptStore";
import { useOnboardingStore } from "../components/onboarding/onboardingStore";
import type { OnboardingConfigEvent, OnboardingResponseEvent } from "../types";
import { offloadManager } from "../messageOffload";
import { getSilencedChannels, getUserVolumes, getMutedPushChannels, getPreferences, updatePreferences } from "../preferencesStorage";
import { createDmSlice, dmInitialState, type DmSlice } from "./slices/dm";
import { createVoiceSlice, voiceInitialState, type VoiceSlice } from "./slices/voice";
import {
  createNotificationsSlice,
  notificationsInitialState,
  type NotificationsSlice,
} from "./slices/notifications";
import {
  createDownloadsSlice,
  downloadsInitialState,
  type DownloadsSlice,
} from "./slices/downloads";
import { loadProfileData } from "../pages/settings/profileData";
import { base64ToBytes } from "../utils/base64";
import { serializeProfile, dataUrlToBytes } from "../profileFormat";
import { sanitiseWsUrl } from "../components/chat/livedoc/sanitiseWsUrl";
import { TauriEvent } from "../constants/tauriEvents";
import {
  PluginDataId,
  PluginPayloadType,
  PLUGIN_NAME_FILE_SERVER,
  PLUGIN_NAME_LIVE_DOC,
  friendlyPluginName,
} from "../constants/pluginData";
import i18next from "i18next";
import {
  probeFileServerCapabilities,
  rebaseFileServerUrl,
} from "./fileServer";
export {
  DEFAULT_FILE_SERVER_PORT,
  fileServerBaseUrl,
  probeFileServerCapabilities,
  rebaseFileServerUrl,
} from "./fileServer";
import type {
  PluginRegistryEntry,
  PluginRegistryEvent,
} from "./plugins";
import {
  reconcilePluginRegistry,
  sendPluginMessage,
  sliceFromState,
  slicePatch,
} from "./plugins";
export type {
  PluginRegistryEntry,
  PluginRegistryEvent,
} from "./plugins";
export {
  allowPlugin,
  dismissPluginCard,
  dismissPluginModal,
  dismissPluginToast,
  reconcilePluginRegistry,
  resetPluginTrust,
  resolvePluginTrust,
  resolvePluginTrustBulk,
  revokePluginTrust,
  sendPluginInteraction,
  sendPluginMessage,
} from "./plugins";
import { applyCalendarInbound } from "../components/chat/calendar/calendarStore";
import {
  MSG_MEETING_ROOM,
  MSG_MEETING_INVITE_LINK,
  dispatchMeetingRoom,
  dispatchMeetingInviteLink,
} from "../components/chat/calendar/meetings";
import { FRIENDS_PLUGIN, MSG_FRIENDS_ROOM, parseFriendsRoom } from "../friendsChannel";
import {
  createPersistentChatSlice,
  persistentChatInitialState,
  type PersistentChatSlice,
} from "./slices/persistentChat";
import { registerPersistentChatEvents } from "./slices/persistentChat.events";

/** Sessions that have already had their stored volume applied this connection. */
const volumeAppliedSessions = new Set<number>();

/** Cached `autoReconnect` preference. The disconnect handler runs
 *  synchronously and must decide whether to schedule a retry without an
 *  async store read, so we mirror the persisted flag here and keep it in
 *  sync via the `preferences-changed` event. */
let autoReconnectEnabled = false;
if (typeof window !== "undefined") {
  void import("../preferencesStorage")
    .then(({ getPreferences }) => getPreferences())
    .then((p) => {
      autoReconnectEnabled = p.autoReconnect ?? false;
    })
    .catch(() => {});
  window.addEventListener("preferences-changed", (e) => {
    const detail = (e as CustomEvent).detail as { autoReconnect?: boolean } | undefined;
    if (detail && typeof detail.autoReconnect === "boolean") {
      autoReconnectEnabled = detail.autoReconnect;
    }
  });
}

// File-server URL helpers moved to `store/fileServer.ts`; re-exported
// below so callers continue to `import { rebaseFileServerUrl } from "../store"`.

let autoReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manualDisconnectRequested = false;
/** Sessions whose disconnect was triggered by the user (e.g. via the
 *  tab close button).  The `server-disconnected` listener consults this
 *  set so it does not surface a "Connection lost" overlay for what the
 *  user just initiated themselves.  Entries are removed once handled. */
const intentionallyClosingSessions = new Set<string>();
/** Module-level handle to react-router's `navigate`.  Set by
 *  `initEventListeners`; used by store actions that need to redirect
 *  (e.g. `disconnectSession` falling back to the connect page). */
let navigateRef: ((path: string) => void) | null = null;
/** Reconnect voice-restore guard: while true, voice toggles suppress the
 *  preference writes that would otherwise clobber the saved on-reconnect
 *  state. Mutated by the voice-state event handler below; read by the voice
 *  slice's `toggleMute` (imported there as a live binding). */
export let isRestoringVoice = false;

function clearAutoReconnectTimer(): void {
  if (autoReconnectTimer !== null) {
    clearTimeout(autoReconnectTimer);
    autoReconnectTimer = null;
  }
  useAppStore.setState({ reconnectScheduled: false, nextReconnectAt: null });
}

async function attemptAutoReconnect(
  fallbackTarget: { host: string; port: number; username: string; certLabel: string | null },
): Promise<void> {
  autoReconnectTimer = null;
  if (manualDisconnectRequested || !autoReconnectEnabled) {
    useAppStore.setState({ reconnectScheduled: false, nextReconnectAt: null });
    return;
  }

  const state = useAppStore.getState();
  // Only start a fresh attempt from a settled `disconnected` state. If a
  // connect is already in flight (`connecting`), or we are connected /
  // blocked on a password, do nothing now: the connection result events
  // (ServerConnected / server-disconnected) drive the next step. This keeps
  // the loop event-driven and avoids racing the backend's own retry loop.
  if (state.status !== "disconnected" || state.passwordRequired) {
    return;
  }

  const target = state.pendingConnect ?? fallbackTarget;
  // Count this attempt and ensure the downtime clock is running (normally
  // set by the disconnect handler, but guard for safety).
  useAppStore.setState((p) => ({
    reconnectAttempts: p.reconnectAttempts + 1,
    connectionLostAt: p.connectionLostAt ?? Date.now(),
  }));
  await state.connect(target.host, target.port, target.username, target.certLabel ?? null);

  // `connect()` returns immediately while the backend connects in the
  // background. On a synchronous failure it leaves status `disconnected`
  // (no result event will arrive), so reschedule here; otherwise wait for
  // the ServerConnected / server-disconnected event to drive the next step.
  const after = useAppStore.getState();
  if (
    after.status === "disconnected"
    && !after.passwordRequired
    && !manualDisconnectRequested
    && autoReconnectEnabled
  ) {
    scheduleAutoReconnect(target);
  }
}

function scheduleAutoReconnect(
  fallbackTarget: { host: string; port: number; username: string; certLabel: string | null },
): void {
  clearAutoReconnectTimer();
  if (!autoReconnectEnabled || manualDisconnectRequested) return;
  const delay = reconnectDelayMs(useAppStore.getState().reconnectAttempts);
  useAppStore.setState({ reconnectScheduled: true, nextReconnectAt: Date.now() + delay });
  autoReconnectTimer = setTimeout(() => {
    void attemptAutoReconnect(fallbackTarget);
  }, delay);
}

/**
 * Apply persisted per-user volumes to any users that just appeared.
 * Skips sessions already applied this connection.
 */
function applyStoredVolumesToNewUsers(): void {
  const { users, userVolumes } = useAppStore.getState();
  for (const user of users) {
    if (!user.hash || volumeAppliedSessions.has(user.session)) continue;
    const vol = userVolumes[user.hash];
    if (vol !== undefined && vol !== 100) {
      invoke("set_user_volume", { session: user.session, volume: vol / 100 }).catch(() => {});
    }
    volumeAppliedSessions.add(user.session);
  }
}

// --- Live Doc types -----------------------------------------------
// Defined inline (rather than imported from `components/chat/useLiveDoc.ts`)
// to keep the store dependency-free of UI components.  The shape is
// re-exported from this module so consumers can reference one type.

/** All the data needed to connect to and render a Live Doc session. */
export interface LiveDocSessionInfo {
  readonly serverId: number;
  /** App-side server tab id this session belongs to.  Used to scope
   *  the live-doc maps so two server tabs do not collide on the same
   *  numeric channel id (channel 0 = root on every Mumble server). */
  readonly appServerId: import("../types").ServerId | null;
  readonly channelId: number;
  readonly slug: string;
  readonly title: string;
  readonly wsUrl: string;
  readonly token: string;
  readonly ownSession: number;
  readonly ownName: string;
  readonly ownColor: string;
  /** True when this client created the session (non-silent opener).
   *  Gates owner-only controls such as manual "save now". */
  readonly isOwner?: boolean;
}

/** Pending announce shown as a chat banner. */
export interface LiveDocAnnounceInfo {
  readonly openerName: string;
  readonly title: string;
  readonly appServerId: import("../types").ServerId | null;
  readonly channelId: number;
  readonly slug: string;
}

/** Composite map key for live-doc state, scoped to a server tab. */
export function liveDocKey(
  appServerId: import("../types").ServerId | null,
  channelId: number,
): string {
  return `${appServerId ?? ""}|${channelId}`;
}

// --- Store shape --------------------------------------------------

export interface AppState extends PersistentChatSlice, DmSlice, VoiceSlice, NotificationsSlice, DownloadsSlice {
  // Reactive state
  status: ConnectionStatus;
  channels: ChannelEntry[];
  users: UserEntry[];
  selectedChannel: number | null;
  /** The channel the user is physically in on the server. */
  currentChannel: number | null;
  /** Session ID of the user whose profile panel is open (right side). */
  selectedUser: number | null;
  /** Our own session ID assigned by the server after connecting. */
  ownSession: number | null;
  messages: ChatMessage[];
  error: string | null;
  unreadCounts: Record<number, number>;
  serverConfig: MumbleServerConfig;
  /** File-server plugin configuration advertised by the server on connect.
   *  `null` when the server has no file-server plugin. */
  fileServerConfig: FileServerConfig | null;
  /** Capabilities fetched from `GET {baseUrl}/capabilities` after receiving
   *  the file-server config. `null` when not yet fetched or no file-server. */
  fileServerCapabilities: FileServerCapabilities | null;
  /** Configuration advertised by the live-doc plugin on connect via
   *  `fancy-live-doc-config`. `null` when the server has no live-doc plugin. */
  liveDocPluginConfig: LiveDocPluginConfig | null;
  /** Plugin registry broadcast by the server right after `ServerSync` via
   *  the `plugin-registry` Tauri event.  Lists every plugin the server's
   *  plugin host loaded.  Cleared on disconnect. */
  pluginRegistry: PluginRegistryEntry[];
  /** Decoded Tier-1 client manifests keyed by plugin name.  Only
   *  trusted plugins appear here; pending/denied plugins are
   *  filtered out. */
  pluginManifests: PluginTier1Slice["pluginManifests"];
  /** Per-server trust decisions keyed by plugin name.  Loaded from
   *  `pluginTrust.json` whenever the active server changes. */
  pluginTrust: PluginTier1Slice["pluginTrust"];
  /** Plugins whose manifest is pending the user's trust decision.
   *  Drained one-at-a-time by `PluginTrustPrompt`. */
  pluginTrustQueue: PluginTier1Slice["pluginTrustQueue"];
  /** Settings panels declared by trusted plugins, plus live updates
   *  pushed via `ResponseKind.UpdatePanel`. */
  pluginPanels: PluginTier1Slice["pluginPanels"];
  /** Currently-visible plugin-rendered message cards (buttons / select
   *  menus attached to a plugin response). */
  pluginCards: PluginTier1Slice["pluginCards"];
  /** Active plugin-rendered modal dialog, or null. */
  pluginModal: PluginTier1Slice["pluginModal"];
  /** Pending plugin-pushed toasts. */
  pluginToasts: PluginTier1Slice["pluginToasts"];
  /** Plugin names allowed \"once\" for this session; cleared on disconnect. */
  pluginSessionTrust: PluginTier1Slice["pluginSessionTrust"];
  /** Custom server emotes pushed via `fancy-server-emotes`. Cleared on disconnect. */
  customServerEmotes: CustomServerEmote[];
  /** Plugin info records broadcast by the server via `fancy-plugin-info`
   *  shortly after connect. Keyed by plugin name. Cleared on disconnect.
   *  This is the canonical "which plugins are active on this server" registry:
   *  UI gated on a plugin's presence here disappears the moment the host
   *  broadcasts that the plugin was disabled (see `recordPluginDisabled`). */
  pluginInfos: Map<string, PluginInfoRecord>;
  /** Set when a server plugin was disabled at runtime *and* the local user has
   *  a view for it open, so a dialog can prompt (and, for live-doc, offer a
   *  local save) before the view is torn down. `null` otherwise. */
  pluginDisabledNotice: { name: string } | null;
  /** Whether the admin File Server dashboard is currently mounted, so a runtime
   *  disable of the file-server plugin can prompt the open admin. */
  fileServerAdminOpen: boolean;
  // Downloads state (downloads/unseenDownloadCount) lives in DownloadsSlice
  // (store/slices/downloads.ts).
  /** Fancy Mumble version of the connected server (v2-encoded), null if not a fancy server. */
  serverFancyVersion: number | null;
  /** Plugin ABI version the connected server's plugin host was compiled
   *  against (from FancyPluginAdminList.host_abi_version). null until an
   *  admin plugin list is received, or on a non-fancy server. */
  serverHostAbiVersion: number | null;

  // Voice state (voiceState/udpActive/inCall/talkingSessions/listenedChannels)
  // lives in VoiceSlice (store/slices/voice.ts).
  // DM state lives in DmSlice (store/slices/dm.ts).

  // -- Poll state (in-memory, not persisted) ---------------------
  /** All known polls keyed by poll ID. */
  polls: Map<string, PollPayload>;
  /** Synthetic local-only messages for rendering polls in the chat flow. */
  pollMessages: ChatMessage[];

  // -- Optimistic outbound messages (in-memory, not persisted) ---
  /** Messages we have started sending but haven't yet confirmed. */
  pendingMessages: PendingMessage[];

  // -- Link embed state (in-memory, not persisted) ---------------
  /** Link embeds keyed by message_id. */
  linkEmbeds: Map<string, import("../types").LinkEmbed[]>;

  /** Whether the user has opted out of requesting link previews. */
  disableLinkPreviews: boolean;

  /** Whether the user allows external embed sources (e.g. YouTube IFrame API). */
  enableExternalEmbeds: boolean;

  /** Streamer mode - when true, sensitive identifiers (host/IP) are
   *  masked across the UI to keep them out of screen captures. */
  streamerMode: boolean;

  /** Monotonic counter incremented whenever the module-level reaction store changes. */
  reactionVersion: number;

  /** Unseen pin message IDs per channel (channel_id -> set of message_ids). */
  unseenPinIds: Map<number, Set<string>>;

  /** Monotonic counter incremented whenever the module-level read receipt store changes. */
  readReceiptVersion: number;

  /** Map of channel_id -> set of session IDs currently typing. */
  typingUsers: Map<number, Set<number>>;

  /** Active watch-together sessions keyed by their session UUID. */
  watchSessions: Map<string, WatchSession>;
  /** Monotonic counter bumped whenever any watch session is mutated. */
  watchSessionsVersion: number;

  // -- Screen share state (in-memory) ----------------------------
  /** Whether we are currently sharing our own screen. */
  isSharingOwn: boolean;
  /** The Mumble session ID of the tab whose webcam/screen is being captured
   *  locally.  Set when `startSharing` succeeds, cleared when broadcasting
   *  stops.  Compared against the current tab's `ownSession` so that other
   *  server tabs in the same window do not mistake themselves for the
   *  broadcaster (which would render a phantom local stream and a stray
   *  "Desktop overlay" button on the wrong tab). */
  broadcastingOwnSession: number | null;
  /** Whether the broadcaster WebRTC connection is still negotiating. */
  webrtcConnecting: boolean;
  /** Inline error message when a WebRTC operation fails (e.g. unreachable SFU). */
  webrtcError: string | null;
  /** Whether the click-through desktop drawing-overlay window is currently
   *  open.  Persisted in the global store (rather than as React local state
   *  in `OwnBroadcastPreview`) so that switching to a different server tab
   *  - which unmounts the preview component - does not implicitly close
   *  the overlay.  Cleared automatically when broadcasting stops. */
  desktopDrawingOverlayOpen: boolean;
  /** Active Live Doc sessions, keyed by channel id.  Set when the
   *  local user opens or accepts a Live Doc invite; cleared on close.
   *  Defined inline (rather than a separate import) to avoid a circular
   *  dependency between the store and the chat components that consume
   *  the session object. */
  activeLiveDocs: Map<string, LiveDocSessionInfo>;
  /** Pending Live Doc announces shown as banners in chat.  Keyed by
   *  `liveDocKey(activeServerId, channelId)`; the most recent announce wins. */
  pendingLiveDocAnnounces: Map<string, LiveDocAnnounceInfo>;
  /** Pending markdown seed content the editor should insert into a
   *  freshly-opened doc.  Consumed once on first WS-connected mount
   *  by `LiveDocPanel`.  Keyed by `liveDocKey(activeServerId, channelId)`. */
  pendingLiveDocSeeds: Map<string, string>;
  /** Channel IDs where the screen-share drawing tools (color picker,
   *  width slider, clear button) are currently active.  Stored in the
   *  global store so the toggle button in `StreamControls` and the
   *  toolbar in `DrawingOverlay` stay in sync, and so switching tabs
   *  preserves the active state. */
  drawingActiveChannels: Set<number>;
  /** Session IDs of other users currently broadcasting. */
  broadcastingSessions: Set<number>;
  /** Session IDs whose live screen-share is currently displayed in a
   *  detached popout window.  The main window suppresses the
   *  "is sharing" banner for these sessions so the user does not see
   *  a redundant prompt to watch a stream they are already viewing. */
  poppedOutStreamSessions: Set<number>;
  /** Session ID we are currently watching (null if not watching). */
  watchingSession: number | null;
  /** The Mumble session ID of the tab whose viewer is currently watching
   *  `watchingSession`.  Set when `watchBroadcast` runs, cleared when
   *  `stopWatching` runs.  Compared against the current tab's `ownSession`
   *  so that other server tabs in the same window do not mistake the
   *  watch state as their own (which would render a stray RemoteViewer
   *  - including on the broadcaster's tab, where it would try to render
   *  the broadcaster's own session as a remote stream and hang on
   *  "Connecting..."). */
  watchingOwnSession: number | null;

  // Persistent-chat state lives in PersistentChatSlice (store/slices/persistentChat.ts).
  // Notification state (silenced/mutedPush/pushSubscribed/userVolumes) lives in
  // NotificationsSlice (store/slices/notifications.ts).

  /** Server activity log entries (connect, disconnect, mute, channel move, etc.). */
  serverLog: ServerLogEntry[];

  /** Set when the server rejects with WrongUserPW/WrongServerPW - prompts the UI for a password. */
  passwordRequired: boolean;
  /** True after the user has submitted a password at least once (so we can show rejection errors on retries). */
  passwordAttempted: boolean;
  /** Connection params stored when a password prompt is needed so the user can retry. */
  pendingConnect: { host: string; port: number; username: string; certLabel: string | null } | null;
  /** Certificate label used for the active connection. Stays set until explicit disconnect. */
  connectedCertLabel: string | null;

  /** Human-readable label describing the current post-connect bootstrap
   *  stage ("Negotiating with server...", "Fetching channels...", etc.).
   *  Non-null implies bootstrapping is in progress: the connect-page
   *  loading bar stays visible until this clears, so the chat view is
   *  only revealed once it actually has data.  `null` when idle. */
  bootstrapStage: string | null;
  /** Number of reconnect attempts made since the active session's
   *  connection was lost. Reset to 0 once a connection is re-established. */
  reconnectAttempts: number;
  /** Epoch ms when the active session's connection was lost (and an
   *  auto-reconnect sequence began), or `null` when connected / idle.
   *  Drives the "time since last connection" counter in the reconnect view. */
  connectionLostAt: number | null;
  /** True while an auto-reconnect attempt is queued (waiting out the
   *  backoff) or in flight. Keeps the reconnect view visible between
   *  attempts instead of flashing the "Disconnected" card. */
  reconnectScheduled: boolean;
  /** Epoch ms when the next queued auto-reconnect attempt will fire, for
   *  the "next retry in Ns" countdown, or `null` when none is queued. */
  nextReconnectAt: number | null;

  // Actions
  connect: (host: string, port: number, username: string, certLabel?: string | null, password?: string | null) => Promise<void>;
  disconnect: () => Promise<void>;
  selectChannel: (id: number) => Promise<void>;
  joinChannel: (id: number) => Promise<void>;
  joinChannelWithPassword: (id: number, password: string) => Promise<void>;
  /** Read a 1:1 private chat room (friend chat / self-notepad) WITHOUT joining
   *  it: fetch its E2E history + pass the key challenge so live messages are
   *  delivered, while staying in your current channel. Idempotent. */
  peekChannel: (id: number) => Promise<void>;
  sendMessage: (channelId: number, body: string) => Promise<void>;
  /**
   * Insert a synthetic pending-message placeholder.  Used by the chat
   * composer to surface UI feedback while local media processing
   * (image/video re-encoding) runs BEFORE the actual `send_message`
   * call.  Returns the generated pending id so the caller can dismiss
   * or fail it once processing finishes.
   */
  addPendingPlaceholder: (channelId: number | null, dmSession: number | null, body: string) => string;
  /** Mark an existing pending message as failed with an error message. */
  markPendingFailed: (pendingId: string, errorMessage: string) => void;
  /** Discard a failed pending message. */
  dismissPendingMessage: (pendingId: string) => void;
  /** Retry a failed pending message. */
  retryPendingMessage: (pendingId: string) => Promise<void>;
  editMessage: (channelId: number, messageId: string, newBody: string) => Promise<void>;

  // Channel management
  createChannel: (parentId: number, name: string, opts?: {
    description?: string;
    position?: number;
    temporary?: boolean;
    maxUsers?: number;
    pchatProtocol?: PchatProtocol;
    pchatMaxHistory?: number;
    pchatRetentionDays?: number;
    password?: string;
    hidden?: boolean;
    expiryMode?: number;
    expiryDurationSecs?: number;
    /** Registered user_ids to invite (private meeting room). Create-only. */
    invitees?: number[];
  }) => Promise<void>;
  updateChannel: (channelId: number, opts: {
    name?: string;
    description?: string;
    position?: number;
    temporary?: boolean;
    maxUsers?: number;
    pchatProtocol?: PchatProtocol;
    pchatMaxHistory?: number;
    pchatRetentionDays?: number;
    password?: string;
    hidden?: boolean;
    expiryMode?: number;
    expiryDurationSecs?: number;
  }) => Promise<void>;
  deleteChannel: (channelId: number) => Promise<void>;
  moveChannelUsers: (fromChannelId: number, toChannelId: number) => Promise<void>;

  // -- Multi-server (Phase C) ------------------------------------
  /** Snapshot of every backend session currently registered.  Survives
   *  disconnects of individual sessions; only cleared by `refreshSessions`. */
  sessions: import("../types").SessionMeta[];
  /** Backend's currently-active session id (the one frontend commands
   *  without an explicit serverId target).  `null` when no sessions. */
  activeServerId: import("../types").ServerId | null;
  /** Re-pull `list_servers` + `get_active_server` from the backend.
   *  Idempotent; safe to call after any connect / disconnect. */
  refreshSessions: () => Promise<void>;
  /** Make `id` the backend's active session, then refresh per-session
   *  data (channels / users / messages) for the new active session. */
  switchServer: (id: import("../types").ServerId) => Promise<void>;
  /** Tear down a single session by id (used by the tab-close button).
   *  Suppresses the "Connection lost" overlay and switches the active
   *  view to the next remaining session, or to the connect page when
   *  no sessions remain. */
  disconnectSession: (id: import("../types").ServerId) => Promise<void>;
  /** Total unread message count per session (channels + DMs combined),
   *  keyed by serverId.  Updated from `unread-changed` /
   *  `dm-unread-changed` events for non-active sessions; the active
   *  session's totals live in `unreadCounts` / `dmUnreadCounts`. */
  sessionUnreadTotals: Record<string, number>;
  /** Last disconnect / rejection reason per session, keyed by serverId.
   *  Populated by `server-disconnected` / `connection-rejected` listeners
   *  for *every* session (active or not) so that switching to a
   *  disconnected tab restores its specific reason in the UI. */
  sessionErrors: Record<string, string | null>;

  refreshState: () => Promise<void>;
  refreshMessages: (channelId: number) => Promise<void>;
  // Voice actions (toggleListen/enableVoice/disableVoice/toggleMute/toggleDeafen)
  // live in VoiceSlice (store/slices/voice.ts).
  selectUser: (session: number | null) => void;
  sendPluginData: (receiverSessions: number[], data: Uint8Array, dataId: string) => Promise<void>;
  /** Upload a local file via the server-side file-server plugin. Returns the
   *  signed download URL on success. Throws if no file-server is configured. */
  uploadFile: (params: {
    filePath: string;
    channelId: number;
    mode: FileAccessMode;
    password?: string;
    /** Requested lifetime in seconds (undefined = server default, 0 = never). */
    ttlSeconds?: number;
    filename?: string;
    mimeType?: string;
    uploadId?: string;
  }) => Promise<UploadResponse>;
  /** Download a file (handling password / session-JWT pre-auth automatically)
   *  to `destPath`. Returns the number of bytes written. */
  downloadFile: (params: {
    url: string;
    destPath: string;
    /** Optional password (only used when the file uses `mode=password`). */
    password?: string;
  }) => Promise<number>;
  /** Send a WebRTC screen-sharing signaling message via native proto. */
  sendWebRtcSignal: (targetSession: number, signalType: number, payload: string, serverId?: string | null) => Promise<void>;
  /** Send a reaction (add/remove) on a persistent chat message via native proto. */
  sendReaction: (channelId: number, messageId: string, emoji: string, action: "add" | "remove") => Promise<void>;
  /** Pin or unpin a message in a persistent channel. */
  pinMessage: (channelId: number, messageId: string, unpin: boolean) => Promise<void>;
  /** Mark all unseen pin notifications as seen for a channel. */
  clearUnseenPins: (channelId: number) => void;
  // Download actions (addDownload/markDownloadsSeen/removeDownload/clearDownloads)
  // live in DownloadsSlice (store/slices/downloads.ts).
  /** Upload a new custom server emote. Requires admin permission. */
  addCustomEmote: (params: {
    shortcode: string;
    aliasEmoji: string;
    description?: string;
    filePath: string;
    mimeType: string;
  }) => Promise<void>;
  /** Delete a custom server emote by shortcode. Requires admin permission. */
  removeCustomEmote: (shortcode: string) => Promise<void>;
  /** Add a poll to the store (called locally when creating a poll). */
  addPoll: (poll: PollPayload, isOwn: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
  /** Retry connection with a password after a WrongUserPW/WrongServerPW rejection. */
  retryWithPassword: (password: string) => Promise<void>;
  /** Dismiss the password prompt without retrying. */
  dismissPasswordPrompt: () => void;

  // Plugin lifecycle
  /** Handle a host broadcast that a server plugin was disabled at runtime:
   *  drop it from the registry, clear its feature state, log an activity entry,
   *  and (when the user has a view for it open) raise `pluginDisabledNotice`. */
  recordPluginDisabled: (name: string) => void;
  /** Dismiss the plugin-disabled dialog and tear down the affected view. */
  dismissPluginDisabledNotice: () => void;
  /** Track whether the admin File Server dashboard is mounted. */
  setFileServerAdminOpen: (open: boolean) => void;

  // Live Doc
  /** Open (or re-attach to) a Live Doc session and surface its panel. */
  openLiveDoc: (session: LiveDocSessionInfo) => void;
  /** Close the active Live Doc panel for a channel.  Idempotent.
   *  Pass `appServerId` to target a specific server tab instead of the
   *  currently active one (essential when the panel session belongs to
   *  a tab that may not be the foreground tab at click time). */
  closeActiveLiveDoc: (
    channelId: number,
    appServerId?: import("../types").ServerId | null,
  ) => void;
  /** Record a pending Live Doc announce so the chat banner can render. */
  setLiveDocAnnounce: (announce: LiveDocAnnounceInfo) => void;
  /** Dismiss a pending Live Doc announce for a channel.  Pass
   *  `appServerId` to target a specific server tab. */
  clearLiveDocAnnounce: (
    channelId: number,
    appServerId?: import("../types").ServerId | null,
  ) => void;
  /** Ask the server to open a Live Doc by slug.  Server validates and
   *  replies with a `fancy-live-doc/invite` PluginDataTransmission that
   *  the plugin-data dispatcher turns into an `openLiveDoc` call. */
  /** Open or join a Live Doc.  Pass `silent: true` when joining via an
   *  existing invite card so the client does NOT post a second invite
   *  card to the channel (the original one is still valid). */
  requestOpenLiveDoc: (
    channelId: number,
    slug: string,
    title: string,
    options?: { silent?: boolean; mode?: "private" | "publish" },
  ) => Promise<void>;
  /** Publish an already-open document to a channel (owner only). */
  publishLiveDoc: (channelId: number, slug: string) => Promise<void>;
  /** Rename the active Live Doc: update the local session title and send
   *  a best-effort `Rename` plugin message so the server can persist the
   *  new name.  Live propagation to peers is handled separately via the
   *  shared Yjs document. */
  renameActiveLiveDoc: (
    channelId: number,
    slug: string,
    title: string,
    appServerId?: import("../types").ServerId | null,
  ) => void;
  /** Ask the live-doc server to flush/snapshot the document now
   *  (owner-initiated manual save).  Best-effort plugin message. */
  saveLiveDoc: (channelId: number, slug: string) => Promise<void>;
  /** Stash markdown text for the editor to consume on next mount. */
  setPendingLiveDocSeed: (
    channelId: number,
    markdown: string,
    appServerId?: import("../types").ServerId | null,
  ) => void;
  /** Atomic take-and-clear of the pending seed for a channel. */
  consumePendingLiveDocSeed: (
    channelId: number,
    appServerId?: import("../types").ServerId | null,
  ) => string | undefined;

  // Notification actions (silence / push-mute / per-user volume) live in
  // NotificationsSlice (store/slices/notifications.ts).

  // DM actions live in DmSlice (store/slices/dm.ts).

  // Persistent-chat actions live in PersistentChatSlice (store/slices/persistentChat.ts).
}

const INITIAL: Pick<
  AppState,
  | "channelPersistence"
  | "keyTrust"
  | "custodianPins"
  | "pendingDisputes"
  | "pchatHistoryLoading"
  | "pendingKeyShares"
  | "keyHolders"
  | "pchatKeyRevoked"
  | "signalBridgeError"
  | "status"
  | "channels"
  | "users"
  | "selectedChannel"
  | "currentChannel"
  | "selectedUser"
  | "ownSession"
  | "messages"
  | "error"
  | "listenedChannels"
  | "unreadCounts"
  | "serverConfig"
  | "fileServerConfig"
  | "fileServerCapabilities"
  | "liveDocPluginConfig"
  | "pluginRegistry"
  | "pluginManifests"
  | "pluginTrust"
  | "pluginTrustQueue"
  | "pluginPanels"
  | "pluginCards"
  | "pluginModal"
  | "pluginToasts"
  | "pluginSessionTrust"
  | "customServerEmotes"
  | "pluginInfos"
  | "pluginDisabledNotice"
  | "fileServerAdminOpen"
  | "downloads"
  | "unseenDownloadCount"
  | "serverFancyVersion"
  | "serverHostAbiVersion"
  | "voiceState"
  | "udpActive"
  | "inCall"
  | "talkingSessions"
  | "selectedDmUser"
  | "dmMessages"
  | "dmUnreadCounts"
  | "polls"
  | "pollMessages"
  | "pendingMessages"
  | "linkEmbeds"
  | "reactionVersion"
  | "unseenPinIds"
  | "readReceiptVersion"
  | "typingUsers"
  | "watchSessions"
  | "watchSessionsVersion"
  | "isSharingOwn"
  | "broadcastingOwnSession"
  | "webrtcConnecting"
  | "webrtcError"
  | "desktopDrawingOverlayOpen"
  | "activeLiveDocs"
  | "pendingLiveDocAnnounces"
  | "pendingLiveDocSeeds"
  | "drawingActiveChannels"
  | "broadcastingSessions"
  | "poppedOutStreamSessions"
  | "watchingSession"
  | "watchingOwnSession"
  | "silencedChannels"
  | "mutedPushChannels"
  | "pushSubscribedChannels"
  | "userVolumes"
  | "serverLog"
  | "passwordRequired"
  | "passwordAttempted"
  | "pendingConnect"
  | "connectedCertLabel"
  | "bootstrapStage"
  | "reconnectAttempts"
  | "connectionLostAt"
  | "reconnectScheduled"
  | "nextReconnectAt"
> = {
  ...persistentChatInitialState,
  ...dmInitialState,
  ...voiceInitialState,
  ...notificationsInitialState,
  ...downloadsInitialState,
  status: "disconnected",
  channels: [],
  users: [],
  selectedChannel: null,
  currentChannel: null,
  selectedUser: null,
  ownSession: null,
  messages: [],
  error: null,
  unreadCounts: {},
  serverConfig: {
    max_message_length: 5000,
    max_image_message_length: 131072,
    allow_html: true,
    webrtc_sfu_available: false,
    fancy_rest_api_url: null,
  },
  fileServerConfig: null,
  fileServerCapabilities: null,
  liveDocPluginConfig: null,
  pluginRegistry: [],
  pluginManifests: emptyPluginTier1Slice.pluginManifests,
  pluginTrust: emptyPluginTier1Slice.pluginTrust,
  pluginTrustQueue: emptyPluginTier1Slice.pluginTrustQueue,
  pluginPanels: emptyPluginTier1Slice.pluginPanels,
  pluginCards: emptyPluginTier1Slice.pluginCards,
  pluginModal: emptyPluginTier1Slice.pluginModal,
  pluginToasts: emptyPluginTier1Slice.pluginToasts,
  pluginSessionTrust: emptyPluginTier1Slice.pluginSessionTrust,
  customServerEmotes: [],
  pluginInfos: new Map(),
  pluginDisabledNotice: null,
  fileServerAdminOpen: false,
  serverFancyVersion: null,
  serverHostAbiVersion: null,
  polls: new Map(),
  pollMessages: [],
  pendingMessages: [],
  linkEmbeds: new Map(),
  reactionVersion: 0,
  unseenPinIds: new Map(),
  readReceiptVersion: 0,
  typingUsers: new Map(),
  watchSessions: new Map(),
  watchSessionsVersion: 0,
  isSharingOwn: false,
  broadcastingOwnSession: null,
  webrtcConnecting: false,
  webrtcError: null,
  desktopDrawingOverlayOpen: false,
  activeLiveDocs: new Map(),
  pendingLiveDocAnnounces: new Map(),
  pendingLiveDocSeeds: new Map(),
  drawingActiveChannels: new Set(),
  broadcastingSessions: new Set(),
  poppedOutStreamSessions: new Set(),
  watchingSession: null,
  watchingOwnSession: null,
  serverLog: [],
  passwordRequired: false,
  passwordAttempted: false,
  pendingConnect: null,
  connectedCertLabel: null,
  bootstrapStage: null,
  reconnectAttempts: 0,
  connectionLostAt: null,
  reconnectScheduled: false,
  nextReconnectAt: null,
};

// --- Store --------------------------------------------------------

/**
 * Monotonically increasing sequence number for channel-message writes.
 * Every async operation that sets `messages` bumps this counter before
 * starting the IPC round-trip and only applies the result when the
 * counter hasn't been bumped again in the meantime.  This prevents
 * stale `get_messages` responses from overwriting fresher data.
 */
let messageWriteSeq = 0;

/**
 * Threshold (in HTML body length) above which a sent message gets an
 * optimistic placeholder + progress UI even when it doesn't contain an
 * image.  Picked so plain chat messages never trigger the indicator
 * but anything that is likely to take noticeable time on a slow link
 * does.
 */
const LARGE_MESSAGE_THRESHOLD = 4096;

/** Whether a message body should show an optimistic upload-progress UI. */
export function bodyNeedsProgressUI(body: string): boolean {
  if (body.includes("<img")) return true;
  if (body.includes("<video")) return true;
  return body.length > LARGE_MESSAGE_THRESHOLD;
}

export function newPendingId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Update the taskbar badge with the total unread count (channels + DMs). */
export function updateBadgeCount(): void {
  const { unreadCounts, dmUnreadCounts, silencedChannels } = useAppStore.getState();
  const channelSum = Object.entries(unreadCounts)
    .filter(([id]) => !silencedChannels.has(Number(id)))
    .reduce((a, [, b]) => a + b, 0);
  const dmSum = Object.values(dmUnreadCounts).reduce((a, b) => a + b, 0);
  const total = channelSum + dmSum;
  invoke("update_badge_count", { count: total > 0 ? total : null }).catch(() => {
    // Badge API may not be available on all platforms.
  });
}

// applyDmPersistence + the DM actions live in DmSlice (store/slices/dm.ts).

export const useAppStore = create<AppState>()((set, get, store) => ({
  ...INITIAL,
  ...createPersistentChatSlice(set, get, store),
  ...createDmSlice(set, get, store),
  ...createVoiceSlice(set, get, store),
  ...createNotificationsSlice(set, get, store),
  ...createDownloadsSlice(set, get, store),
  disableLinkPreviews: false,
  enableExternalEmbeds: false,
  streamerMode: false,

  // Multi-server (Phase C): outside INITIAL so it survives single-session disconnects.
  sessions: [],
  activeServerId: null,
  sessionUnreadTotals: {},
  sessionErrors: {},

  refreshSessions: async () => {
    try {
      const [sessions, activeServerId] = await Promise.all([
        invoke<import("../types").SessionMeta[]>("list_servers"),
        invoke<import("../types").ServerId | null>("get_active_server"),
      ]);
      set((prev) => {
        // Drop per-tab badge entries for sessions that no longer exist.
        const ids = new Set(sessions.map((s) => s.id));
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(prev.sessionUnreadTotals)) {
          const baseId = k.split(":")[0];
          if (ids.has(baseId)) next[k] = v;
        }
        // Drop stored errors for sessions that no longer exist.
        const nextErrors: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(prev.sessionErrors)) {
          if (ids.has(k)) nextErrors[k] = v;
        }
        const activeMeta = activeServerId ? sessions.find((s) => s.id === activeServerId) : undefined;
        const status = activeMeta?.status ?? prev.status;
        const error = activeMeta?.status === "connected" ? null : (nextErrors[activeServerId ?? ""] ?? prev.error);
        return { sessions, activeServerId, sessionUnreadTotals: next, sessionErrors: nextErrors, status, error };
      });
    } catch (e) {
      console.error("refreshSessions error:", e);
    }
  },

  switchServer: async (id) => {
    try {
      await invoke("set_active_server", { serverId: id });
      // Clear our per-tab badge cache for the newly-active session;
      // its unreads now live in `unreadCounts` / `dmUnreadCounts`.
      set((prev) => {
        const next = { ...prev.sessionUnreadTotals };
        delete next[id];
        delete next[`${id}:ch`];
        delete next[`${id}:dm`];
        return { activeServerId: id, sessionUnreadTotals: next };
      });
      // Sync global status/error from this session's own metadata so the
      // ChatPage overlay reflects the tab the user just switched to,
      // not whatever the previously-active tab's status was.
      await get().refreshSessions().catch(() => {});
      const { sessions, sessionErrors } = get();
      const meta = sessions.find((s) => s.id === id);
      const sessionStatus = meta?.status ?? "disconnected";
      set({
        status: sessionStatus,
        error: sessionStatus === "connected" ? null : (sessionErrors[id] ?? null),
      });
      // Repopulate per-session data for the newly-active session.
      await get().refreshState();
      try {
        const currentCh = await invoke<number | null>("get_current_channel");
        set({ currentChannel: currentCh, selectedChannel: currentCh });
        if (currentCh !== null) {
          const messages = await invoke<ChatMessage[]>("get_messages", { channelId: currentCh });
          set({ messages });
        } else {
          set({ messages: [] });
        }
      } catch (e) {
        console.error("switchServer post-switch refresh error:", e);
      }
      try {
        const ownSession = await invoke<number | null>("get_own_session");
        set({ ownSession });
      } catch {
        // not connected; leave as-is.
      }
    } catch (e) {
      console.error("switchServer error:", e);
      throw e;
    }
  },

  disconnectSession: async (id) => {
    intentionallyClosingSessions.add(id);
    const wasActive = get().activeServerId === id;
    try {
      await invoke("disconnect_server", { serverId: id });
    } catch (e) {
      console.error("disconnectSession error:", e);
      intentionallyClosingSessions.delete(id);
      throw e;
    }
    // Drop the cached error for the closed session.
    set((prev) => {
      if (prev.sessionErrors[id] == null) return prev;
      const next = { ...prev.sessionErrors };
      delete next[id];
      return { sessionErrors: next };
    });
    // Drop live-doc state scoped to the closed server tab so it cannot
    // bleed into another tab on the same channel id.
    set((prev) => {
      const prefix = `${id}|`;
      const filter = <V,>(m: Map<string, V>): Map<string, V> => {
        let changed = false;
        const next = new Map(m);
        for (const k of m.keys()) {
          if (k.startsWith(prefix)) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : m;
      };
      return {
        activeLiveDocs: filter(prev.activeLiveDocs),
        pendingLiveDocAnnounces: filter(prev.pendingLiveDocAnnounces),
        pendingLiveDocSeeds: filter(prev.pendingLiveDocSeeds),
      };
    });
    // Refresh the sessions list and learn which session (if any) the
    // backend made active in place of the one we just closed.
    await get().refreshSessions().catch(() => {});
    const { sessions: nextSessions, activeServerId: nextActive } = get();
    if (wasActive) {
      if (nextActive && nextSessions.some((s) => s.id === nextActive)) {
        // The backend rebound the active session to a remaining one.
        // Reflect its status / error / data in the global store.
        await get().switchServer(nextActive).catch(() => {});
      } else {
        // No sessions left - reset to the empty connect-page state.
        manualDisconnectRequested = true;
        offloadManager.dispose().catch(() => {});
        volumeAppliedSessions.clear();
        clearReadReceipts();
        useOnboardingStore.getState().clear();
        set({ ...INITIAL });
        invoke("update_badge_count", { count: null }).catch(() => {});
        navigateRef?.("/");
      }
    }
    intentionallyClosingSessions.delete(id);
  },

  connect: async (host, port, username, certLabel, password) => {
    manualDisconnectRequested = false;
    clearAutoReconnectTimer();
    set({
      status: "connecting",
      error: null,
      passwordRequired: false,
      pendingConnect: { host, port, username, certLabel: certLabel ?? null },
      connectedCertLabel: certLabel ?? null,
      bootstrapStage: "Negotiating with server...",
    });
    try {
      await invoke("connect", {
        host,
        port,
        username,
        certLabel: certLabel ?? null,
        password: password ?? null,
      });
      // Sync activeServerId before rejection events arrive, so listener
      // routing works even if the new session id isn't known yet.
      await get().refreshSessions().catch(() => {});
    } catch (e) {
      set({
        status: "disconnected",
        error: String(e),
        pendingConnect: null,
        connectedCertLabel: null,
        bootstrapStage: null,
      });
    }
  },

  disconnect: async () => {
    clearAutoReconnectTimer();
    const activeId = get().activeServerId;
    if (activeId) {
      // Delegate to the multi-session-aware path so closing the active
      // session via the sidebar button behaves identically to closing
      // it via the tab close button: the backend rebinds `inner` to
      // the next session and the UI follows along instead of flashing
      // a misleading "Connection lost" overlay on the next tab.
      try {
        await get().disconnectSession(activeId);
      } catch (e) {
        console.error("disconnect error:", e);
      }
      return;
    }
    // No active session - fall back to a full local reset.
    manualDisconnectRequested = true;
    try {
      await offloadManager.dispose();
      await invoke("disconnect");
    } catch (e) {
      console.error("disconnect error:", e);
    }
    resetReactions();
    clearReadReceipts();
    useOnboardingStore.getState().clear();
    set({ ...INITIAL });
    invoke("update_badge_count", { count: null }).catch(() => {});
    useAppStore.getState().refreshSessions().catch(() => {});
  },

  selectChannel: async (id) => {
    set({ selectedChannel: id, selectedDmUser: null, dmMessages: [] });
    const seq = ++messageWriteSeq;
    try {
      // Notify backend - marks channel as read and clears DM selection.
      await invoke("select_channel", { channelId: id });
      const messages = await invoke<ChatMessage[]>("get_messages", {
        channelId: id,
      });
      // Only apply if no newer write has started (avoids overwriting
      // fresher data from a concurrent refreshMessages / new-message).
      if (messageWriteSeq === seq) {
        set({ messages });
      }
    } catch (e) {
      console.error("select_channel error:", e);
    }
  },

  joinChannel: async (id) => {
    try {
      await invoke("join_channel", { channelId: id });
    } catch (e) {
      console.error("join_channel error:", e);
    }
  },

  peekChannel: async (id) => {
    try {
      await invoke("peek_pchat_channel", { channelId: id });
    } catch (e) {
      console.error("peek_pchat_channel error:", e);
    }
  },

  joinChannelWithPassword: async (id, password) => {
    try {
      await invoke("join_channel", { channelId: id, password });
    } catch (e) {
      console.error("join_channel error:", e);
      throw e;
    }
  },

  createChannel: async (parentId, name, opts = {}) => {
    try {
      await invoke("create_channel", {
        parentId,
        name,
        description: opts.description ?? null,
        position: opts.position ?? null,
        temporary: opts.temporary ?? null,
        maxUsers: opts.maxUsers ?? null,
        pchatProtocol: opts.pchatProtocol ?? null,
        pchatMaxHistory: opts.pchatMaxHistory ?? null,
        pchatRetentionDays: opts.pchatRetentionDays ?? null,
        password: opts.password ?? null,
        hidden: opts.hidden ?? null,
        expiryMode: opts.expiryMode ?? null,
        expiryDurationSecs: opts.expiryDurationSecs ?? null,
        invitees: opts.invitees ?? null,
      });
    } catch (e) {
      console.error("create_channel error:", e);
      throw e;
    }
  },

  updateChannel: async (channelId, opts) => {
    try {
      await invoke("update_channel", {
        channelId,
        name: opts.name ?? null,
        description: opts.description ?? null,
        position: opts.position ?? null,
        temporary: opts.temporary ?? null,
        maxUsers: opts.maxUsers ?? null,
        pchatProtocol: opts.pchatProtocol ?? null,
        pchatMaxHistory: opts.pchatMaxHistory ?? null,
        pchatRetentionDays: opts.pchatRetentionDays ?? null,
        password: opts.password ?? null,
        hidden: opts.hidden ?? null,
        expiryMode: opts.expiryMode ?? null,
        expiryDurationSecs: opts.expiryDurationSecs ?? null,
      });
    } catch (e) {
      console.error("update_channel error:", e);
      throw e;
    }
  },

  deleteChannel: async (channelId) => {
    try {
      await invoke("delete_channel", { channelId });
    } catch (e) {
      console.error("delete_channel error:", e);
      throw e;
    }
  },

  moveChannelUsers: async (fromChannelId, toChannelId) => {
    try {
      await invoke("move_channel_users", { fromChannelId, toChannelId });
    } catch (e) {
      console.error("move_channel_users error:", e);
      throw e;
    }
  },

  sendMessage: async (channelId, body) => {
    const pendingId = newPendingId();
    const showPlaceholder = bodyNeedsProgressUI(body);
    if (showPlaceholder) {
      set((s) => ({
        pendingMessages: [
          ...s.pendingMessages,
          {
            pendingId,
            channelId,
            dmSession: null,
            body,
            createdAt: Date.now(),
            state: "sending",
          },
        ],
      }));
    }
    try {
      await invoke("send_message", { channelId, body });
      const seq = ++messageWriteSeq;
      const messages = await invoke<ChatMessage[]>("get_messages", {
        channelId,
      });
      const updates: Partial<AppState> = {};
      if (messageWriteSeq === seq) {
        updates.messages = messages;
      }
      if (showPlaceholder) {
        set((s) => ({
          ...updates,
          pendingMessages: s.pendingMessages.filter((p) => p.pendingId !== pendingId),
        }));
      } else if (Object.keys(updates).length > 0) {
        set(updates);
      }
    } catch (e) {
      console.error("send_message error:", e);
      if (showPlaceholder) {
        const detail = e instanceof Error ? e.message : String(e);
        set((s) => ({
          pendingMessages: s.pendingMessages.map((p) =>
            p.pendingId === pendingId
              ? { ...p, state: "failed" as const, errorMessage: detail }
              : p,
          ),
        }));
      }
    }
  },

  dismissPendingMessage: (pendingId) => {
    set((s) => ({
      pendingMessages: s.pendingMessages.filter((p) => p.pendingId !== pendingId),
    }));
  },

  addPendingPlaceholder: (channelId, dmSession, body) => {
    const pendingId = newPendingId();
    set((s) => ({
      pendingMessages: [
        ...s.pendingMessages,
        {
          pendingId,
          channelId,
          dmSession,
          body,
          createdAt: Date.now(),
          state: "sending",
        },
      ],
    }));
    return pendingId;
  },

  markPendingFailed: (pendingId, errorMessage) => {
    set((s) => ({
      pendingMessages: s.pendingMessages.map((p) =>
        p.pendingId === pendingId
          ? { ...p, state: "failed" as const, errorMessage }
          : p,
      ),
    }));
  },

  retryPendingMessage: async (pendingId) => {
    const target = get().pendingMessages.find((p) => p.pendingId === pendingId);
    if (!target) return;
    set((s) => ({
      pendingMessages: s.pendingMessages.filter((p) => p.pendingId !== pendingId),
    }));
    if (target.dmSession !== null) {
      await get().sendDm(target.dmSession, target.body);
    } else if (target.channelId !== null) {
      await get().sendMessage(target.channelId, target.body);
    }
  },

  editMessage: async (channelId, messageId, newBody) => {
    try {
      await invoke("edit_message", { channelId, messageId, newBody });
      const seq = ++messageWriteSeq;
      const messages = await invoke<ChatMessage[]>("get_messages", {
        channelId,
      });
      if (messageWriteSeq === seq) {
        set({ messages });
      }
    } catch (e) {
      console.error("edit_message error:", e);
    }
  },

  refreshState: async () => {
    try {
      const [channels, users, pushSubscribed] = await Promise.all([
        invoke<ChannelEntry[]>("get_channels"),
        invoke<UserEntry[]>("get_users"),
        invoke<number[]>("get_push_subscribed_channels"),
      ]);

      // Derive channelPersistence from channel pchat_protocol so the
      // PersistenceBanner (and its loading indicator) can render.
      const prev = get().channelPersistence;
      const nextPersistence: Record<number, ChannelPersistenceState> = { ...prev };
      for (const ch of channels) {
        if (ch.pchat_protocol && ch.pchat_protocol !== "none") {
          const mode = ch.pchat_protocol.toUpperCase() as PersistenceMode;
          nextPersistence[ch.id] = {
            mode,
            maxHistory: ch.pchat_max_history ?? prev[ch.id]?.maxHistory ?? 0,
            retentionDays: ch.pchat_retention_days ?? prev[ch.id]?.retentionDays ?? 0,
            hasMore: prev[ch.id]?.hasMore ?? false,
            isFetching: prev[ch.id]?.isFetching ?? false,
            totalStored: prev[ch.id]?.totalStored ?? 0,
          };
        }
      }
      set({ channels, users, channelPersistence: nextPersistence, pushSubscribedChannels: new Set(pushSubscribed) });

      // Clean up broadcastingSessions for users that are no longer connected.
      const currentSessions = new Set(users.map((u) => u.session));
      const { broadcastingSessions } = get();
      if (broadcastingSessions.size > 0) {
        const pruned = new Set([...broadcastingSessions].filter((s) => currentSessions.has(s)));
        if (pruned.size !== broadcastingSessions.size) {
          // Wipe drawings authored by anyone who disconnected mid-stream
          // so their annotations vanish for every viewer.  Imported
          // lazily to avoid a circular module dependency between the
          // store and the chat-only DrawingOverlay module.
          const dropped = [...broadcastingSessions].filter((s) => !currentSessions.has(s));
          if (dropped.length > 0) {
            void import("../components/chat/drawing/DrawingOverlay").then((m) => {
              for (const s of dropped) m.clearStrokesFromSender(s);
            }).catch(() => {});
          }
          set({ broadcastingSessions: pruned });
        }
      }
    } catch (e) {
      console.error("refresh error:", e);
    }
  },

  refreshMessages: async (channelId) => {
    const seq = ++messageWriteSeq;
    try {
      const messages = await invoke<ChatMessage[]>("get_messages", {
        channelId,
      });
      if (messageWriteSeq === seq) {
        set({ messages });
      }
    } catch (e) {
      console.error("refresh messages error:", e);
    }
  },

  selectUser: (session) => set({ selectedUser: session }),

  sendPluginData: async (_receiverSessions, _data, dataId) => {
    // PluginDataTransmission is permanently forbidden in Fancy Mumble.
    // The legacy generic carriage hid "silent drop" bugs whenever a
    // server-side plugin handler was missing; use a typed protobuf
    // message instead (see Mumble.proto IDs 141+ and the corresponding
    // `send_fancy_*` Tauri commands).
    const err = new Error(
      `PluginDataTransmission is forbidden in Fancy Mumble (dataId=${dataId}). ` +
      `Use a typed protobuf message instead: see proto/Mumble.proto IDs 141-145 ` +
      `and the send_fancy_* Tauri commands.  Add a new message (>= 146) if you ` +
      `need a new payload.`,
    );
    console.error("sendPluginData is BRICKED:", err);
    throw err;
  },

  uploadFile: async ({ filePath, channelId, mode, password, ttlSeconds, filename, mimeType, uploadId }) => {
    const cfg = get().fileServerConfig;
    if (!cfg) {
      throw new Error("file-server is not configured for this server");
    }
    if (mode === "password" && !password) {
      throw new Error("mode=password requires a password");
    }
    const resp = await invoke<UploadResponse>("upload_file", {
      request: {
        baseUrl: cfg.baseUrl,
        session: cfg.sessionId,
        uploadToken: cfg.uploadToken,
        channelId,
        filePath,
        filename,
        mimeType,
        mode,
        password,
        ttlSeconds,
        uploadId: uploadId ?? "",
      },
    });
    return { ...resp, download_url: rebaseFileServerUrl(resp.download_url) };
  },

  downloadFile: async ({ url, destPath, password }) => {
    const cfg = get().fileServerConfig;
    let credential: { kind: "password" | "session"; value: string } | undefined;
    if (password !== undefined) {
      credential = { kind: "password", value: password };
    } else if (cfg?.sessionJwt) {
      credential = { kind: "session", value: cfg.sessionJwt };
    }
    return await invoke<number>("download_file", {
      request: {
        url,
        destPath,
        credential,
      },
    });
  },

  sendWebRtcSignal: async (targetSession, signalType, payload, serverId) => {
    try {
      await invoke("send_webrtc_signal", {
        targetSession,
        signalType,
        payload,
        serverId: serverId ?? null,
      });
    } catch (e) {
      console.error("send_webrtc_signal error:", e);
    }
  },

  sendReaction: async (channelId, messageId, emoji, action) => {
    try {
      await invoke("send_reaction", { channelId, messageId, emoji, action });
    } catch (e) {
      console.error("send_reaction error:", e);
    }
  },

  pinMessage: async (channelId, messageId, unpin) => {
    try {
      await invoke("pin_message", { channelId, messageId, unpin });
    } catch (e) {
      console.error("pin_message error:", e);
    }
  },

  clearUnseenPins: (channelId) => {
    set((s) => {
      const next = new Map(s.unseenPinIds);
      next.delete(channelId);
      return { unseenPinIds: next };
    });
  },

  addCustomEmote: async ({ shortcode, aliasEmoji, description, filePath, mimeType }) => {
    const cfg = get().fileServerConfig;
    if (!cfg) throw new Error("file-server is not configured for this server");
    if (!cfg.canManageEmotes) throw new Error("you are not allowed to manage emotes");
    await invoke("add_custom_emote", {
      request: {
        baseUrl: cfg.baseUrl,
        sessionJwt: cfg.sessionJwt,
        shortcode,
        aliasEmoji,
        description,
        filePath,
        mimeType,
      },
    });
  },

  removeCustomEmote: async (shortcode) => {
    const cfg = get().fileServerConfig;
    if (!cfg) throw new Error("file-server is not configured for this server");
    if (!cfg.canManageEmotes) throw new Error("you are not allowed to manage emotes");
    await invoke("remove_custom_emote", {
      request: {
        baseUrl: cfg.baseUrl,
        sessionJwt: cfg.sessionJwt,
        shortcode,
      },
    });
  },

  addPoll: (poll, isOwn) => {
    registerPoll(poll);
    set((prev) => {
      const newPolls = new Map(prev.polls).set(poll.id, poll);
      // Avoid duplicate synthetic messages.
      if (prev.pollMessages.some((m) => m.body.includes(poll.id))) {
        return { polls: newPolls };
      }
      return {
        polls: newPolls,
        pollMessages: [
          ...prev.pollMessages,
          {
            sender_session: poll.creator,
            sender_name: poll.creatorName || "Unknown",
            body: `<!-- FANCY_POLL:${poll.id} -->`,
            channel_id: poll.channelId ?? 0,
            is_own: isOwn,
          },
        ],
      };
    });
  },
  setError: (error) => set({ error }),
  reset: () => set({ ...INITIAL }),

  retryWithPassword: async (password) => {
    const pending = get().pendingConnect;
    if (!pending) return;
    set({ passwordRequired: false, passwordAttempted: true, pendingConnect: null });
    await get().connect(pending.host, pending.port, pending.username, pending.certLabel, password);
  },

  dismissPasswordPrompt: () => {
    set({ passwordRequired: false, passwordAttempted: false, pendingConnect: null, connectedCertLabel: null });
  },

  // -- Plugin lifecycle -------------------------------------------

  recordPluginDisabled: (name) => {
    set((s) => {
      const patch: Partial<AppState> = {};
      // Drop from the canonical registry so every UI gated on plugin presence
      // (Server Info list, LiveDoc entries, ...) disappears at once.
      if (s.pluginInfos.has(name)) {
        const infos = new Map(s.pluginInfos);
        infos.delete(name);
        patch.pluginInfos = infos;
      }
      // Clear the plugin's feature state so stale creds/config can't linger,
      // and note whether the user currently has a view for it open.
      let viewOpen = false;
      if (name === PLUGIN_NAME_FILE_SERVER) {
        patch.fileServerConfig = null;
        patch.fileServerCapabilities = null;
        patch.customServerEmotes = [];
        viewOpen = s.fileServerAdminOpen;
      } else if (name === PLUGIN_NAME_LIVE_DOC) {
        patch.liveDocPluginConfig = null;
        viewOpen = s.activeLiveDocs.size > 0;
      }
      patch.serverLog = [
        ...s.serverLog,
        {
          timestamp_ms: Date.now(),
          message: i18next.t("common:plugins.disabledLog", {
            defaultValue: "Plugin “{{name}}” was disabled by the server",
            name: friendlyPluginName(name),
          }),
        },
      ];
      // Only the file-server contributes server-custom reactions; clear them.
      if (name === PLUGIN_NAME_FILE_SERVER) setServerCustomReactions([]);
      if (viewOpen) patch.pluginDisabledNotice = { name };
      return patch;
    });
  },

  dismissPluginDisabledNotice: () => {
    set((s) => {
      const notice = s.pluginDisabledNotice;
      if (!notice) return s;
      const patch: Partial<AppState> = { pluginDisabledNotice: null };
      // Tear down any open view for the now-disabled plugin.
      if (notice.name === PLUGIN_NAME_LIVE_DOC && s.activeLiveDocs.size > 0) {
        patch.activeLiveDocs = new Map();
      }
      return patch;
    });
  },

  setFileServerAdminOpen: (open) => set({ fileServerAdminOpen: open }),

  // -- Live Doc ---------------------------------------------------

  openLiveDoc: (session) => {
    set((state) => {
      const k = liveDocKey(session.appServerId, session.channelId);
      const next = new Map(state.activeLiveDocs);
      next.set(k, session);
      const announces = new Map(state.pendingLiveDocAnnounces);
      announces.delete(k);
      return { activeLiveDocs: next, pendingLiveDocAnnounces: announces };
    });
  },

  closeActiveLiveDoc: (channelId, appServerId) => {
    set((state) => {
      const targetServer = appServerId !== undefined ? appServerId : state.activeServerId;
      const k = liveDocKey(targetServer, channelId);
      if (!state.activeLiveDocs.has(k)) return state;
      const next = new Map(state.activeLiveDocs);
      next.delete(k);
      return { activeLiveDocs: next };
    });
  },

  setLiveDocAnnounce: (announce) => {
    set((state) => {
      const next = new Map(state.pendingLiveDocAnnounces);
      next.set(liveDocKey(announce.appServerId, announce.channelId), announce);
      return { pendingLiveDocAnnounces: next };
    });
  },

  clearLiveDocAnnounce: (channelId, appServerId) => {
    set((state) => {
      const targetServer = appServerId !== undefined ? appServerId : state.activeServerId;
      const k = liveDocKey(targetServer, channelId);
      if (!state.pendingLiveDocAnnounces.has(k)) return state;
      const next = new Map(state.pendingLiveDocAnnounces);
      next.delete(k);
      return { pendingLiveDocAnnounces: next };
    });
  },

  setPendingLiveDocSeed: (channelId, markdown, appServerId) => {
    set((state) => {
      const targetServer = appServerId !== undefined ? appServerId : state.activeServerId;
      const next = new Map(state.pendingLiveDocSeeds);
      next.set(liveDocKey(targetServer, channelId), markdown);
      return { pendingLiveDocSeeds: next };
    });
  },

  consumePendingLiveDocSeed: (channelId, appServerId) => {
    const state = get();
    const targetServer = appServerId !== undefined ? appServerId : state.activeServerId;
    const k = liveDocKey(targetServer, channelId);
    const current = state.pendingLiveDocSeeds.get(k);
    if (current === undefined) return undefined;
    set((s) => {
      const next = new Map(s.pendingLiveDocSeeds);
      next.delete(k);
      return { pendingLiveDocSeeds: next };
    });
    return current;
  },

  requestOpenLiveDoc: async (channelId, slug, title, options) => {
    const silent = options?.silent === true;
    const sanitised = slug
      .toLowerCase()
      .replaceAll(/[^a-z0-9_-]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 64);
    console.log("[store] requestOpenLiveDoc:", { channelId, slug, sanitised, title });
    if (!sanitised) {
      console.warn("[store] requestOpenLiveDoc aborted: slug sanitised to empty string", { slug });
      throw new Error("Document name produces empty slug; pick a different title.");
    }
    const trimmedTitle = title.trim().slice(0, 200);
    const mode = options?.mode ?? "publish";
    const key = `${channelId}|${sanitised}`;
    // De-dupe concurrent opens: if a request for this doc is already awaiting
    // its invite, don't fire another OpenRequest (rapid clicks would otherwise
    // spam the server with duplicate envelopes while the first is in flight).
    if (pendingLiveDocOpens.has(key)) {
      console.log("[store] requestOpenLiveDoc: open already in flight; skipping duplicate", { key });
      return;
    }
    const activeServerId = get().activeServerId;
    if (get().activeLiveDocs.has(liveDocKey(activeServerId, channelId))) {
      console.log("[store] requestOpenLiveDoc: channel already has active doc; skipping wait");
      await sendPluginMessage("fancy-live-doc", "OpenRequest", { channelId, slug: sanitised, title: trimmedTitle, mode });
      return;
    }
    const waitForInvite = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingLiveDocOpens.delete(key);
        console.warn("[store] requestOpenLiveDoc: timed out waiting for invite", { key });
        reject(new Error(
          "Server did not reply with a document invite within 8s. " +
          "The live-doc plugin may be disabled on this server " +
          "(set plugin.live-doc.enabled=true and plugin.live-doc.state_path in mumble-server.ini), " +
          "or you may lack permission in this channel.",
        ));
      }, 8000);
      pendingLiveDocOpens.set(key, {
        silent,
        mode,
        resolve: () => {
          clearTimeout(timer);
          pendingLiveDocOpens.delete(key);
          resolve();
        },
      });
    });
    await sendPluginMessage("fancy-live-doc", "OpenRequest", { channelId, slug: sanitised, title: trimmedTitle, mode });
    console.log("[store] requestOpenLiveDoc: open dispatched, awaiting invite");
    await waitForInvite;
    console.log("[store] requestOpenLiveDoc: invite received");
  },

  publishLiveDoc: async (channelId, slug) => {
    await sendPluginMessage("fancy-live-doc", "Publish", { channelId, slug });
  },

  renameActiveLiveDoc: (channelId, slug, title, appServerId) => {
    const trimmed = title.trim().slice(0, 200);
    if (!trimmed) return;
    set((state) => {
      const targetServer = appServerId !== undefined ? appServerId : state.activeServerId;
      const k = liveDocKey(targetServer, channelId);
      const current = state.activeLiveDocs.get(k);
      if (!current || current.title === trimmed) return state;
      const next = new Map(state.activeLiveDocs);
      next.set(k, { ...current, title: trimmed });
      return { activeLiveDocs: next };
    });
    sendPluginMessage("fancy-live-doc", "Rename", { channelId, slug, title: trimmed }).catch((e) =>
      console.warn("plugin-message Rename failed:", e),
    );
  },

  saveLiveDoc: async (channelId, slug) => {
    await sendPluginMessage("fancy-live-doc", "Persist", { channelId, slug });
  },
}));

// --- Tauri event bridge -------------------------------------------

// --- Live Doc native-event dispatcher -----------------------------

/** Native `fancy-live-doc-invite` event payload (server -> client). */
interface LiveDocInviteEvent {
  channelId: number;
  slug: string;
  title: string;
  wsUrl: string;
  token: string | null;
  serverId: string | null;
}

/** Native `fancy-live-doc-announce` event payload (peer -> peer via server relay). */
interface LiveDocAnnounceEvent {
  channelId: number;
  slug: string;
  title: string;
  openerSession: number;
  openerName: string;
}

function dispatchLiveDocInvite(p: LiveDocInviteEvent): void {
  const state = useAppStore.getState();
  const ownSession = state.ownSession;
  if (ownSession === null) return;
  const pendingKey = `${p.channelId}|${p.slug}`;
  const pending = pendingLiveDocOpens.get(pendingKey);
  // Announce to the channel (banner + persistent chat invite card) only
  // when WE initiated a *new, non-silent* open of a *published* document.
  // A private document is exactly that - private - so it must never leak
  // an "X opened a shared document" banner/message to the channel.  Silent
  // opens (joining an existing invite) also never re-announce.
  // We own the document whenever we initiated a non-silent open, whether
  // it is private or published (gates owner-only controls like "save now").
  const isOwner = pending !== undefined && !pending.silent;
  const shouldPublish = isOwner && pending?.mode === "publish";
  if (pending) pending.resolve();
  const ownUser = state.users.find((u) => u.session === ownSession);
  // Convert serverId string -> numeric session-id-like value (legacy field).
  // The new proto carries the string verbatim; downstream `openLiveDoc`
  // accepts the numeric server id used previously.  When the new field is
  // numeric-looking, parse it; otherwise fall back to 0 to keep the call
  // shape stable.
  const serverIdNum = p.serverId !== null ? Number.parseInt(p.serverId, 10) || 0 : 0;
  state.openLiveDoc({
    serverId: serverIdNum,
    appServerId: state.activeServerId,
    channelId: p.channelId,
    slug: p.slug,
    title: p.title,
    wsUrl: p.wsUrl,
    token: p.token ?? "",
    ownSession,
    ownName: ownUser?.name ?? "You",
    ownColor: pickLiveDocCursorColor(ownSession),
    isOwner,
  });
  // Only a *published* open fans out to the channel.  Private documents
  // stay private: no banner announce and no persistent chat invite card.
  if (shouldPublish) {
    // Tell everyone else in the channel that a doc was opened.
    sendPluginMessage("fancy-live-doc", "Announce", {
      channelId: p.channelId,
      slug: p.slug,
      title: p.title,
    }).catch((e) => console.warn("plugin-message Announce failed:", e));
    // Post a persistent chat invite so users who were not in the channel
    // when the announce flew can still join.
    const payload = encodeLiveDocInviteMarker(p.slug, p.title);
    void state.sendMessage(p.channelId, payload).catch((e) =>
      console.warn("live-doc auto-invite message failed:", e),
    );
  }
}

function dispatchLiveDocAnnounce(p: LiveDocAnnounceEvent): void {
  const state = useAppStore.getState();
  state.setLiveDocAnnounce({
    openerName: p.openerName || "Someone",
    title: p.title,
    appServerId: state.activeServerId,
    channelId: p.channelId,
    slug: p.slug,
  });
}

// --- Generic plugin envelope helpers -------------------------------

/** Raw `plugin-message` event payload emitted by the Tauri backend.
 *  `payload` carries the plugin bytes as base64 (see PluginMessagePayload
 *  in the Rust backend). */
interface PluginMessageEvent {
  pluginName: string;
  pluginSlot: number | null;
  payloadType: string;
  payload: string;
  targetSessions: number[];
  channelId: number | null;
  senderSession: number | null;
  senderName: string | null;
}

// PluginRegistryEntry / PluginRegistryEvent moved to `store/plugins.ts`
// (re-exported below so existing `import { PluginRegistryEntry } from "../store"` works).

/** Decode a base64 `plugin-message` payload as a UTF-8 JSON object. */
function decodePluginPayload<T>(b64: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64ToBytes(b64))) as T;
  } catch (e) {
    console.error("[store] plugin-message payload is not valid JSON:", e);
    return null;
  }
}

/** Policy gate for an inbound plugin `InteractionResponse`.
 *
 *  - A plugin that ships a Tier-1 client manifest must be *trusted*
 *    (present in `pluginManifests` - i.e. allowed or prompt-exempt) AND
 *    must have declared the capability backing the response kind.  This
 *    refuses plugins that are pending a trust decision, explicitly
 *    denied, or reaching for a capability they never declared.
 *  - A plugin that ships no client manifest at all keeps its historical
 *    bypass for non-injecting responses (legacy transports), but may
 *    never inject chat history.
 *
 *  Evaluated before any side effect so a blocked / under-declared plugin
 *  cannot inject or rewrite local chat. */
function pluginResponseAllowed(
  s: AppState,
  pluginName: string,
  kind: InteractionResponse["kind"],
): boolean {
  const manifest = s.pluginManifests.get(pluginName);
  if (manifest) {
    return manifestPermitsResponse(manifest, kind);
  }
  const entry = s.pluginRegistry.find((e) => e.pluginName === pluginName);
  const hasManifest = entry ? parseClientManifest(entry.infoJson) !== null : false;
  // A manifest-bearing plugin not in `pluginManifests` is pending or
  // denied -> refuse.  A manifest-less plugin is a legacy transport;
  // allow everything except chat injection.
  if (hasManifest) return false;
  return kind !== "chat-message";
}

/** Route an inbound plugin envelope to the appropriate in-store handler. */
function dispatchPluginMessage(p: PluginMessageEvent): void {
  // Host-broadcast plugin lifecycle (any plugin).  Deactivation clears the
  // plugin's UI/state; activation is a no-op client-side (the host re-announces
  // the plugin's `fancy-plugin-info` + config, which repopulate the registry).
  if (p.payloadType === PluginPayloadType.PluginDeactivated) {
    useAppStore.getState().recordPluginDisabled(p.pluginName);
    return;
  }
  if (p.payloadType === PluginPayloadType.PluginActivated) {
    return;
  }

  if (p.pluginName === "fancy-calendar") {
    const data = decodePluginPayload<Record<string, unknown>>(p.payload);
    if (data) {
      if (p.payloadType === MSG_MEETING_ROOM) {
        // The server provisioned (or located) our meeting room and admitted us:
        // join + select it. The backend already knows the channel from the
        // ChannelState broadcast, so joining is safe even before the UI store
        // has rendered it.
        if (dispatchMeetingRoom(data) && typeof data.channelId === "number") {
          void useAppStore.getState().joinChannel(data.channelId);
          useAppStore.getState().selectChannel(data.channelId);
        }
      } else if (p.payloadType === MSG_MEETING_INVITE_LINK) {
        dispatchMeetingInviteLink(data);
      } else {
        applyCalendarInbound(p.payloadType, data);
      }
    }
    return;
  }

  if (p.pluginName === FRIENDS_PLUGIN) {
    // The fancy-friends plugin provisioned (or located) the detached, E2E
    // (signal_v1), persisted channel for a friend chat and admitted us. Bind the
    // peer -> channel and switch the chat to it: the friend DM *is* this channel
    // now (channel-only history). We *peek* rather than join - read its history +
    // pass the key challenge so live messages are delivered, without moving our
    // presence into the detached room (which would pull us out of our current
    // channel and hide us from the channel list).
    if (p.payloadType === MSG_FRIENDS_ROOM) {
      const data = decodePluginPayload<Record<string, unknown>>(p.payload);
      const room = data ? parseFriendsRoom(data) : null;
      if (room) {
        useAppStore.getState().bindFriendChannel(room.peerUserId, room.channelId);
        void useAppStore.getState().peekChannel(room.channelId);
        useAppStore.getState().selectChannel(room.channelId);
      }
    }
    return;
  }

  if (p.pluginName === "fancy-live-doc") {
    if (p.payloadType === PluginPayloadType.Invite) {
      const data = decodePluginPayload<{
        channelId: number;
        slug: string;
        title: string;
        wsUrl: string;
        token?: string | null;
        serverId?: string | null;
      }>(p.payload);
      if (!data) return;
      const fallbackHost =
        useAppStore.getState().sessions.find(
          (s) => s.id === useAppStore.getState().activeServerId,
        )?.host ?? useAppStore.getState().pendingConnect?.host ?? null;
      dispatchLiveDocInvite({
        channelId: data.channelId,
        slug: data.slug,
        title: data.title,
        wsUrl: sanitiseWsUrl(data.wsUrl, fallbackHost),
        token: data.token ?? null,
        serverId: data.serverId ?? null,
      });
      return;
    }
    if (p.payloadType === PluginPayloadType.Announce) {
      const data = decodePluginPayload<{
        channelId: number;
        slug: string;
        title: string;
        openerSession: number;
        openerName?: string | null;
      }>(p.payload);
      if (!data) return;
      dispatchLiveDocAnnounce({
        channelId: data.channelId,
        slug: data.slug,
        title: data.title,
        openerSession: data.openerSession,
        openerName: data.openerName ?? "",
      });
      return;
    }
    if (p.payloadType === "SharedWith") {
      const data = decodePluginPayload<{
        slug: string;
        sharedWith?: import("../types").LiveDocSharedMember[];
      }>(p.payload);
      if (!data) return;
      void import("../components/chat/livedoc/sharedWithStore").then(
        ({ useLiveDocSharedWithStore }) => {
          useLiveDocSharedWithStore.getState().setSharedWith(data.slug, data.sharedWith ?? []);
        },
      );
      return;
    }
  }
  const response = decodeInteractionResponse(p.payloadType, p.payload);
  if (response) {
    // Trust + capability gate.  Evaluated against current state BEFORE
    // any side effect, so a pending / denied / under-declared plugin
    // cannot inject or rewrite chat history (the side effects below run
    // outside the `setState` reducer).
    if (!pluginResponseAllowed(useAppStore.getState(), p.pluginName, response.kind)) {
      return;
    }
    // Side effect for chat-message: ask the rust state to inject the
    // bubble into local channel history.  The tier1 reducer itself
    // is a no-op for this kind, so the side effect is the entire
    // delivery mechanism.
    if (response.kind === "chat-message") {
      invoke("plugin_inject_chat_message", {
        pluginName: p.pluginName,
        channelIds: response.channel_ids ?? [],
        messageId: response.message_id,
        content: response.content ?? "",
        components: response.components ?? null,
      }).catch((e) =>
        console.warn("[store] plugin_inject_chat_message failed:", e),
      );
    }
    // Side effect for update-message: also try to update any
    // matching plugin-authored chat bubble.  The tier1 reducer in
    // parallel updates floating cards; the bubble path is restricted
    // to messages whose `plugin_name` matches `p.pluginName`.
    if (response.kind === "update-message") {
      invoke("plugin_update_chat_message", {
        pluginName: p.pluginName,
        messageId: response.message_id,
        content: response.content ?? null,
        components:
          response.components === null
            ? null
            : (response.components ?? null),
        clearComponents: response.components === null,
      }).catch((e) =>
        console.warn("[store] plugin_update_chat_message failed:", e),
      );
    }
    useAppStore.setState((s) => {
      const next = applyInteractionResponse(
        sliceFromState(s),
        p.pluginName,
        response,
        p.channelId,
      );
      return slicePatch(next);
    });
    return;
  }
  console.debug("[store] unhandled plugin-message:", p.pluginName, p.payloadType);
}


/** Deterministic palette mirror of `pickCursorColor` in ChatView.tsx. */
const LIVE_DOC_COLORS = [
  "#2aabee", "#ff6f61", "#7cd66c", "#ffb74d",
  "#b388ff", "#ff66cc", "#00bfa5", "#ffd54f",
  "#90caf9", "#f48fb1", "#80deea", "#ce93d8",
] as const;
function pickLiveDocCursorColor(session: number): string {
  return LIVE_DOC_COLORS[Math.abs(session) % LIVE_DOC_COLORS.length];}

/** Encode a live-doc invite marker for use in a chat message body.
 *  Recognised by `MessageItem` and rendered as a `LiveDocInviteCard`
 *  with a Join button.  The format is opaque to legacy clients (HTML
 *  comment); they will simply see an empty message body. */
export function encodeLiveDocInviteMarker(slug: string, title: string): string {
  const t = title.replaceAll("\n", " ").slice(0, 200);
  // Encode via URI percent-encoding to keep `btoa` ASCII-safe for
  // non-ASCII characters in slug/title.
  const payload = btoa(encodeURIComponent(JSON.stringify({ slug, title: t })));
  return `<!-- FANCY_LIVEDOC:${payload} -->`;
}

/** Decoded payload for the `FANCY_LIVEDOC` marker. */
export interface LiveDocInviteMarker {
  readonly slug: string;
  readonly title: string;
}

/** Decode the payload from a `FANCY_LIVEDOC:<base64>` marker.  Returns
 *  null when the payload is malformed. */
export function decodeLiveDocInviteMarker(payload: string): LiveDocInviteMarker | null {
  try {
    const json = decodeURIComponent(atob(payload));
    const raw = JSON.parse(json) as Partial<LiveDocInviteMarker>;
    if (typeof raw.slug !== "string" || typeof raw.title !== "string") return null;
    return { slug: raw.slug, title: raw.title };
  } catch {
    return null;
  }
}

/** Regex used by `MessageItem` to extract the invite payload. */
export const FANCY_LIVEDOC_MARKER_RE = /<!-- FANCY_LIVEDOC:([A-Za-z0-9+/=]+) -->/;

// --- Plugin data handler registry ---------------------------------

type PluginDataHandler = (dataId: string, data: Uint8Array, senderSession: number | null) => void;
const pluginDataHandlers: PluginDataHandler[] = [];

/** Register a handler for incoming plugin data transmissions. */
export function onPluginData(handler: PluginDataHandler): () => void {
  pluginDataHandlers.push(handler);
  return () => {
    const idx = pluginDataHandlers.indexOf(handler);
    if (idx >= 0) pluginDataHandlers.splice(idx, 1);
  };
}

// --- WebRTC signal handler registry ---

type WebRtcSignalHandler = (senderSession: number | null, targetSession: number | null, signalType: number, payload: string, serverId: string | null) => void;
const webRtcSignalHandlers: WebRtcSignalHandler[] = [];

/** Register a handler for incoming WebRTC screen-sharing signals. */
export function onWebRtcSignal(handler: WebRtcSignalHandler): () => void {
  webRtcSignalHandlers.push(handler);
  return () => {
    const idx = webRtcSignalHandlers.indexOf(handler);
    if (idx >= 0) webRtcSignalHandlers.splice(idx, 1);
  };
}

/** Set of request_ids already sent to avoid duplicate requests. */
const pendingPreviewRequests = new Set<string>();

/** In-flight `requestOpenLiveDoc` invocations keyed by `${channelId}|${slug}`.
 *  Resolved when the matching `fancy-live-doc/invite` PluginDataTransmission
 *  arrives; rejected by the request's own timeout if the server never replies. */
const pendingLiveDocOpens = new Map<
  string,
  { resolve: () => void; silent: boolean; mode: "private" | "publish" }
>();

/** Request link previews from the server for the given URLs. */
export async function requestLinkPreview(urls: string[], requestId: string): Promise<void> {
  if (pendingPreviewRequests.has(requestId)) return;
  pendingPreviewRequests.add(requestId);
  try {
    await invoke("request_link_preview", { urls, requestId });
  } catch (e) {
    console.error("request_link_preview failed:", e);
    pendingPreviewRequests.delete(requestId);
  }
}

/**
 * Subscribe to backend events and translate them into store updates.
 * Call once from the root `<App>` component; returns cleanup functions.
 */
/**
 * Process a single `plugin-data` envelope.
 *
 * Shared by the live `TauriEvent.PluginData` listener and the HMR
 * restore path: the server broadcasts connect-time configs (file-server,
 * live-doc, plugin-info, server-emotes) exactly once, so after a Vite
 * HMR full reload they must be replayed from the backend cache through
 * this same code to re-hydrate the store without a full reconnect.
 */
function processPluginDataEvent(
  payload: { sender_session: number | null; data: string; data_id: string },
): void {
  const { data_id, data, sender_session } = payload;
  // `data` is base64: a number[] would inflate the IPC JSON (and the
  // backend-side serde_json::Value) by more than an order of magnitude
  // for multi-MB broadcasts like server emotes.
  const bytes = base64ToBytes(data);

  if (data_id === PluginDataId.FileServerConfig) {
    try {
      const json = new TextDecoder().decode(bytes);
      const raw = JSON.parse(json);
      // The server-wide override (advertised in `ServerConfig`)
      // takes precedence over the per-plugin `base_url`. This
      // matters when the HTTP interface is hosted behind a
      // reverse proxy or ingress and reachable at a different
      // hostname than the Mumble TCP port.
      const override = useAppStore.getState().serverConfig.fancy_rest_api_url;
      const internalBaseUrl = String(raw.base_url).replace(/\/+$/, "");
      const baseUrl = (override && override.length > 0)
        ? override.replace(/\/+$/, "")
        : internalBaseUrl;
      const cfg: FileServerConfig = {
        baseUrl,
        internalBaseUrl,
        sessionId: raw.session_id,
        uploadToken: raw.upload_token,
        sessionJwt: raw.session_jwt,
        maxFileSizeBytes: raw.max_file_size_bytes,
        deleteOnTtl: !!raw.delete_on_ttl,
        ttlSeconds: raw.ttl_seconds ?? 0,
        maxTtlSeconds: raw.max_ttl_seconds ?? 0,
        deleteOnDownload: !!raw.delete_on_download,
        deleteOnDisconnect: !!raw.delete_on_disconnect,
        canManageEmotes: !!raw.can_manage_emotes,
        canShareFiles: raw.can_share_files !== false,
        canShareFilesPublic: raw.can_share_files_public !== false,
        registered: !!raw.registered,
      };
      useAppStore.setState({ fileServerConfig: cfg });
    } catch (e) {
      console.error("plugin-data file-server-config processing error:", e);
    }
  }

  if (data_id === PluginDataId.LiveDocConfig) {
    try {
      const json = new TextDecoder().decode(bytes);
      const raw = JSON.parse(json) as { version: string; ws_base_url: string };
      const fallbackHost =
        useAppStore.getState().sessions.find(
          (s) => s.id === useAppStore.getState().activeServerId,
        )?.host ?? useAppStore.getState().pendingConnect?.host ?? null;
      useAppStore.setState({
        liveDocPluginConfig: {
          version: raw.version,
          wsBaseUrl: sanitiseWsUrl(raw.ws_base_url, fallbackHost),
        },
      });
    } catch (e) {
      console.error("plugin-data live-doc-config processing error:", e);
    }
  }

  if (data_id === PluginDataId.PluginInfo) {
    (async () => {
      try {
        const rec = await invoke<PluginInfoRecord>("decode_plugin_info", {
          envelope: Array.from(bytes),
        });
        useAppStore.setState((s) => {
          const next = new Map(s.pluginInfos);
          next.set(rec.name, rec);
          return { pluginInfos: next };
        });
      } catch (e) {
        console.error("plugin-data plugin-info decode error:", e);
      }
    })();
  }

  if (data_id === PluginDataId.ServerEmotes) {
    try {
      const json = new TextDecoder().decode(bytes);
      const raw = JSON.parse(json) as { emotes: Array<{
        shortcode: string;
        alias_emoji: string;
        description?: string;
        image_data_url: string;
      }> };
      const emotes: CustomServerEmote[] = (raw.emotes ?? []).map((e) => ({
        shortcode: e.shortcode,
        aliasEmoji: e.alias_emoji,
        description: e.description,
        imageDataUrl: e.image_data_url,
      }));
      useAppStore.setState({ customServerEmotes: emotes });
      const reactions: ServerCustomReaction[] = emotes.map((e) => ({
        shortcode: `:${e.shortcode}:`,
        display: e.imageDataUrl,
        label: e.description ?? e.aliasEmoji,
      }));
      setServerCustomReactions(reactions);
    } catch (e) {
      console.error("plugin-data server-emotes processing error:", e);
    }
  }

  if (data_id === PluginDataId.Poll || data_id === PluginDataId.PollVote) {
    // Legacy: ignored.  Polls now travel through native protobuf
    // messages (FancyPoll, FancyPollVote) and are routed via the
    // "fancy-poll" / "fancy-poll-vote" Tauri events below.
  }

  if (data_id === PluginDataId.LiveDocInvite || data_id === PluginDataId.LiveDocAnnounce) {
    // Legacy: ignored.  Live-doc invites/announces now travel through
    // the generic `PluginMessage` envelope (wire ID 200) and are
    // delivered as `plugin-message` Tauri events below.
  }

  // Also dispatch to legacy registered handlers for extensibility.
  for (const handler of pluginDataHandlers) {
    handler(data_id, bytes, sender_session);
  }
}

export async function initEventListeners(
  navigate: (path: string) => void,
): Promise<UnlistenFn[]> {
  navigateRef = navigate;
  const unlisteners: UnlistenFn[] = [];

  // Bootstrap the multi-server session list once at startup so the
  // sessions slice reflects whatever the backend already has.  When the
  // backend is already in a connected session (e.g. after a Vite HMR
  // remount), also pull channels/users/current-channel/messages/ownSession
  // so the UI restores the chat view instead of showing the empty/
  // disconnected fallback.
  useAppStore.getState().refreshSessions()
    .then(async () => {
      const { activeServerId, sessions, refreshState } = useAppStore.getState();
      const active = sessions.find((s) => s.id === activeServerId);
      if (active?.status !== "connected") return;
      await refreshState();
      try {
        const currentCh = await invoke<number | null>("get_current_channel");
        useAppStore.setState({ currentChannel: currentCh, selectedChannel: currentCh });
        if (currentCh !== null) {
          const messages = await invoke<ChatMessage[]>("get_messages", { channelId: currentCh });
          useAppStore.setState({ messages });
        }
      } catch (e) {
        console.error("HMR state restore (channel/messages) failed:", e);
      }
      try {
        const ownSession = await invoke<number | null>("get_own_session");
        useAppStore.setState({ ownSession });
      } catch {
        // not connected; leave as-is.
      }
      // Restore the server's Fancy version.  The `server-version` event
      // is emitted when the Version protobuf message arrives, which
      // already happened before HMR, so re-registering the listener
      // doesn't help -- we have to pull the cached value from the backend.
      try {
        const info = await invoke<ServerInfo>("get_server_info");
        useAppStore.setState({ serverFancyVersion: info.fancy_version });
      } catch {
        // Standard server or not connected; leave as-is.
      }
      // The `plugin-registry` Tauri event is a one-shot fired right
      // after ServerSync, so an HMR reload that re-registers the
      // listener misses it entirely and the Plugins settings tab
      // stays hidden until reconnect.  Pull the cached snapshot from
      // the backend and replay it through the same reconcile path.
      try {
        const entries = await invoke<PluginRegistryEntry[]>("get_plugin_registry");
        if (entries.length > 0) {
          await reconcilePluginRegistry(entries);
        }
      } catch (e) {
        console.error("HMR state restore (plugin registry) failed:", e);
      }
      // The server's connect-time plugin-data broadcasts (file-server
      // config, live-doc config, plugin info, server emotes) are sent
      // once after ServerSync and never resent, so an HMR full reload
      // loses them and e.g. the document library goes blank until a
      // real reconnect.  Replay the backend-cached payloads through the
      // same processing path so the store re-hydrates in place.
      try {
        const broadcasts = await invoke<
          { sender_session: number | null; data: string; data_id: string }[]
        >("get_plugin_broadcasts");
        for (const payload of broadcasts) {
          processPluginDataEvent(payload);
        }
      } catch (e) {
        console.error("HMR state restore (plugin broadcasts) failed:", e);
      }
    })
    .catch(() => {});

  // Ensure notification permissions and channel are set up (Android 8+ / 13+).
  // Deferred to the next macrotask so the Tauri webview URL settles to
  // http://tauri.localhost/ before the IPC capability check runs; calling
  // isPermissionGranted() synchronously during init sees URL: about:blank
  // on Android, causing the permission check to fail.
  setTimeout(async () => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const result = await requestPermission();
        granted = result === "granted";
      }
      if (granted) {
        await createChannel({
          id: "messages",
          name: "Messages",
          description: "Chat message notifications",
          importance: Importance.High,
          visibility: Visibility.Public,
        });
      }
    } catch {
      // Notification API may not be available on all platforms.
    }
  }, 0);

  // Sync the notification preference to the Rust backend.
  try {
    const { getPreferences } = await import("../preferencesStorage");
    const prefs = await getPreferences();
    await invoke("set_notifications_enabled", {
      enabled: prefs.enableNotifications ?? true,
    });
    await invoke("set_disable_dual_path", {
      disabled: !(prefs.enableDualPath ?? false),
    });
    const logLevel = prefs.logLevel ?? (prefs.debugLogging ? "debug" : "info");
    if (logLevel !== "info") {
      await invoke("set_log_level", { filter: logLevel });
    }
  } catch {
    // Preference store may not be ready yet - backend defaults to enabled.
  }

  // Server fully connected (ServerSync received).
  unlisteners.push(
    await listen(TauriEvent.ServerConnected, async () => {
      manualDisconnectRequested = false;
      clearAutoReconnectTimer();
      // Load silenced channels for this server (pendingConnect still available).
      const pending = useAppStore.getState().pendingConnect;
      let silenced = new Set<number>();
      let mutedPush = new Set<number>();
      if (pending) {
        const serverKey = `${pending.host}:${pending.port}`;
        const ids = await getSilencedChannels(serverKey);
        silenced = new Set(ids);
        const mutedIds = await getMutedPushChannels(serverKey);
        mutedPush = new Set(mutedIds);
      }

      // Load persisted per-user volumes and reset the applied-session tracker.
      volumeAppliedSessions.clear();
      let storedVolumes: Record<string, number> = {};
      try {
        storedVolumes = await getUserVolumes();
      } catch {
        // Store may not be ready yet.
      }

      // Navigate immediately - don't block on data fetching.
      useAppStore.setState({
        status: "connected",
        passwordRequired: false,
        silencedChannels: silenced,
        mutedPushChannels: mutedPush,
        userVolumes: storedVolumes,
        bootstrapStage: "Fetching channels and users...",
        // Connection re-established: clear the reconnect counters/schedule.
        reconnectAttempts: 0,
        connectionLostAt: null,
        reconnectScheduled: false,
        nextReconnectAt: null,
      });

      // Signal the welcome-message modal that a server join just completed.
      if (typeof window !== "undefined") {
        const serverKey = pending ? `${pending.host}:${pending.port}` : undefined;
        window.dispatchEvent(new CustomEvent("server-connected", { detail: { serverKey } }));
      }

      // Refresh the multi-server session list so any newly-connected
      // server appears in the sessions slice immediately.
      useAppStore.getState().refreshSessions().catch(() => {
        // best-effort; the sessions list will be repopulated on next event.
      }).then(() => {
        // Clear any stale per-session error stored from a prior disconnect
        // for this newly-connected session.
        const { activeServerId } = useAppStore.getState();
        if (activeServerId) {
          useAppStore.setState((prev) => {
            if (prev.sessionErrors[activeServerId] == null) return prev;
            const next = { ...prev.sessionErrors };
            delete next[activeServerId];
            return { sessionErrors: next };
          });
        }
      });

      // Load channels/users/messages, then resolve identity, then
      // hand off to the chat view.  We delay `navigate("/chat")` until
      // the visible bootstrap is done so the connect-page progress bar
      // stays visible until the chat view actually has data.
      useAppStore
        .getState()
        .refreshState()
        .then(async () => {
          // Fetch the channel the user is currently in.
          useAppStore.setState({ bootstrapStage: "Locating your channel..." });
          const currentCh = await invoke<number | null>("get_current_channel");
          if (currentCh !== null) {
            useAppStore.setState({ currentChannel: currentCh });
          }

          // Fetch our own session ID.
          useAppStore.setState({ bootstrapStage: "Identifying you to the server..." });
          const ownSession = await invoke<number | null>("get_own_session");
          useAppStore.setState({ ownSession });

          // Fetch the server's Fancy Mumble version (null for standard servers).
          try {
            const info = await invoke<ServerInfo>("get_server_info");
            useAppStore.setState({ serverFancyVersion: info.fancy_version, serverHostAbiVersion: null });
          } catch {
            // Server info unavailable - leave as null.
          }

          // Auto-apply the locally saved profile for unregistered users.
          // Registered users have their profile stored server-side, but
          // unregistered users lose it on each connect.
          if (ownSession !== null) {
            const ownUser = useAppStore.getState().users.find((u) => u.session === ownSession);
            const isRegistered = ownUser?.user_id != null && ownUser.user_id > 0;
            if (!isRegistered) {
              const identityLabel = useAppStore.getState().connectedCertLabel ?? null;
              loadProfileData(identityLabel)
                .then(async ({ profile, bio, avatarDataUrl }) => {
                  const comment = serializeProfile(profile, bio);
                  if (comment) {
                    await invoke("set_user_comment", { comment });
                  }
                  const texture = avatarDataUrl ? dataUrlToBytes(avatarDataUrl) : [];
                  if (texture.length > 0) {
                    await invoke("set_user_texture", { texture });
                  }
                })
                .catch((err) => console.error("Auto-apply profile error:", err));
            }
          }

          const { channels, selectedChannel } = useAppStore.getState();
          if (selectedChannel === null && channels.length > 0) {
            // Default to the channel the user is in, falling back to the first channel.
            const defaultCh = currentCh ?? channels[0].id;
            useAppStore.getState().selectChannel(defaultCh);
          }

          // Apply persisted per-user volumes to backend for all current users.
          applyStoredVolumesToNewUsers();

          // Hydrate onboarding state for this server (no-op on legacy
          // Mumble - the store gates on serverFancyVersion >= 0.3.1).
          try {
            const { activeServerId, serverFancyVersion } = useAppStore.getState();
            await useOnboardingStore
              .getState()
              .hydrate(activeServerId ?? null, serverFancyVersion);
          } catch {
            // best-effort; hydrate already swallows decode failures.
          }

          // Visible bootstrap is done - drop the loading bar and reveal the chat view.
          useAppStore.setState({ bootstrapStage: null });
          navigate("/chat");

          // Restore voice call state from before the disconnect.
          // isRestoringVoice suppresses pref writes from the
          // voice-state-changed listener during this sequence so that
          // rapid "active" then "muted" events cannot race and
          // clobber voiceMutedOnReconnect with false.
          try {
            const prefs = await getPreferences();
            if (prefs.voiceOnReconnect) {
              isRestoringVoice = true;
              try {
                if (prefs.voiceMutedOnReconnect) {
                  // Establish the muted state in ONE atomic backend call.
                  // The previous enableVoice() + toggleMute() two-step could
                  // race on a reconnect (the unmute from enableVoice landing
                  // after the mute) and leave the user unmuted.
                  await invoke("enable_voice_muted");
                  useAppStore.setState({ voiceState: "muted", inCall: true });
                  updatePreferences({ voiceOnReconnect: true, voiceMutedOnReconnect: true }).catch(() => {});
                } else {
                  await useAppStore.getState().enableVoice();
                }
              } finally {
                isRestoringVoice = false;
              }
            }
          } catch {
            // Voice restore is best-effort.
          }

          // Authoritatively sync the self mute/deaf indicator to the backend's
          // actual voice state.  `voiceState` is otherwise only set optimistically
          // and via the `voice-state-changed` event, which can fire during connect
          // before the listener is ready (or diverge after a reconnect) - leaving
          // the self indicator stale, e.g. showing muted while voice is active.
          try {
            const vs = await invoke<VoiceState>("get_voice_state");
            useAppStore.setState({ voiceState: vs, inCall: vs !== "inactive" });
          } catch {
            // best-effort sync
          }
        })
        .catch((err) => {
          // If the bootstrap chain fails, surface it but never leave the UI
          // stranded on a permanent loading bar.
          console.error("Post-connect bootstrap error:", err);
          useAppStore.setState({ bootstrapStage: null });
          navigate("/chat");
        });
    }),
  );

  // Connection dropped.
  unlisteners.push(
    await listen<{ serverId?: string | null; reason: string | null } | string | null>(
      TauriEvent.ServerDisconnected,
      async (event) => {
        // Normalise: backend now always sends an object payload, but tolerate
        // a bare reason string for forwards/backwards compatibility.
        const payload = event.payload;
        const eventServerId = typeof payload === "object" && payload !== null
          ? (payload.serverId ?? null)
          : null;
        const eventReason = typeof payload === "string"
          ? payload
          : (typeof payload === "object" && payload !== null ? payload.reason : null);

        const { activeServerId, pendingConnect: pendingForActive } = useAppStore.getState();
        // Only treat the event as affecting the active session if the
        // backend explicitly tagged it with the active session's id.
        // A missing/null serverId means "unknown" - we must not assume
        // it belongs to the currently-focused tab, otherwise closing a
        // background session would clobber the foreground one.
        //
        // Exception: if a `pendingConnect` is in flight AND we don't yet
        // have an active session (initial connect race - the backend
        // fired the disconnect before our `refreshSessions()` returned),
        // fall back to assuming the event belongs to the pending connect
        // so the user sees the error instead of being stuck on a
        // "connecting" skeleton. Crucially, we do NOT apply this fallback
        // when the user already has an active session AND the
        // `eventServerId` either differs from it or is unknown - in that
        // case the disconnect belongs to a *different* tab (a new
        // connection attempt) and clobbering the active one would make
        // the foreground server's tab unusable.
        const pendingFallbackApplies =
          pendingForActive !== null &&
          activeServerId === null &&
          (eventServerId === null || eventServerId !== activeServerId);
        const isActiveSession =
          (eventServerId !== null && eventServerId === activeServerId) ||
          pendingFallbackApplies;

        // If the user explicitly closed this session via the tab close
        // button, the `disconnectSession` action manages the UI handoff
        // (refresh + switch to next active tab).  Skip the listener's
        // own state-clobbering cleanup so we don't flash a misleading
        // "Connection lost" overlay on the *next* tab.
        if (eventServerId && intentionallyClosingSessions.has(eventServerId)) {
          await useAppStore.getState().refreshSessions().catch(() => {});
          return;
        }

        // Always refresh the sessions list so the disconnected tab updates
        // its status dot / badge regardless of which tab was affected.
        await useAppStore.getState().refreshSessions().catch(() => {});

        // Always remember the disconnect reason for this specific session
        // so the user sees the correct reason when they switch tabs.
        // Skip overwriting an already-stored reason with null - kick events
        // may be followed by a generic on_disconnected with no reason.
        if (eventServerId && eventReason) {
          useAppStore.setState((prev) => ({
            sessionErrors: { ...prev.sessionErrors, [eventServerId]: eventReason },
          }));
        }

        if (!isActiveSession) {
          // A non-active session disconnected: do not touch the active
          // session's state (status, channels, users, etc.).  The tab
          // bar already reflects the new status; nothing else to do.
          return;
        }

        // Active session was the one that disconnected - proceed with
        // the full local cleanup.
        offloadManager.dispose().catch(() => {});
        volumeAppliedSessions.clear();
        clearReadReceipts();
        useOnboardingStore.getState().clear();
        const { error: currentError, passwordRequired: pwRequired, pendingConnect: pending } = useAppStore.getState();
        // If a password prompt is already pending, keep the rejection error
        // instead of overwriting it with a generic disconnect message.
        const reason = pwRequired ? currentError : (eventReason ?? currentError);
        // Will we auto-reconnect? Only when enabled and this wasn't a
        // user-initiated disconnect or a password rejection.
        const willReconnect =
          !manualDisconnectRequested && !pwRequired && !!pending && autoReconnectEnabled;
        // Preserve the downtime clock and attempt count across a reconnect
        // *sequence* (multiple failures) so they accumulate rather than
        // resetting on every failed attempt; a fresh loss starts the clock.
        const prevReconnect = useAppStore.getState();
        useAppStore.setState({
          ...INITIAL,
          error: reason,
          passwordRequired: pwRequired,
          pendingConnect: pending,
          connectionLostAt: willReconnect
            ? (prevReconnect.connectionLostAt ?? Date.now())
            : null,
          reconnectAttempts: willReconnect ? prevReconnect.reconnectAttempts : 0,
        });
        invoke("update_badge_count", { count: null }).catch(() => {});

        const { sessions } = useAppStore.getState();
        if (sessions.length === 0 || pwRequired) {
          navigate("/");
        } else {
          navigate("/chat");
        }

        if (willReconnect) {
          scheduleAutoReconnect(pending);
        }
      },
    ),
  );

  // Channel / user list changed - debounce rapid-fire updates.
  let stateChangeTimer: ReturnType<typeof setTimeout> | undefined;
  unlisteners.push(
    await listen(TauriEvent.StateChanged, () => {
      clearTimeout(stateChangeTimer);
      stateChangeTimer = setTimeout(() => {
        useAppStore
          .getState()
          .refreshState()
          .then(() => applyStoredVolumesToNewUsers());
      }, 100);
    }),
  );

  // Messages, unreads, groups, connection events.
  unlisteners.push(
    // Server activity log entry.
    await listen<ServerLogEntry>(TauriEvent.ServerLog, (event) => {
      const MAX_LOG_ENTRIES = 200;
      useAppStore.setState((prev) => {
        const log = [...prev.serverLog, event.payload];
        if (log.length > MAX_LOG_ENTRIES) {
          log.splice(0, log.length - MAX_LOG_ENTRIES);
        }
        return { serverLog: log };
      });
    }),

    // New text message arrived.
    await listen<{ channel_id: number; sender_session: number | null }>(TauriEvent.NewMessage, async (event) => {
      const { channel_id, sender_session } = event.payload;

      // Clear the sender's typing indicator immediately.
      if (sender_session != null) {
        useAppStore.setState((prev) => {
          const channelSet = prev.typingUsers.get(channel_id);
          if (!channelSet?.has(sender_session)) return prev;
          const next = new Map(prev.typingUsers);
          const updated = new Set(channelSet);
          updated.delete(sender_session);
          if (updated.size === 0) {
            next.delete(channel_id);
          } else {
            next.set(channel_id, updated);
          }
          return { typingUsers: next };
        });
      }

      const { selectedChannel } = useAppStore.getState();
      if (selectedChannel === channel_id) {
        await useAppStore.getState().refreshMessages(channel_id);
      }
    }),

    // New direct message arrived.
    await listen<{ session: number }>(TauriEvent.NewDm, async (event) => {
      const { selectedDmUser } = useAppStore.getState();
      if (selectedDmUser === event.payload.session) {
        await useAppStore
          .getState()
          .refreshDmMessages(event.payload.session);
      }
    }),

    // Unread counts changed.
    await listen<{ unreads: Record<number, number>; serverId?: string | null }>(
      "unread-changed",
      (event) => {
        const { activeServerId } = useAppStore.getState();
        const eventServerId = event.payload.serverId ?? null;
        // Compute total for this session (sum of unreads).
        const total = Object.values(event.payload.unreads).reduce((a, b) => a + b, 0);
        if (eventServerId && eventServerId !== activeServerId) {
          // Non-active session: only update its per-tab badge total.
          useAppStore.setState((prev) => {
            // Combine channel total with whatever DM total we last saw
            // for this session (we store the channel total alone here;
            // dm-unread updates merge in the same way).
            const next = { ...prev.sessionUnreadTotals };
            const prevDm = next[`${eventServerId}:dm`] ?? 0;
            next[`${eventServerId}:ch`] = total;
            next[eventServerId] = total + prevDm;
            return { sessionUnreadTotals: next };
          });
          return;
        }
        useAppStore.setState({ unreadCounts: event.payload.unreads });
        updateBadgeCount();
      },
    ),

    // DM unread counts changed.
    await listen<{ unreads: Record<number, number>; serverId?: string | null }>(
      "dm-unread-changed",
      (event) => {
        const { activeServerId } = useAppStore.getState();
        const eventServerId = event.payload.serverId ?? null;
        const total = Object.values(event.payload.unreads).reduce((a, b) => a + b, 0);
        if (eventServerId && eventServerId !== activeServerId) {
          useAppStore.setState((prev) => {
            const next = { ...prev.sessionUnreadTotals };
            const prevCh = next[`${eventServerId}:ch`] ?? 0;
            next[`${eventServerId}:dm`] = total;
            next[eventServerId] = total + prevCh;
            return { sessionUnreadTotals: next };
          });
          return;
        }
        useAppStore.setState({ dmUnreadCounts: event.payload.unreads });
        updateBadgeCount();
      },
    ),

    // Server rejected the connection.
    await listen<{ serverId?: string | null; reason: string; reject_type: number | null }>(TauriEvent.ConnectionRejected, async (event) => {
      // Always remember the rejection reason for this session so the
      // user sees it when they switch to its tab.
      const eventServerId = event.payload.serverId ?? null;
      if (eventServerId) {
        useAppStore.setState((prev) => ({
          sessionErrors: { ...prev.sessionErrors, [eventServerId]: event.payload.reason },
        }));
      }
      // Ignore rejections targeting non-active sessions: the matching
      // server-disconnected event will surface them via the per-session
      // status and the reconnect overlay when the user opens that tab.
      //
      // Exception: if a `pendingConnect` is in flight AND we have no
      // active session yet (initial connect race - backend fired the
      // rejection before `refreshSessions()` returned), fall back to
      // assuming the rejection belongs to the pending connect so the
      // user sees the error instead of being stuck on a "connecting"
      // skeleton. We do NOT apply this fallback when the user already
      // has an active session AND `eventServerId` differs - that would
      // clobber the foreground server's tab when a *different* tab's
      // connection attempt was rejected.
      const { activeServerId, pendingConnect } = useAppStore.getState();
      const pendingFallbackApplies =
        pendingConnect !== null &&
        activeServerId === null &&
        (eventServerId === null || eventServerId !== activeServerId);
      if (eventServerId !== null && eventServerId !== activeServerId && !pendingFallbackApplies) {
        return;
      }
      const rt = event.payload.reject_type;
      // WrongUserPW = 3, WrongServerPW = 4.  Some server implementations
      // (notably older Fancy Mumble servers) reject auth without setting
      // the `type` field - fall back to a reason-string heuristic so the
      // password prompt still appears instead of silently retrying with
      // the wrong credentials.
      const reasonText = event.payload.reason ?? "";
      const reasonLooksLikePwError =
        /password|wrong\s+(?:user|server)|certificate/i.test(reasonText);
      const isPasswordError =
        rt === 3 || rt === 4 || (rt == null && reasonLooksLikePwError);
      if (isPasswordError) {
        const { passwordAttempted } = useAppStore.getState();
        useAppStore.setState({
          status: "disconnected",
          error: passwordAttempted ? event.payload.reason : null,
          passwordRequired: true,
          bootstrapStage: null,
          // pendingConnect was set by the connect action - keep it
          // so the dialog can re-issue the connect with the password.
        });
        // Make sure the failed-session tab is the active one so the
        // PasswordDialog (rendered on /chat over the disconnected
        // session card) appears anchored to it.  Otherwise the user
        // is left on "/" which renders an extra synthetic "New
        // connection" tab alongside the real failed-session tab.
        await useAppStore.getState().refreshSessions().catch(() => {});
        const { sessions } = useAppStore.getState();
        if (eventServerId && sessions.some((s) => s.id === eventServerId)) {
          await useAppStore.getState().switchServer(eventServerId).catch(() => {});
          // switchServer re-syncs status/error from the session
          // metadata, which would clobber passwordRequired.  Restore.
          useAppStore.setState({
            status: "disconnected",
            passwordRequired: true,
            error: passwordAttempted ? event.payload.reason : null,
            pendingConnect: useAppStore.getState().pendingConnect,
          });
          navigate("/chat");
        }
        return;
      }
      useAppStore.setState({
        status: "disconnected",
        error: event.payload.reason,
        // Keep `pendingConnect` so the auto-reconnect loop (driven by the
        // matching `server-disconnected` event) still has a target and its
        // attempt counter / backoff are not reset. A user-initiated
        // disconnect suppresses reconnect via `manualDisconnectRequested`,
        // and the next `connect()` overwrites this value.
        bootstrapStage: null,
      });
      // Stay on /chat when other tabs remain so the reconnect overlay
      // surfaces the kick/ban reason via `error`.  Connect-time failures
      // (no other sessions) fall back to the connect page.
      await useAppStore.getState().refreshSessions().catch(() => {});
      const { sessions } = useAppStore.getState();
      navigate(sessions.length > 0 ? "/chat" : "/");
    }),

    // Listen request was denied by the server - revert the UI.
    await listen<{ channel_id: number }>(TauriEvent.ListenDenied, (event) => {
      useAppStore.setState((prev) => {
        const next = new Set(prev.listenedChannels);
        next.delete(event.payload.channel_id);
        return { listenedChannels: next };
      });
    }),

    // Our own user moved to a different channel.
    await listen<{ channel_id: number }>(TauriEvent.CurrentChannelChanged, (event) => {
      useAppStore.setState({ currentChannel: event.payload.channel_id });
    }),

    // User tapped a chat notification - navigate to the target channel.
    await listen<{ channel_id: number }>(TauriEvent.NavigateToChannel, (event) => {
      const channelId = event.payload.channel_id;
      navigate("/chat");
      useAppStore.getState().selectChannel(channelId);
    }),

    // Voice state changed (enable/disable voice calling).
    // Pref writes are NOT done here: queued IPC messages can arrive in the
    // wrong order (especially with a slow backend event loop) and corrupt
    // voiceMutedOnReconnect. Prefs are written by the explicit action
    // handlers (enableVoice, disableVoice, toggleMute) where ordering is
    // deterministic relative to the user's intent.
    await listen<VoiceState>(TauriEvent.VoiceStateChanged, (event) => {
      const updates: Partial<ReturnType<typeof useAppStore.getState>> = { voiceState: event.payload };
      if (event.payload === "inactive") {
        updates.talkingSessions = new Set();
      }
      useAppStore.setState(updates);
    }),

    // Audio transport mode changed (UDP vs TCP tunnel).
    await listen<boolean>(TauriEvent.AudioTransportChanged, (event) => {
      useAppStore.setState({ udpActive: event.payload });
    }),

    // Stream popout windows broadcast their open/close state so the main
    // window can hide its "is sharing" banner for sessions whose stream
    // is already being viewed in a detached window.
    await listen<{ session: number; opened: boolean }>(TauriEvent.StreamPopoutState, (event) => {
      const { session, opened } = event.payload;
      const prev = useAppStore.getState().poppedOutStreamSessions;
      const next = new Set(prev);
      if (opened) next.add(session); else next.delete(session);
      useAppStore.setState({ poppedOutStreamSessions: next });
    }),

    // User talking state changed (audio transmission start/stop).
    await listen<[number, boolean]>(TauriEvent.UserTalking, (event) => {
      const [session, talking] = event.payload;
      const prev = useAppStore.getState().talkingSessions;
      const next = new Set(prev);
      if (talking) {
        next.add(session);
      } else {
        next.delete(session);
      }
      useAppStore.setState({ talkingSessions: next });
    }),

    // Server announced its (Fancy) version. Keep the cached
    // `serverFancyVersion` in sync reactively: a Fancy server may send the
    // extension version in a `Version` message that arrives after the
    // initial `get_server_info` bootstrap read, which would otherwise leave
    // the UI gating Fancy-only features off until the next reconnect.
    await listen<{ serverId?: string | null; fancy_version: number | null }>(
      TauriEvent.ServerVersion,
      (event) => {
        const { activeServerId } = useAppStore.getState();
        const eventServerId = event.payload.serverId ?? null;
        if (eventServerId !== null && eventServerId !== activeServerId) {
          return;
        }
        useAppStore.setState({ serverFancyVersion: event.payload.fancy_version });
      },
    ),

    // Server config received (limits, allow_html, etc.).
    await listen(TauriEvent.ServerConfig, async () => {
      try {
        const cfg = await invoke<MumbleServerConfig>("get_server_config");
        useAppStore.setState((state) => {
          const next: { serverConfig: MumbleServerConfig; fileServerConfig?: FileServerConfig } = { serverConfig: cfg };
          const override = cfg.fancy_rest_api_url;
          if (override && override.length > 0 && state.fileServerConfig) {
            next.fileServerConfig = { ...state.fileServerConfig, baseUrl: override.replace(/\/+$/, "") };
          }
          return next;
        });
        void probeFileServerCapabilities();
      } catch (e) {
        console.error("get_server_config error:", e);
      }
    }),
  );

  // Plugin data received (polls, etc.).
  // Process polls and votes directly here so the data reaches the
  // Zustand store even across Vite HMR reloads and React StrictMode
  // double-mounts where the old handler-array dispatch could fail.
  unlisteners.push(
    await listen<{ sender_session: number | null; data: string; data_id: string }>(
      TauriEvent.PluginData,
      (event) => processPluginDataEvent(event.payload),
    ),
  );

  // -- Generic plugin envelope dispatcher --------------------------

  unlisteners.push(
    await listen<PluginMessageEvent>(TauriEvent.PluginMessage, (event) => {
      dispatchPluginMessage(event.payload);
    }),
  );
  unlisteners.push(
    await listen<PluginRegistryEvent>(TauriEvent.PluginRegistry, (event) => {
      void reconcilePluginRegistry(event.payload.plugins);
    }),
  );

  // -- Native poll events ------------------------------------------

  unlisteners.push(
    await listen<{
      channelId: number;
      pollId: string;
      question: string;
      options: string[];
      multiple: boolean;
      creatorSession: number;
      creatorName: string;
      createdAt: string;
    }>(TauriEvent.FancyPoll, (event) => {
      const e = event.payload;
      const users = useAppStore.getState().users;
      const resolvedName = e.creatorName
        || users.find((u) => u.session === e.creatorSession)?.name
        || "";
      const poll: PollPayload = {
        type: "poll",
        id: e.pollId,
        question: e.question,
        options: e.options,
        multiple: e.multiple,
        creator: e.creatorSession,
        creatorName: resolvedName,
        createdAt: e.createdAt,
        channelId: e.channelId,
      };
      useAppStore.getState().addPoll(poll, false);
    }),
  );
  unlisteners.push(
    await listen<{
      channelId: number;
      pollId: string;
      selected: number[];
      voterSession: number;
      voterName: string;
    }>(TauriEvent.FancyPollVote, (event) => {
      const e = event.payload;
      const users = useAppStore.getState().users;
      const resolvedName = e.voterName
        || users.find((u) => u.session === e.voterSession)?.name
        || "";
      const vote: PollVotePayload = {
        type: "poll_vote",
        pollId: e.pollId,
        selected: e.selected,
        voter: e.voterSession,
        voterName: resolvedName,
      };
      registerVote(vote);
      useAppStore.setState({});
    }),
  );

  // -- WebRTC signal events ----------------------------------------

  unlisteners.push(
    await listen<{ sender_session: number | null; target_session: number | null; signal_type: number; payload: string; serverId?: string | null }>(
      TauriEvent.WebrtcSignal,
      (event) => {
        const { sender_session, target_session, signal_type, payload } = event.payload;
        const serverId = event.payload.serverId ?? null;
        for (const handler of webRtcSignalHandlers) {
          handler(sender_session, target_session, signal_type, payload, serverId);
        }
      },
    ),
  );

  // -- Link preview response events --------------------------------

  unlisteners.push(
    await listen<{ request_id: string; embeds: import("../types").LinkEmbed[] }>(
      "link-preview-response",
      (event) => {
        const { request_id, embeds } = event.payload;
        if (!request_id || !Array.isArray(embeds) || embeds.length === 0) return;
        const prev = useAppStore.getState().linkEmbeds;
        const next = new Map(prev);
        next.set(request_id, embeds);
        useAppStore.setState({ linkEmbeds: next });
      },
    ),
  );

  // -- Custom reactions config event --------------------------------

  unlisteners.push(
    await listen<ServerCustomReaction[]>(
      TauriEvent.CustomReactionsConfig,
      (event) => {
        const reactions = event.payload;
        if (Array.isArray(reactions)) {
          setServerCustomReactions(reactions);
        }
      },
    ),
  );

  // -- Read receipt events -----------------------------------------

  unlisteners.push(
    await listen<ReadReceiptDeliverPayload>(
      TauriEvent.ReadReceiptDeliver,
      (event) => {
        const { channel_id, read_states } = event.payload;
        applyReadStates(channel_id, read_states);
        useAppStore.setState((prev) => ({
          readReceiptVersion: prev.readReceiptVersion + 1,
        }));
      },
    ),
  );

  // -- Onboarding workflow events ---------------------------------

  unlisteners.push(
    await listen<OnboardingConfigEvent>(TauriEvent.OnboardingConfig, (event) => {
      const { config } = event.payload;
      const onboarding = useOnboardingStore.getState();
      onboarding.setConfig(config);

      // If a fresh config arrived and the user has not answered the
      // current revision yet, surface the modal automatically.
      const { response } = useOnboardingStore.getState();
      if (
        config?.enabled &&
        (!response || response.config_revision < config.revision)
      ) {
        const serverId = useAppStore.getState().activeServerId ?? null;
        const dismissed = serverId
          ? sessionStorage.getItem(`onboarding-dismissed:${serverId}`) === "1"
          : false;
        if (!dismissed) {
          onboarding.setModalOpen(true);
        }
      }
    }),
  );

  unlisteners.push(
    await listen<OnboardingResponseEvent>(TauriEvent.OnboardingResponse, (event) => {
      useOnboardingStore.getState().setResponse(event.payload.response ?? null);
    }),
  );

  // -- Typing indicator events ------------------------------------

  unlisteners.push(
    await listen<{ session: number; channel_id: number }>(
      TauriEvent.TypingIndicator,
      (event) => {
        const { session, channel_id } = event.payload;
        useAppStore.setState((prev) => {
          const next = new Map(prev.typingUsers);
          const channelSet = new Set(next.get(channel_id));
          channelSet.add(session);
          next.set(channel_id, channelSet);
          return { typingUsers: next };
        });

        // Auto-expire after 5 seconds.
        setTimeout(() => {
          useAppStore.setState((prev) => {
            const next = new Map(prev.typingUsers);
            const channelSet = next.get(channel_id);
            if (!channelSet) return prev;
            const updated = new Set(channelSet);
            updated.delete(session);
            if (updated.size === 0) {
              next.delete(channel_id);
            } else {
              next.set(channel_id, updated);
            }
            return { typingUsers: next };
          });
        }, 5000);
      },
    ),
  );

  // -- Watch-together (FancyWatchSync) events ---------------------

  unlisteners.push(
    await listen<WatchSyncPayload>(TauriEvent.WatchSync, (event) => {
      applyWatchSyncEvent(event.payload);
    }),
  );

  // -- Persistent chat events (in store/slices/persistentChat.events.ts) ---
  await registerPersistentChatEvents(unlisteners);

  return unlisteners;
}
