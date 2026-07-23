import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  BoldIcon,
  ItalicIcon,
  ListIcon,
  ListTreeIcon,
} from "../../../icons";
import styles from "./EventDialog.module.css";

/**
 * Compact rich-text editor for an event description, reusing the same tiptap
 * stack as the LiveDoc editor (StarterKit + Placeholder). Produces HTML.
 *
 * Mounted fresh per dialog open, so `content` is an uncontrolled initial value.
 */
export default function DescriptionEditor({
  value,
  onChange,
  placeholder,
}: {
  readonly value: string;
  readonly onChange: (html: string) => void;
  readonly placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
  });

  return (
    <div className={styles.editorWrap}>
      <div className={styles.editorToolbar}>
        <button
          type="button"
          className={editor?.isActive("bold") ? styles.tbActive : styles.tbBtn}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          aria-label="Bold"
        >
          <BoldIcon width={14} height={14} />
        </button>
        <button
          type="button"
          className={editor?.isActive("italic") ? styles.tbActive : styles.tbBtn}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          aria-label="Italic"
        >
          <ItalicIcon width={14} height={14} />
        </button>
        <button
          type="button"
          className={editor?.isActive("bulletList") ? styles.tbActive : styles.tbBtn}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          aria-label="Bullet list"
        >
          <ListIcon width={14} height={14} />
        </button>
        <button
          type="button"
          className={editor?.isActive("orderedList") ? styles.tbActive : styles.tbBtn}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          aria-label="Numbered list"
        >
          <ListTreeIcon width={14} height={14} />
        </button>
      </div>
      <EditorContent editor={editor} className={styles.editorContent} />
    </div>
  );
}
