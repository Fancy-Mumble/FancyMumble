/**
 * Server emotes on a server that keeps its own.
 *
 * The plugin's emotes arrived once, as a `fancy-server-emotes` broadcast with
 * every image inlined as a data URL, and a server without that plugin had
 * none at all.  These are named public objects in the server's own
 * `srv/emotes/` namespace (`STORAGE-UNIFICATION.md` D2): the client is handed
 * URLs rather than bytes, and the set is re-sent to everyone whenever it
 * changes - so an emote somebody deleted actually stops rendering.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CustomServerEmote } from "../types";

/** One emote as the backend hands it over. */
interface CanonEmote {
  readonly shortcode: string;
  /** A plain URL: an `<img>` cannot sign a request. */
  readonly url: string;
  readonly aliasEmoji: string;
  readonly description: string;
}

/** The shape the rest of the client already renders. */
function asStoreEmote(emote: CanonEmote): CustomServerEmote {
  return {
    shortcode: emote.shortcode,
    aliasEmoji: emote.aliasEmoji,
    description: emote.description || undefined,
    // The field is named for the data URLs the plugin sent, and holds a plain
    // URL here. Both are things an `<img src>` accepts, which is all any
    // consumer does with it.
    imageDataUrl: emote.url,
  };
}

/**
 * This server's emotes, or `null` when it keeps none of its own.
 *
 * `null` rather than an empty list, because the two mean different things: no
 * store is the cue to fall back to the plugin's set, and an empty store is a
 * server that simply has no emotes yet.
 */
export async function fetchCanonEmotes(): Promise<CustomServerEmote[] | null> {
  try {
    const emotes = await invoke<CanonEmote[]>("canon_emotes");
    return emotes.map(asStoreEmote);
  } catch {
    return null;
  }
}

/** Add or replace one emote. Needs `ManageEmotes` on the root. */
export async function addCanonEmote(
  shortcode: string,
  aliasEmoji: string,
  description: string,
  filePath: string,
): Promise<CustomServerEmote[]> {
  const emotes = await invoke<CanonEmote[]>("canon_emote_add", {
    shortcode,
    aliasEmoji,
    description,
    filePath,
  });
  return emotes.map(asStoreEmote);
}

/** Remove one emote. Needs `ManageEmotes` on the root. */
export async function removeCanonEmote(shortcode: string): Promise<CustomServerEmote[]> {
  const emotes = await invoke<CanonEmote[]>("canon_emote_remove", { shortcode });
  return emotes.map(asStoreEmote);
}

/**
 * Follow the server's emote set for as long as the connection lasts.
 *
 * The server pushes the whole set on every change, so there is nothing to
 * merge: whatever arrives is what the server has.
 */
export function watchCanonEmotes(onChange: (emotes: CustomServerEmote[]) => void): Promise<() => void> {
  return listen<CanonEmote[]>("server-emotes-changed", (event) => {
    onChange((event.payload ?? []).map(asStoreEmote));
  });
}
