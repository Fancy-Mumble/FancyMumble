/**
 * The colour each member's name is drawn in, handed down to the rows.
 *
 * Computed once, where the ACL groups are: reading them from every row would
 * start a listener and a request per row. A context rather than a prop so the
 * rows between the list and the name do not each carry a map they never read.
 */
import { createContext, useContext } from "react";

const NO_COLORS: ReadonlyMap<number, string> = new Map();

export const RoleColorsContext = createContext<ReadonlyMap<number, string>>(NO_COLORS);

/** The role colour for a registered user, or null for anyone uncoloured or unregistered. */
export function useRoleColor(userId: number | null | undefined): string | null {
  const colors = useContext(RoleColorsContext);
  return userId != null && userId > 0 ? (colors.get(userId) ?? null) : null;
}
