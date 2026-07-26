import type { UserPreferences } from "@core/types";

export interface PrivacyWarningCopy {
  /**
   * The preference value that makes this a live exposure. Most protective
   * toggles are risky while *off*; permissive ones while *on*.
   */
  riskyWhen: boolean;
  heading: string;
  /**
   * Heading for the safe state. When omitted the banner disappears entirely
   * once the exposure is closed - only dual-path stays visible in both states,
   * because "off" there is a standing warning about turning it on.
   */
  safeHeading?: string;
  body: string;
}

export interface PrivacyRowCopy {
  key: keyof UserPreferences;
  title: string;
  detail: string;
  warning?: PrivacyWarningCopy;
}

/**
 * Privacy toggles with the exposure each one governs.
 *
 * The hints are deliberately specific about *who* learns *what* - "the server
 * logs every URL you paste" is actionable where "improves privacy" is not.
 */
export const PRIVACY_ROWS: PrivacyRowCopy[] = [
  {
    key: "disableTypingIndicators",
    title: "Disable typing indicators",
    detail:
      "When enabled, you will not send typing indicators to others and you will not see when others are typing.",
  },
  {
    key: "disableReadReceipts",
    title: "Disable read receipts",
    detail:
      "When enabled, other users will not see that you have read their messages. You will also not see read receipts from others.",
    warning: {
      riskyWhen: false,
      heading: "Read times are visible to others",
      body: "Other users can see exactly when you opened a message. Enable this toggle to stop broadcasting your read times.",
    },
  },
  {
    key: "disableOsmMaps",
    title: "Disable OpenStreetMap maps",
    detail:
      "When enabled, no map tiles are loaded and no IP geolocation requests are sent to external services.",
    warning: {
      riskyWhen: false,
      heading: "External map services are active",
      body: "Map tiles are fetched from tile.openstreetmap.org. Your IP address is visible to OpenStreetMap servers on every map interaction. Enable this toggle to prevent those requests.",
    },
  },
  {
    key: "disableLinkPreviews",
    title: "Disable link previews",
    detail:
      "When enabled, the app will not request link metadata from the server. This prevents the server from learning which URLs you share in chat.",
    warning: {
      riskyWhen: false,
      heading: "URLs are sent to the server for preview generation",
      body: "Every link you paste in chat is fetched by the server to generate a preview. This lets the server log all URLs you share and may hint at encrypted message content if a URL carries context. Enable this toggle to prevent it.",
    },
  },
  {
    key: "enableExternalEmbeds",
    title: "Allow external embeds",
    detail:
      "Required for the YouTube watch-together adapter. When enabled, the YouTube IFrame API is loaded from youtube.com on demand. Disable to keep all watch-together sessions on direct media URLs only.",
    warning: {
      riskyWhen: true,
      heading: "Third-party code loaded on demand",
      body: "YouTube's IFrame API is fetched from youtube.com during watch-together sessions. Google can observe these requests and associate them with your IP address.",
    },
  },
  {
    key: "streamerMode",
    title: "Streamer mode",
    detail:
      "Hides identifying information (server host, ports, IP addresses, geolocation) and suppresses native notifications so they cannot leak personal data into a screen recording.",
  },
  {
    key: "persistDms",
    title: "Keep direct-message history",
    detail: "Store encrypted direct-message history on this device so it survives restarts.",
  },
  {
    key: "enableDualPath",
    title: "Enable dual-path sending",
    detail:
      'When enabled, encrypted channels also send a plain-text placeholder over the normal message path so legacy clients without E2EE support see "[Encrypted message]" instead of nothing. Disable this to keep the ciphertext off the unencrypted path entirely.',
    warning: {
      riskyWhen: true,
      heading: "E2EE partially bypassed",
      safeHeading: "Security risk if enabled",
      body: "A plaintext placeholder is sent over the unencrypted message path. Anyone monitoring TCP traffic can see when an encrypted message was sent, even if they cannot read its contents. Only enable this for compatibility with legacy clients that lack E2EE support.",
    },
  },
];
