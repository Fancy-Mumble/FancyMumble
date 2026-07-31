import type { UserPreferences } from "@core/types";

export type SettingsSectionId =
  | "general"
  | "profile"
  | "identities"
  | "voice"
  | "shortcuts"
  | "notifications"
  | "localization"
  | "privacy"
  | "plugins"
  | "appearance"
  | "advanced";

export interface PreferenceRow {
  key: keyof UserPreferences;
  title: string;
  detail: string;
}

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  /** Extra free-text keywords folded into the sidebar search haystack. */
  keywords?: string;
}

/** Boolean preferences rendered as toggle rows, with their copy. */
export const settingRows: PreferenceRow[] = [
  {
    key: "enableNotifications",
    title: "Desktop notifications",
    detail: "Show native notifications for messages and calls.",
  },
  {
    key: "autoReconnect",
    title: "Automatic reconnect",
    detail: "Reconnect when a server connection is interrupted.",
  },
  {
    key: "disableTypingIndicators",
    title: "Disable typing indicators",
    detail: "Do not send or display typing activity.",
  },
  {
    key: "disableLinkPreviews",
    title: "Disable link previews",
    detail: "Hide rich metadata cards below messages.",
  },
  {
    key: "enableExternalEmbeds",
    title: "Allow external media",
    detail: "Permit remote players after preview metadata arrives.",
  },
  {
    key: "streamerMode",
    title: "Streamer mode",
    detail: "Hide sensitive connection information while recording.",
  },
  { key: "hideEmptyChannels", title: "Hide empty channels", detail: "Reduce channel lists to active rooms." },
  {
    key: "persistDms",
    title: "Keep direct-message history",
    detail: "Store encrypted DM history on this device.",
  },
  {
    key: "disableReadReceipts",
    title: "Disable read receipts",
    detail: "Do not report when messages have been read.",
  },
  {
    key: "disableOsmMaps",
    title: "Disable map requests",
    detail: "Prevent OpenStreetMap and IP geolocation requests.",
  },
  {
    key: "autoUpdateOnStartup",
    title: "Automatic updates",
    detail: "Download and install client updates on startup.",
  },
  {
    key: "enableDualPath",
    title: "Encrypted dual-path messages",
    detail: "Send encrypted content together with a compatible placeholder.",
  },
  {
    key: "showDisconnectWarning",
    title: "Confirm disconnect",
    detail: "Ask before leaving the active server.",
  },
  { key: "logToFile", title: "Write logs to file", detail: "Keep date-stamped client logs on this device." },
  { key: "terminalLogging", title: "Terminal logging", detail: "Mirror application logs to stdout." },
  { key: "autoZipLogs", title: "Compress old logs", detail: "Compress log files older than one day." },
];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general", label: "General" },
  { id: "profile", label: "Profile" },
  { id: "identities", label: "Identities", keywords: "certificate key export import persona account" },
  { id: "voice", label: "Voice & audio", keywords: "audio microphone" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "notifications", label: "Notifications", keywords: "sound alert volume welcome message chime" },
  {
    id: "localization",
    label: "Localization",
    keywords: "language translation time date number format 12h 24h separator timezone",
  },
  {
    id: "privacy",
    label: "Privacy",
    keywords:
      "encryption e2ee read receipts typing maps geolocation openstreetmap previews embeds youtube streamer hide ip",
  },
  { id: "plugins", label: "Plugins", keywords: "extensions trust capabilities permissions allow block" },
  { id: "appearance", label: "Appearance" },
  { id: "advanced", label: "Advanced" },
];

/** Which boolean preference rows appear in each section, in display order. */
export const sectionPreferenceKeys: Record<SettingsSectionId, Array<keyof UserPreferences>> = {
  general: ["autoReconnect", "hideEmptyChannels", "showDisconnectWarning", "autoUpdateOnStartup"],
  profile: [],
  identities: [],
  voice: [],
  shortcuts: [],
  notifications: ["enableNotifications"],
  localization: [],
  privacy: [
    "disableTypingIndicators",
    "disableReadReceipts",
    "disableOsmMaps",
    "disableLinkPreviews",
    "enableExternalEmbeds",
    "streamerMode",
    "persistDms",
    "enableDualPath",
  ],
  plugins: [],
  appearance: [],
  advanced: ["logToFile", "terminalLogging", "autoZipLogs"],
};

export function sectionLabel(id: SettingsSectionId): string {
  return SETTINGS_SECTIONS.find((section) => section.id === id)?.label ?? id;
}

/** True when the section id, label, keywords, or any of its toggle copy matches the query. */
export function sectionMatchesQuery(section: SettingsSection, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const rowCopy = settingRows
    .filter((row) => sectionPreferenceKeys[section.id].includes(row.key))
    .map((row) => `${row.title} ${row.detail}`)
    .join(" ");
  return `${section.id} ${section.label} ${section.keywords ?? ""} ${rowCopy}`
    .toLocaleLowerCase()
    .includes(needle);
}

/** Shared handler shapes passed from the SettingsPanel controller down to section panels. */
export type PreferenceToggleHandler = (key: keyof UserPreferences) => void;
export type PreferencePatchHandler = (change: Partial<UserPreferences>) => Promise<void> | void;
export type LocalPreferenceHandler = (change: Partial<UserPreferences>) => void;
