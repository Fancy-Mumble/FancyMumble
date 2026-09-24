/**
 * An identity's recovery phrase, shown and typed back in.
 *
 * The phrase is the identity's chat seed as 24 words (`state::recovery`): the
 * key its end-to-end encrypted conversations are sealed under. Shown on
 * request only and hidden again as soon as the page is left, since anyone who
 * reads it over a shoulder can read those conversations.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useRecoveryPhrase(identities: readonly string[], preferred: string | null) {
  const [label, setLabel] = useState<string>(preferred ?? identities[0] ?? "");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow the list: a deleted identity is not left selected, and the first
  // one appears selected rather than an empty choice.
  useEffect(() => {
    if (!identities.includes(label)) setLabel(preferred ?? identities[0] ?? "");
  }, [identities, label, preferred]);

  const choose = useCallback((next: string) => {
    setLabel(next);
    setPhrase(null);
    setRestored(false);
    setError(null);
  }, []);

  const show = useCallback(async () => {
    setError(null);
    try {
      setPhrase(await invoke<string>("get_recovery_phrase", { label }));
    } catch (e) {
      setError(String(e));
    }
  }, [label]);

  const restore = useCallback(async () => {
    setError(null);
    setRestored(false);
    try {
      await invoke("restore_recovery_phrase", { label, phrase: draft });
      setDraft("");
      setPhrase(null);
      setRestored(true);
    } catch (e) {
      setError(String(e));
    }
  }, [label, draft]);

  /** How many words have been typed, for the "24 words" hint. */
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return {
    label,
    choose,
    phrase,
    show,
    hide: () => setPhrase(null),
    draft,
    setDraft,
    wordCount,
    restore,
    restored,
    error,
  };
}
