/**
 * ForumsPanel - a chat-splitting side panel that presents the per-channel
 * forum as a classic message board: a **board index** of categories, each
 * holding **topics**; opening a topic lists its **threads**; opening a thread
 * shows its **posts** with a reply box.
 *
 * Persistence and access control live entirely in the Rust backend. The board
 * hierarchy is a presentation layer: a thread's category/topic are packed into
 * its server-stored root title (see `forumTaxonomy.ts`), so the structure
 * survives round-trips without any protocol change.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { PERM_WRITE } from "../../utils/permissions";
import {
  ForumIcon,
  SendIcon,
  TrashIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  FolderIcon,
  MessageCircleIcon,
  PlusIcon,
  EditIcon,
  QuoteIcon,
  SearchIcon,
  PinIcon,
  LockIcon,
  CloseIcon,
} from "../../icons";
import { useForumStore, isThreadRoot, type ForumPost } from "./forumStore";
import {
  buildBoard,
  encodeThreadTitle,
  parseThreadTitle,
  isPinned,
  isLocked,
  withFlag,
  FLAG_PINNED,
  FLAG_LOCKED,
  type TopicView,
} from "./forumTaxonomy";
import { isThreadUnread, markThreadSeen } from "./forumUnread";
import { TID, FORUM_TOPIC_ATTR, FORUM_THREAD_TITLE_ATTR } from "../../testids";
import styles from "./ForumsPanel.module.css";

interface ForumsPanelProps {
  readonly channelId: number;
  readonly onClose: () => void;
}

function formatTime(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

function timeAgo(ms?: number): string {
  if (!ms) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

function initial(name?: string): string {
  const n = (name ?? "").trim();
  return n ? n[0]!.toUpperCase() : "?";
}

/** Deterministic accent hue for an author avatar. */
function avatarHue(name?: string): number {
  const n = name ?? "";
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return h;
}

function Avatar({ name, size = 34 }: { readonly name?: string; readonly size?: number }) {
  const hue = avatarHue(name);
  return (
    <span
      className={styles.avatar}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue} 55% 45%), hsl(${(hue + 40) % 360} 55% 38%))`,
        fontSize: Math.round(size * 0.42),
      }}
      aria-hidden
    >
      {initial(name)}
    </span>
  );
}

export default function ForumsPanel({ channelId }: ForumsPanelProps) {
  const { t } = useTranslation("chat");
  const ownSession = useAppStore((s) => s.ownSession);
  const channel = useAppStore((s) => s.channels.find((c) => c.id === channelId));
  const channelName = channel?.name;

  // Server allows editing/deleting someone else's post only with Write on the
  // channel (channel admin); pin/lock reuse that same bar since they're
  // implemented as a title edit under the hood.
  const canModerate = channel?.permissions != null && (channel.permissions & PERM_WRITE) !== 0;

  const threadsByChannel = useForumStore((s) => s.threadsByChannel);
  const postsByThread = useForumStore((s) => s.postsByThread);
  const hasMoreByChannel = useForumStore((s) => s.hasMoreByChannel);
  const loadingChannel = useForumStore((s) => s.loadingChannel);
  const loadingThread = useForumStore((s) => s.loadingThread);
  const fetchForumThreads = useForumStore((s) => s.fetchForumThreads);
  const fetchForumThread = useForumStore((s) => s.fetchForumThread);
  const createForumThread = useForumStore((s) => s.createForumThread);
  const replyForumPost = useForumStore((s) => s.replyForumPost);
  const editForumPost = useForumStore((s) => s.editForumPost);
  const deleteForumPost = useForumStore((s) => s.deleteForumPost);

  const roots = useMemo(() => threadsByChannel.get(channelId) ?? [], [threadsByChannel, channelId]);
  const board = useMemo(() => buildBoard(roots), [roots]);
  const hasMoreThreads = hasMoreByChannel.get(channelId) ?? false;

  // Navigation: a selected topic (category + topic name) and, within it, an
  // open thread. `openThreadId` implies a topic is selected.
  const [selected, setSelected] = useState<{ category: string; topic: string } | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  // Composers.
  const [showNewThread, setShowNewThread] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replying, setReplying] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);

  // Inline post editing.
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Loading more (older) thread roots.
  const [loadingMore, setLoadingMore] = useState(false);

  // In-topic search.
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    void fetchForumThreads(channelId);
  }, [channelId, fetchForumThreads]);

  // Reset navigation when switching channels.
  useEffect(() => {
    setSelected(null);
    setOpenThreadId(null);
    setShowNewThread(false);
    setSearchQuery("");
  }, [channelId]);

  const currentTopic: TopicView | undefined = useMemo(() => {
    if (!selected) return undefined;
    const cat = board.find((c) => c.name === selected.category);
    return cat?.topics.find((tp) => tp.name === selected.topic);
  }, [board, selected]);

  const visibleThreads = useMemo(() => {
    if (!currentTopic) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentTopic.threads;
    return currentTopic.threads.filter((thread) => {
      const { title } = parseThreadTitle(thread.title);
      return title.toLowerCase().includes(q) || (thread.authorName ?? "").toLowerCase().includes(q);
    });
  }, [currentTopic, searchQuery]);

  const openTopic = useCallback((category: string, topic: string) => {
    setSelected({ category, topic });
    setOpenThreadId(null);
    setShowNewThread(false);
    setSearchQuery("");
  }, []);

  const openThread = useCallback(
    (threadId: string, activityAt?: number) => {
      setOpenThreadId(threadId);
      setReplyBody("");
      setEditingPostId(null);
      if (activityAt) markThreadSeen(threadId, activityAt);
      void fetchForumThread(channelId, threadId);
    },
    [channelId, fetchForumThread],
  );

  const submitNewThread = useCallback(async () => {
    const title = newTitle.trim();
    const body = newBody.trim();
    if (!title || !body || !selected || posting) return;
    setPosting(true);
    try {
      await createForumThread(channelId, encodeThreadTitle(selected.category, selected.topic, title), body);
      setNewTitle("");
      setNewBody("");
      setShowNewThread(false);
    } catch (e) {
      console.error("[forum] create thread failed:", e);
    } finally {
      setPosting(false);
    }
  }, [channelId, newTitle, newBody, selected, posting, createForumThread]);

  const submitReply = useCallback(async () => {
    const body = replyBody.trim();
    if (!body || !openThreadId || replying) return;
    setReplying(true);
    try {
      await replyForumPost(channelId, openThreadId, body);
      setReplyBody("");
    } catch (e) {
      console.error("[forum] reply failed:", e);
    } finally {
      setReplying(false);
    }
  }, [channelId, openThreadId, replyBody, replying, replyForumPost]);

  const canModify = useCallback(
    (post: ForumPost) => (ownSession != null && post.authorSession === ownSession) || canModerate,
    [ownSession, canModerate],
  );

  const onDelete = useCallback(
    async (post: ForumPost) => {
      try {
        await deleteForumPost(channelId, post.postId);
        if (isThreadRoot(post)) setOpenThreadId(null);
      } catch (e) {
        console.error("[forum] delete failed:", e);
      }
    },
    [channelId, deleteForumPost],
  );

  const startEdit = useCallback((post: ForumPost) => {
    setEditingPostId(post.postId);
    setEditBody(post.body ?? "");
    setEditTitle(isThreadRoot(post) ? parseThreadTitle(post.title).title : "");
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingPostId(null);
  }, []);

  const submitEdit = useCallback(
    async (post: ForumPost) => {
      const body = editBody.trim();
      if (!body || savingEdit) return;
      setSavingEdit(true);
      try {
        let title: string | undefined;
        if (isThreadRoot(post)) {
          const coords = parseThreadTitle(post.title);
          title = encodeThreadTitle(coords.category, coords.topic, editTitle.trim() || coords.title, coords.flags);
        }
        await editForumPost(channelId, post.postId, body, title);
        setEditingPostId(null);
      } catch (e) {
        console.error("[forum] edit failed:", e);
      } finally {
        setSavingEdit(false);
      }
    },
    [channelId, editBody, editTitle, savingEdit, editForumPost],
  );

  // Pin/lock are just a re-encoded root title carrying a different flag set;
  // the server treats them as an ordinary edit (author or channel admin only).
  const toggleThreadFlag = useCallback(
    async (root: ForumPost, flag: string) => {
      const coords = parseThreadTitle(root.title);
      const nextFlags = withFlag(coords.flags, flag, !coords.flags.includes(flag));
      const nextTitle = encodeThreadTitle(coords.category, coords.topic, coords.title, nextFlags);
      try {
        await editForumPost(channelId, root.postId, root.body ?? "", nextTitle);
      } catch (e) {
        console.error("[forum] toggle flag failed:", e);
      }
    },
    [channelId, editForumPost],
  );

  const quotePost = useCallback((post: ForumPost) => {
    const author = post.authorName || "";
    const quoted = (post.body ?? "")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setReplyBody((prev) => {
      const attribution = author ? `${author} wrote:\n` : "";
      const block = `${attribution}${quoted}\n\n`;
      return prev ? `${prev}\n${block}` : block;
    });
    requestAnimationFrame(() => replyRef.current?.focus());
  }, []);

  const loadMoreThreads = useCallback(async () => {
    if (loadingMore || !hasMoreThreads || roots.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = roots[roots.length - 1];
      await fetchForumThreads(channelId, oldest.postId);
    } finally {
      setLoadingMore(false);
    }
  }, [channelId, roots, hasMoreThreads, loadingMore, fetchForumThreads]);

  const openPosts = openThreadId ? postsByThread.get(openThreadId) : undefined;
  const openRoot = openThreadId ? roots.find((r) => r.threadId === openThreadId) : undefined;
  const openCoords = openRoot ? parseThreadTitle(openRoot.title) : undefined;
  const openThreadTitle = openCoords?.title ?? "";
  const openThreadLocked = openCoords ? isLocked(openCoords.flags) : false;

  // ---- Breadcrumb ------------------------------------------------------

  const breadcrumb = (
    <div className={styles.breadcrumb}>
      <button
        type="button"
        className={styles.crumb}
        onClick={() => {
          setSelected(null);
          setOpenThreadId(null);
        }}
      >
        <ForumIcon width={14} height={14} />
        {channelName ? `${channelName} ${t("forum.title")}` : t("forum.title")}
      </button>
      {selected && (
        <>
          <ChevronRightIcon width={13} height={13} className={styles.crumbSep} />
          <span className={styles.crumbMuted}>{selected.category}</span>
          <ChevronRightIcon width={13} height={13} className={styles.crumbSep} />
          <button
            type="button"
            className={styles.crumb}
            onClick={() => {
              setOpenThreadId(null);
              setShowNewThread(false);
            }}
          >
            {selected.topic}
          </button>
        </>
      )}
      {openThreadId && (
        <>
          <ChevronRightIcon width={13} height={13} className={styles.crumbSep} />
          <span className={styles.crumbCurrent}>{openThreadTitle || t("forum.untitled")}</span>
        </>
      )}
    </div>
  );

  // ---- Views -----------------------------------------------------------

  const boardIndex = (
    <div className={styles.scroll}>
      {board.map((cat) => (
        <section key={cat.name} className={styles.category}>
          <header className={styles.categoryHead}>
            <FolderIcon width={15} height={15} />
            <span>{cat.name}</span>
          </header>
          <div className={styles.topicList}>
            {cat.topics.map((tp) => (
              <button
                type="button"
                key={tp.name}
                className={styles.topicRow}
                data-testid={TID.forumTopicRow}
                {...{ [FORUM_TOPIC_ATTR]: tp.name }}
                onClick={() => openTopic(tp.category, tp.name)}
              >
                <span className={styles.topicIcon} data-active={tp.threadCount > 0}>
                  <MessageCircleIcon width={20} height={20} />
                </span>
                <span className={styles.topicMain}>
                  <span className={styles.topicName}>{tp.name}</span>
                  {tp.description && <span className={styles.topicDesc}>{tp.description}</span>}
                </span>
                <span className={styles.topicStats}>
                  <span className={styles.statNum}>{tp.threadCount}</span>
                  <span className={styles.statLabel}>{t("forum.threadCount", { count: tp.threadCount })}</span>
                </span>
                <span className={styles.topicLast}>
                  {tp.lastPost ? (
                    <>
                      <span className={styles.lastAuthor}>{tp.lastPost.authorName || t("forum.unknownAuthor")}</span>
                      <span className={styles.lastTime}>{timeAgo(tp.lastPost.at)}</span>
                    </>
                  ) : (
                    <span className={styles.lastTime}>{t("forum.noPosts")}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {hasMoreThreads && (
        <button type="button" className={styles.loadMoreBtn} data-testid={TID.forumLoadMore} onClick={() => void loadMoreThreads()} disabled={loadingMore}>
          {loadingMore ? t("forum.loading") : t("forum.loadMore")}
        </button>
      )}
    </div>
  );

  const topicView = currentTopic && (
    <>
      <div className={styles.toolbar}>
        <div className={styles.toolbarTitle}>
          <MessageCircleIcon width={16} height={16} />
          <span>{currentTopic.name}</span>
          <span className={styles.toolbarCount}>{t("forum.threadCount", { count: currentTopic.threadCount })}</span>
        </div>
        <button type="button" className={styles.primaryBtn} data-testid={TID.forumNewThread} onClick={() => setShowNewThread((v) => !v)}>
          <PlusIcon width={15} height={15} />
          {t("forum.newThread")}
        </button>
      </div>

      {currentTopic.threads.length > 0 && (
        <div className={styles.searchBar}>
          <SearchIcon width={14} height={14} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            type="text"
            data-testid={TID.forumSearchInput}
            placeholder={t("forum.searchThreads")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setSearchQuery("")}
              title={t("forum.clearSearch")}
              aria-label={t("forum.clearSearch")}
            >
              <CloseIcon width={13} height={13} />
            </button>
          )}
        </div>
      )}

      {showNewThread && (
        <div className={styles.composer}>
          <input
            className={styles.input}
            type="text"
            data-testid={TID.forumThreadTitleInput}
            placeholder={t("forum.threadTitlePlaceholder")}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            maxLength={180}
          />
          <textarea
            className={styles.textarea}
            data-testid={TID.forumThreadBodyInput}
            placeholder={t("forum.threadBodyPlaceholder")}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            rows={3}
          />
          <button
            type="button"
            className={styles.primaryBtn}
            data-testid={TID.forumThreadSubmit}
            onClick={() => void submitNewThread()}
            disabled={posting || !newTitle.trim() || !newBody.trim()}
          >
            <SendIcon width={15} height={15} />
            {t("forum.postThread")}
          </button>
        </div>
      )}

      <div className={styles.scroll}>
        {visibleThreads.length === 0 ? (
          <div className={styles.empty}>
            {searchQuery ? t("forum.noSearchResults") : t("forum.noThreadsInTopic")}
          </div>
        ) : (
          <div className={styles.threadTable}>
            {visibleThreads.map((thread) => {
              const coords = parseThreadTitle(thread.title);
              const pinned = isPinned(coords.flags);
              const locked = isLocked(coords.flags);
              const activityAt = thread.editedAt ?? thread.createdAt ?? 0;
              const unread = isThreadUnread(thread.threadId, activityAt);
              return (
                <button
                  type="button"
                  key={thread.postId}
                  className={styles.threadRow}
                  data-pinned={pinned}
                  data-reply-count={thread.replyCount ?? 0}
                  data-testid={TID.forumThreadRow}
                  {...{ [FORUM_THREAD_TITLE_ATTR]: coords.title }}
                  onClick={() => openThread(thread.threadId, activityAt)}
                >
                  <Avatar name={thread.authorName} size={34} />
                  <span className={styles.threadMain}>
                    <span className={styles.threadTitle}>
                      {unread && <span className={styles.unreadDot} title={t("forum.newActivity")} />}
                      {pinned && (
                        <span title={t("forum.pinned")}>
                          <PinIcon width={13} height={13} className={styles.pinIcon} />
                        </span>
                      )}
                      {locked && (
                        <span title={t("forum.locked")}>
                          <LockIcon width={13} height={13} className={styles.lockIcon} />
                        </span>
                      )}
                      {coords.title || t("forum.untitled")}
                    </span>
                    <span className={styles.threadSub}>
                      {t("forum.by", { name: thread.authorName || t("forum.unknownAuthor") })}
                      {" · "}
                      {formatTime(thread.createdAt)}
                    </span>
                  </span>
                  <span className={styles.threadReplies}>
                    <span className={styles.statNum}>{thread.replyCount}</span>
                    <span className={styles.statLabel}>{t("forum.replyCount", { count: thread.replyCount })}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  const threadView = openThreadId && (
    <>
      <div className={styles.scroll}>
        {loadingThread === openThreadId && !openPosts && <div className={styles.empty}>{t("forum.loading")}</div>}
        {openRoot && canModerate && (
          <div className={styles.modBar}>
            <button
              type="button"
              className={styles.modBtn}
              data-active={isPinned(openCoords?.flags ?? "")}
              data-testid={TID.forumPinToggle}
              onClick={() => void toggleThreadFlag(openRoot, FLAG_PINNED)}
            >
              <PinIcon width={13} height={13} />
              {isPinned(openCoords?.flags ?? "") ? t("forum.unpin") : t("forum.pin")}
            </button>
            <button
              type="button"
              className={styles.modBtn}
              data-active={isLocked(openCoords?.flags ?? "")}
              data-testid={TID.forumLockToggle}
              onClick={() => void toggleThreadFlag(openRoot, FLAG_LOCKED)}
            >
              <LockIcon width={13} height={13} />
              {isLocked(openCoords?.flags ?? "") ? t("forum.unlock") : t("forum.lock")}
            </button>
          </div>
        )}
        <div className={styles.postList}>
          {openPosts?.map((post) => {
            const root = isThreadRoot(post);
            const editing = editingPostId === post.postId;
            return (
              <article key={post.postId} className={styles.post} data-op={root} data-testid={TID.forumPost}>
                <div className={styles.postAside}>
                  <Avatar name={post.authorName} size={44} />
                  <span className={styles.postAsideName}>{post.authorName || t("forum.unknownAuthor")}</span>
                  {root && <span className={styles.opBadge}>{t("forum.op")}</span>}
                </div>
                <div className={styles.postMain}>
                  <div className={styles.postHead}>
                    {root && <span className={styles.postTitle}>{openThreadTitle}</span>}
                    <span className={styles.postTime}>
                      {formatTime(post.createdAt)}
                      {post.editedAt ? ` · ${t("forum.edited")}` : ""}
                    </span>
                    {!editing && (
                      <button
                        type="button"
                        className={styles.iconBtn}
                        data-testid={TID.forumPostQuote}
                        onClick={() => quotePost(post)}
                        title={t("forum.quote")}
                        aria-label={t("forum.quote")}
                      >
                        <QuoteIcon width={14} height={14} />
                      </button>
                    )}
                    {!editing && canModify(post) && (
                      <button
                        type="button"
                        className={styles.iconBtn}
                        data-testid={TID.forumPostEdit}
                        onClick={() => startEdit(post)}
                        title={t("forum.edit")}
                        aria-label={t("forum.edit")}
                      >
                        <EditIcon width={14} height={14} />
                      </button>
                    )}
                    {!editing && canModify(post) && (
                      <button
                        type="button"
                        className={styles.iconBtn}
                        data-testid={TID.forumPostDelete}
                        onClick={() => void onDelete(post)}
                        title={t("forum.delete")}
                        aria-label={t("forum.delete")}
                      >
                        <TrashIcon width={14} height={14} />
                      </button>
                    )}
                  </div>
                  {editing ? (
                    <div className={styles.editBox}>
                      {root && (
                        <input
                          className={styles.input}
                          type="text"
                          data-testid={TID.forumEditTitleInput}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          maxLength={180}
                        />
                      )}
                      <textarea
                        className={styles.textarea}
                        data-testid={TID.forumEditBodyInput}
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={3}
                      />
                      <div className={styles.editActions}>
                        <button type="button" className={styles.iconBtn} onClick={cancelEdit}>
                          {t("forum.cancel")}
                        </button>
                        <button
                          type="button"
                          className={styles.primaryBtn}
                          data-testid={TID.forumEditSave}
                          onClick={() => void submitEdit(post)}
                          disabled={savingEdit || !editBody.trim()}
                        >
                          {t("forum.save")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.postBody}>{post.body}</div>
                  )}
                </div>
              </article>
            );
          })}
          {openPosts && openPosts.length === 0 && <div className={styles.empty}>{t("forum.threadRemoved")}</div>}
        </div>
      </div>

      {openThreadLocked && !canModerate ? (
        <div className={styles.lockedBanner} data-testid={TID.forumLockedBanner}>
          <LockIcon width={14} height={14} />
          {t("forum.threadLocked")}
        </div>
      ) : (
        <div className={styles.composer}>
          <textarea
            ref={replyRef}
            className={styles.textarea}
            data-testid={TID.forumReplyInput}
            placeholder={t("forum.replyPlaceholder")}
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submitReply();
              }
            }}
          />
          <button
            type="button"
            className={styles.primaryBtn}
            data-testid={TID.forumReplySubmit}
            onClick={() => void submitReply()}
            disabled={replying || !replyBody.trim()}
          >
            <SendIcon width={15} height={15} />
            {t("forum.reply")}
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className={styles.panel} data-testid={TID.forumPanel}>
      <div className={styles.header}>
        {(selected || openThreadId) && (
          <button
            type="button"
            className={styles.iconBtn}
            data-testid={TID.forumBack}
            onClick={() => (openThreadId ? setOpenThreadId(null) : setSelected(null))}
            title={t("forum.back")}
            aria-label={t("forum.back")}
          >
            <ChevronLeftIcon width={18} height={18} />
          </button>
        )}
        {breadcrumb}
        <button
          type="button"
          className={styles.iconBtn}
          data-testid={TID.forumRefresh}
          onClick={() => {
            void fetchForumThreads(channelId);
            if (openThreadId) void fetchForumThread(channelId, openThreadId);
          }}
          title={t("forum.refresh")}
          aria-label={t("forum.refresh")}
        >
          <RefreshCwIcon width={16} height={16} />
        </button>
      </div>

      {loadingChannel === channelId && roots.length === 0 && !selected ? (
        <div className={styles.empty}>{t("forum.loading")}</div>
      ) : openThreadId ? (
        threadView
      ) : selected ? (
        topicView
      ) : (
        boardIndex
      )}
    </div>
  );
}
