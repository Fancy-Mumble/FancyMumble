/**
 * ForumsPanel - a chat-splitting side panel (like Pinned / Downloads) that
 * shows the per-channel forum: a list of threads and, when one is opened, the
 * thread's posts with a reply box.  All persistence and access control live in
 * the Rust backend; this panel only invokes the forum commands and renders the
 * `useForumStore` state that the backend events feed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { ForumIcon, SendIcon, TrashIcon, ChevronLeftIcon, RefreshCwIcon } from "../../icons";
import { useForumStore, isThreadRoot, type ForumPost } from "./forumStore";
import styles from "./ForumsPanel.module.css";

interface ForumsPanelProps {
  readonly channelId: number;
  readonly onClose: () => void;
}

function formatTime(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

export default function ForumsPanel({ channelId }: ForumsPanelProps) {
  const { t } = useTranslation("chat");
  const ownSession = useAppStore((s) => s.ownSession);
  const channelName = useAppStore((s) => s.channels.get(channelId)?.name);

  const threadsByChannel = useForumStore((s) => s.threadsByChannel);
  const postsByThread = useForumStore((s) => s.postsByThread);
  const loadingChannel = useForumStore((s) => s.loadingChannel);
  const loadingThread = useForumStore((s) => s.loadingThread);
  const fetchForumThreads = useForumStore((s) => s.fetchForumThreads);
  const fetchForumThread = useForumStore((s) => s.fetchForumThread);
  const createForumThread = useForumStore((s) => s.createForumThread);
  const replyForumPost = useForumStore((s) => s.replyForumPost);
  const deleteForumPost = useForumStore((s) => s.deleteForumPost);

  const threads = useMemo(() => threadsByChannel.get(channelId) ?? [], [threadsByChannel, channelId]);

  // null = thread list; a thread id = viewing that thread.
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  // New-thread composer.
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [posting, setPosting] = useState(false);

  // Reply composer.
  const [replyBody, setReplyBody] = useState("");
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    void fetchForumThreads(channelId);
  }, [channelId, fetchForumThreads]);

  const openThread = useCallback(
    (threadId: string) => {
      setOpenThreadId(threadId);
      setReplyBody("");
      void fetchForumThread(channelId, threadId);
    },
    [channelId, fetchForumThread],
  );

  const submitNewThread = useCallback(async () => {
    const title = newTitle.trim();
    const body = newBody.trim();
    if (!title || !body || posting) return;
    setPosting(true);
    try {
      await createForumThread(channelId, title, body);
      setNewTitle("");
      setNewBody("");
    } catch (e) {
      console.error("[forum] create thread failed:", e);
    } finally {
      setPosting(false);
    }
  }, [channelId, newTitle, newBody, posting, createForumThread]);

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

  const canDelete = useCallback(
    (post: ForumPost) => ownSession != null && post.authorSession === ownSession,
    [ownSession],
  );

  const onDelete = useCallback(
    async (post: ForumPost) => {
      try {
        await deleteForumPost(channelId, post.postId);
        // Deleting a thread root returns us to the list.
        if (isThreadRoot(post)) setOpenThreadId(null);
      } catch (e) {
        console.error("[forum] delete failed:", e);
      }
    },
    [channelId, deleteForumPost],
  );

  const openPosts = openThreadId ? postsByThread.get(openThreadId) : undefined;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        {openThreadId ? (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setOpenThreadId(null)}
            title={t("forum.backToThreads")}
            aria-label={t("forum.backToThreads")}
          >
            <ChevronLeftIcon width={18} height={18} />
          </button>
        ) : (
          <ForumIcon width={18} height={18} />
        )}
        <span className={styles.title}>
          {t("forum.title")}
          {channelName ? ` · ${channelName}` : ""}
        </span>
        {!openThreadId && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => void fetchForumThreads(channelId)}
            title={t("forum.refresh")}
            aria-label={t("forum.refresh")}
          >
            <RefreshCwIcon width={16} height={16} />
          </button>
        )}
      </div>

      {!openThreadId ? (
        <>
          <div className={styles.composer}>
            <input
              className={styles.input}
              type="text"
              placeholder={t("forum.threadTitlePlaceholder")}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={200}
            />
            <textarea
              className={styles.textarea}
              placeholder={t("forum.threadBodyPlaceholder")}
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              rows={3}
            />
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void submitNewThread()}
              disabled={posting || !newTitle.trim() || !newBody.trim()}
            >
              <SendIcon width={15} height={15} />
              {t("forum.postThread")}
            </button>
          </div>

          <div className={styles.list}>
            {loadingChannel === channelId && threads.length === 0 && (
              <div className={styles.empty}>{t("forum.loading")}</div>
            )}
            {loadingChannel !== channelId && threads.length === 0 && (
              <div className={styles.empty}>{t("forum.noThreads")}</div>
            )}
            {threads.map((thread) => (
              <button
                type="button"
                key={thread.postId}
                className={styles.threadRow}
                onClick={() => openThread(thread.threadId)}
              >
                <span className={styles.threadTitle}>{thread.title || t("forum.untitled")}</span>
                <span className={styles.threadMeta}>
                  {thread.authorName || t("forum.unknownAuthor")}
                  {" · "}
                  {formatTime(thread.createdAt)}
                  {" · "}
                  {t("forum.replyCount", { count: thread.replyCount })}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className={styles.list}>
            {loadingThread === openThreadId && !openPosts && (
              <div className={styles.empty}>{t("forum.loading")}</div>
            )}
            {openPosts?.map((post) => (
              <div key={post.postId} className={styles.post}>
                <div className={styles.postHead}>
                  <span className={styles.postAuthor}>
                    {post.authorName || t("forum.unknownAuthor")}
                    {isThreadRoot(post) && post.title ? ` · ${post.title}` : ""}
                  </span>
                  <span className={styles.postTime}>
                    {formatTime(post.createdAt)}
                    {post.editedAt ? ` · ${t("forum.edited")}` : ""}
                  </span>
                  {canDelete(post) && (
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => void onDelete(post)}
                      title={t("forum.delete")}
                      aria-label={t("forum.delete")}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  )}
                </div>
                <div className={styles.postBody}>{post.body}</div>
              </div>
            ))}
            {openPosts && openPosts.length === 0 && (
              <div className={styles.empty}>{t("forum.threadRemoved")}</div>
            )}
          </div>

          <div className={styles.composer}>
            <textarea
              className={styles.textarea}
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
              onClick={() => void submitReply()}
              disabled={replying || !replyBody.trim()}
            >
              <SendIcon width={15} height={15} />
              {t("forum.reply")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
