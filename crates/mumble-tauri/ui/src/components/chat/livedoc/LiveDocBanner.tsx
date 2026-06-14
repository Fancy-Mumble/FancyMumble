/**
 * LiveDocBanner - inline notification shown in chat when someone else
 * opens a Live Doc in the current channel.  Mirrors BroadcastBanner.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon, FileIcon } from "../../../icons";
import type { LiveDocAnnounceInfo } from "../../../store";
import styles from "./LiveDocBanner.module.css";

export type { LiveDocAnnounceInfo };

interface LiveDocBannerProps {
  readonly announce: LiveDocAnnounceInfo;
  readonly onJoin: () => void;
}

export default function LiveDocBanner({ announce, onJoin }: LiveDocBannerProps) {
  const { t } = useTranslation("chat");
  const [dismissed, setDismissed] = useState(false);
  const handleDismiss = useCallback(() => setDismissed(true), []);

  if (dismissed) return null;

  return (
    <div className={styles.banner} role="status">
      <FileIcon className={styles.icon} width={14} height={14} aria-hidden="true" />
      <span className={styles.text}>
        {t("liveDoc.banner.title", { name: announce.openerName })}
        {announce.title && <span className={styles.title}>&nbsp;&middot;&nbsp;{announce.title}</span>}
      </span>
      <button type="button" className={styles.joinBtn} onClick={onJoin}>
        {t("liveDoc.banner.join")}
      </button>
      <button
        type="button"
        className={styles.dismissBtn}
        onClick={handleDismiss}
        title={t("liveDoc.banner.dismiss")}
        aria-label={t("liveDoc.banner.dismiss")}
      >
        <CloseIcon width={14} height={14} />
      </button>
    </div>
  );
}
