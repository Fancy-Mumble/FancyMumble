/**
 * Forum feature store + helpers.
 *
 * Backed by the server-side forum (`send_forum_post` / `fetch_forum` /
 * `delete_forum_post` Tauri commands).  All persistence and access control
 * live in the Rust backend - this store only invokes commands and reacts to
 * the `fancy-forum-post` / `fancy-forum-fetch-response` events.  The main app
 * store (`src/store.ts`) wires those event listeners into the appliers below.
 *
 * Data model:
 *   - `threadsByChannel`  channelId  -> thread root posts (one per thread)
 *   - `postsByThread`     threadId   -> every post in that thread (root first)
 *
 * A "thread root" is the first post of a thread; the backend gives it a
 * `postId` equal to its `threadId`.  Replies share the thread's `threadId`
 * but have their own `postId`.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

// -- Wire types ----------------------------------------------------

/**
 * A single forum post as delivered by the backend.  Timestamps are Unix
 * epoch milliseconds when present.
 */
export interface ForumPost {
  channelId: number;
  postId: string;
  threadId: string;
  title?: string;
  body?: string;
  authorHash?: string;
  authorSession?: number;
  authorName?: string;
  createdAt?: number;
  editedAt?: number;
  /** When true the post was deleted and must be removed from local state. */
  deleted: boolean;
  /** Number of replies (only meaningful on thread roots). */
  replyCount: number;
}

/** Payload of the `fancy-forum-fetch-response` event. */
export interface ForumFetchResponse {
  channelId: number;
  /** When set, `posts` are the posts inside this thread; otherwise thread roots. */
  threadId?: string;
  posts: ForumPost[];
  hasMore: boolean;
}

// -- Helpers -------------------------------------------------------

/** True when a post is the root (first) post of its thread. */
export function isThreadRoot(post: ForumPost): boolean {
  return post.postId === post.threadId;
}

/** Best-effort "when did this happen" timestamp for ordering. */
function activityTime(post: ForumPost): number {
  return post.editedAt ?? post.createdAt ?? 0;
}

/** Upsert a post into a list keyed by `postId`, preserving array identity rules. */
function upsertPost(list: ForumPost[], post: ForumPost): ForumPost[] {
  const idx = list.findIndex((p) => p.postId === post.postId);
  if (idx === -1) return [...list, post];
  const next = list.slice();
  next[idx] = { ...next[idx], ...post };
  return next;
}

/** Thread roots sorted by most-recent activity first. */
function sortThreadRoots(list: ForumPost[]): ForumPost[] {
  return [...list].sort((a, b) => activityTime(b) - activityTime(a));
}

/** Posts within a thread: root first, then replies oldest-first. */
function sortThreadPosts(list: ForumPost[]): ForumPost[] {
  return [...list].sort((a, b) => {
    const aRoot = isThreadRoot(a);
    const bRoot = isThreadRoot(b);
    if (aRoot !== bRoot) return aRoot ? -1 : 1;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
}

// -- Store ---------------------------------------------------------

interface ForumStoreState {
  /** Thread roots keyed by channel id. */
  threadsByChannel: Map<number, ForumPost[]>;
  /** Posts (root + replies) keyed by thread id. */
  postsByThread: Map<string, ForumPost[]>;
  /** Whether the backend reports more thread roots to page for a channel. */
  hasMoreByChannel: Map<number, boolean>;
  /** Channel id currently awaiting a thread-list fetch response, if any. */
  loadingChannel: number | null;
  /** Thread id currently awaiting a thread fetch response, if any. */
  loadingThread: string | null;

  // Appliers driven by the store event listeners.
  applyForumPost: (post: ForumPost) => void;
  applyForumFetchResponse: (res: ForumFetchResponse) => void;

  // Command wrappers.
  fetchForumThreads: (channelId: number, beforeId?: string) => Promise<void>;
  fetchForumThread: (channelId: number, threadId: string) => Promise<void>;
  createForumThread: (channelId: number, title: string, body: string) => Promise<void>;
  replyForumPost: (channelId: number, threadId: string, body: string) => Promise<void>;
  editForumPost: (channelId: number, postId: string, body: string, title?: string) => Promise<void>;
  deleteForumPost: (channelId: number, postId: string) => Promise<void>;

  /** Reset all forum state (called on disconnect / server switch). */
  clearForums: () => void;
}

export const useForumStore = create<ForumStoreState>((set) => ({
  threadsByChannel: new Map(),
  postsByThread: new Map(),
  hasMoreByChannel: new Map(),
  loadingChannel: null,
  loadingThread: null,

  applyForumPost: (post) => {
    set((prev) => {
      const threadsByChannel = new Map(prev.threadsByChannel);
      const postsByThread = new Map(prev.postsByThread);

      // Remove on delete.
      if (post.deleted) {
        const roots = threadsByChannel.get(post.channelId);
        if (roots) {
          threadsByChannel.set(
            post.channelId,
            roots.filter((p) => p.postId !== post.postId),
          );
        }
        const posts = postsByThread.get(post.threadId);
        if (posts) {
          const filtered = posts.filter((p) => p.postId !== post.postId);
          // Deleting the root drops the whole thread view.
          if (isThreadRoot(post)) postsByThread.delete(post.threadId);
          else postsByThread.set(post.threadId, filtered);
        }
        return { threadsByChannel, postsByThread };
      }

      // Upsert into the per-thread list when that thread is loaded (or when
      // this is the root, which seeds the list).
      if (isThreadRoot(post) || postsByThread.has(post.threadId)) {
        const posts = postsByThread.get(post.threadId) ?? [];
        postsByThread.set(post.threadId, sortThreadPosts(upsertPost(posts, post)));
      }

      // Maintain the channel's thread-root list.
      const roots = threadsByChannel.get(post.channelId) ?? [];
      if (isThreadRoot(post)) {
        threadsByChannel.set(post.channelId, sortThreadRoots(upsertPost(roots, post)));
      } else {
        // A reply bumps the parent thread's reply count / activity if we
        // already know about the root.
        const rootIdx = roots.findIndex((p) => p.postId === post.threadId);
        if (rootIdx !== -1) {
          const nextRoots = roots.slice();
          nextRoots[rootIdx] = {
            ...nextRoots[rootIdx],
            replyCount: Math.max(nextRoots[rootIdx].replyCount, post.replyCount),
            editedAt: activityTime(post) || nextRoots[rootIdx].editedAt,
          };
          threadsByChannel.set(post.channelId, sortThreadRoots(nextRoots));
        }
      }

      return { threadsByChannel, postsByThread };
    });
  },

  applyForumFetchResponse: (res) => {
    set((prev) => {
      if (res.threadId != null) {
        const postsByThread = new Map(prev.postsByThread);
        postsByThread.set(res.threadId, sortThreadPosts(res.posts));
        return {
          postsByThread,
          loadingThread: prev.loadingThread === res.threadId ? null : prev.loadingThread,
        };
      }
      const threadsByChannel = new Map(prev.threadsByChannel);
      threadsByChannel.set(res.channelId, sortThreadRoots(res.posts));
      const hasMoreByChannel = new Map(prev.hasMoreByChannel);
      hasMoreByChannel.set(res.channelId, res.hasMore);
      return {
        threadsByChannel,
        hasMoreByChannel,
        loadingChannel: prev.loadingChannel === res.channelId ? null : prev.loadingChannel,
      };
    });
  },

  fetchForumThreads: async (channelId, beforeId) => {
    set({ loadingChannel: channelId });
    try {
      await invoke("fetch_forum", { channelId, beforeId });
    } catch (e) {
      set((prev) => ({
        loadingChannel: prev.loadingChannel === channelId ? null : prev.loadingChannel,
      }));
      console.error("[forum] fetchForumThreads failed:", e);
    }
  },

  fetchForumThread: async (channelId, threadId) => {
    set({ loadingThread: threadId });
    try {
      await invoke("fetch_forum", { channelId, threadId });
    } catch (e) {
      set((prev) => ({
        loadingThread: prev.loadingThread === threadId ? null : prev.loadingThread,
      }));
      console.error("[forum] fetchForumThread failed:", e);
    }
  },

  createForumThread: async (channelId, title, body) => {
    await invoke("send_forum_post", { channelId, title, body });
  },

  replyForumPost: async (channelId, threadId, body) => {
    await invoke("send_forum_post", { channelId, threadId, body });
  },

  editForumPost: async (channelId, postId, body, title) => {
    await invoke("send_forum_post", { channelId, postId, body, title });
  },

  deleteForumPost: async (channelId, postId) => {
    await invoke("delete_forum_post", { channelId, postId });
  },

  clearForums: () =>
    set({
      threadsByChannel: new Map(),
      postsByThread: new Map(),
      hasMoreByChannel: new Map(),
      loadingChannel: null,
      loadingThread: null,
    }),
}));
