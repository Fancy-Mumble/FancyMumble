/**
 * useLiveDocEndnotes - React hook exposing the document's live endnote
 * entries (markers + their numbers + text) for the endnote marker views
 * and the generated endnotes section.
 *
 * Mirrors `useLiveDocReferences`: it recomputes on document changes and
 * emits a new array only when the entry set actually changes, so
 * consumers do not re-render on unrelated edits (which would otherwise
 * risk the render <-> view-sync feedback loop).
 */

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  extractEndnotes,
  endnotesSignature,
  type EndnoteEntry,
} from "./liveDocEndnotes";

export interface UseLiveDocEndnotes {
  readonly entries: EndnoteEntry[];
  readonly refresh: () => void;
}

export function useLiveDocEndnotes(editor: Editor | null): UseLiveDocEndnotes {
  const [entries, setEntries] = useState<EndnoteEntry[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!editor) {
      setEntries([]);
      return undefined;
    }
    let lastSig: string | null = null;
    const sync = () => {
      const next = extractEndnotes(editor.state.doc);
      const sig = endnotesSignature(next);
      if (sig === lastSig) return;
      lastSig = sig;
      setEntries(next);
    };
    sync();
    editor.on("update", sync);
    editor.on("create", sync);
    return () => {
      editor.off("update", sync);
      editor.off("create", sync);
    };
  }, [editor, nonce]);

  return { entries, refresh: () => setNonce((n) => n + 1) };
}
