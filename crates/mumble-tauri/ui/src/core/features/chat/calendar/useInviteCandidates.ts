import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../../../store";
import { getCachedUserAvatar } from "../../../lazyBlobs";
import { acquireRegisteredTextures, releaseRegisteredTextures } from "../../../registeredTextureLease";
import type { RegisteredUser } from "../../../types";
import type { Participant } from "./types";

export interface InviteCandidate {
  readonly user_id: number;
  readonly name: string;
}

/**
 * Everyone a meeting can be addressed to, while a meeting form is open.
 *
 * The online list alone would leave out whoever is offline, so the server's
 * registered-user directory is asked for too (any authenticated user may ask;
 * the reply arrives on the shared `user-list` event and leases the registered
 * avatars until the form closes). Anyone already on the event stays a
 * candidate, so an existing invitee never turns into a bare id.
 */
export function useInviteCandidates(existing: readonly Participant[] | undefined) {
  const users = useAppStore((s) => s.users);
  const [registered, setRegistered] = useState<RegisteredUser[]>([]);

  useEffect(() => {
    acquireRegisteredTextures();
    const unlisten = listen<RegisteredUser[]>("user-list", (event) => setRegistered(event.payload));
    invoke("request_user_list").catch(() => {
      /* a locked-down server may refuse; the online list still works */
    });
    return () => {
      void unlisten.then((off) => off());
      releaseRegisteredTextures();
    };
  }, []);

  const candidates = useMemo<InviteCandidate[]>(() => {
    const map = new Map<number, string>();
    // Registered ids start at 0 (SuperUser); guests carry -1.
    for (const u of registered) if (u.user_id >= 0) map.set(u.user_id, u.name);
    // The live name wins, which covers a rename the directory predates.
    for (const u of users) if (u.user_id != null && u.user_id >= 0) map.set(u.user_id, u.name);
    for (const p of existing ?? []) map.set(p.userId, p.name);
    return [...map.entries()].map(([user_id, name]) => ({ user_id, name }));
  }, [registered, users, existing]);

  const avatarFor = (userId: number): string | null => {
    const live = users.find((u) => u.user_id === userId);
    return live ? getCachedUserAvatar(live.session, live.texture_size) : null;
  };

  return { candidates, avatarFor };
}
