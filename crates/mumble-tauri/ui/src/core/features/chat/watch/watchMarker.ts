/**
 * The marker a started watch-together session leaves in the conversation.
 *
 * `useWatchStart` sends a message whose entire body is an HTML comment naming
 * the session, so every client can find the session from the history. It is a
 * carrier, not something anyone typed.
 */

const MARKER = /<!--\s*FANCY_WATCH:([^\s]+)\s*-->/;

/** The session id a message carries, or null where it carries none. */
export function readWatchMarker(body: string): string | null {
  return MARKER.exec(body)?.[1] ?? null;
}

/**
 * True when a message is nothing but a marker for a session that is over.
 *
 * Such a message has no content left to draw: the comment is stripped by the
 * sanitiser and the session it pointed at is gone. Rendered anyway it becomes a
 * ghost - an empty bubble carrying only a timestamp and a read receipt - and a
 * channel where several sessions have run collects a column of them.
 */
export function isSpentWatchMarker(body: string, isLive: (sessionId: string) => boolean): boolean {
  const sessionId = readWatchMarker(body);
  if (sessionId === null || isLive(sessionId)) return false;
  return body.replace(MARKER, "").trim().length === 0;
}
