/**
 * LiveDocBookmarkView - inline pill rendering for a Live Doc bookmark
 * anchor.  Shows a small bookmark icon plus the label.  The label is
 * edited inline (no native prompt): clicking the pill - or inserting a
 * fresh, unlabelled bookmark - reveals an inline input that commits on
 * blur / Enter and cancels on Escape.
 */

import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { PinIcon } from "../../../icons";
import styles from "./LiveDocReferences.module.css";

export default function LiveDocBookmarkView({ node, updateAttributes }: Readonly<NodeViewProps>) {
  const { t } = useTranslation("chat");
  const label = String(node.attrs.label ?? "").trim();
  const [editing, setEditing] = useState(() => label === "");
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(label);
    setEditing(true);
  };

  const commit = () => {
    updateAttributes({ label: draft.trim() });
    setEditing(false);
  };

  const cancel = () => {
    setDraft(label);
    setEditing(false);
  };

  if (editing) {
    return (
      <NodeViewWrapper
        as="span"
        className={styles.bookmark}
        data-livedoc-bookmark=""
        contentEditable={false}
        suppressContentEditableWarning
      >
        <PinIcon width={11} height={11} aria-hidden="true" />
        <input
          ref={inputRef}
          className={styles.bookmarkInput}
          value={draft}
          placeholder={t("liveDoc.references.bookmarkPrompt")}
          aria-label={t("liveDoc.references.bookmarkPrompt")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className={styles.bookmark}
      data-livedoc-bookmark=""
      contentEditable={false}
      suppressContentEditableWarning
      role="button"
      tabIndex={0}
      title={label || t("liveDoc.references.bookmarkUnnamed")}
      onClick={startEditing}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startEditing();
        }
      }}
    >
      <PinIcon width={11} height={11} aria-hidden="true" />
      <span className={styles.bookmarkLabel}>
        {label || t("liveDoc.references.bookmarkUnnamed")}
      </span>
    </NodeViewWrapper>
  );
}
