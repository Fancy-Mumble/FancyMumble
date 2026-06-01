/**
 * LiveDocCrossRefView - renders a cross-reference as a clickable link
 * showing the live text/number of its target.  Headings and bookmarks
 * show their label; captions show "Figure 1" etc.  Missing targets
 * render as a clearly-marked broken reference.
 */

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { scrollToPos } from "./liveDocHeadings";
import { resolveTarget, type RefTarget } from "./liveDocReferences";
import { useLiveDocReferences } from "./useLiveDocReferences";
import styles from "./LiveDocReferences.module.css";

function targetDisplay(
  target: RefTarget,
  translate: (key: string) => string,
): string {
  if (target.number !== undefined) {
    return `${translate(`liveDoc.references.kind.${target.kind}`)} ${target.number}`;
  }
  return target.label || translate("liveDoc.references.untitledTarget");
}

export default function LiveDocCrossRefView({ editor, node }: Readonly<NodeViewProps>) {
  const { t } = useTranslation("chat");
  const translate = t as (key: string) => string;
  const { targets } = useLiveDocReferences(editor);
  const targetId = String(node.attrs.targetId ?? "");
  const target = resolveTarget(targetId, targets);

  if (!target) {
    return (
      <NodeViewWrapper
        as="span"
        className={styles.xrefBroken}
        data-livedoc-xref=""
        contentEditable={false}
        suppressContentEditableWarning
      >
        {translate("liveDoc.references.brokenReference")}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className={styles.xref}
      data-livedoc-xref=""
      contentEditable={false}
      suppressContentEditableWarning
      role="link"
      tabIndex={0}
      onClick={() => scrollToPos(editor, target.pos)}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          scrollToPos(editor, target.pos);
        }
      }}
    >
      {targetDisplay(target, translate)}
    </NodeViewWrapper>
  );
}
