/**
 * useMentionCandidates - shared candidate-source for the @-mention
 * autocomplete popup.
 *
 * Built once from the chat composer and now reused by the Live Doc
 * editor so both surfaces see the same user list, role list and
 * `@everyone` / `@here` special entries, ranked the same way.
 *
 * The hook is intentionally pure-read: it returns a memoised list for
 * the given `(query, kind)` pair and never mutates the store.  Callers
 * own the trigger detection and the insertion side effect.
 */

import { useMemo } from "react";
import { useAppStore } from "../../../store";
import { useAclGroups } from "../../../hooks/useAclGroups";
import { getCachedUserAvatar } from "../../../lazyBlobs";
import type { MentionCandidate } from "./MentionAutocomplete";

const MAX_CANDIDATES = 8;

export type MentionQueryKind = "user" | "role";

/**
 * Build the candidate list for a `@<query>` trigger.
 *
 * - `user` triggers return users (current-channel first), then roles,
 *   then `@everyone` / `@here` extras.
 * - `role` triggers (`@&query`) only return roles.
 */
export function useMentionCandidates(
  kind: MentionQueryKind | null,
  query: string,
): readonly MentionCandidate[] {
  const users = useAppStore((s) => s.users);
  const selectedChannel = useAppStore((s) => s.selectedChannel);
  const ownSession = useAppStore((s) => s.ownSession);
  const roleGroups = useAclGroups();

  return useMemo(() => {
    if (kind === null) return [];
    const q = query.toLowerCase();

    if (kind === "user") {
      const allOthers = users.filter(
        (u) => u.session !== ownSession && u.name.toLowerCase().includes(q),
      );
      const inChannel = allOthers.filter(
        (u) => selectedChannel != null && u.channel_id === selectedChannel,
      );
      const elsewhere = allOthers.filter(
        (u) => selectedChannel == null || u.channel_id !== selectedChannel,
      );
      const userCandidates: MentionCandidate[] = [...inChannel, ...elsewhere]
        .slice(0, MAX_CANDIDATES)
        .map((u) => ({
          kind: "user",
          session: u.session,
          name: u.name,
          avatarUrl: getCachedUserAvatar(u.session, u.texture_size) ?? undefined,
        }));

      const roleCandidates: MentionCandidate[] = roleGroups
        .filter((g) => !g.name.startsWith("~") && g.name.toLowerCase().includes(q))
        .slice(0, MAX_CANDIDATES)
        .map((g) => ({ kind: "role", name: g.name }));

      const extras: MentionCandidate[] = [];
      if ("everyone".startsWith(q)) extras.push({ kind: "everyone" });
      if ("here".startsWith(q)) extras.push({ kind: "here" });

      return [...userCandidates, ...roleCandidates, ...extras];
    }

    return roleGroups
      .filter((g) => !g.name.startsWith("~") && g.name.toLowerCase().includes(q))
      .slice(0, MAX_CANDIDATES)
      .map((g) => ({ kind: "role", name: g.name }));
  }, [kind, query, users, selectedChannel, ownSession, roleGroups]);
}
