/**
 * `WatchStartButton` - inline action that opens a watch-together
 * session for a video URL detected in a chat message.
 *
 * Generates a session UUID, sends a `start` event over FancyWatchSync,
 * and posts a `<!-- FANCY_WATCH:{id} -->` marker into the same channel
 * so participants discover the session via chat history.
 */

import { memo } from "react";

import { useTranslation } from "react-i18next";
import { useWatchStart } from "./useWatchStart";
import styles from "./WatchTogetherCard.module.css";

interface Props {
  readonly body: string;
  readonly channelId: number | null | undefined;
}

function WatchStartButtonImpl({ body, channelId }: Props) {
  const { t } = useTranslation("chat");
  const { canStart, busy, start } = useWatchStart(body, channelId);

  if (!canStart) return null;

  return (
    <button
      type="button"
      className={styles.startBtn}
      onClick={() => void start()}
      disabled={busy}
      title={t("watch.startTooltip")}
    >
      {busy ? t("watch.starting") : t("watch.watchTogether")}
    </button>
  );
}

const WatchStartButton = memo(WatchStartButtonImpl);
export default WatchStartButton;
