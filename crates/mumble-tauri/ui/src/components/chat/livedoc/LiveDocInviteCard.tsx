/**
 * LiveDocInviteCard - persistent in-chat invite for a Live Doc.  Posted
 * as a chat message (with a `FANCY_LIVEDOC:<payload>` marker) when the
 * local user opens a Live Doc, so users who join the channel later (or
 * who dismiss the transient `LiveDocBanner`) can still discover and
 * join the shared editing session.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FileIcon } from "../../../icons";
import { useAppStore, liveDocKey } from "../../../store";
import styles from "./LiveDocInviteCard.module.css";

interface LiveDocInviteCardProps {
  readonly channelId: number;
  readonly slug: string;
  readonly title: string;
  readonly senderName: string;
}

export default function LiveDocInviteCard({
  channelId,
  slug,
  title,
  senderName,
}: LiveDocInviteCardProps) {
  const { t } = useTranslation("chat");
  const activeServerId = useAppStore((s) => s.activeServerId);
  const activeLiveDocs = useAppStore((s) => s.activeLiveDocs);
  const requestOpenLiveDoc = useAppStore((s) => s.requestOpenLiveDoc);

  const alreadyJoined =
    activeLiveDocs.get(liveDocKey(activeServerId, channelId))?.slug === slug;

  const handleJoin = useCallback(() => {
    if (alreadyJoined) return;
    void requestOpenLiveDoc(channelId, slug, title, { silent: true }).catch((e) =>
      console.warn("requestOpenLiveDoc failed:", e),
    );
  }, [alreadyJoined, requestOpenLiveDoc, channelId, slug, title]);

  return (
    <div className={styles.card} role="group">
      <FileIcon className={styles.icon} width={24} height={24} aria-hidden="true" />
      <div className={styles.body}>
        <span className={styles.opener}>
          {t("liveDoc.inviteCard.opened", { name: senderName })}
        </span>
        <span className={styles.title}>{title}</span>
      </div>
      <button
        type="button"
        className={styles.joinBtn}
        onClick={handleJoin}
        disabled={alreadyJoined}
      >
        {alreadyJoined
          ? t("liveDoc.inviteCard.joined")
          : t("liveDoc.inviteCard.join")}
      </button>
    </div>
  );
}
