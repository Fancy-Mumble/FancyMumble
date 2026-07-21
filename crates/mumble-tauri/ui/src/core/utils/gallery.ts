//! Image-gallery messages.
//!
//! A gallery is sent as several individual messages - one image each, at full
//! quality - rather than one heavily-compressed message. Each image message
//! carries an HTML comment marker identifying its group, order and total, and
//! the message list lays a run of same-group messages out as a single grid
//! (see `ChatMessageList`). Because each image is its own real message it is
//! offloaded/restored individually like any other heavy message.

import type { ChatMessage } from "../types";

const PREFIX = "<!-- FANCY_GALLERY:";
const SUFFIX = " -->";

/** Matches `<!-- FANCY_GALLERY:<groupId>:<index>:<total> -->`. */
const GALLERY_RE = /<!-- FANCY_GALLERY:([^:\s]+):(\d+):(\d+) -->/;

export interface GalleryRef {
  readonly groupId: string;
  readonly index: number;
  readonly total: number;
}

/** Build the marker placed at the start of each gallery image message. */
export function galleryMarker(groupId: string, index: number, total: number): string {
  return `${PREFIX}${groupId}:${index}:${total}${SUFFIX}`;
}

/** Parse a gallery marker out of a message body, or `null` if absent. */
export function parseGalleryMarker(body: string): GalleryRef | null {
  const m = GALLERY_RE.exec(body);
  if (!m) return null;
  return { groupId: m[1], index: Number(m[2]), total: Number(m[3]) };
}

/** Remove the gallery marker from a body (and trim surrounding whitespace). */
export function stripGalleryMarker(body: string): string {
  return body.replace(GALLERY_RE, "").trim();
}

/** A short, collision-resistant id shared by the messages of one gallery. */
export function newGalleryId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? uuid.slice(0, 8) : `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// --- Membership map ------------------------------------------------
//
// Offload replaces a message body with a placeholder, which destroys the
// marker. We remember each message's gallery ref the first time we see it (with
// the marker intact) so an offloaded image still groups into - and holds its
// placeholder slot in - the gallery grid.

const galleryRefs = new Map<string, GalleryRef>();

/** Record the gallery ref of every marked message so it survives offload. */
export function rememberGalleryRefs(messages: readonly ChatMessage[]): void {
  for (const m of messages) {
    if (!m.message_id) continue;
    const ref = parseGalleryMarker(m.body);
    if (ref) galleryRefs.set(m.message_id, ref);
  }
}

/** The remembered (or live) gallery ref for a message id, or `null`. */
export function getGalleryRef(messageId: string | null | undefined): GalleryRef | null {
  if (!messageId) return null;
  return galleryRefs.get(messageId) ?? null;
}

/** Test-only: clear the remembered membership map. */
export function _resetGalleryRefs(): void {
  galleryRefs.clear();
}
