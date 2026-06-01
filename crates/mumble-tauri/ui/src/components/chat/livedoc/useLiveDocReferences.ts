/**
 * useLiveDocReferences - React hook exposing the document's live
 * reference targets (headings, bookmarks, captions) for the cross-
 * reference picker and the cross-reference / caption node views.
 *
 * Mirrors `useLiveDocHeadings`: it recomputes on document changes and
 * emits a new array only when the target set actually changes, so
 * consumers do not re-render on unrelated edits (which would otherwise
 * risk the render <-> view-sync feedback loop).
 */

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  extractReferenceTargets,
  referenceTargetsSignature,
  type RefTarget,
} from "./liveDocReferences";

export interface UseLiveDocReferences {
  readonly targets: RefTarget[];
  readonly refresh: () => void;
}

export function useLiveDocReferences(editor: Editor | null): UseLiveDocReferences {
  const [targets, setTargets] = useState<RefTarget[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!editor) {
      setTargets([]);
      return undefined;
    }
    let lastSig: string | null = null;
    const sync = () => {
      const next = extractReferenceTargets(editor.state.doc);
      const sig = referenceTargetsSignature(next);
      if (sig === lastSig) return;
      lastSig = sig;
      setTargets(next);
    };
    sync();
    editor.on("update", sync);
    editor.on("create", sync);
    return () => {
      editor.off("update", sync);
      editor.off("create", sync);
    };
  }, [editor, nonce]);

  return { targets, refresh: () => setNonce((n) => n + 1) };
}
