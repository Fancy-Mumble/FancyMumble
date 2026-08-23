/** Super-search results and the photo-gallery entries it surfaces. */

export type SearchCategory = "channel" | "user" | "message";

/**
 * The parts of a message result a caller needs to draw the row itself.
 *
 * `subtitle` already reads "enot in #Gaming", which is enough to print but not
 * to lay out: a design that gives the sender, the place and the time their own
 * weight would have to take that sentence back apart. The pieces travel
 * separately instead.
 */
export interface MessageContext {
  /** Who sent it, for the avatar beside the row; absent once they have left. */
  sender_session?: number | null;
  sender_name: string;
  /** Where it was said: `in #Gaming`, `DM with enot`. */
  context: string;
  /** Unix epoch milliseconds, when the sender's client stamped one. */
  timestamp?: number | null;
  /** `true` when `id` addresses a direct-message partner, not a channel. */
  dm?: boolean;
}

export interface SearchResult {
  category: SearchCategory;
  score: number;
  title: string;
  subtitle: string | null;
  id: number | null;
  string_id: string | null;
  /** Set on message results only. */
  message?: MessageContext | null;
}

export interface PhotoEntry {
  src: string;
  sender_name: string;
  channel_id?: number | null;
  dm_session?: number | null;
  context: string;
  timestamp?: number | null;
}
