/**
 * LiveDocReferenceControls - a self-contained toolbar group that adds
 * the reference-related insert actions (bookmark, caption, cross-
 * reference) to the Live Doc toolbar.  Kept separate from
 * `LiveDocToolbar` to avoid growing that already-large file.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { HashIcon, Link2Icon, PinIcon, SuperscriptIcon } from "../../../icons";
import { newRefId } from "./liveDocBookmark";
import { CAPTION_KINDS, type CaptionKind, type RefTarget } from "./liveDocReferences";
import { hasEndnotesSection } from "./liveDocEndnotes";
import { useLiveDocReferences } from "./useLiveDocReferences";
import LiveDocReferencePicker from "./LiveDocReferencePicker";
import toolbar from "./LiveDocEditor.module.css";
import styles from "./LiveDocReferences.module.css";

interface LiveDocReferenceControlsProps {
  readonly editor: Editor;
}

export default function LiveDocReferenceControls({ editor }: LiveDocReferenceControlsProps) {
  const { t } = useTranslation("chat");
  const { targets } = useLiveDocReferences(editor);
  const [captionMenuOpen, setCaptionMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const insertBookmark = useCallback(() => {
    editor
      .chain()
      .focus()
      .insertBookmark({ bookmarkId: newRefId("bm"), label: "" })
      .run();
  }, [editor]);

  const insertCaption = useCallback(
    (kind: CaptionKind) => {
      setCaptionMenuOpen(false);
      editor.chain().focus().insertCaption(kind).run();
    },
    [editor],
  );

  const insertCrossReference = useCallback(
    (target: RefTarget) => {
      setPickerOpen(false);
      editor.chain().focus().insertCrossReference(target.id).run();
    },
    [editor],
  );

  const insertEndnote = useCallback(() => {
    editor.chain().focus().insertEndnote().run();
    if (!hasEndnotesSection(editor.state.doc)) {
      editor.chain().insertEndnotesSection().run();
    }
  }, [editor]);

  return (
    <div className={toolbar.toolbarGroup}>
      <button
        type="button"
        className={toolbar.toolBtn}
        onClick={insertBookmark}
        title={t("liveDoc.references.insertBookmark")}
        aria-label={t("liveDoc.references.insertBookmark")}
      >
        <PinIcon width={14} height={14} aria-hidden="true" />
      </button>

      <span className={styles.controlWrap}>
        <button
          type="button"
          className={toolbar.toolBtn}
          onClick={() => setCaptionMenuOpen((v) => !v)}
          title={t("liveDoc.references.insertCaption")}
          aria-label={t("liveDoc.references.insertCaption")}
          aria-haspopup="menu"
          aria-expanded={captionMenuOpen}
        >
          <HashIcon width={14} height={14} aria-hidden="true" />
        </button>
        {captionMenuOpen && (
          <div className={styles.captionMenu} role="menu">
            {CAPTION_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={styles.captionMenuItem}
                role="menuitem"
                onClick={() => insertCaption(kind)}
              >
                {t(`liveDoc.references.kind.${kind}`)}
              </button>
            ))}
          </div>
        )}
      </span>

      <span className={styles.controlWrap}>
        <button
          type="button"
          className={toolbar.toolBtn}
          onClick={() => setPickerOpen((v) => !v)}
          title={t("liveDoc.references.insertCrossReference")}
          aria-label={t("liveDoc.references.insertCrossReference")}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
        >
          <Link2Icon width={14} height={14} aria-hidden="true" />
        </button>
        {pickerOpen && (
          <LiveDocReferencePicker
            targets={targets}
            onPick={insertCrossReference}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </span>

      <button
        type="button"
        className={toolbar.toolBtn}
        onClick={insertEndnote}
        title={t("liveDoc.endnotes.insertEndnote")}
        aria-label={t("liveDoc.endnotes.insertEndnote")}
      >
        <SuperscriptIcon width={14} height={14} aria-hidden="true" />
      </button>
    </div>
  );
}
