/**
 * The picture actions, with the one thing a menu row needs on top of them:
 * whether the one that was clicked is still going, and how it ended.
 *
 * Copying a picture is not instant - a file-server link has to be fetched
 * through the host and a JPEG re-encoded before the clipboard will take it -
 * and a row that closes the menu the moment it is clicked leaves the reader
 * with no idea whether anything happened. So the row stays, says what it is
 * doing, and the menu closes itself once the answer is in.
 */
import { useCallback, useEffect, useState } from "react";
import { copyImageToClipboard, saveImageAs } from "./imageActions";

/** Which row is talking. */
export type ImageActionKind = "copy" | "save" | "link";
/** Where it has got to. */
export type ImageActionPhase = "busy" | "done" | "failed";

export interface ImageActionStatus {
  readonly kind: ImageActionKind;
  readonly phase: ImageActionPhase;
}

export interface ImageActions {
  /** The row that is mid-action, the one that just finished, or null. */
  readonly status: ImageActionStatus | null;
  readonly copyImage: () => void;
  readonly saveImage: () => void;
  readonly copyLink: () => void;
}

/**
 * Actions bound to one picture.
 *
 * `src` is the value the gallery wrote into the `src` attribute rather than
 * the absolute URL the DOM resolved it to, for the same reason the lightbox
 * wants that one: it is the only spelling every road agrees on.
 *
 * `link` is the address to hand somebody else, where that is a different
 * string - a public or password-protected file is drawn from a local copy,
 * and copying *that* would put a path off this machine's disk on the
 * clipboard. Defaults to the `src` when it is already an address.
 */
export function useImageActions(src: string | null, link?: string | null): ImageActions {
  const [status, setStatus] = useState<ImageActionStatus | null>(null);

  // A menu re-opened on a different picture starts from silence rather than
  // from the last picture's "Copied".
  useEffect(() => setStatus(null), [src]);

  const run = useCallback(
    (kind: ImageActionKind, action: (source: string) => Promise<boolean>) => () => {
      if (!src) return;
      setStatus({ kind, phase: "busy" });
      action(src).then(
        (settled) => setStatus(settled ? { kind, phase: "done" } : null),
        () => setStatus({ kind, phase: "failed" }),
      );
    },
    [src],
  );

  return {
    status,
    copyImage: run("copy", async (source) => {
      await copyImageToClipboard(source);
      return true;
    }),
    // Closing the save dialog without picking a file is a decision, not a
    // failure: the row goes quiet rather than claiming either.
    saveImage: run("save", async (source) => (await saveImageAs(source)) !== null),
    copyLink: run("link", async (source) => {
      await navigator.clipboard.writeText(link ?? source);
      return true;
    }),
  };
}
