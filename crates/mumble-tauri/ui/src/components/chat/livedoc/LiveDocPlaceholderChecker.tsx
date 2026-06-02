/**
 * LiveDocPlaceholderChecker - lists citations that need attention: unset
 * placeholders and citations whose source is missing from the current
 * list.  Each row jumps to the citation in the document so it can be
 * resolved.
 */

import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { CloseIcon } from "../../../icons";
import { scrollToPos } from "./liveDocHeadings";
import { useCitationSnapshot } from "./liveDocCitationStore";
import styles from "./LiveDocCitations.module.css";

interface LiveDocPlaceholderCheckerProps {
  readonly editor: Editor;
  readonly onClose: () => void;
}

export default function LiveDocPlaceholderChecker({ editor, onClose }: LiveDocPlaceholderCheckerProps) {
  const { t } = useTranslation("chat");
  const snapshot = useCitationSnapshot(editor);
  const tb = (k: string, d: string) => t(`liveDoc.citations.${k}`, { defaultValue: d });

  const jump = (pos: number) => {
    scrollToPos(editor, pos);
    onClose();
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.dialog} ${styles.dialogNarrow}`}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>{tb("checkPlaceholders", "Check Placeholders")}</span>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label={tb("close", "Close")}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        {snapshot.unresolved.length === 0 ? (
          <div className={styles.allGood}>
            {tb("noPlaceholders", "All citations are resolved — no unset placeholders.")}
          </div>
        ) : (
          <div className={styles.form}>
            {snapshot.unresolved.map((u) => (
              <button key={u.pos} type="button" className={styles.checkRow} onClick={() => jump(u.pos)}>
                <span className={styles.checkLabel}>
                  {u.placeholder
                    ? `“${u.placeholder}”`
                    : tb("missingSourceFor", "Missing source") + `: ${u.missingIds.join(", ")}`}
                </span>
                <span className={styles.checkBadge}>
                  {u.placeholder ? tb("badgePlaceholder", "placeholder") : tb("badgeMissing", "missing")}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onClose}>
            {tb("done", "Done")}
          </button>
        </div>
      </div>
    </div>
  );
}
