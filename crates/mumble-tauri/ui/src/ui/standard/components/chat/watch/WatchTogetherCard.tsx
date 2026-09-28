/**
 * `WatchTogetherCard` renders an active watch-together session
 * inline in the chat.
 *
 * All of the behaviour - claiming the player mount, joining, syncing,
 * leaving - lives in `useWatchCard`, which Nebula's floating dock uses
 * too. This file is the chrome and nothing else. It fails gracefully
 * (renders an info banner) when:
 *
 * - The session is not (yet) known locally.
 * - Another surface already owns the player for it.
 * - The source kind is `youtube` but the user has not opted in to
 *   external embeds.
 */

import { memo } from "react";

import { useTranslation } from "react-i18next";
import { useWatchCard } from "@core/features/chat/watch/useWatchCard";
import styles from "./WatchTogetherCard.module.css";

interface Props {
  readonly sessionId: string;
  /**
   * Stable identifier for the mount instance.  When omitted a unique
   * id is generated.  The first card to render for a given
   * `sessionId` claims the player mount; later cards render a
   * placeholder so the underlying adapter is not mounted twice.
   */
  readonly mountKey?: string;
}

function WatchTogetherCardImpl({ sessionId, mountKey }: Props) {
  const { t } = useTranslation("chat");
  const {
    session,
    owns,
    explicitlyLeft,
    containerRef,
    adapterError,
    outOfSync,
    isHost,
    hostName,
    requestState,
    leave,
    rejoin,
    end,
  } = useWatchCard(sessionId, { mountKey });

  if (!session) {
    // Session has ended (or never existed for us) - render nothing
    // so the chat marker visually disappears.  We still completed
    // any prior cleanup via the effects in the hook.
    return null;
  }

  const watching = hostName
    ? t("watch.card.watchingWithHost", { count: session.participants.size, hostName })
    : t("watch.watching", { count: session.participants.size });

  if (!owns) {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.title}>{session.title ?? session.sourceUrl}</span>
          <span className={styles.badges}>
            <span className={styles.participants}>{watching}</span>
          </span>
        </div>
        <div className={styles.warning}>{t("watch.card.openElsewhere")}</div>
      </div>
    );
  }

  if (explicitlyLeft) {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.title}>{session.title ?? session.sourceUrl}</span>
          <span className={styles.badges}>
            <span className={styles.participants}>{watching}</span>
          </span>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={rejoin}>
            {t("watch.card.rejoin")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>{session.title ?? session.sourceUrl}</span>
        <span className={styles.badges}>
          {isHost && <span className={styles.hostBadge}>{t("watch.card.hostBadge")}</span>}
          <span className={styles.participants}>{watching}</span>
        </span>
      </div>

      <div ref={containerRef} className={styles.player} />

      {adapterError && <div className={styles.error}>{adapterError}</div>}
      {outOfSync && (
        <div className={styles.warning}>
          {t("watch.card.outOfSync")}{" "}
          <button type="button" onClick={() => void requestState()}>
            {t("watch.card.resync")}
          </button>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" onClick={() => void requestState()}>
          {t("watch.card.requestState")}
        </button>
        <button type="button" className={styles.danger} onClick={() => void leave()}>
          {t("watch.card.leave")}
        </button>
        {isHost && (
          <button type="button" className={styles.danger} onClick={() => void end()}>
            {t("watch.card.endForEveryone")}
          </button>
        )}
      </div>
    </div>
  );
}

const WatchTogetherCard = memo(WatchTogetherCardImpl);
export default WatchTogetherCard;
