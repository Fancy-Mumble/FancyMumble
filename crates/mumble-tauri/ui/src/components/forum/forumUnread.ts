/**
 * Purely local "have I seen this thread's latest activity" tracking.
 *
 * The server has no read-state concept for forums, so this is a client-only
 * convenience backed by localStorage: a thread is "unread" when its latest
 * activity timestamp is newer than the last time the user opened it here.
 */

const STORAGE_KEY = "fancy-forum-last-seen";

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable (private mode, quota, ...) - unread tracking is best-effort.
  }
}

/** True when `activityAt` is newer than the last time `threadId` was opened. */
export function isThreadUnread(threadId: string, activityAt: number): boolean {
  if (!activityAt) return false;
  const seen = readMap()[threadId];
  return seen == null || seen < activityAt;
}

/** Record that the thread's activity as of `activityAt` has now been seen. */
export function markThreadSeen(threadId: string, activityAt: number): void {
  const map = readMap();
  if ((map[threadId] ?? 0) >= activityAt) return;
  map[threadId] = activityAt;
  writeMap(map);
}
