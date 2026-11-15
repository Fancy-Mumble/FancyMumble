/**
 * Viewport-driven offloading of heavy message bodies.
 *
 * A message carrying a data-URL image is worth megabytes of heap, and a busy
 * channel holds hundreds of them.  This watches the rendered rows and hands
 * the heavy ones to `offloadManager` once they have been out of sight for a
 * moment, then asks for them back before the reader arrives.  What leaves is
 * the content, not the message: the row stays mounted and keeps its place.
 *
 * The policy lives here rather than in a UI pack.  Each pack draws its own
 * rows, but "how long out of view before it goes" and "how far ahead to fetch
 * it back" are one decision, and a second copy of it would drift from this one
 * the first time either was tuned.
 *
 * A pack opts in by marking each rendered row with two attributes - the
 * message id, and a flag for the bodies worth offloading (`isHeavyContent`) -
 * and by drawing a placeholder for a body that has become one, which
 * `extractOffloadInfo` recognises.  The attribute names are configurable
 * because a pack may already label its rows for its own reasons; nothing else
 * about the arrangement is.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useAppStore } from "../../store";
import { isHeavyContent, offloadManager, type MessageScope } from "../../messageOffload";
import type { ChatMessage } from "../../types";

/**
 * How far outside the scroller a row still counts as being in view.
 *
 * Generous on purpose: this distance is the time a restore has to finish in
 * before the reader gets there, and a decrypt that lands late reads as a
 * message that flickered.
 */
const ROOT_MARGIN = "800px 0px 800px 0px";

export interface UseMessageOffloadOptions {
  /** The scrolling element, used as the observer's root. */
  readonly containerRef: RefObject<HTMLElement | null>;
  /**
   * The element the rows are mounted inside.
   *
   * Watched for mutations as well as observed, because the render window
   * mounts and unmounts rows underneath it and a row that arrives after the
   * observer was built would otherwise never be watched.
   */
  readonly innerRef: RefObject<HTMLElement | null>;
  /** The open conversation, or null when there is none. */
  readonly currentScope: () => MessageScope | null;
  /**
   * Messages of the conversation that are in memory but have no row.
   *
   * The render window mounts only the newest stretch of a long conversation,
   * and the observer can only ever see a row. Everything above the window is
   * out of sight by construction, so its heavy bodies are put away without
   * waiting for a row that will not come - otherwise a channel full of
   * screenshots keeps every one of them in memory, on both sides of the IPC
   * boundary, for as long as the reader stays at the bottom.
   */
  readonly unmounted?: readonly ChatMessage[];
  /** Attribute carrying a row's message id. */
  readonly idAttribute?: string;
  /** Attribute marking a row whose body is worth offloading. */
  readonly heavyAttribute?: string;
}

export interface UseMessageOffloadResult {
  /**
   * Message ids whose bodies are being decrypted right now.
   *
   * A row in this set is already showing a placeholder - its body in the store
   * is still the offload marker - and the set is what lets it say "decrypting"
   * rather than "offloaded" while the read is in flight.
   */
  readonly restoringKeys: Set<string>;
}

export function useMessageOffload({
  containerRef,
  innerRef,
  currentScope,
  unmounted,
  idAttribute = "data-msg-id",
  heavyAttribute = "data-msg-heavy",
}: UseMessageOffloadOptions): UseMessageOffloadResult {
  const [restoringKeys, setRestoringKeys] = useState<Set<string>>(new Set());

  // Read through a ref: the caller hands over a fresh closure on most renders,
  // and rebuilding the observer for that would drop every pending offload
  // timer along with it.
  const scopeRef = useRef(currentScope);
  scopeRef.current = currentScope;

  // The conversation, on the other hand, *must* rebuild it - the ids it is
  // holding belong to the one that just closed.
  const scope = currentScope();
  const scopeKey = scope ? `${scope.scope}:${scope.scopeId}` : null;

  const unmountedHeavy = useMemo(
    () =>
      (unmounted ?? [])
        .filter((message) => message.message_id && isHeavyContent(message.body))
        .map((message) => message.message_id as string),
    [unmounted],
  );

  // Deliberately unguarded by a dependency list. The obvious key - the ids,
  // joined - is wrong: a body restored by scrolling back over it becomes
  // heavy again under the *same* id, so the key would not change and the
  // body would never be put away a second time. `scheduleOffload` already
  // ignores an id it is holding or has written out, so running this on every
  // render is idempotent and costs a walk of the list.
  useEffect(() => {
    if (unmountedHeavy.length === 0) return;
    const target = scopeRef.current();
    if (!target) return;
    const refresh = () => {
      const state = useAppStore.getState();
      if (target.scope === "channel") {
        state.refreshMessages(Number(target.scopeId));
      } else if (target.scope === "dm") {
        state.refreshDmMessages(Number(target.scopeId));
      }
    };
    // Same grace period as a row leaving the viewport: a window that is about
    // to grow over these must not find them half-written. A body that gets a
    // row after all is handled by the observer from then on - cancelled if
    // the row is in view, scheduled again if it is not.
    for (const id of unmountedHeavy) {
      offloadManager.scheduleOffload(id, target, refresh);
    }
  });

  useEffect(() => {
    const inner = innerRef.current;
    const container = containerRef.current;
    if (!inner || !container) return;
    // A DOM without an observer (a test runner's) has no viewport to watch;
    // the rows simply keep their bodies, as they would with nothing mounted.
    if (typeof IntersectionObserver === "undefined") return;

    /**
     * Re-read the conversation from the store.
     *
     * Offloading and restoring both rewrite the body in the backend rather
     * than in React state, so this is the step that makes either visible.
     */
    const refreshForScope = (target: MessageScope) => {
      const state = useAppStore.getState();
      if (target.scope === "channel") {
        state.refreshMessages(Number(target.scopeId));
      } else if (target.scope === "dm") {
        state.refreshDmMessages(Number(target.scopeId));
      }
    };

    const handleRestored = (target: MessageScope, restoredIds: string[]) => {
      setRestoringKeys((prev) => {
        const next = new Set(prev);
        for (const id of restoredIds) next.delete(id);
        return next;
      });
      if (restoredIds.length > 0) refreshForScope(target);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const target = scopeRef.current();
        if (!target) return;

        const toRestore: string[] = [];

        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const msgId = el.getAttribute(idAttribute);
          if (!msgId) continue;

          if (entry.isIntersecting) {
            offloadManager.cancelOffload(msgId);
            if (offloadManager.isOffloaded(msgId)) {
              toRestore.push(msgId);
            }
          } else if (el.hasAttribute(heavyAttribute)) {
            offloadManager.scheduleOffload(msgId, target, () => {
              refreshForScope(target);
            });
          }
        }

        if (toRestore.length > 0) {
          setRestoringKeys((prev) => {
            const next = new Set(prev);
            for (const id of toRestore) next.add(id);
            return next;
          });
          offloadManager.restoreMany(toRestore, target).then((results) => {
            handleRestored(target, Object.keys(results));
          });
        }
      },
      { root: container, rootMargin: ROOT_MARGIN },
    );

    const observeAll = () => {
      for (const el of inner.querySelectorAll<HTMLElement>(`[${idAttribute}]`)) {
        observer.observe(el);
      }
    };
    observeAll();

    const mutObs = new MutationObserver(observeAll);
    mutObs.observe(inner, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutObs.disconnect();
    };
  }, [scopeKey, containerRef, innerRef, idAttribute, heavyAttribute]);

  return { restoringKeys };
}
