/**
 * LiveDocBibliographyView - renders the generated reference list from the
 * shared citation snapshot, formatted in the document's current style.
 */

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { useCitationSnapshot } from "./liveDocCitationStore";
import styles from "./LiveDocCitations.module.css";

export default function LiveDocBibliographyView({ editor }: Readonly<NodeViewProps>) {
  const { t } = useTranslation("chat");
  const snapshot = useCitationSnapshot(editor);

  return (
    <NodeViewWrapper
      as="div"
      className={styles.bibliography}
      data-livedoc-bibliography=""
      contentEditable={false}
      suppressContentEditableWarning
    >
      <div className={styles.bibliographyHeading}>
        {t("liveDoc.citations.bibliographyTitle", { defaultValue: "References" })}
      </div>
      {snapshot.bibliography.length === 0 ? (
        <div className={styles.bibliographyEmpty}>
          {t("liveDoc.citations.bibliographyEmpty", {
            defaultValue: "No citations yet - insert a citation to populate the bibliography.",
          })}
        </div>
      ) : (
        snapshot.bibliography.map((html, i) => (
          <div
            // Bibliography entries have no stable id; index is acceptable as
            // the list is fully regenerated on every change.
            key={i}
            className={styles.bibliographyEntry}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ))
      )}
    </NodeViewWrapper>
  );
}
