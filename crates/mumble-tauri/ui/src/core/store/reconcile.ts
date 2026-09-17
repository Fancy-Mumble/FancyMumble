/**
 * Keeping the identity of lists the backend re-sends unchanged.
 *
 * `refreshState` asks the backend for the whole channel and user list on every
 * `StateChanged` event, which the server sends for anything at all: somebody
 * muting themselves, a comment being set, a person moving room. The answer is
 * freshly deserialised each time, so every entry is a new object and the list a
 * new array - even when not one field in it has changed.
 *
 * React is watching those identities. A new array means every component that
 * selected it renders again, and in this client that included each of the
 * hundred-odd mounted message rows. So an event that said nothing cost a render
 * of the whole conversation, ten times a second on a busy server.
 *
 * Nothing here decides *what* changed. It only refuses to call something new
 * when it is not, which is what lets the layers above keep their memos.
 */

/**
 * Whether two records say the same thing.
 *
 * A key-by-key comparison rather than a deep one: these are flat rows off the
 * wire - `UserEntry` has fourteen scalar fields - and a deep walk would cost
 * more than the render it is trying to avoid. Arrays are compared one level
 * down by element, which covers the few list-valued fields without recursing.
 */
export function sameEntry(a: object, b: object): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    const left = (a as Record<string, unknown>)[key];
    const right = (b as Record<string, unknown>)[key];
    if (Object.is(left, right)) continue;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return false;
      if (left.every((item, index) => Object.is(item, right[index]))) continue;
      return false;
    }
    return false;
  }
  return true;
}

/**
 * The new list, with every entry that has not changed kept as the object it
 * already was - and the previous array itself where nothing changed at all.
 *
 * Entries are matched by key rather than by position, so somebody joining at
 * the top of the roster does not make strangers of everyone below them.
 */
export function reconcileList<T extends object>(
  prev: readonly T[],
  next: readonly T[],
  keyOf: (entry: T) => number | string,
): T[] {
  const byKey = new Map<number | string, T>();
  for (const entry of prev) byKey.set(keyOf(entry), entry);

  let identical = prev.length === next.length;
  const merged = next.map((entry, index) => {
    const before = byKey.get(keyOf(entry));
    const kept = before !== undefined && sameEntry(before, entry) ? before : entry;
    if (kept !== prev[index]) identical = false;
    return kept;
  });

  return identical ? (prev as T[]) : merged;
}

/** The same, for a set of ids: the old set where it holds exactly these. */
export function reconcileSet<T>(prev: ReadonlySet<T>, next: readonly T[]): Set<T> {
  if (prev.size === next.length && next.every((item) => prev.has(item))) return prev as Set<T>;
  return new Set(next);
}
