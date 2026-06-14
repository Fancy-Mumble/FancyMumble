/**
 * liveDocRibbonWidgets - shared, editor-agnostic controls used to build the
 * Live Doc ribbon tabs.  Extracted from the old flat toolbar so every tab
 * panel can reuse the same themed dropdown / colour / font-size / table
 * widgets instead of native form controls (which ignore the app theme on
 * dark backgrounds).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { ChevronDownIcon, CloseIcon, Grid2x2Icon, MinusIcon, PlusIcon } from "../../../icons";
import styles from "./LiveDocEditor.module.css";
import ribbon from "./LiveDocRibbon.module.css";

/** Font family options.  The first three reference the project's bundled
 *  `@font-face` declarations (see `src/fonts.css`); the rest fall back to
 *  the user's system fonts. */
export const FONT_FAMILIES: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
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
export const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96] as const;
const DEFAULT_FONT_SIZE_PT = 11;
const MIN_FONT_SIZE_PT = 1;
const MAX_FONT_SIZE_PT = 400;

// ---------------------------------------------------------------------------
// Ribbon buttons (large icon-over-label + small icon buttons)
// ---------------------------------------------------------------------------

interface RibbonButtonProps {
  readonly label: string;
  /** Optional shorter caption rendered under a large button (defaults to
   *  `label`).  The full `label` is always used for the tooltip / aria. */
  readonly caption?: string;
  readonly icon: ReactNode;
  readonly variant?: "large" | "small";
  readonly active?: boolean;
  readonly disabled?: boolean;
  /** Render the text label next to a small button's icon. */
  readonly showLabel?: boolean;
  readonly onClick: () => void;
}

export function RibbonButton({
  label,
  caption,
  icon,
  variant = "small",
  active,
  disabled,
  showLabel,
  onClick,
}: RibbonButtonProps) {
  if (variant === "large") {
    return (
      <button
        type="button"
        className={`${ribbon.btnLarge} ${active ? ribbon.btnActive : ""}`}
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-pressed={active ?? undefined}
      >
        <span className={ribbon.btnLargeIcon} aria-hidden="true">
          {icon}
        </span>
        <span className={ribbon.btnLargeLabel}>{caption ?? label}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`${ribbon.btnSmall} ${active ? ribbon.btnActive : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
    >
      <span aria-hidden="true">{icon}</span>
      {showLabel && <span className={ribbon.btnSmallLabel}>{caption ?? label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Themed dropdown (replaces native <select> so the menu honours the app
// theme on every OS).  `triggerClassName` lets ribbon groups restyle the
// trigger; it defaults to the original toolbar-button look.
// ---------------------------------------------------------------------------

interface ToolDropdownProps {
  readonly label: string;
  readonly buttonText: string;
  readonly buttonStyle?: React.CSSProperties;
  readonly triggerClassName?: string;
  readonly children: (close: () => void) => ReactNode;
}

export function ToolDropdown({
  label,
  buttonText,
  buttonStyle,
  triggerClassName,
  children,
}: ToolDropdownProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        close();
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open, close]);

  const handleToggle = useCallback(() => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({ left: rect.left, top: rect.bottom + 4 });
    }
    setOpen((v) => !v);
  }, [open]);

  return (
    <span className={styles.dropdownWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? `${styles.toolBtn} ${styles.dropdownTrigger}`}
        onClick={handleToggle}
        title={label}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={buttonStyle}
      >
        <span className={styles.dropdownTriggerText}>{buttonText}</span>
        <ChevronDownIcon width={12} height={12} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.dropdownMenu}
            style={{ position: "fixed", left: menuPos.left, top: menuPos.top, zIndex: 9999 }}
            role="listbox"
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Convenience: a labelled compact dropdown for a ribbon group field. */
interface RibbonSelectProps<T extends string> {
  readonly fieldLabel: string;
  readonly ariaLabel: string;
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly width?: number;
  readonly onPick: (value: T) => void;
}

export function RibbonSelect<T extends string>({
  fieldLabel,
  ariaLabel,
  value,
  options,
  width = 110,
  onPick,
}: RibbonSelectProps<T>) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <label className={ribbon.ribbonField}>
      <span className={ribbon.ribbonFieldLabel}>{fieldLabel}</span>
      <ToolDropdown
        label={ariaLabel}
        buttonText={current?.label ?? ""}
        triggerClassName={`${styles.toolBtn} ${styles.dropdownTrigger} ${ribbon.inlineTrigger}`}
        buttonStyle={{ minWidth: width }}
      >
        {(close) =>
          options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`${styles.dropdownItem} ${opt.value === value ? styles.dropdownItemActive : ""}`}
              onClick={() => {
                onPick(opt.value);
                close();
              }}
            >
              {opt.label}
            </button>
          ))
        }
      </ToolDropdown>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Font-size widget: [-] [number input] [+] [▾ preset dropdown]
// ---------------------------------------------------------------------------

export function FontSizeWidget({ editor }: { readonly editor: Editor }) {
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

  const stepBy = useCallback((delta: number) => apply(currentSizePt + delta), [apply, currentSizePt]);

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

/** Parse the editor's current `textStyle.fontSize` attribute as a numeric
 *  point value.  Accepts `12pt`, `16px` (converted to ~12 pt), or unitless
 *  numbers.  Returns null if the mark is unset. */
export function readFontSizePt(editor: Editor): number | null {
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

export function ColorTrigger({ inputRef, label, current, onColor, onClear, children }: ColorTriggerProps) {
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
          title={`${label} - clear`}
          aria-label={`${label} - clear`}
        >
          <CloseIcon width={14} height={14} />
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Table grid picker (small inline trigger or large ribbon button)
// ---------------------------------------------------------------------------

const TABLE_PICKER_MAX_ROWS = 8;
const TABLE_PICKER_MAX_COLS = 8;

export function TablePickerButton({
  editor,
  large,
}: {
  readonly editor: Editor;
  readonly large?: boolean;
}) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<{ rows: number; cols: number } | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const handleToggle = useCallback(
    () => {
      if (!open && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setMenuPos({ left: rect.left, top: rect.bottom + 4 });
      }
      setOpen((v) => !v);
    },
    [open],
  );

  const insertTable = useCallback(
    (rows: number, cols: number) => {
      editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
      setOpen(false);
      setHovered(null);
    },
    [editor],
  );

  const label = hovered ? `${hovered.cols} × ${hovered.rows}` : t("liveDoc.toolbar.table");

  return (
    <span className={styles.dropdownWrap}>
      {large ? (
        <button
          ref={triggerRef}
          type="button"
          className={`${ribbon.btnLarge} ${open ? ribbon.btnActive : ""}`}
          onClick={handleToggle}
          title={t("liveDoc.toolbar.table")}
          aria-label={t("liveDoc.toolbar.table")}
          aria-haspopup="true"
          aria-expanded={open}
        >
          <span className={ribbon.btnLargeIcon} aria-hidden="true">
            <Grid2x2Icon width={22} height={22} />
          </span>
          <span className={ribbon.btnLargeLabel}>{t("liveDoc.toolbar.table")}</span>
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className={`${styles.toolBtn} ${open ? styles.toolBtnActive : ""}`}
          onClick={handleToggle}
          title={t("liveDoc.toolbar.table")}
          aria-label={t("liveDoc.toolbar.table")}
          aria-haspopup="true"
          aria-expanded={open}
        >
          <Grid2x2Icon width={16} height={16} aria-hidden="true" />
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.tablePickerPopup}
            style={{ position: "fixed", left: menuPos.left, top: menuPos.top, zIndex: 9999 }}
            role="dialog"
            aria-label={t("liveDoc.toolbar.table")}
          >
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
                }),
              )}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
