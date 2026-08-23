/**
 * Persistent storage for personalization settings (chat background, etc.)
 * using `@tauri-apps/plugin-store` (Tauri Store v2).
 */

import { load } from "@core/utils/store";
import type { ThemeId } from "./themes";

export type BubbleStyle = "bubbles" | "flat" | "compact";
export type FontSize = "small" | "medium" | "large";
export type BgFit = "cover" | "tile";
export type ChannelViewerStyle = "classic" | "flat" | "modern";

export interface PersonalizationData {
  /**
   * The background still: either a data-URL (legacy, and what Standard's own
   * editor writes) or a `bgstore:` reference to a file in the backend's
   * chat-backgrounds store. Resolve through
   * `@core/features/settings/chatBackground` before rendering. For an
   * animated background this is the clip's poster frame.
   */
  chatBgOriginal: string | null;
  /** The still with blur/dim baked in - data-URL or `bgstore:` ref, as above. */
  chatBgBlurred: string | null;
  /** Blur sigma value (0 = no blur). */
  chatBgBlurSigma: number;
  /** Background opacity (0.0 - 1.0). */
  chatBgOpacity: number;
  /** Background dim/overlay darkness (0.0 - 1.0). */
  chatBgDim: number;
  /** How the background image fills the chat area ("cover" or "tile"). */
  chatBgFit: BgFit;
  /**
   * File name of an animated background in the backend's store, or null for a
   * still (or no) background.
   *
   * Only the name lives here: the clip itself is far too big for a record that
   * is read back over IPC on every cold start, so the bytes stay on disk and
   * the webview reads them once over binary IPC. `chatBgOriginal` holds its
   * poster frame, which is what the skins that cannot play video fall back to.
   */
  chatBgVideo: string | null;
  /**
   * File name of the pre-processed clip - `chatBgVideo` with blur and dim
   * baked into its pixels by the Rust backend - or null while no bake exists.
   * Valid only while the two `chatBgVideoBaked*` values match the live
   * `chatBgBlurSigma`/`chatBgDim`; a slider moved after the bake leaves this
   * stale, and renderers must fall back to the live CSS filter over the raw
   * clip until the next bake lands.
   */
  chatBgVideoBaked: string | null;
  /** The sigma the current bake was computed with. */
  chatBgVideoBakedSigma: number;
  /** The dim the current bake was computed with. */
  chatBgVideoBakedDim: number;
  /** Message bubble visual style. */
  bubbleStyle: BubbleStyle;
  /** Font size preset (or custom px value stored as number). */
  fontSize: FontSize;
  /** Custom font size in pixels (used only when fontSize === "large" in expert mode). */
  fontSizeCustomPx: number;
  /** Font family for chat messages. */
  fontFamily: string;
  /** Compact mode - hide avatars and tighten spacing. */
  compactMode: boolean;
  /** Channel sidebar viewer style. */
  channelViewerStyle: ChannelViewerStyle;
  /** Active color theme. */
  theme: ThemeId;
  /** Always render the copy/reply/reaction action bar at the bottom of every
   *  text message instead of only showing it on hover. */
  alwaysShowMessageActions: boolean;
}

const STORE_FILE = "personalization.json";
const KEY = "data";

export const PERSONALIZATION_DEFAULTS: PersonalizationData = {
  chatBgOriginal: null,
  chatBgBlurred: null,
  chatBgBlurSigma: 0,
  chatBgOpacity: 0.25,
  chatBgDim: 0.5,
  chatBgFit: "cover",
  chatBgVideo: null,
  chatBgVideoBaked: null,
  chatBgVideoBakedSigma: 0,
  chatBgVideoBakedDim: 0,
  bubbleStyle: "bubbles",
  fontSize: "medium",
  fontSizeCustomPx: 14,
  fontFamily: "system",
  compactMode: false,
  channelViewerStyle: "flat",
  theme: "dark",
  alwaysShowMessageActions: false,
};

async function getStore() {
  return load(STORE_FILE, { autoSave: true, defaults: {} });
}

// In-flight + cached load promise so concurrent / repeat callers on
// startup share a single IPC roundtrip (the personalization payload can
// include large image data URLs and cost ~200 KiB per fetch).
let cachedLoad: Promise<PersonalizationData> | null = null;

/** Return persisted personalization data, falling back to defaults. */
export async function loadPersonalization(): Promise<PersonalizationData> {
  if (cachedLoad) return cachedLoad;
  cachedLoad = (async () => {
    const store = await getStore();
    const data = await store.get<PersonalizationData>(KEY);
    return data ? { ...PERSONALIZATION_DEFAULTS, ...data } : { ...PERSONALIZATION_DEFAULTS };
  })();
  try {
    return await cachedLoad;
  } catch (e) {
    cachedLoad = null;
    throw e;
  }
}

/** Fired after a successful save so live surfaces (chat backgrounds, previews)
 *  can re-read without being remounted. */
export const PERSONALIZATION_CHANGED_EVENT = "personalization-changed";

/** Persist personalization data. */
export async function savePersonalization(data: PersonalizationData): Promise<void> {
  const store = await getStore();
  await store.set(KEY, data);
  cachedLoad = Promise.resolve(data);
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(PERSONALIZATION_CHANGED_EVENT, { detail: data }));
}
