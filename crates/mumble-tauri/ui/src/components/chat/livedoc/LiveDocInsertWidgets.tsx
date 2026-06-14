/**
 * LiveDocInsertWidgets - the dropdown pickers and action buttons that make up
 * the Word-style "Insert" ribbon tab (shapes, icons, symbols, charts, media,
 * comments, cross-references, ...).
 *
 * Each control renders as a large icon-over-label ribbon button by default,
 * or as a compact small icon+label button when `compact` is set (used by the
 * Text group's stacked secondary column, mirroring Word's layout).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import {
  ActivityIcon,
  CircleIcon,
  FileIcon,
  FileTextIcon,
  HashIcon,
  HistoryIcon,
  Link2Icon,
  MessageCircleIcon,
  PlayIcon,
  PuzzleIcon,
  SearchIcon,
  SeparatorHorizontalIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquareIcon,
} from "../../../icons";
import {
  useLiveDocHeaderFooter,
  setLiveDocHeaderFooter,
  BAND_STYLES,
  PAGE_NUMBER_STYLES,
} from "./useLiveDoc";
import * as AppIcons from "../../../icons";
import { RibbonButton } from "./liveDocRibbonWidgets";
import { SHAPES, shapeDataUrl } from "./liveDocInsertSvg";
import { type LiveDocChartType } from "./liveDocChart";
import { toVideoEmbedUrl } from "./liveDocInsert";
import { signDocument } from "./liveDocSignature";
import { useAppStore } from "../../../store";
import { formatBytes } from "../../../utils/format";
import { useLiveDocReferences } from "./useLiveDocReferences";
import LiveDocReferencePicker from "./LiveDocReferencePicker";
import type { RefTarget } from "./liveDocReferences";
import ribbon from "./LiveDocRibbon.module.css";
import styles from "./LiveDocInsert.module.css";

const insertImage = (editor: Editor, src: string) => editor.chain().focus().setImage({ src }).run();

interface WidgetProps {
  readonly editor: Editor;
  /** Render as a compact small icon+label button instead of a large one. */
  readonly compact?: boolean;
}

// ---------------------------------------------------------------------------
// Icon button (large icon-over-label, or compact) that opens a popup
// ---------------------------------------------------------------------------

interface MenuButtonProps {
  readonly label: string;
  readonly icon: ReactNode;
  readonly compact?: boolean;
  readonly children: (close: () => void) => ReactNode;
  readonly width?: number;
}

function MenuButton({ label, icon, compact, children, width = 240 }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 4 });
    }
    setOpen((v) => !v);
  };

  return (
    <span className={styles.menuWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={`${compact ? ribbon.btnSmall : ribbon.btnLarge} ${open ? ribbon.btnActive : ""}`}
        onClick={toggle}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={compact ? undefined : ribbon.btnLargeIcon} aria-hidden="true">{icon}</span>
        <span className={compact ? ribbon.btnSmallLabel : ribbon.btnLargeLabel}>{label}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.menu}
            style={{ position: "fixed", left: pos.left, top: pos.top, width, zIndex: 9999 }}
            role="dialog"
            aria-label={label}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Pick an icon size matching the button form. */
const sz = (compact?: boolean) => (compact ? 16 : 22);

// ---------------------------------------------------------------------------
// Shapes / Icons (SVG -> image)
// ---------------------------------------------------------------------------

export function ShapesButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  return (
    <MenuButton compact={compact} label={t("liveDoc.insert.shapes", { defaultValue: "Shapes" })} icon={<SquareIcon width={sz(compact)} height={sz(compact)} />}>
      {(close) => (
        <div className={styles.grid}>
          {SHAPES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={styles.gridCell}
              title={s.label}
              aria-label={s.label}
              onClick={() => { insertImage(editor, shapeDataUrl(s.id)); close(); }}
            >
              <img src={shapeDataUrl(s.id)} alt="" width={32} height={32} />
            </button>
          ))}
        </div>
      )}
    </MenuButton>
  );
}

/** Every icon the app exposes (the lucide barrel), as a searchable list. */
type IconComp = ComponentType<{ width?: number; height?: number }>;
const ICON_ENTRIES: ReadonlyArray<{ name: string; label: string; Comp: IconComp }> = Object.entries(AppIcons)
  .filter(([name, value]) => name.endsWith("Icon") && typeof value !== "undefined")
  .map(([name, Comp]) => ({ name, label: name.replace(/Icon$/, ""), Comp: Comp as IconComp }))
  .sort((a, b) => a.label.localeCompare(b.label));

const ICON_RESULT_LIMIT = 160;

/** Serialise a rendered (lucide) `<svg>` to a coloured data-URL image. */
function iconElToDataUrl(svg: SVGElement, color: string): string {
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("stroke", color);
  clone.setAttribute("width", "48");
  clone.setAttribute("height", "48");
  const markup = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, color);
  return `data:image/svg+xml,${encodeURIComponent(markup)}`;
}

export function IconsButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? ICON_ENTRIES.filter((i) => i.label.toLowerCase().includes(q)) : ICON_ENTRIES;
    return list.slice(0, ICON_RESULT_LIMIT);
  }, [query]);

  return (
    <MenuButton compact={compact} label={t("liveDoc.insert.icons", { defaultValue: "Icons" })} icon={<SparklesIcon width={sz(compact)} height={sz(compact)} />} width={312}>
      {(close) => (
        <div className={styles.iconPicker}>
          <div className={styles.searchRow}>
            <SearchIcon width={14} height={14} aria-hidden="true" />
            <input
              className={styles.searchInput}
              value={query}
              autoFocus
              placeholder={t("liveDoc.insert.iconSearch", { defaultValue: "Search icons…" })}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={styles.iconGrid}>
            {results.map(({ name, label, Comp }) => (
              <button
                key={name}
                type="button"
                className={styles.gridCell}
                title={label}
                aria-label={label}
                onClick={(e) => {
                  const svg = e.currentTarget.querySelector("svg");
                  if (svg) insertImage(editor, iconElToDataUrl(svg, "#334155"));
                  close();
                }}
              >
                <Comp width={22} height={22} />
              </button>
            ))}
            {results.length === 0 && (
              <p className={styles.noResults}>{t("liveDoc.insert.iconNoResults", { defaultValue: "No icons found" })}</p>
            )}
          </div>
        </div>
      )}
    </MenuButton>
  );
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

const SYMBOLS = "© ® ™ § ¶ † ‡ • … ° ± × ÷ ≠ ≤ ≥ ≈ ∞ µ π Ω √ ∑ ∫ ∂ € £ ¥ ¢ ½ ¼ ¾ № ← → ↑ ↓ ↔ ⇒ ★ ☆ ♥ ♦ ♣ ♠ ✓ ✗ ☐ ☑".split(" ");

export function SymbolButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  return (
    <MenuButton
      compact={compact}
      label={t("liveDoc.insert.symbol", { defaultValue: "Symbol" })}
      icon={<span style={{ fontSize: compact ? 15 : 20, lineHeight: 1 }}>Ω</span>}
      width={260}
    >
      {(close) => (
        <div className={styles.symbolGrid}>
          {SYMBOLS.map((sym) => (
            <button
              key={sym}
              type="button"
              className={styles.symbolCell}
              onClick={() => { editor.chain().focus().insertContent(sym).run(); close(); }}
            >
              {sym}
            </button>
          ))}
        </div>
      )}
    </MenuButton>
  );
}

// ---------------------------------------------------------------------------
// Date & Time
// ---------------------------------------------------------------------------

function dateFormats(): { label: string; value: string }[] {
  const now = new Date();
  return [
    { label: now.toLocaleDateString(), value: now.toLocaleDateString() },
    { label: now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }), value: now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) },
    { label: now.toLocaleString(), value: now.toLocaleString() },
    { label: now.toLocaleTimeString(), value: now.toLocaleTimeString() },
    { label: now.toISOString().slice(0, 10), value: now.toISOString().slice(0, 10) },
  ];
}

export function DateTimeButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  return (
    <MenuButton compact={compact} label={t("liveDoc.insert.dateTime", { defaultValue: "Date & Time" })} icon={<HistoryIcon width={sz(compact)} height={sz(compact)} />} width={280}>
      {(close) => (
        <div className={styles.list}>
          {dateFormats().map((f) => (
            <button
              key={f.label}
              type="button"
              className={styles.listItem}
              onClick={() => { editor.chain().focus().insertContent(f.value).run(); close(); }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </MenuButton>
  );
}

// ---------------------------------------------------------------------------
// Quick Parts (document fields)
// ---------------------------------------------------------------------------

export function QuickPartsButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  const parts: { label: string; value: string }[] = [
    { label: t("liveDoc.insert.quickParts.author", { defaultValue: "Author" }), value: "[Author]" },
    { label: t("liveDoc.insert.quickParts.title", { defaultValue: "Title" }), value: "[Title]" },
    { label: t("liveDoc.insert.quickParts.subject", { defaultValue: "Subject" }), value: "[Subject]" },
    { label: t("liveDoc.insert.quickParts.company", { defaultValue: "Company" }), value: "[Company]" },
    { label: t("liveDoc.insert.quickParts.date", { defaultValue: "Date" }), value: new Date().toLocaleDateString() },
  ];
  return (
    <MenuButton compact={compact} label={t("liveDoc.insert.quickParts.title2", { defaultValue: "Quick Parts" })} icon={<PuzzleIcon width={sz(compact)} height={sz(compact)} />}>
      {(close) => (
        <div className={styles.list}>
          {parts.map((p) => (
            <button
              key={p.label}
              type="button"
              className={styles.listItem}
              onClick={() => { editor.chain().focus().insertContent(p.value).run(); close(); }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </MenuButton>
  );
}

// ---------------------------------------------------------------------------
// Chart - inserts a live Chart.js node with an editable data grid
// ---------------------------------------------------------------------------

const CHART_TYPES: LiveDocChartType[] = ["bar", "line", "pie", "doughnut"];

export function ChartButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  const insert = (chartType: LiveDocChartType) =>
    editor.chain().focus().insertLiveDocChart({ chartType }).run();
  return (
    <MenuButton compact={compact} label={t("liveDoc.insert.chart", { defaultValue: "Chart" })} icon={<ActivityIcon width={sz(compact)} height={sz(compact)} />} width={220}>
      {(close) => (
        <div className={styles.list}>
          {CHART_TYPES.map((ct) => (
            <button
              key={ct}
              type="button"
              className={styles.listItem}
              onClick={() => { insert(ct); close(); }}
            >
              {t(`liveDoc.insert.chartType.${ct}`, { defaultValue: ct })}
            </button>
          ))}
        </div>
      )}
    </MenuButton>
  );
}

// ---------------------------------------------------------------------------
// Media: Online Video, 3D model, Object
// ---------------------------------------------------------------------------

const VIDEO_FRAMES = ["plain", "rounded", "shadow", "bordered"] as const;

export function OnlineVideoButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  const [url, setUrl] = useState("");
  const [frame, setFrame] = useState<(typeof VIDEO_FRAMES)[number]>("rounded");
  const preview = useMemo(() => toVideoEmbedUrl(url), [url]);
  const label = t("liveDoc.insert.onlineVideo", { defaultValue: "Online Video" });

  return (
    <MenuButton compact={compact} label={label} icon={<PlayIcon width={sz(compact)} height={sz(compact)} />} width={320}>
      {(close) => (
        <div className={styles.form}>
          <label className={styles.formLabel}>
            {t("liveDoc.insert.videoUrl", { defaultValue: "Video URL (YouTube, Vimeo, …)" })}
            <input className={styles.input} value={url} autoFocus placeholder="https://youtu.be/…" onChange={(e) => setUrl(e.target.value)} />
          </label>
          <div className={`${styles.videoPreview} ${styles[`frame_${frame}`] ?? ""}`}>
            {preview ? (
              <iframe src={preview} title="preview" allow="encrypted-media" loading="lazy" />
            ) : (
              <span className={styles.previewEmpty}>{t("liveDoc.insert.videoPreviewEmpty", { defaultValue: "Preview appears here" })}</span>
            )}
          </div>
          <div className={styles.chartTypes}>
            {VIDEO_FRAMES.map((f) => (
              <button key={f} type="button" className={`${styles.chartType} ${frame === f ? styles.chartTypeActive : ""}`} onClick={() => setFrame(f)}>
                {t(`liveDoc.insert.videoFrame.${f}`, { defaultValue: f })}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={!preview}
            onClick={() => {
              if (preview) editor.chain().focus().insertLiveDocEmbed({ kind: "video", src: url, frame }).run();
              close();
            }}
          >
            {t("liveDoc.insert.insert", { defaultValue: "Insert" })}
          </button>
        </div>
      )}
    </MenuButton>
  );
}

/** Read a File as standard (un-prefixed) base64. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

export function Model3DButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const title = t("liveDoc.insert.model3d", { defaultValue: "3D Models" });

  // Upload the model to the file server (session-scoped: only collaborators
  // with document access can fetch it) and embed the resulting signed link;
  // the embed's node view downloads + renders it with three.js.
  const onFile = useCallback(
    async (file: File) => {
      const { fileServerConfig: config, currentChannel: channelId } = useAppStore.getState();
      if (!config || channelId == null) {
        await message(
          t("liveDoc.insert.modelNoServer", { defaultValue: "File sharing is not available on this server." }),
          { title, kind: "warning" },
        );
        return;
      }
      // The cap is whatever the file server advertised (`maxFileSizeBytes`,
      // e.g. 512 MiB) - never a hardcoded client guess.  0/absent means "no
      // advertised limit", so we let the server be the authority.
      const limit = config.maxFileSizeBytes > 0 ? config.maxFileSizeBytes : Infinity;
      if (file.size > limit) {
        await message(
          t("liveDoc.insert.modelTooLarge", {
            defaultValue: "This model is {{size}}, which exceeds the server's upload limit of {{limit}}.",
            size: formatBytes(file.size),
            limit: formatBytes(limit),
          }),
          { title, kind: "warning" },
        );
        return;
      }
      setBusy(true);
      try {
        const contentBase64 = await fileToBase64(file);
        const res = await invoke<{ download_url: string }>("upload_binary", {
          request: {
            baseUrl: config.baseUrl,
            session: config.sessionId,
            uploadToken: config.uploadToken,
            channelId,
            filename: file.name,
            mimeType: file.type || "model/gltf-binary",
            contentBase64,
            mode: "session",
          },
        });
        editor
          .chain()
          .focus()
          .insertLiveDocEmbed({ kind: "model3d", fileName: file.name, title: file.name, src: res.download_url })
          .run();
      } catch (e) {
        await message(`${e instanceof Error ? e.message : String(e)}`, {
          title: t("liveDoc.insert.modelUploadFailed", { defaultValue: "Model upload failed" }),
          kind: "error",
        });
      } finally {
        setBusy(false);
      }
    },
    [editor, t, title],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }}
      />
      <RibbonButton variant={compact ? "small" : "large"} showLabel disabled={busy} label={title} caption={title} icon={<CircleIcon width={sz(compact)} height={sz(compact)} />} onClick={() => inputRef.current?.click()} />
    </>
  );
}

const MAX_EMBED_OBJECT_BYTES = 1_500_000;

export function ObjectButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  const inputRef = useRef<HTMLInputElement>(null);
  const onFile = useCallback(
    (file: File) => {
      const insert = (src: string) =>
        editor.chain().focus().insertLiveDocEmbed({ kind: "object", fileName: file.name, src, title: file.name }).run();
      if (file.size <= MAX_EMBED_OBJECT_BYTES) {
        const reader = new FileReader();
        reader.onload = () => insert(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => insert("");
        reader.readAsDataURL(file);
      } else {
        insert("");
      }
    },
    [editor],
  );
  const label = t("liveDoc.insert.object", { defaultValue: "Object" });
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
      />
      <RibbonButton variant={compact ? "small" : "large"} showLabel label={label} caption={label} icon={<FileIcon width={sz(compact)} height={sz(compact)} />} onClick={() => inputRef.current?.click()} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Comment + Cross-reference
// ---------------------------------------------------------------------------

export function CommentButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  const onClick = useCallback(() => {
    const note = window.prompt(t("liveDoc.insert.commentPrompt", { defaultValue: "Comment" }), "");
    if (note === null) return;
    const { empty } = editor.state.selection;
    if (empty) {
      // Insert as structured content (a marked text node) rather than a raw
      // HTML string, so the note text can't inject markup.
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: t("liveDoc.insert.commentMarker", { defaultValue: "comment" }),
          marks: [{ type: "comment", attrs: { note } }],
        })
        .run();
    } else {
      editor.chain().focus().setComment(note).run();
    }
  }, [editor, t]);
  const label = t("liveDoc.insert.comment", { defaultValue: "Comment" });
  return (
    <RibbonButton variant={compact ? "small" : "large"} showLabel label={label} caption={label} icon={<MessageCircleIcon width={sz(compact)} height={sz(compact)} />} onClick={onClick} />
  );
}

// ---------------------------------------------------------------------------
// Digital signature (eSignature)
// ---------------------------------------------------------------------------

export function DigitalSignatureButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  const users = useAppStore((s) => s.users);
  const ownSession = useAppStore((s) => s.ownSession);
  const certLabel = useAppStore((s) => s.connectedCertLabel);
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(() => {
    const ownName = users.find((u) => u.session === ownSession)?.name;
    const name = ownName || window.prompt(t("liveDoc.insert.signaturePrompt", { defaultValue: "Signer name" }), "") || "";
    if (!name) return;
    setBusy(true);
    // Sign with the user's real Mumble identity (the connected cert, or the
    // default identity when offline).
    void signDocument(editor.getText(), name, certLabel ?? "default")
      .then((sig) => {
        editor
          .chain()
          .focus()
          .insertLiveDocEmbed({
            kind: "signatureDigital",
            name: sig.name,
            fingerprint: sig.fingerprint,
            signedAt: sig.signedAt,
            signature: sig.signature,
            publicKey: sig.publicKey,
            docHash: sig.docHash,
            algorithm: sig.algorithm,
          })
          .run();
      })
      .catch((e) => {
        console.warn("live-doc sign failed:", e);
        window.alert(t("liveDoc.insert.signError", { defaultValue: "Could not sign: no Mumble identity available." }));
      })
      .finally(() => setBusy(false));
  }, [editor, t, users, ownSession, certLabel]);

  const label = t("liveDoc.insert.signatureFields", { defaultValue: "eSignature" });
  return (
    <RibbonButton
      variant={compact ? "small" : "large"}
      showLabel
      label={label}
      caption={label}
      disabled={busy}
      icon={<ShieldCheckIcon width={sz(compact)} height={sz(compact)} />}
      onClick={onClick}
    />
  );
}

export function CrossReferenceButton({ editor, compact }: WidgetProps) {
  const { t } = useTranslation("chat");
  const { targets } = useLiveDocReferences(editor);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const insert = useCallback(
    (target: RefTarget) => { setOpen(false); editor.chain().focus().insertCrossReference(target.id).run(); },
    [editor],
  );
  const toggle = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ left: Math.min(r.left, window.innerWidth - 296), top: r.bottom + 4 });
    }
    setOpen((v) => !v);
  };
  const label = t("liveDoc.references.insertCrossReference", { defaultValue: "Cross-reference" });
  const caption = t("liveDoc.insert.crossRef", { defaultValue: "Cross-ref" });
  return (
    <span className={styles.menuWrap} ref={triggerRef}>
      <RibbonButton variant={compact ? "small" : "large"} showLabel label={label} caption={caption} icon={<Link2Icon width={sz(compact)} height={sz(compact)} />} active={open} onClick={toggle} />
      {open &&
        createPortal(
          <div style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 9999 }}>
            <LiveDocReferencePicker targets={targets} onPick={insert} onClose={() => setOpen(false)} />
          </div>,
          document.body,
        )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Header / Footer / Page Number template dropdowns
// ---------------------------------------------------------------------------

interface DocWidgetProps {
  readonly doc: Y.Doc;
  readonly compact?: boolean;
}

export function HeaderTemplateButton({ doc, compact }: DocWidgetProps) {
  const { t } = useTranslation("chat");
  const hf = useLiveDocHeaderFooter(doc);
  const label = t("liveDoc.insert.header", { defaultValue: "Header" });
  return (
    <MenuButton compact={compact} label={label} icon={<FileTextIcon width={sz(compact)} height={sz(compact)} />} width={220}>
      {(close) => (
        <div className={styles.list}>
          {BAND_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.listItem} ${hf.headerEnabled && hf.headerStyle === s ? styles.listItemActive : ""}`}
              onClick={() => { setLiveDocHeaderFooter(doc, { headerEnabled: true, headerStyle: s }); close(); }}
            >
              {t(`liveDoc.insert.bandStyle.${s}`, { defaultValue: s })}
            </button>
          ))}
          <hr className={styles.listSep} />
          <button type="button" className={styles.listItem} onClick={() => { setLiveDocHeaderFooter(doc, { headerEnabled: false }); close(); }}>
            {t("liveDoc.insert.removeHeader", { defaultValue: "Remove header" })}
          </button>
        </div>
      )}
    </MenuButton>
  );
}

export function FooterTemplateButton({ doc, compact }: DocWidgetProps) {
  const { t } = useTranslation("chat");
  const hf = useLiveDocHeaderFooter(doc);
  const label = t("liveDoc.insert.footer", { defaultValue: "Footer" });
  return (
    <MenuButton compact={compact} label={label} icon={<SeparatorHorizontalIcon width={sz(compact)} height={sz(compact)} />} width={220}>
      {(close) => (
        <div className={styles.list}>
          {BAND_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.listItem} ${hf.footerEnabled && hf.footerStyle === s ? styles.listItemActive : ""}`}
              onClick={() => { setLiveDocHeaderFooter(doc, { footerEnabled: true, footerStyle: s }); close(); }}
            >
              {t(`liveDoc.insert.bandStyle.${s}`, { defaultValue: s })}
            </button>
          ))}
          <hr className={styles.listSep} />
          <button type="button" className={styles.listItem} onClick={() => { setLiveDocHeaderFooter(doc, { footerEnabled: false }); close(); }}>
            {t("liveDoc.insert.removeFooter", { defaultValue: "Remove footer" })}
          </button>
        </div>
      )}
    </MenuButton>
  );
}

export function PageNumberTemplateButton({ doc, compact }: DocWidgetProps) {
  const { t } = useTranslation("chat");
  const hf = useLiveDocHeaderFooter(doc);
  const label = t("liveDoc.insert.pageNumber", { defaultValue: "Page Number" });
  return (
    <MenuButton compact={compact} label={label} icon={<HashIcon width={sz(compact)} height={sz(compact)} />} width={220}>
      {(close) => (
        <div className={styles.list}>
          {PAGE_NUMBER_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.listItem} ${hf.showPageNumber && hf.pageNumberStyle === s ? styles.listItemActive : ""}`}
              onClick={() => { setLiveDocHeaderFooter(doc, { showPageNumber: true, pageNumberStyle: s }); close(); }}
            >
              {t(`liveDoc.insert.pageNumberStyle.${s}`, { defaultValue: s })}
            </button>
          ))}
          <hr className={styles.listSep} />
          <button type="button" className={styles.listItem} onClick={() => { setLiveDocHeaderFooter(doc, { showPageNumber: false }); close(); }}>
            {t("liveDoc.insert.pageNumberNone", { defaultValue: "No page number" })}
          </button>
        </div>
      )}
    </MenuButton>
  );
}
