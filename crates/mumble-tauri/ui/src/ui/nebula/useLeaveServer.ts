/**
 * Leaving a server.
 *
 * Standard treats disconnecting as a decision worth confirming - closing a tab
 * asks first, unless the user has turned the warning off in Advanced settings
 * or ticked "don't ask again". Nebula honours the same preference and the same
 * opt-out rather than inventing a second answer to the same question, so a user
 * who silenced the prompt in one design does not meet it again in another.
 *
 * The flow lives here, not in a component, because three controls mean the same
 * thing - the dock's Leave, mini mode's Leave, and the title bar's ✕ - and they
 * must not each carry their own copy of the rules.
 */
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@core/store";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import type { SessionMeta } from "@core/types";

export interface LeaveServerFlow {
  /** The session awaiting confirmation, or null when nothing is pending. */
  pending: SessionMeta | null;
  /** True while the disconnect is in flight. */
  leaving: boolean;
  /** State of the "don't ask again" tick in the dialog. */
  neverAsk: boolean;
  setNeverAsk: (value: boolean) => void;
  /** Leave `session`, asking first unless the user has opted out. */
  request: (session: SessionMeta | null | undefined) => void;
  confirm: () => Promise<void>;
  cancel: () => void;
}

export function useLeaveServer(): LeaveServerFlow {
  const [pending, setPending] = useState<SessionMeta | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [neverAsk, setNeverAsk] = useState(false);
  // Defaults to asking: the destructive reading of a missing preference is the
  // safe one, and it matches Standard's `?? true`.
  const [warn, setWarn] = useState(true);

  useEffect(() => {
    const load = () =>
      void getPreferences()
        .then((preferences) => setWarn(preferences.showDisconnectWarning ?? true))
        .catch(() => undefined);
    load();
    // Advanced settings can flip this while the client is open, in either pack.
    globalThis.addEventListener("preferences-changed", load);
    return () => globalThis.removeEventListener("preferences-changed", load);
  }, []);

  const leave = useCallback(async (id: string) => {
    // `disconnectSession`, not `disconnect`: it is the multi-session path, so
    // the backend rebinds to a remaining tab instead of leaving the client
    // showing a connection that is no longer there. It refreshes the session
    // list itself, so there is nothing to follow it with.
    await useAppStore
      .getState()
      .disconnectSession(id)
      .catch((reason) => console.error("Nebula leave failed:", reason));
  }, []);

  const request = useCallback(
    (session: SessionMeta | null | undefined) => {
      if (!session) return;
      if (warn) setPending(session);
      else void leave(session.id);
    },
    [leave, warn],
  );

  const confirm = useCallback(async () => {
    if (!pending) return;
    setLeaving(true);
    try {
      await leave(pending.id);
      if (neverAsk) {
        await updatePreferences({ showDisconnectWarning: false }).catch(() => undefined);
        setWarn(false);
      }
    } finally {
      setLeaving(false);
      setPending(null);
      setNeverAsk(false);
    }
  }, [leave, neverAsk, pending]);

  const cancel = useCallback(() => {
    setPending(null);
    setNeverAsk(false);
  }, []);

  return { pending, leaving, neverAsk, setNeverAsk, request, confirm, cancel };
}
