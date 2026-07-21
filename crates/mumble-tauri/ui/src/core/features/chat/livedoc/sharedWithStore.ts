/**
 * Tiny store for the "shared with" member lists pushed by the live-doc
 * plugin's `SharedWith` envelope, keyed by document slug.  Kept separate
 * from the main app store (and free of any back-import to it) so the
 * plugin-message dispatcher can populate it without a dependency cycle.
 */

import { create } from "zustand";
import type { LiveDocSharedMember } from "../../../types";

interface SharedWithState {
  /** Members each document (by slug) has been shared with. */
  bySlug: Record<string, LiveDocSharedMember[]>;
  setSharedWith: (slug: string, members: LiveDocSharedMember[]) => void;
}

export const useLiveDocSharedWithStore = create<SharedWithState>((set) => ({
  bySlug: {},
  setSharedWith: (slug, members) =>
    set((s) => ({ bySlug: { ...s.bySlug, [slug]: members } })),
}));
