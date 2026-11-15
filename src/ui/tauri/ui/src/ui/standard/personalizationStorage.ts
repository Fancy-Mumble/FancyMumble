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
export type ColorMode = "system" | "light" | "dark";

/**
 * One wallpaper, as the record remembers it.
 *
 * Exactly the fields that describe a *picture* - the sliders are not in here,
 * because blur, dim and opacity are settings of the chat column that outlive
 * any one wallpaper rather than properties of the picture behind it. The two
 * derived files (`blurred`, `videoBaked`) are, since they are that picture
 * rendered at particular slider values and are worth keeping alongside it.
 */
export interface ChatBackgroundEntry {
  /** The still - data-URL or `bgstore:` ref. For a clip, its poster frame. */
  original: string | null;
  /** The still with blur/dim baked in, or null. */
  blurred: string | null;
  /** Stored clip name, or null for a still. */
  video: string | null;
  /** The clip's bake; valid only while the stamps below match the sliders. */
  videoBaked: string | null;
  /** The sigma the bake was computed with. */
  videoBakedSigma: number;
  /** The dim the bake was computed with. */
  videoBakedDim: number;
  /**
   * Where the picture is anchored when it has to be cropped, as a fraction of
   * its own width and height. `0.5`/`0.5` is the middle, which is what CSS
   * does on its own.
   *
   * Per wallpaper rather than per window, because it answers a question about
   * this picture - where in it the subject is - and the answer moves with the
   * picture. A column narrower than the image crops the sides; a shorter one
   * crops top and bottom, which is what puts a portrait's belly on screen and
   * its face out of frame.
   *
   * Absent on a wallpaper shelved before the focus point existed, which is
   * read as the middle - what it was being drawn with all along.
   */
  focusX?: number;
  focusY?: number;
}

/** How many wallpapers the shelf holds before the oldest is let go. */
export const CHAT_BG_RECENTS_MAX = 5;

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
   * The displayed wallpaper's focus point (see [`ChatBackgroundEntry`]), as
   * fractions of the picture. Only meaningful while it is being cropped -
   * a tiled background has nothing to crop.
   */
  chatBgFocusX: number;
  chatBgFocusY: number;
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
  /**
   * The wallpaper shelf: the last few picks, newest first, capped at
   * [`CHAT_BG_RECENTS_MAX`].
   *
   * The `chatBg*` fields above stay the single answer to "what is on screen" -
   * every renderer reads those and nothing else - and this list is only the
   * memory behind them, so switching wallpapers is a record write rather than
   * a re-pick. The entry matching the live fields is the active one; a shelf
   * with no active entry is the "Default" (no wallpaper) state.
   *
   * Names, never bytes: the store keeps every file the list still refers to,
   * and `pruneChatBackgrounds` deletes the rest.
   */
  chatBgRecents: ChatBackgroundEntry[];
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
  /**
   * Light or dark, independent of which theme is chosen.
   *
   * The design sheet draws every theme in both schemes - the names are brands,
   * not modes - so which scheme a theme is worn in is a separate choice.
   * "system" follows the platform. Themes that exist only as a single Standard
   * stylesheet ignore this and keep the one scheme they have.
   */
  colorMode: ColorMode;
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
  chatBgFocusX: 0.5,
  chatBgFocusY: 0.5,
  chatBgVideo: null,
  chatBgVideoBaked: null,
  chatBgVideoBakedSigma: 0,
  chatBgVideoBakedDim: 0,
  chatBgRecents: [],
  bubbleStyle: "bubbles",
  fontSize: "medium",
  fontSizeCustomPx: 14,
  fontFamily: "system",
  compactMode: false,
  channelViewerStyle: "flat",
  theme: "dark",
  colorMode: "system",
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
