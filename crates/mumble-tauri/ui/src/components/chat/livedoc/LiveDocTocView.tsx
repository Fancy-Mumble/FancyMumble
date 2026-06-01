/**
 * LiveDocTocView - React node view for the in-document "Table of
 * Contents" block.  Renders a live, clickable list of the document's
 * headings with a manual refresh button.  Clicking an entry scrolls the
 * editor to that heading.
 *
 * The list is generated from the live document via
 * [`useLiveDocHeadings`], so it stays current as the document is edited;
 * the refresh button is offered for parity with word processors and
 * forces an immediate re-scan.
 */

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { RefreshIcon } from "../../../icons";
import {
  useLiveDocHeadings,
  minHeadingLevel,
  scrollToHeading,
  extractHeadings,
  type HeadingItem,
} from "./liveDocHeadings";
import styles from "./LiveDocToc.module.css";

const INDENT_PER_LEVEL_PX = 16;

export default function LiveDocTocView({ editor }: Readonly<NodeViewProps>) {
  const { t } = useTranslation("chat");
  const { headings, refresh } = useLiveDocHeadings(editor);
  const base = minHeadingLevel(headings);

  const goTo = (item: HeadingItem) => {
    const fresh = extractHeadings(editor.state.doc);
    const target = fresh[item.index]?.text === item.text ? fresh[item.index] : item;
    scrollToHeading(editor, target.pos);
  };

  return (
    <NodeViewWrapper
      className={styles.toc}
      data-livedoc-toc=""
      contentEditable={false}
      suppressContentEditableWarning
    >
      <div className={styles.header}>
        <span className={styles.title}>{t("liveDoc.toc.title")}</span>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={refresh}
          title={t("liveDoc.toc.refresh")}
          aria-label={t("liveDoc.toc.refresh")}
        >
          <RefreshIcon width={13} height={13} aria-hidden="true" />
        </button>
      </div>
      {headings.length === 0 ? (
        <p className={styles.empty}>{t("liveDoc.toc.empty")}</p>
      ) : (
        <ol className={styles.list}>
          {headings.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className={styles.entry}
                style={{ marginLeft: (h.level - base) * INDENT_PER_LEVEL_PX }}
                onClick={() => goTo(h)}
              >
                {h.text || t("liveDoc.toc.untitledHeading")}
              </button>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  );
}
