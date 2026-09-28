import { useEffect, useMemo, useState } from "react";
import type { Friend } from "@core/friendsStorage";
import {
  NOTEPAD_CHANGED_EVENT,
  resolveNotepad,
  type NotepadSettings,
  type ResolvedNotepad,
} from "@core/notepad";
import { getNotepadSettings } from "@core/notepadActions";

/** The saved notepad choice, kept current; `loaded` is false until the first read. */
export function useStoredNotepad(): { loaded: boolean; settings: NotepadSettings | undefined } {
  const [state, setState] = useState<{ loaded: boolean; settings: NotepadSettings | undefined }>({
    loaded: false,
    settings: undefined,
  });

  useEffect(() => {
    let live = true;
    const load = () =>
      void getNotepadSettings()
        .then((settings) => {
          if (live) setState({ loaded: true, settings });
        })
        .catch((reason: unknown) => console.error("loading the notepad choice failed:", reason));
    load();
    globalThis.addEventListener(NOTEPAD_CHANGED_EVENT, load);
    return () => {
      live = false;
      globalThis.removeEventListener(NOTEPAD_CHANGED_EVENT, load);
    };
  }, []);

  return state;
}

/** The notepad in effect for this set of saved friends. */
export function useResolvedNotepad(friends: readonly Friend[]): ResolvedNotepad {
  const { settings } = useStoredNotepad();
  return useMemo(() => resolveNotepad(settings, friends), [settings, friends]);
}
