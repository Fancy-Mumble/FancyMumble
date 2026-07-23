import { useEffect, type ReactNode } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { BoldIcon, ItalicIcon, ListIcon, ListOrderedIcon, QuoteIcon, CodeIcon } from "@ui/icons";
import styles from "./RichTextEditor.module.css";

export interface RichTextEditorProps {
  /** Current HTML value. May arrive asynchronously (e.g. a lazily loaded blob). */
  readonly value: string;
  readonly onChange: (html: string) => void;
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  /** Renders the shared field chrome (label + optional hint) around the editor. */
  readonly label?: string;
  readonly hint?: ReactNode;
}

/**
 * Compact WYSIWYG editor producing HTML, built on the same tiptap stack the
 * Standard UI uses (StarterKit + Placeholder). Suitable for channel
 * descriptions, event notes, and other short rich-text fields.
 */
export default function RichTextEditor({ value, onChange, placeholder, ariaLabel, label, hint }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: placeholder ?? "" })],
    content: value,
    editorProps: { attributes: { class: styles.surface, ...(ariaLabel ? { "aria-label": ariaLabel } : {}) } },
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
  });

  // The value can load after mount (channel descriptions are lazy blobs), so
  // sync a diverging external value into the editor - but never while the user
  // is typing, which would fight their edits and reset the caret.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return;
    const current = editor.getHTML();
    const normalized = current === "<p></p>" ? "" : current;
    if (normalized !== value) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [value, editor]);

  const cls = (active: boolean | undefined) => (active ? `${styles.toolBtn} ${styles.toolBtnActive}` : styles.toolBtn);

  const body = (
    <div className={styles.wrap}>
      <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
        <button type="button" className={cls(editor?.isActive("bold"))} onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="Bold" aria-pressed={editor?.isActive("bold")}><BoldIcon size={15} /></button>
        <button type="button" className={cls(editor?.isActive("italic"))} onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="Italic" aria-pressed={editor?.isActive("italic")}><ItalicIcon size={15} /></button>
        <span className={styles.toolSep} />
        <button type="button" className={cls(editor?.isActive("bulletList"))} onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-label="Bullet list" aria-pressed={editor?.isActive("bulletList")}><ListIcon size={15} /></button>
        <button type="button" className={cls(editor?.isActive("orderedList"))} onClick={() => editor?.chain().focus().toggleOrderedList().run()} aria-label="Numbered list" aria-pressed={editor?.isActive("orderedList")}><ListOrderedIcon size={15} /></button>
        <span className={styles.toolSep} />
        <button type="button" className={cls(editor?.isActive("blockquote"))} onClick={() => editor?.chain().focus().toggleBlockquote().run()} aria-label="Quote" aria-pressed={editor?.isActive("blockquote")}><QuoteIcon size={15} /></button>
        <button type="button" className={cls(editor?.isActive("codeBlock"))} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} aria-label="Code block" aria-pressed={editor?.isActive("codeBlock")}><CodeIcon size={15} /></button>
      </div>
      <EditorContent editor={editor} className={styles.content} />
    </div>
  );

  if (!label) return body;
  return (
    <div className={styles.field}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      {body}
    </div>
  );
}
