/**
 * The wallpaper shelf's bookkeeping.
 *
 * The picker used to hold exactly one background: every pick wiped the store
 * and the record kept one set of names. Several now live side by side, so the
 * record carries a list of them and the store keeps every file that list still
 * names. Switching between them costs a record write and nothing else - no
 * second dialog, no re-copy, no re-decode, and no second copy of the bytes.
 *
 * The live `chatBg*` fields stay the single answer to "what is on screen":
 * every renderer reads those and knows nothing about this list. So the two
 * directions here are [`activeBackground`] (live fields -> entry) and
 * [`showBackground`] (entry -> live fields), and everything else is list
 * algebra over the shelf.
 *
 * Pure by design - no IPC, no React - apart from the two ref helpers it
 * borrows to read file names back out of a record value.
 */

import {
  CHAT_BG_RECENTS_MAX,
  type ChatBackgroundEntry,
  type PersonalizationData,
} from "@standard/personalizationStorage";
import { isStoreRef, storeRefName } from "./chatBackground";

/** The live fields a shelf entry is made of. */
type BackgroundFields = Pick<
  PersonalizationData,
  | "chatBgOriginal"
  | "chatBgBlurred"
  | "chatBgVideo"
  | "chatBgVideoBaked"
  | "chatBgVideoBakedSigma"
  | "chatBgVideoBakedDim"
  | "chatBgFocusX"
  | "chatBgFocusY"
>;

/** The middle, which is where CSS crops from when nobody has said otherwise. */
const CENTER = 0.5;

/** The wallpaper a record currently shows, as a shelf entry. */
export function activeBackground(data: PersonalizationData): ChatBackgroundEntry {
  return {
    original: data.chatBgOriginal,
    blurred: data.chatBgBlurred,
    video: data.chatBgVideo,
    videoBaked: data.chatBgVideoBaked,
    videoBakedSigma: data.chatBgVideoBakedSigma,
    videoBakedDim: data.chatBgVideoBakedDim,
    focusX: data.chatBgFocusX,
    focusY: data.chatBgFocusY,
  };
}

/** The live fields that put `entry` on screen; `null` means no wallpaper. */
export function showBackground(entry: ChatBackgroundEntry | null): BackgroundFields {
  return {
    chatBgOriginal: entry?.original ?? null,
    chatBgBlurred: entry?.blurred ?? null,
    chatBgVideo: entry?.video ?? null,
    chatBgVideoBaked: entry?.videoBaked ?? null,
    chatBgVideoBakedSigma: entry?.videoBakedSigma ?? 0,
    chatBgVideoBakedDim: entry?.videoBakedDim ?? 0,
    // `??`, not a plain read: a wallpaper shelved before the focus point
    // existed has no opinion about it, and the middle is what it was being
    // drawn with all along.
    chatBgFocusX: entry?.focusX ?? CENTER,
    chatBgFocusY: entry?.focusY ?? CENTER,
  };
}

/** Whether an entry names a picture at all, rather than the default state. */
export function hasBackground(entry: ChatBackgroundEntry | null): boolean {
  return entry != null && (entry.original !== null || entry.video !== null);
}

/**
 * Whether two entries are the same wallpaper.
 *
 * Identity is the picked files only. The derived ones are that same picture
 * re-rendered whenever a slider moves, so letting them count would make a
 * wallpaper stop being itself the moment its bake landed - and the shelf would
 * fill up with copies of the one picture the user is looking at.
 */
export function isSameBackground(a: ChatBackgroundEntry, b: ChatBackgroundEntry): boolean {
  return a.original === b.original && a.video === b.video;
}

/**
 * Put `entry` at the front of the shelf, dropping the oldest past the cap.
 *
 * Re-picking a wallpaper that is already on the shelf moves it rather than
 * duplicating it. The default state is not a wallpaper and is never remembered.
 */
export function rememberBackground(
  recents: readonly ChatBackgroundEntry[],
  entry: ChatBackgroundEntry,
): ChatBackgroundEntry[] {
  if (!hasBackground(entry)) return [...recents];
  return [entry, ...recents.filter((other) => !isSameBackground(other, entry))].slice(
    0,
    CHAT_BG_RECENTS_MAX,
  );
}

/**
 * Refresh the shelf's copy of a wallpaper in place.
 *
 * For results that land after the pick - a finished bake, a processed still -
 * which change what the entry points at without making it a newer pick, so its
 * position must not move.
 */
export function updateBackground(
  recents: readonly ChatBackgroundEntry[],
  entry: ChatBackgroundEntry,
): ChatBackgroundEntry[] {
  return recents.map((other) => (isSameBackground(other, entry) ? entry : other));
}

/** Take a wallpaper off the shelf. Its files go on the next prune. */
export function forgetBackground(
  recents: readonly ChatBackgroundEntry[],
  entry: ChatBackgroundEntry,
): ChatBackgroundEntry[] {
  return recents.filter((other) => !isSameBackground(other, entry));
}

/**
 * Every stored file a record still refers to - the store's keep-list.
 *
 * The active wallpaper is included whether or not it is on the shelf, so a
 * record mid-write can never prune the picture it is displaying. Data-URL
 * values name no file and simply contribute nothing.
 */
export function referencedFiles(data: PersonalizationData): string[] {
  const names = new Set<string>();
  const addRef = (value: string | null) => {
    if (isStoreRef(value)) names.add(storeRefName(value));
  };
  const addName = (name: string | null) => {
    if (name) names.add(name);
  };
  for (const entry of [activeBackground(data), ...data.chatBgRecents]) {
    addRef(entry.original);
    addRef(entry.blurred);
    addName(entry.video);
    addName(entry.videoBaked);
  }
  return [...names];
}
