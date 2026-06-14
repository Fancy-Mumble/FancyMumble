/**
 * LiveDocOutline - collapsible outline / navigation pane for the Live
 * Doc editor.  Lists every heading (H1-H6) in document order, indented
 * by level, and scrolls the editor to a heading on click.
 *
 * Heading data comes from [`useLiveDocHeadings`] which keeps the list in
 * sync with collaborative edits.
 */

import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { CloseIcon } from "../../../icons";
import {
  useLiveDocHeadings,
  minHeadingLevel,
  scrollToHeading,
  extractHeadings,
  type HeadingItem,
} from "./liveDocHeadings";
import styles from "./LiveDocOutline.module.css";

interface LiveDocOutlineProps {
  readonly editor: Editor;
  readonly onClose: () => void;
}

const INDENT_PER_LEVEL_PX = 12;

export default function LiveDocOutline({ editor, onClose }: LiveDocOutlineProps) {
  const { t } = useTranslation("chat");
  const { headings } = useLiveDocHeadings(editor);
  const base = minHeadingLevel(headings);

  const goTo = (item: HeadingItem) => {
    // Positions shift as peers edit; re-read fresh so the click lands on
    // the heading the user actually sees.
    const fresh = extractHeadings(editor.state.doc);
    const target = fresh[item.index]?.text === item.text ? fresh[item.index] : item;
    scrollToHeading(editor, target.pos);
  };

  return (
    <aside className={styles.outline} aria-label={t("liveDoc.outline.title")}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t("liveDoc.outline.title")}</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          title={t("liveDoc.outline.hide")}
          aria-label={t("liveDoc.outline.hide")}
        >
          <CloseIcon width={14} height={14} aria-hidden="true" />
        </button>
      </div>
      {headings.length === 0 ? (
        <p className={styles.empty}>{t("liveDoc.outline.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {headings.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className={styles.item}
                style={{ paddingLeft: 8 + (h.level - base) * INDENT_PER_LEVEL_PX }}
                data-level={h.level}
                onClick={() => goTo(h)}
                title={h.text || t("liveDoc.outline.untitledHeading")}
              >
                {h.text || t("liveDoc.outline.untitledHeading")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
