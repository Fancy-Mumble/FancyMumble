/**
 * LiveDocToolbar - all formatting controls for the Live Doc editor.
 *
 * Receives the Tiptap `editor` as a prop and dispatches commands on
 * it.  Custom popovers replace native `<select>` so the dropdown
 * content stays inside the app theme (native `<option>` honours OS
 * styling on closed state and is unreadable on dark themes).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ChevronDownIcon,
  Grid2x2Icon,
  ImageIcon,
  MinusIcon,
  PaintBucketIcon,
  PaletteIcon,
  PlusIcon,
  RedoIcon,
  UndoIcon,
} from "../../../icons";
import { resizeImage } from "../../../pages/settings/imageUtils";
import styles from "./LiveDocEditor.module.css";

interface LiveDocToolbarProps {
  readonly editor: Editor;
  readonly onInsertMathBlock: () => void;
}

/** Font family options.  The first three reference the project's
 *  bundled `@font-face` declarations (see `src/fonts.css`); the rest
 *  fall back to the user's system fonts. */
const FONT_FAMILIES: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
  { label: "Default", value: "" },
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Roboto", value: "Roboto, system-ui, sans-serif" },
  { label: "Space Mono", value: "'Space Mono', ui-monospace, monospace" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Sans Serif", value: "system-ui, 'Segoe UI', sans-serif" },
  { label: "Monospace", value: "ui-monospace, Menlo, monospace" },
  { label: "Cursive", value: "'Comic Sans MS', cursive" },
];

/** Google Docs font-size presets (points). */
const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96] as const;
const DEFAULT_FONT_SIZE_PT = 11;
const MIN_FONT_SIZE_PT = 1;
const MAX_FONT_SIZE_PT = 400;

export default function LiveDocToolbar({ editor, onInsertMathBlock }: LiveDocToolbarProps) {
  const { t } = useTranslation("chat");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textColorInputRef = useRef<HTMLInputElement>(null);
  const highlightInputRef = useRef<HTMLInputElement>(null);

  const promptForLink = useCallback(() => {
    const previous = (editor.getAttributes("link").href as string | null) ?? "";
    // eslint-disable-next-line no-alert
    const url = window.prompt(t("liveDoc.toolbar.link"), previous);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor, t]);

  const promptForBlockMath = onInsertMathBlock;

  const handleInsertImage = useCallback(
    async (file: File) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const raw = e.target?.result as string | undefined;
        if (!raw) return;
        const dataUrl = await resizeImage(raw, 800, 800, 250_000);
        editor.chain().focus().setImage({ src: dataUrl }).run();
      };
      reader.readAsDataURL(file);
    },
    [editor],
  );

  const currentFamilyValue =
    (editor.getAttributes("textStyle").fontFamily as string | undefined) ?? "";
  const currentFamily =
    FONT_FAMILIES.find((f) => f.value === currentFamilyValue) ?? FONT_FAMILIES[0];

  return (
    <div className={styles.toolbar} role="toolbar" aria-label={t("liveDoc.panelTitle")}>
      {/* Group 1 - inline marks */}
      <div className={styles.toolbarGroup}>
        <ToolButton label={t("liveDoc.toolbar.bold")} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <strong>B</strong>
        </ToolButton>
        <ToolButton label={t("liveDoc.toolbar.italic")} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <em>I</em>
        </ToolButton>
        <ToolButton label={t("liveDoc.toolbar.underline")} active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <u>U</u>
        </ToolButton>
        <ToolButton label={t("liveDoc.toolbar.strike")} active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <s>S</s>
        </ToolButton>
        <ToolButton label={t("liveDoc.toolbar.code")} active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
          {"</>"}
        </ToolButton>
      </div>

      <Divider />

      {/* Group 2 - headings */}
      <div className={styles.toolbarGroup}>
        <ToolButton label={t("liveDoc.toolbar.h1")} active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolButton>
        <ToolButton label={t("liveDoc.toolbar.h2")} active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolButton>
        <ToolButton label={t("liveDoc.toolbar.h3")} active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolButton>
        <ToolButton label={t("liveDoc.toolbar.paragraph")} active={editor.isActive("paragraph")} onClick={() => editor.chain().focus().setParagraph().run()}>¶</ToolButton>
      </div>

      <Divider />

      {/* Group 3 - block formatting */}
      <div className={styles.toolbarGroup}>
        <ToolButton label={t("liveDoc.toolbar.bulletList")} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</ToolButton>
        <ToolButton label={t("liveDoc.toolbar.orderedList")} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolButton>
        <ToolButton label={t("liveDoc.toolbar.blockquote")} active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolButton>
        <ToolButton label={t("liveDoc.toolbar.codeBlock")} active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{"{ }"}</ToolButton>
      </div>

      <Divider />

      {/* Group 4 - text alignment (lucide icons, accessible labels) */}
      <div className={styles.toolbarGroup}>
        <ToolButton label={t("liveDoc.toolbar.alignLeft")} active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeftIcon width={14} height={14} aria-hidden="true" />
        </ToolButton>
        <ToolButton label={t("liveDoc.toolbar.alignCenter")} active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenterIcon width={14} height={14} aria-hidden="true" />
        </ToolButton>
        <ToolButton label={t("liveDoc.toolbar.alignRight")} active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRightIcon width={14} height={14} aria-hidden="true" />
        </ToolButton>
        <ToolButton label={t("liveDoc.toolbar.alignJustify")} active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
          <AlignJustifyIcon width={14} height={14} aria-hidden="true" />
        </ToolButton>
      </div>

      <Divider />

      {/* Group 5 - indentation */}
      <div className={styles.toolbarGroup}>
        <ToolButton label={t("liveDoc.toolbar.outdent")} onClick={() => editor.chain().focus().outdentBlock().run()}>⇤</ToolButton>
        <ToolButton label={t("liveDoc.toolbar.indent")} onClick={() => editor.chain().focus().indentBlock().run()}>⇥</ToolButton>
      </div>

      <Divider />

      {/* Group 6 - font family + font size + colours */}
      <div className={styles.toolbarGroup}>
        <ToolDropdown
          label={t("liveDoc.toolbar.fontFamily")}
          buttonText={currentFamily.label}
          buttonStyle={{ fontFamily: currentFamily.value || undefined, minWidth: 110 }}
        >
          {(close) =>
            FONT_FAMILIES.map((f) => (
              <button
                key={f.label}
                type="button"
                className={`${styles.dropdownItem} ${currentFamilyValue === f.value ? styles.dropdownItemActive : ""}`}
                style={{ fontFamily: f.value || undefined }}
                onClick={() => {
                  if (f.value) editor.chain().focus().setFontFamily(f.value).run();
                  else editor.chain().focus().unsetFontFamily().run();
                  close();
                }}
              >
                {f.label}
              </button>
            ))
          }
        </ToolDropdown>

        <FontSizeWidget editor={editor} />

        <ColorTrigger
          inputRef={textColorInputRef}
          label={t("liveDoc.toolbar.textColor")}
          current={(editor.getAttributes("textStyle").color as string) ?? null}
          onColor={(c) => editor.chain().focus().setColor(c).run()}
          onClear={() => editor.chain().focus().unsetColor().run()}
        >
          <PaletteIcon width={14} height={14} aria-hidden="true" />
        </ColorTrigger>

        <ColorTrigger
          inputRef={highlightInputRef}
          label={t("liveDoc.toolbar.highlightColor")}
          current={(editor.getAttributes("highlight").color as string) ?? null}
          onColor={(c) => editor.chain().focus().toggleHighlight({ color: c }).run()}
          onClear={() => editor.chain().focus().unsetHighlight().run()}
        >
          <PaintBucketIcon width={14} height={14} aria-hidden="true" />
        </ColorTrigger>
      </div>

      <Divider />

      {/* Group 7 - image + link + math */}
      <div className={styles.toolbarGroup}>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleInsertImage(file);
            e.target.value = "";
          }}
        />
        <ToolButton label={t("liveDoc.toolbar.image")} onClick={() => imageInputRef.current?.click()}>
          <ImageIcon width={14} height={14} aria-hidden="true" />
        </ToolButton>
        <ToolButton label={t("liveDoc.toolbar.link")} onClick={promptForLink}>🔗</ToolButton>
        <ToolButton label={t("liveDoc.toolbar.mathBlock")} onClick={promptForBlockMath}>
          <span aria-hidden="true">&#x2211;</span>
        </ToolButton>
        <TablePickerButton editor={editor} />
      </div>

      <Divider />

      {/* Group 8 - history.  Click always tries; the Yjs UndoManager
          silently no-ops when the stack is empty, and Tiptap's
          `can()` is unreliable here because the undo-plugin state
          isn't always ready on first render. */}
      <div className={styles.toolbarGroup}>
        <ToolButton label={t("liveDoc.toolbar.undo")} onClick={() => editor.chain().focus().undo().run()}>
          <UndoIcon width={14} height={14} aria-hidden="true" />
        </ToolButton>
        <ToolButton label={t("liveDoc.toolbar.redo")} onClick={() => editor.chain().focus().redo().run()}>
          <RedoIcon width={14} height={14} aria-hidden="true" />
        </ToolButton>
      </div>
    </div>
  );
}

function Divider() {
  return <div className={styles.toolbarDivider} aria-hidden="true" />;
}

interface ToolButtonProps {
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

function ToolButton({ label, active, disabled, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.toolBtn} ${active ? styles.toolBtnActive : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Themed dropdown (replaces native <select> so dark-theme options
// don't render as grey-on-white).
// ---------------------------------------------------------------------------

interface ToolDropdownProps {
  readonly label: string;
  readonly buttonText: string;
  readonly buttonStyle?: React.CSSProperties;
  readonly children: (close: () => void) => ReactNode;
}

function ToolDropdown({ label, buttonText, buttonStyle, children }: ToolDropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open, close]);

  return (
    <span ref={wrapperRef} className={styles.dropdownWrap}>
      <button
        type="button"
        className={`${styles.toolBtn} ${styles.dropdownTrigger}`}
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={buttonStyle}
      >
        <span className={styles.dropdownTriggerText}>{buttonText}</span>
        <ChevronDownIcon width={12} height={12} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.dropdownMenu} role="listbox">
          {children(close)}
        </div>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Font-size widget: [-] [number input] [+] [▾ preset dropdown]
// ---------------------------------------------------------------------------

function FontSizeWidget({ editor }: { readonly editor: Editor }) {
  const { t } = useTranslation("chat");

  const currentSizePt = readFontSizePt(editor) ?? DEFAULT_FONT_SIZE_PT;
  const [draft, setDraft] = useState<string>(String(currentSizePt));

  // Reflect external changes (selection moves) back into the input.
  useEffect(() => {
    setDraft(String(currentSizePt));
  }, [currentSizePt]);

  const apply = useCallback(
    (next: number) => {
      const clamped = Math.max(MIN_FONT_SIZE_PT, Math.min(MAX_FONT_SIZE_PT, Math.round(next)));
      editor.chain().focus().setFontSize(`${clamped}pt`).run();
    },
    [editor],
  );

  const commitDraft = useCallback(() => {
    const parsed = parseInt(draft, 10);
    if (Number.isFinite(parsed) && parsed >= MIN_FONT_SIZE_PT) {
      apply(parsed);
    } else {
      setDraft(String(currentSizePt));
    }
  }, [draft, apply, currentSizePt]);

  const stepBy = useCallback(
    (delta: number) => apply(currentSizePt + delta),
    [apply, currentSizePt],
  );

  return (
    <span className={styles.fontSizeWidget}>
      <button
        type="button"
        className={styles.fontSizeBtn}
        onClick={() => stepBy(-1)}
        title={t("liveDoc.toolbar.fontSize")}
        aria-label={t("liveDoc.toolbar.fontSize")}
      >
        <MinusIcon width={12} height={12} aria-hidden="true" />
      </button>
      <input
        type="number"
        className={styles.fontSizeInput}
        min={MIN_FONT_SIZE_PT}
        max={MAX_FONT_SIZE_PT}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label={t("liveDoc.toolbar.fontSize")}
      />
      <button
        type="button"
        className={styles.fontSizeBtn}
        onClick={() => stepBy(+1)}
        title={t("liveDoc.toolbar.fontSize")}
        aria-label={t("liveDoc.toolbar.fontSize")}
      >
        <PlusIcon width={12} height={12} aria-hidden="true" />
      </button>
      <ToolDropdown
        label={t("liveDoc.toolbar.fontSize")}
        buttonText=""
        buttonStyle={{ minWidth: 22, padding: "0 4px" }}
      >
        {(close) =>
          FONT_SIZE_PRESETS.map((pt) => (
            <button
              key={pt}
              type="button"
              className={`${styles.dropdownItem} ${pt === currentSizePt ? styles.dropdownItemActive : ""}`}
              onClick={() => {
                apply(pt);
                close();
              }}
            >
              {pt}
            </button>
          ))
        }
      </ToolDropdown>
    </span>
  );
}

/** Parse the editor's current `textStyle.fontSize` attribute as a
 *  numeric point value.  Accepts `12pt`, `16px` (converted to ~12 pt),
 *  or unitless numbers.  Returns null if the mark is unset. */
function readFontSizePt(editor: Editor): number | null {
  const raw = editor.getAttributes("textStyle").fontSize as string | undefined;
  if (!raw) return null;
  const m = /^(\d+(?:\.\d+)?)(pt|px|em|rem)?$/i.exec(raw.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "pt").toLowerCase();
  if (unit === "pt") return Math.round(n);
  if (unit === "px") return Math.round(n * 0.75);
  return null;
}

// ---------------------------------------------------------------------------
// Color trigger (native picker without popover infrastructure)
// ---------------------------------------------------------------------------

interface ColorTriggerProps {
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly label: string;
  readonly current: string | null;
  readonly onColor: (color: string) => void;
  readonly onClear: () => void;
  readonly children: ReactNode;
}

function ColorTrigger({ inputRef, label, current, onColor, onClear, children }: ColorTriggerProps) {
  return (
    <span className={styles.colorTrigger}>
      <button
        type="button"
        className={styles.toolBtn}
        onClick={() => inputRef.current?.click()}
        title={label}
        aria-label={label}
      >
        <span className={styles.colorIcon} style={{ borderBottomColor: current ?? "transparent" }}>
          {children}
        </span>
      </button>
      <input
        ref={inputRef}
        type="color"
        value={current ?? "#ffffff"}
        onChange={(e) => onColor(e.target.value)}
        className={styles.colorInputHidden}
        aria-hidden="true"
        tabIndex={-1}
      />
      {current && (
        <button
          type="button"
          className={styles.colorClearBtn}
          onClick={onClear}
          title={`${label} – clear`}
          aria-label={`${label} – clear`}
        >
          ×
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Table grid picker
// ---------------------------------------------------------------------------

const TABLE_PICKER_MAX_ROWS = 8;
const TABLE_PICKER_MAX_COLS = 8;

function TablePickerButton({ editor }: { readonly editor: Editor }) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<{ rows: number; cols: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const insertTable = useCallback(
    (rows: number, cols: number) => {
      editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
      setOpen(false);
      setHovered(null);
    },
    [editor],
  );

  const label = hovered
    ? `${hovered.cols} × ${hovered.rows}`
    : t("liveDoc.toolbar.table");

  return (
    <span ref={wrapperRef} className={styles.dropdownWrap}>
      <button
        type="button"
        className={`${styles.toolBtn} ${open ? styles.toolBtnActive : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={t("liveDoc.toolbar.table")}
        aria-label={t("liveDoc.toolbar.table")}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Grid2x2Icon width={14} height={14} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.tablePickerPopup} role="dialog" aria-label={t("liveDoc.toolbar.table")}>
          <div className={styles.tablePickerLabel}>{label}</div>
          <div className={styles.tablePickerGrid}>
            {Array.from({ length: TABLE_PICKER_MAX_ROWS }, (_, r) =>
              Array.from({ length: TABLE_PICKER_MAX_COLS }, (_, c) => {
                const row = r + 1;
                const col = c + 1;
                const active = hovered ? row <= hovered.rows && col <= hovered.cols : false;
                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    className={`${styles.tablePickerCell} ${active ? styles.tablePickerCellActive : ""}`}
                    onMouseEnter={() => setHovered({ rows: row, cols: col })}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => insertTable(row, col)}
                    aria-label={`${col} × ${row} ${t("liveDoc.toolbar.table")}`}
                  />
                );
              })
            )}
          </div>
        </div>
      )}
    </span>
  );
}
