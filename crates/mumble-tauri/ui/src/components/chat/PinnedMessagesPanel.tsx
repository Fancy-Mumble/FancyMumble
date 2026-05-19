import { CloseIcon } from "../../icons";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../types";
import styles from "./PinnedMessagesPanel.module.css";

const MAX_PREVIEW = 120;

const IMG_SRC_RE = /<img[^>]+src="([^"]+)"/i;

function extractFirstImageSrc(html: string): string | null {
  return IMG_SRC_RE.exec(html)?.[1] ?? null;
}

function stripHtml(html: string): string {
  return html
    .replaceAll(/<!--[\s\S]*?-->/g, "")
    .replaceAll(/<br\s*\/?>/gi, "\n")
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\u2026";
}

interface PinnedMessagesPanelProps {
  readonly messages: readonly ChatMessage[];
  readonly unseenIds: ReadonlySet<string>;
  readonly onClose: () => void;
  readonly onNavigate: (messageId: string) => void;
  readonly onUnpin?: (msg: ChatMessage) => void;
}

export default function PinnedMessagesPanel({
  messages,
  unseenIds,
  onClose,
  onNavigate,
  onUnpin,
}: PinnedMessagesPanelProps) {
  const { t } = useTranslation("chat");
  const pinnedMessages = useMemo(
    () => messages.filter((m) => m.pinned),
    [messages],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          📌 {t("pinned.title")}
          {pinnedMessages.length > 0 && (
            <span className={styles.count}>{pinnedMessages.length}</span>
          )}
        </span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label={t("pinned.closeAriaLabel")}
        >
          <CloseIcon width={16} height={16} />
        </button>
      </div>

      {pinnedMessages.length === 0 ? (
        <div className={styles.empty}>{t("pinned.empty")}</div>
      ) : (
        <div className={styles.list}>
          {pinnedMessages.map((msg) => {
            const id = msg.message_id ?? "";
            const preview = truncate(stripHtml(msg.body), MAX_PREVIEW);
            const imageSrc = extractFirstImageSrc(msg.body);
            const isUnseen = unseenIds.has(id);

            return (
              <button
                key={id}
                type="button"
                className={styles.item}
                onClick={() => {
                  onNavigate(id);
                  onClose();
                }}
              >
                <div className={styles.itemHeader}>
                  <span className={styles.senderName}>{msg.sender_name}</span>
                  {isUnseen && <span className={styles.unseenDot} />}
                  {msg.pinned_by && (
                    <span className={styles.pinnedBy}>
                      {t("pinned.pinnedBy", { name: msg.pinned_by })}
                    </span>
                  )}
                </div>
                <div className={styles.previewRow}>
                  {imageSrc && (
                    <img src={imageSrc} alt="" className={styles.thumbnail} />
                  )}
                  <div className={styles.preview}>{preview || (imageSrc ? t("pinned.imageLabel") : t("pinned.mediaLabel"))}</div>
                </div>
                {onUnpin && (
                  <button
                    type="button"
                    className={styles.unpinBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnpin(msg);
                    }}
                    aria-label={t("pinned.unpinAriaLabel")}
                  >
                    {t("pinned.unpin")}
                  </button>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
