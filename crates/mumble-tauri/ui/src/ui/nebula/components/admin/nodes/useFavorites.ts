import { useCallback, useState } from "react";

/**
 * The blocks an operator starred, remembered on this machine.
 *
 * Which blocks somebody reaches for is a property of the person, not of the
 * server or of the graph - two admins on the same server star different things
 * - so it lives in local storage rather than in the document. It is a
 * convenience and nothing depends on it, which is why every access is wrapped:
 * a browser with storage disabled gets an editor whose stars do not stick,
 * rather than an editor that does not render.
 */
const key = (dialect: string) => `nebula.nodes.favorites.${dialect}`;

function read(dialect: string): Set<string> {
  try {
    const stored = localStorage.getItem(key(dialect));
    if (!stored) return new Set();
    const parsed: unknown = JSON.parse(stored);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function useFavorites(dialect: string, fallback: readonly string[] = []) {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const stored = read(dialect);
    // A first-time operator gets the dialect's own suggestion rather than an
    // empty row, because an empty favourites row teaches nothing about what
    // the star is for.
    return stored.size > 0 ? stored : new Set(fallback);
  });

  const toggle = useCallback(
    (id: string) => {
      setFavorites((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        try {
          localStorage.setItem(key(dialect), JSON.stringify([...next]));
        } catch {
          // Not remembered across sessions, still correct in this one.
        }
        return next;
      });
    },
    [dialect],
  );

  return { favorites, toggle };
}
