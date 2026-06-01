/**
 * LiveDocCaptionView - renders a caption block with a live, auto-
 * generated number prefix ("Figure 1: ") followed by the editable
 * caption text.
 *
 * The number is derived from [`useLiveDocReferences`] so it always
 * reflects the caption's current ordinal among same-kind captions.
 */

import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { captionTargetId, type CaptionKind } from "./liveDocReferences";
import { useLiveDocReferences } from "./useLiveDocReferences";
import styles from "./LiveDocReferences.module.css";

export default function LiveDocCaptionView({ editor, node }: Readonly<NodeViewProps>) {
  const { t } = useTranslation("chat");
  const { targets } = useLiveDocReferences(editor);
  const kind = (node.attrs.kind as CaptionKind) ?? "figure";
  const captionId = String(node.attrs.captionId ?? "");
  const target = targets.find((x) => x.id === captionTargetId(captionId));
  const number = target?.number ?? 1;
  const kindLabel = t(`liveDoc.references.kind.${kind}`);

  return (
    <NodeViewWrapper as="figcaption" className={styles.caption} data-kind={kind}>
      <span className={styles.captionPrefix} contentEditable={false}>
        {`${kindLabel} ${number}: `}
      </span>
      <NodeViewContent className={styles.captionText} />
    </NodeViewWrapper>
  );
}
