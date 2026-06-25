/** App-wide user preferences, notification-sound config, sidebar state and the
 *  developer debug-stats panel. */

import type { ServerId } from "./server";

/** Whether the user prefers a simplified or full-featured UI. */
export type UserMode = "normal" | "expert" | "developer";

/** Preferred time display format. */
export type TimeFormat = "12h" | "24h" | "auto";

/** Preferred date display format.
 *  - `auto`: follow the active UI language.
 *  - `dmy`: Day/Month/Year (e.g. 17/05/2026) - most of the world.
 *  - `mdy`: Month/Day/Year (e.g. 05/17/2026) - US, parts of Canada.
 *  - `ymd`: Year-Month-Day / ISO 8601 (e.g. 2026-05-17). */
export type DateFormat = "auto" | "dmy" | "mdy" | "ymd";

/** Preferred number formatting. Named by the actual separators used so
 *  no convention is privileged as "plain" or "default". */
export type NumberFormat = "auto" | "comma-period" | "period-comma" | "space-comma";

/** App-wide user preferences stored persistently. */
export interface UserPreferences {
  /** Simplified or full-featured UI mode. */
  userMode: UserMode;
  /** Whether the first-run setup has been completed. */
  hasCompletedSetup: boolean;
  /** Default username pre-filled when adding a new server. */
  defaultUsername: string;
  /** Custom Klipy API key (expert mode). When empty/undefined, the built-in key is used. */
  klipyApiKey?: string;
  /** Preferred time format for message timestamps. */
  timeFormat: TimeFormat;
  /** Convert UTC timestamps to the local timezone before displaying. */
  convertToLocalTime: boolean;
  /** Preferred date format for message timestamps and other date displays. */
  dateFormat?: DateFormat;
  /** Preferred number formatting (thousands separator + decimal mark). */
  numberFormat?: NumberFormat;
  /** Whether native OS notifications are enabled. */
  enableNotifications?: boolean;
  /** When true, encrypted channels send a placeholder instead of the real
   *  message body in the plain TextMessage (disabling dual-path sending). */
  enableDualPath?: boolean;
  /** Enable verbose debug logging in the Rust backend.
   *  @deprecated use logLevel instead */
  debugLogging?: boolean;
  /** Backend log level. One of: error, warn, info, debug, trace. */
  logLevel?: string;
  /** Write logs to a date-stamped file in the OS log directory. */
  logToFile?: boolean;
  /** Enable stdout/terminal logging in release builds (always on in dev). */
  terminalLogging?: boolean;
  /** Auto-compress (zstd) log files older than a day when file logging is on. */
  autoZipLogs?: boolean;
  /** Fingerprint of the audio input settings the last voice-activation
   *  calibration was performed under. The "calibration needed" hint is shown
   *  only when this is absent or differs from the current settings.
   *  `null` = never calibrated. */
  calibrationSignature?: string | null;
  /** User's preferred ordering of the server tabs (by server id). */
  serverTabOrder?: ServerId[];
  /** Collapsed/expanded state of sidebar sections. */
  sidebarSections?: SidebarSections;
  /** When true, the channel viewer hides channels that have no members. */
  hideEmptyChannels?: boolean;
  /** Per-event notification sound configuration. */
  notificationSounds?: NotificationSoundSettings;
  /** When true, the client does not send read receipts to the server. */
  disableReadReceipts?: boolean;
  /** When true, typing indicators are neither sent nor shown. */
  disableTypingIndicators?: boolean;
  /** When true, OpenStreetMap maps and IP geolocation requests are disabled. */
  disableOsmMaps?: boolean;
  /** When true, rich link previews (including external resource embeds) are hidden. */
  disableLinkPreviews?: boolean;
  /** When true, the watch-together feature may embed external players
   *  (e.g. YouTube IFrame API).  When false, only direct media URLs
   *  shared inside the chat can be played in sync. */
  enableExternalEmbeds?: boolean;
  /** Streamer mode: hides identifying information (server host/IP, own IP)
   *  and suppresses native notifications so personal data does not leak
   *  into screen captures or recordings. */
  streamerMode?: boolean;
  /** When true, automatically retry connecting after an unexpected disconnect. */
  autoReconnect?: boolean;
  /** When true, app updates are downloaded and installed automatically on
   *  startup automatically. When false, the user is prompted. */
  autoUpdateOnStartup?: boolean;
  /** Version string the user chose to skip in the updater bootstrapper.
   *  Updates matching this version are silently ignored on startup. */
  skippedUpdateVersion?: string | null;
  /** Last active sidebar tab - restored after reconnect. */
  sidebarActiveTab?: "channels" | "members";
  /** Whether voice (mic on/can-hear) was enabled when last disconnected.
   *  On reconnect the call is re-enabled automatically when true. */
  voiceOnReconnect?: boolean;
  /** Whether the mic was muted (but still in-call) when last disconnected. */
  voiceMutedOnReconnect?: boolean;
  /** When true, direct messages exchanged with friends are persisted to
   *  the local device (encrypted with AES-GCM) so the conversation
   *  history survives reconnects and app restarts.  Off by default. */
  persistDms?: boolean;
  /** Override marketplace API base URL used in developer mode.
   *  When absent or undefined the production URL is used. */
  marketplaceBaseUrl?: string;
  /** How the server's welcome message is shown after connecting:
   *  "hide" never shows it, "once" shows it once per server (until dismissed),
   *  "always" shows it on every connect.  Defaults to "once". */
  welcomeMessageDisplay?: WelcomeMessageDisplay;
  /** When false, the disconnect confirmation dialog is skipped (the user chose
   *  "never show again").  Defaults to true. */
  showDisconnectWarning?: boolean;
}

/** Controls when the server welcome message modal appears on connect. */
export type WelcomeMessageDisplay = "hide" | "once" | "always";

/** Identifiers for events that can trigger a notification sound. */
export type NotificationEvent =
  | "chatMessage"
  | "directMessage"
  | "mention"
  | "userJoin"
  | "userLeave"
  | "userJoinChannel"
  | "userLeaveChannel"
  | "streamStart"
  | "voiceActivity"
  | "selfMuted";

/** Configuration for a single notification event. */
export interface NotificationEventConfig {
  enabled: boolean;
  sound: string;
  volume: number;
}

/** Per-event notification sound settings with a master toggle. */
export interface NotificationSoundSettings {
  masterEnabled: boolean;
  events: Record<NotificationEvent, NotificationEventConfig>;
}

/** Persisted open/closed state for each sidebar section. */
export interface SidebarSections {
  channels: boolean;
  /** Collapse state of the "Private rooms" section (the flat meeting-room list).
   *  Optional/absent = expanded. */
  privateRooms?: boolean;
}

/** Debug statistics returned by the backend for the developer info panel. */
export interface DebugStats {
  channel_message_count: number;
  dm_message_count: number;
  total_message_count: number;
  offloaded_count: number;
  channel_count: number;
  user_count: number;
  connection_epoch: number;
  voice_state: string;
  uptime_seconds: number;
}
