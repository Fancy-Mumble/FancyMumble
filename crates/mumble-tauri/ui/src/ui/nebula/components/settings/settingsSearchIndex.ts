/**
 * What the settings search can find, and how a query is matched against it.
 *
 * Standard has each panel register its own settings at module scope, which
 * works there because every panel is statically imported by the settings page.
 * Nebula loads one page per chunk on purpose - see ARCHITECTURE's "Chunks" -
 * so self-registration would only ever index the pages already opened, and a
 * search that finds a setting once you have already been there is worse than
 * no search at all. The index is therefore stated here, in one eagerly-loaded
 * module, listing the headings each page draws.
 *
 * Every entry carries a `titleKey` as well as its English title, so the search
 * matches what is actually on screen rather than what the page said before it
 * was translated. The English stays as the fallback a missing key falls back
 * to, and as the thing to read when working out which heading a row means.
 *
 * The titles are the strings the pages pass to `PageTitle`, `GroupTitle`,
 * `Field`, `ToggleRow` and friends, which is what lets `SettingsScreen` flash
 * the heading a result points at: those controls publish their title as a
 * `data-settings-anchor`.
 */
import type { SettingsPageId } from "./SettingsNav";

export interface SettingsSearchEntry {
  /** The page this setting is on. */
  readonly page: SettingsPageId;
  /** The heading as the page draws it, in English - the fallback, and the
   *  readable half of the pair. */
  readonly title: string;
  /** The key that heading is drawn from: bare for the shared `settings`
   *  namespace, `nebulaSettings:`-prefixed for Nebula's own. Required, so a
   *  row added for a new setting cannot quietly go back to English-only. */
  readonly titleKey: string;
  /** Words that should find this setting without being written on it. */
  readonly keywords?: readonly string[];
}

/**
 * Every setting worth landing on, page by page.
 *
 * Headings rather than individual controls: a result takes you to a part of a
 * page, and indexing each switch under a heading would report "9 results" for
 * one section without saying anything more about where to look.
 */
export const SETTINGS_SEARCH_INDEX: readonly SettingsSearchEntry[] = [
  // -- Profile ------------------------------------------------------
  {
    page: "profile",
    title: "Identity",
    titleKey: "profile.identityLabel",
    keywords: ["identities", "certificate", "switch identity", "per-identity profile"],
  },
  {
    page: "profile",
    title: "Display name",
    titleKey: "nebulaSettings:profile.displayName",
    keywords: ["name", "nickname", "username"],
  },
  { page: "profile", title: "Pronouns", titleKey: "nebulaSettings:profile.pronouns" },
  {
    page: "profile",
    title: "Contact",
    titleKey: "nebulaSettings:profile.contact",
    keywords: ["email", "link"],
  },
  {
    page: "profile",
    title: "Status",
    titleKey: "profile.sectionStatus",
    keywords: ["away", "busy", "online"],
  },
  {
    page: "profile",
    title: "About you",
    titleKey: "nebulaSettings:profile.aboutYou",
    keywords: ["bio", "description"],
  },
  { page: "profile", title: "Avatar", titleKey: "profile.sectionAvatar", keywords: ["picture", "photo"] },
  { page: "profile", title: "Banner", titleKey: "profile.sectionBanner", keywords: ["header image"] },
  {
    page: "profile",
    title: "Card colours",
    titleKey: "nebulaSettings:profile.cardColours",
    keywords: ["colors", "card background", "gradient"],
  },
  {
    page: "profile",
    title: "Avatar frame",
    titleKey: "nebulaSettings:profile.avatarFrame",
    keywords: ["border", "ring"],
  },
  { page: "profile", title: "Sticker", titleKey: "nebulaSettings:profile.sticker", keywords: ["decoration"] },
  { page: "profile", title: "Nameplate", titleKey: "nebulaSettings:profile.nameplate" },
  {
    page: "profile",
    title: "Name style",
    titleKey: "nebulaSettings:profile.nameStyle",
    keywords: ["font", "gradient", "glow", "name colour"],
  },
  {
    page: "profile",
    title: "Profile effect",
    titleKey: "nebulaSettings:profile.profileEffect",
    keywords: ["animation"],
  },
  {
    page: "profile",
    title: "What the card shows",
    titleKey: "nebulaSettings:profile.whatTheCardShows",
    keywords: ["visibility", "hide fields"],
  },

  // -- Account ------------------------------------------------------
  {
    page: "account",
    title: "Password sign-in",
    titleKey: "account.password.title",
    keywords: ["password", "authentication", "login", "certificate"],
  },
  {
    page: "account",
    title: "Rename account",
    titleKey: "account.rename.title",
    keywords: ["rename", "username", "account name"],
  },
  {
    page: "account",
    title: "Contact email",
    titleKey: "account.email.title",
    keywords: ["email", "mail", "recovery"],
  },
  {
    page: "account",
    title: "Two-factor authentication (2FA)",
    titleKey: "account.totp.title",
    keywords: ["2fa", "totp", "two-factor", "authenticator", "mfa"],
  },
  {
    page: "account",
    title: "Delete registration",
    titleKey: "account.unregister.title",
    keywords: ["unregister", "delete account", "remove account"],
  },

  // -- Voice --------------------------------------------------------
  {
    page: "voice",
    title: "Input device",
    titleKey: "nebulaSettings:voice.inputDevice",
    keywords: ["microphone", "mic"],
  },
  {
    page: "voice",
    title: "Output device",
    titleKey: "nebulaSettings:voice.outputDevice",
    keywords: ["speaker", "headphones"],
  },
  {
    page: "voice",
    title: "Microphone volume",
    titleKey: "nebulaSettings:voice.microphoneVolume",
    keywords: ["input volume"],
  },
  {
    page: "voice",
    title: "Speaker volume",
    titleKey: "nebulaSettings:voice.speakerVolume",
    keywords: ["output volume"],
  },
  {
    page: "voice",
    title: "Activation mode",
    titleKey: "nebulaSettings:voice.activationMode",
    keywords: ["voice activity", "vad", "push to talk", "ptt", "continuous"],
  },
  {
    page: "voice",
    title: "Voice gate",
    titleKey: "nebulaSettings:gate.title",
    keywords: ["threshold", "sensitivity", "calibration"],
  },
  {
    page: "voice",
    title: "Auto gain",
    titleKey: "nebulaSettings:voice.autoGain",
    keywords: ["agc", "amplification", "levels"],
  },
  {
    page: "voice",
    title: "Noise suppression",
    titleKey: "nebulaSettings:voice.noiseSuppression",
    keywords: ["denoise", "denoiser", "background noise", "rnnoise", "deepfilternet"],
  },
  {
    page: "voice",
    title: "Fine tuning",
    titleKey: "nebulaSettings:voice.fineTuning",
    keywords: ["denoiser parameters", "attenuation", "advanced denoiser"],
  },
  {
    page: "voice",
    title: "Quality",
    titleKey: "nebulaSettings:voice.transmission",
    keywords: ["bitrate", "bandwidth", "compression"],
  },
  {
    page: "voice",
    title: "Audio per packet",
    titleKey: "nebulaSettings:voice.audioPerPacketShort",
    keywords: ["frame size", "latency", "packet"],
  },
  {
    page: "voice",
    title: "Force TCP audio",
    titleKey: "nebulaSettings:voice.forceTcp",
    keywords: ["udp", "firewall", "nat", "tunnel"],
  },
  {
    page: "voice",
    title: "Exclusive microphone mode",
    titleKey: "audio.exclusiveInput",
    keywords: ["wasapi", "exclusive", "access", "device in use", "busy"],
  },
  {
    page: "voice",
    title: "Legacy audio backend",
    titleKey: "nebulaSettings:voice.legacyBackend",
    keywords: ["cpal", "rodio"],
  },
  {
    page: "voice",
    title: "Audio statistics",
    titleKey: "nebulaSettings:voice.audioStatistics",
    keywords: ["packets", "loss", "debug"],
  },

  // -- Personalize --------------------------------------------------
  {
    page: "personalize",
    title: "Theme",
    titleKey: "personalize.theme",
    keywords: ["dark", "light", "colours", "colors"],
  },
  {
    page: "personalize",
    title: "Message style",
    titleKey: "nebulaSettings:personalize.messageStyle",
    keywords: ["bubbles", "flat", "compact"],
  },
  {
    page: "personalize",
    title: "Chat background",
    titleKey: "nebulaSettings:personalize.chatBackground",
    keywords: ["wallpaper", "blur", "dim", "opacity", "video"],
  },
  {
    page: "personalize",
    title: "Text size",
    titleKey: "nebulaSettings:personalize.textSize",
    keywords: ["font size", "larger", "smaller", "zoom"],
  },
  {
    page: "personalize",
    title: "Compact mode",
    titleKey: "nebulaSettings:personalize.compactMode",
    keywords: ["density", "avatars", "spacing"],
  },
  {
    page: "personalize",
    title: "Always show message actions",
    titleKey: "personalize.alwaysShowMessageActions",
    keywords: ["hover", "toolbar", "react", "reply"],
  },
  {
    page: "personalize",
    title: "Server list",
    titleKey: "nebulaSettings:personalize.serverList",
    keywords: ["rail", "title bar", "switcher"],
  },
  {
    page: "personalize",
    title: "Channel viewer",
    titleKey: "nebulaSettings:personalize.channelViewer",
    keywords: ["classic", "flat", "modern", "sidebar"],
  },
  {
    page: "personalize",
    title: "Interface design",
    titleKey: "settings:personalize.uiDesign",
    keywords: ["standard", "aurora", "nebula", "beta", "ui pack"],
  },

  // -- Notifications ------------------------------------------------
  {
    page: "notifications",
    title: "Notification sounds",
    titleKey: "notifications.sounds",
    keywords: ["sound", "audio alert", "chime"],
  },
  {
    page: "notifications",
    title: "Native notifications",
    titleKey: "notifications.native",
    keywords: ["os notifications", "desktop", "toast"],
  },
  {
    page: "notifications",
    title: "Welcome message",
    titleKey: "notifications.welcomeMessage",
    keywords: ["welcome", "motd", "popup"],
  },
  {
    page: "notifications",
    title: "Volume",
    titleKey: "notifications.volume",
    keywords: ["loudness", "sound volume"],
  },

  // -- Overlay ------------------------------------------------------
  {
    page: "overlay",
    title: "Game overlay",
    titleKey: "nebulaSettings:overlay.title",
    keywords: ["overlay", "game", "in-game", "hud", "on top", "always on top"],
  },
  {
    page: "overlay",
    title: "Show the overlay",
    titleKey: "nebulaSettings:overlay.mode",
    keywords: ["overlay", "while talking", "in any game"],
  },
  {
    page: "overlay",
    title: "Position",
    titleKey: "nebulaSettings:overlay.corner",
    keywords: ["overlay", "corner", "placement"],
  },
  {
    page: "overlay",
    title: "Show the last message",
    titleKey: "nebulaSettings:overlay.lastMessage",
    keywords: ["overlay", "chat", "message"],
  },
  {
    page: "overlay",
    title: "Hide from screen capture",
    titleKey: "nebulaSettings:overlay.hideFromCapture",
    keywords: ["overlay", "stream", "obs", "recording", "capture"],
  },
  {
    page: "overlay",
    title: "What it sees",
    titleKey: "nebulaSettings:overlay.diagnostics",
    keywords: ["overlay", "detection", "diagnostics", "why", "game detection"],
  },

  // -- Privacy ------------------------------------------------------
  {
    page: "privacy",
    title: "Dual-path delivery",
    titleKey: "privacy.dualPath",
    keywords: ["encryption", "dual path"],
  },
  { page: "privacy", title: "Read receipts", titleKey: "privacy.readReceipts", keywords: ["seen"] },
  {
    page: "privacy",
    title: "Typing indicators",
    titleKey: "privacy.typingIndicators",
    keywords: ["typing"],
  },
  {
    page: "privacy",
    title: "Maps",
    titleKey: "privacy.osmMaps",
    keywords: ["maps", "geolocation", "openstreetmap", "location"],
  },
  {
    page: "privacy",
    title: "Link previews",
    titleKey: "privacy.linkPreviews",
    keywords: ["embeds", "previews"],
  },
  {
    page: "privacy",
    title: "External embeds",
    titleKey: "privacy.externalEmbeds",
    keywords: ["youtube", "watch together"],
  },
  {
    page: "privacy",
    title: "Streamer mode",
    titleKey: "privacy.streamerMode",
    keywords: ["stream", "hide ip"],
  },
  {
    page: "privacy",
    title: "Rich presence",
    titleKey: "privacy.richPresence",
    keywords: ["discord", "game activity", "playing"],
  },
  {
    page: "privacy",
    title: "Rich presence artwork",
    titleKey: "privacy.richPresenceArtwork",
    keywords: ["discord", "artwork", "game art", "cover"],
  },

  // -- Language & format --------------------------------------------
  {
    page: "localization",
    title: "Language",
    titleKey: "language.label",
    keywords: ["language", "translation", "locale"],
  },
  {
    page: "localization",
    title: "Time Display",
    titleKey: "time.title",
    keywords: ["time format", "12h", "24h", "clock"],
  },
  {
    page: "localization",
    title: "Convert to local time",
    titleKey: "time.localLabel",
    keywords: ["server time", "timezone"],
  },
  { page: "localization", title: "Date Display", titleKey: "date.title", keywords: ["date format"] },
  {
    page: "localization",
    title: "Number Format",
    titleKey: "number.title",
    keywords: ["separator", "decimal"],
  },

  // -- Shortcuts ----------------------------------------------------
  {
    page: "shortcuts",
    title: "Voice - global",
    titleKey: "shortcuts.groupVoiceGlobal",
    keywords: ["push to talk", "ptt", "mute", "deafen", "priority", "hotkey"],
  },
  {
    page: "shortcuts",
    title: "Voice - in-app",
    titleKey: "shortcuts.groupVoiceApp",
    keywords: ["activation mode", "hotkey"],
  },
  {
    page: "shortcuts",
    title: "Channel and navigation",
    titleKey: "shortcuts.groupNavigation",
    keywords: ["quick search", "quick switcher", "sidebar", "member panel", "hotkey"],
  },
  {
    page: "shortcuts",
    title: "Window",
    titleKey: "shortcuts.groupWindow",
    keywords: ["fullscreen", "open settings", "developer overlay", "hotkey"],
  },
  {
    page: "shortcuts",
    title: "Jump to user (cross-server)",
    titleKey: "userShortcuts.title",
    keywords: ["user shortcut", "jump"],
  },
  {
    page: "shortcuts",
    title: "Chat - built-in (not configurable)",
    titleKey: "shortcuts.builtinTitle",
    keywords: ["composer", "bold", "italic", "emoji", "mention"],
  },

  // -- Identities ---------------------------------------------------
  {
    page: "identities",
    title: "Create new identity",
    titleKey: "identities.createNew",
    keywords: ["certificate", "key", "identity", "import"],
  },

  // -- Channels & roles ---------------------------------------------
  {
    page: "channels-roles",
    title: "Visible channels",
    titleKey: "onboarding.channelsAndRoles.visibleChannels",
    keywords: ["onboarding", "channels"],
  },
  {
    page: "channels-roles",
    title: "Your roles",
    titleKey: "onboarding.channelsAndRoles.yourRoles",
    keywords: ["onboarding", "groups", "roles"],
  },

  // -- Plugins ------------------------------------------------------
  {
    page: "plugins",
    title: "Plugins",
    titleKey: "tabs.plugins",
    keywords: ["plugin", "trust", "permissions", "marketplace"],
  },

  // -- Advanced -----------------------------------------------------
  { page: "advanced", title: "Expert Mode", titleKey: "advanced.expertMode", keywords: ["expert"] },
  {
    page: "advanced",
    title: "Lightweight interface (minimal mode)",
    titleKey: "advanced.uiMode",
    keywords: ["minimal", "lightweight", "qt", "interface", "ram", "memory"],
  },
  {
    page: "advanced",
    title: "Klipy API Key",
    titleKey: "advanced.klipyApiKey",
    keywords: ["gif", "klipy", "api key", "sticker search"],
  },
  {
    page: "advanced",
    title: "Stream viewer backend",
    titleKey: "advanced.streamBackend",
    keywords: ["webrtc", "decode", "screen share"],
  },
  {
    page: "advanced",
    title: "Developer Mode",
    titleKey: "advanced.developerMode",
    keywords: ["developer", "debug"],
  },
  { page: "advanced", title: "Log Level", titleKey: "advanced.logLevel", keywords: ["logging", "log"] },
  {
    page: "advanced",
    title: "Log to file",
    titleKey: "advanced.logToFile",
    keywords: ["logging", "log", "file"],
  },
  {
    page: "advanced",
    title: "Auto-compress old logs",
    titleKey: "advanced.autoZipLogs",
    keywords: ["logging", "log", "zip", "compress", "zstd"],
  },
  {
    page: "advanced",
    title: "Terminal logging (release builds)",
    titleKey: "advanced.terminalLogging",
    keywords: ["logging", "log", "terminal", "console", "stdout"],
  },
  {
    page: "advanced",
    title: "Log files",
    titleKey: "advanced.logFiles",
    keywords: ["logging", "log", "export", "view", "folder"],
  },
  {
    page: "advanced",
    title: "Translation helper",
    titleKey: "advanced.translationHelper",
    keywords: ["translate", "locale"],
  },
  {
    page: "advanced",
    title: "Auto Reconnect",
    titleKey: "advanced.autoReconnect",
    keywords: ["reconnect"],
  },
  {
    page: "advanced",
    title: "Auto-update on startup",
    titleKey: "advanced.autoUpdate",
    keywords: ["update", "auto update"],
  },
  {
    page: "advanced",
    title: "Persist DM history",
    titleKey: "advanced.persistDms",
    keywords: ["direct messages", "history"],
  },
  {
    page: "advanced",
    title: "Disconnect confirmation",
    titleKey: "advanced.disconnectWarning",
    keywords: ["disconnect", "confirmation"],
  },
  {
    page: "advanced",
    title: "Danger Zone",
    titleKey: "advanced.dangerZone",
    keywords: ["reset", "delete", "wipe"],
  },
];

/** One page that has something matching the query, and how much of it. */
export interface SettingsSearchHit {
  readonly page: SettingsPageId;
  readonly label: string;
  readonly count: number;
  /**
   * The matching headings, as drawn.
   *
   * Carried so the page can be told what to flash when the query itself is a
   * synonym: searching "ptt" has to land on "Voice - global", which does not
   * contain those three letters anywhere.
   */
  readonly titles: readonly string[];
}

/**
 * The pages matching `query`, in the nav's order.
 *
 * Every whitespace-separated word has to be found - on the title, on the
 * keywords, or split between them - so "log file" narrows to the file switch
 * instead of returning everything that mentions a log.
 *
 * `resolve` turns an entry into the string the page actually draws; the caller
 * owns it because translation is the caller's business, and keeping it out of
 * here leaves the matching testable without an i18n runtime.
 */
export function searchSettings(
  query: string,
  pages: readonly { readonly id: SettingsPageId; readonly label: string }[],
  resolve: (entry: SettingsSearchEntry) => string,
): readonly SettingsSearchHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const byPage = new Map<SettingsPageId, string[]>();
  for (const entry of SETTINGS_SEARCH_INDEX) {
    if (!pages.some((page) => page.id === entry.page)) continue;
    const title = resolve(entry);
    const haystack = `${title} ${entry.title} ${entry.keywords?.join(" ") ?? ""}`.toLowerCase();
    if (!words.every((word) => haystack.includes(word))) continue;
    const titles = byPage.get(entry.page);
    if (titles) titles.push(title);
    else byPage.set(entry.page, [title]);
  }

  return pages
    .filter((page) => byPage.has(page.id))
    .map((page) => {
      const titles = byPage.get(page.id) ?? [];
      return { page: page.id, label: page.label, count: titles.length, titles };
    });
}
