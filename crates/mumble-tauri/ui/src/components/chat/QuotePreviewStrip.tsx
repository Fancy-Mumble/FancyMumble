import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../types";
import { colorFor } from "../../utils/format";
import styles from "./ChatView.module.css";

interface QuotePreviewStripProps {
  readonly quotes: ChatMessage[];
  readonly onRemove: (msgId: string) => void;
}

function stripHtml(body: string): string {
  return body
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll(/<!--[\s\S]*?-->/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}

export default function QuotePreviewStrip({ quotes, onRemove }: QuotePreviewStripProps) {
  const { t } = useTranslation("chat");
  if (quotes.length === 0) return null;

  return (
    <div className={styles.quotePreviewStrip}>
      {quotes.map((q) => {
        const plain = stripHtml(q.body);
        const preview = plain.length > 80 ? plain.slice(0, 80) + "\u2026" : plain;
        return (
          <div key={q.message_id} className={styles.quotePreviewItem}>
            <div
              className={styles.quotePreviewBar}
              style={{ backgroundColor: colorFor(q.sender_name) }}
            />
            <div className={styles.quotePreviewContent}>
              <span
                className={styles.quotePreviewSender}
                style={{ color: colorFor(q.sender_name) }}
              >
                {q.sender_name}
              </span>
              <span className={styles.quotePreviewText}>
                {preview || t("quotePreview.mediaFallback")}
              </span>
            </div>
            <button
              type="button"
              className={styles.quotePreviewRemove}
              onClick={() => onRemove(q.message_id!)}
              aria-label={t("quotePreview.remove")}
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
