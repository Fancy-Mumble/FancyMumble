/**
 * LiveDocCitationView - renders an inline citation from the shared
 * citation snapshot.  A resolved citation shows its style-formatted text
 * (e.g. "(Smith, 2020)" or "[1]"); an unset placeholder shows a clearly
 * marked, clickable chip so it can be found and filled in later.
 */

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { useCitationSnapshot } from "./liveDocCitationStore";
import { parseCitationItems } from "./liveDocCitations";
import styles from "./LiveDocCitations.module.css";

export default function LiveDocCitationView({ editor, node, getPos }: Readonly<NodeViewProps>) {
  const { t } = useTranslation("chat");
  const snapshot = useCitationSnapshot(editor);
  const placeholder = String(node.attrs.placeholder ?? "");
  const items = parseCitationItems(node.attrs.items);
  const pos = typeof getPos === "function" ? getPos() : undefined;
  const html = pos !== undefined ? snapshot.textByPos[String(pos)] : undefined;

  // Unset placeholder (no resolved source).
  if (placeholder && items.length === 0) {
    return (
      <NodeViewWrapper
        as="span"
        className={styles.citationPlaceholder}
        data-livedoc-citation=""
        contentEditable={false}
        suppressContentEditableWarning
        title={t("liveDoc.citations.placeholderTitle", { defaultValue: "Unset citation placeholder" })}
      >
        [{placeholder || t("liveDoc.citations.placeholder", { defaultValue: "Placeholder" })}]
      </NodeViewWrapper>
    );
  }

  // Resolved citation: formatted HTML from citeproc, or a fallback while the
  // snapshot is catching up / when the source is missing.
  if (html) {
    return (
      <NodeViewWrapper
        as="span"
        className={styles.citation}
        data-livedoc-citation=""
        contentEditable={false}
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className={styles.citationBroken}
      data-livedoc-citation=""
      contentEditable={false}
      suppressContentEditableWarning
      title={t("liveDoc.citations.missingSource", { defaultValue: "Source not in current list" })}
    >
      [{t("liveDoc.citations.unresolved", { defaultValue: "citation" })}]
    </NodeViewWrapper>
  );
}
