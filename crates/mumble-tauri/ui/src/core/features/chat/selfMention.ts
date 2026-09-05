/**
 * Whether a message mentions the reader, and the ping that follows.
 *
 * Being @-mentioned has two consequences and both are the client's, not the
 * server's: the row is marked so it can be found by eye, and the mention sound
 * fires once. Neither is presentation, so neither belongs to a UI pack - and
 * leaving them in one is exactly how they went missing. All of this lived
 * inside Standard's `MessageItem`, so Nebula, which mounts the very listener
 * that plays the sound, had nothing that ever dispatched to it: in the default
 * design you could be pinged with no highlight and no sound at all.
 *
 * The dedup set is module scope on purpose. A row unmounts and remounts as it
 * scrolls out of and back into the window, and a mention that pinged once must
 * not ping again each time it is re-rendered.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { containsSelfMention } from "../../utils/mentions";

/** Message ids already pinged for, so a re-render cannot ping twice. */
const NOTIFIED = new Set<string>();

/** Bound on the set for a long session; insertion order makes the oldest first. */
const NOTIFIED_CAP = 2000;

/** Ignore a mention older than this: scrolling back through history is not
 *  news, and replaying a day of pings at once is worse than silence. */
const RECENT_MS = 30_000;

function markNotified(id: string): void {
  if (NOTIFIED.size >= NOTIFIED_CAP) {
    const oldest = NOTIFIED.values().next().value;
    if (oldest !== undefined) NOTIFIED.delete(oldest);
  }
  NOTIFIED.add(id);
}

/** Drop the record of what has already pinged, and any published roles.
 *  Tests only. */
export function resetSelfMentionNotifications(): void {
  NOTIFIED.clear();
  publishOwnRoles(NO_ROLES);
}

/** No roles known - an unregistered reader, or a server whose ACL this client
 *  is not allowed to read. One frozen instance, so a default never looks like
 *  a change to the memo that depends on it. */
const NO_ROLES: ReadonlySet<string> = new Set<string>();

/**
 * The ACL groups the reader belongs to, published once for the whole client.
 *
 * A mention of a group you are in is a mention of you, so every row needs
 * this - and reading the ACL costs a request and an event subscription, which
 * a river of two hundred rows must not each take out. The pack fetches it once
 * and publishes it here.
 *
 * A module-level store rather than a context, deliberately: a context has to
 * wrap the tree, and wrapping either pack's root re-indents a thousand lines
 * of JSX in a file other people are editing. There is one client per window,
 * which is the condition that makes a module store honest here - the same one
 * `NOTIFIED` above relies on.
 *
 * Empty is the honest default and the common case: reading the root ACL needs
 * Write on it, so an ordinary user's client cannot know its own roles and role
 * mentions do not notify them. That is the limit every role feature in this
 * client already has - the chips on a hover card and the mention colours come
 * from the same admin-only fetch.
 */
let publishedRoles: ReadonlySet<string> = NO_ROLES;
const roleListeners = new Set<() => void>();

function subscribeRoles(listener: () => void): () => void {
  roleListeners.add(listener);
  return () => {
    roleListeners.delete(listener);
  };
}

function rolesSnapshot(): ReadonlySet<string> {
  return publishedRoles;
}

/** Publish the reader's roles. Prefer {@link usePublishOwnRoles}. */
export function publishOwnRoles(roles: ReadonlySet<string>): void {
  if (roles === publishedRoles) return;
  publishedRoles = roles;
  for (const listener of roleListeners) listener();
}

/** Publish for as long as the calling app is mounted, and stop on the way out
 *  so a disconnected session does not leave stale roles behind. */
export function usePublishOwnRoles(roles: ReadonlySet<string>): void {
  useEffect(() => {
    publishOwnRoles(roles);
    return () => publishOwnRoles(NO_ROLES);
  }, [roles]);
}

/** The reader's roles as last published. */
export function useOwnRoles(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeRoles, rolesSnapshot, rolesSnapshot);
}

/** The parts of a message this needs, named so either pack's row can pass its
 *  own shape without being cast. */
export interface SelfMentionMessage {
  readonly body: string;
  readonly is_own?: boolean;
  readonly channel_id?: number | null;
  readonly message_id?: string | null;
  readonly sender_session?: number | null;
  readonly timestamp?: number | null;
}

export interface SelfMentionOptions {
  /** The reader's live session id, or null before one is known. */
  readonly ownSession: number | null | undefined;
  /** The channel the reader is looking at, for `@here` and `@everyone`. */
  readonly currentChannel: number | null | undefined;
  /** Overrides what the pack published; a test's way in, not a pack's. */
  readonly ownRoles?: ReadonlySet<string>;
}

/** A stable key for a message, falling back to sender+time when it has no id. */
function mentionKey(msg: SelfMentionMessage): string {
  return msg.message_id ?? `${msg.sender_session ?? "?"}-${msg.timestamp ?? 0}`;
}

/**
 * True when this message mentions the reader, firing the mention ping once the
 * first time a recent one is seen.
 *
 * Your own message never counts: quoting a mention back is not being pinged.
 */
export function useSelfMention(msg: SelfMentionMessage, options: SelfMentionOptions): boolean {
  const { ownSession, currentChannel } = options;
  const publishedOwnRoles = useOwnRoles();
  const ownRoles = options.ownRoles ?? publishedOwnRoles;
  const mentioned = useMemo(() => {
    if (msg.is_own || ownSession == null) return false;
    return containsSelfMention(msg.body, {
      ownSession,
      isInMessageChannel: msg.channel_id != null && currentChannel === msg.channel_id,
      ownRoles,
    });
  }, [msg.body, msg.is_own, msg.channel_id, ownSession, currentChannel, ownRoles]);

  const key = mentionKey(msg);
  const timestamp = msg.timestamp ?? 0;

  useEffect(() => {
    if (!mentioned || NOTIFIED.has(key)) return;
    markNotified(key);
    // Marked either way above: a mention seen too late is answered once, by
    // never asking about it again.
    if (timestamp > 0 && Date.now() - timestamp > RECENT_MS) return;
    globalThis.dispatchEvent(new CustomEvent("fancy:self-mention"));
  }, [mentioned, key, timestamp]);

  return mentioned;
}
