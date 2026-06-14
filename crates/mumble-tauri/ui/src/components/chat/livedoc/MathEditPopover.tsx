/**
 * MathEditPopover - inline WYSIWYG editor for KaTeX math nodes in
 * the LiveDoc Tiptap editor.
 *
 * Opens anchored to a clicked InlineMath / BlockMath node, shows the
 * raw LaTeX in a textarea with a live KaTeX preview, and applies the
 * edit via the Tiptap `updateInlineMath` / `updateBlockMath` commands.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import katex from "katex";
import styles from "./MathEditPopover.module.css";

export interface MathEditTarget {
  /** Node type name, used to dispatch the right update command. */
  readonly type: "inlineMath" | "blockMath";
  /** ProseMirror position of the node. */
  readonly pos: number;
  /** Initial LaTeX source. */
  readonly latex: string;
  /** Bounding rect of the rendered math DOM node in viewport coords. */
  readonly rect: DOMRect;
}

interface MathEditPopoverProps {
  readonly target: MathEditTarget;
  readonly onApply: (latex: string) => void;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}

export default function MathEditPopover({
  target,
  onApply,
  onDelete,
  onCancel,
}: MathEditPopoverProps) {
  const [value, setValue] = useState(target.latex);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: target.rect.bottom + 4,
    left: target.rect.left,
  });

  // Focus the textarea on mount and place caret at the end.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Auto-resize the textarea to fit its content whenever value changes.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Clamp position to viewport once the popover has been measured.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let top = target.rect.bottom + 4;
    let left = target.rect.left;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, target.rect.top - rect.height - 4);
    }
    setPosition({ top, left });
  }, [target.rect, value]);

  // Render the live preview.  KaTeX throwOnError=false renders the
  // error inline in red, but we also surface it separately so the
  // user sees the actual parser message.
  const preview = useMemo(() => {
    try {
      return {
        html: katex.renderToString(value, {
          displayMode: target.type === "blockMath",
          throwOnError: false,
          output: "html",
        }),
        error: null as string | null,
      };
    } catch (e) {
      return { html: "", error: e instanceof Error ? e.message : String(e) };
    }
  }, [value, target.type]);

  const apply = () => {
    onApply(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    // Enter applies for inline math; Cmd/Ctrl+Enter applies for block
    // math (block math benefits from multiline editing).
    if (e.key === "Enter") {
      const isBlock = target.type === "blockMath";
      const wantsApply = isBlock ? e.metaKey || e.ctrlKey : !e.shiftKey;
      if (wantsApply) {
        e.preventDefault();
        apply();
      }
    }
  };

  return createPortal(
    <>
      <div
        className={styles.backdrop}
        onMouseDown={onCancel}
        aria-hidden="true"
      />
      <div
        ref={popoverRef}
        className={styles.popover}
        style={{ top: position.top, left: position.left }}
        role="dialog"
        aria-label="Edit LaTeX"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          {target.type === "blockMath" ? "Math block" : "Inline math"}
        </div>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          rows={target.type === "blockMath" ? 3 : 1}
          style={{ overflow: "hidden" }}
          placeholder="\\frac{a}{b}"
        />
        <div
          className={`${styles.preview} ${target.type === "blockMath" ? styles.block : ""}`}
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
        {preview.error && <div className={styles.error}>{preview.error}</div>}
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={onDelete}>
            Delete
          </button>
          <button type="button" className={styles.btn} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            onClick={apply}
          >
            Apply
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
