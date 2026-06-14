/**
 * LiveDocMarkdownView - a live source view that shows the current document
 * as (Pandoc-flavored) Markdown and lets the user edit it directly.
 *
 *  - Syntax highlighting: a transparent textarea sits over a highlight.js
 *    overlay (the same technique as the chat `MarkdownInput`), so the raw
 *    markdown is coloured while remaining fully editable.
 *  - Live two-way sync: edits are debounced back into the document, and
 *    external/remote changes to the document flow back into the view -
 *    the two stay in sync without a manual "apply" step.
 *  - Readability: large base64 image payloads are collapsed to a short
 *    token (`⟦image#1 · 12 KB⟧`); the real bytes are restored losslessly
 *    before the markdown is applied back to the document.
 *
 * Because applying replaces the whole document, concurrent edits to the
 * rich view while you have *unapplied* markdown edits are resolved in favour
 * of the markdown text; when you have no pending edits, remote changes are
 * reflected live (and "Reload" forces a refresh from the document).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";
import { ySyncPluginKey, relativePositionToAbsolutePosition } from "@tiptap/y-tiptap";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import { editorHtmlToMarkdown, markdownToEditorHtml, stripBlockSentinels } from "./liveDocMarkdown";
import { abbreviateBase64, expandBase64 } from "./liveDocMarkdownImages";
import { serializeFrontMatter, parseFrontMatter, type LiveDocLayoutMeta } from "./liveDocFrontMatter";
import {
  useLiveDocHeaderFooter,
  setLiveDocHeaderFooter,
  useLiveDocPageSetup,
  setLiveDocPageSetup,
  useLiveDocDecoration,
  setLiveDocDecoration,
} from "./useLiveDoc";

/** Awareness type the WebSocket provider exposes (y-protocols). */
type DocAwareness = WebsocketProvider["awareness"];

/** A remote collaborator's live editing position. */
interface RemotePresence {
  readonly session: number;
  readonly name: string;
  readonly color: string;
  /** Caret offset in the markdown source when they are *also* in the markdown
   *  view (both views derive identical markdown from the shared doc, so the
   *  offset is directly comparable).  null = they are in the rendered view. */
  readonly mdHead: number | null;
  /** Top-level block index their rendered-view caret sits in, mapped to a
   *  markdown caret via the block sentinels.  null = couldn't resolve. */
  readonly blockIndex: number | null;
  /** Nearest heading at/above their caret - the fallback "where" shown as a
   *  toolbar chip when no caret offset can be resolved. */
  readonly section: string | null;
}

/** The top-level block index containing document position `pos`. */
function blockIndexForPos(editor: Editor, pos: number): number | null {
  const { doc } = editor.state;
  if (doc.childCount === 0) return null;
  const clamped = Math.min(Math.max(pos, 0), doc.content.size);
  const idx = doc.resolve(clamped).index(0);
  return Math.max(0, Math.min(doc.childCount - 1, idx));
}

/** The nearest heading at or above document position `pos`. */
function sectionForPos(editor: Editor, pos: number): string | null {
  const { doc } = editor.state;
  if (doc.childCount === 0) return null;
  const clamped = Math.min(Math.max(pos, 0), doc.content.size);
  const $pos = doc.resolve(clamped);
  const topIndex = $pos.depth >= 1 ? $pos.index(0) : doc.childCount - 1;
  for (let i = Math.min(topIndex, doc.childCount - 1); i >= 0; i--) {
    const node = doc.child(i);
    if (node.type.name === "heading") {
      const text = node.textContent.trim();
      if (text) return text;
    }
  }
  return null;
}

interface YSyncState {
  readonly doc: Y.Doc;
  readonly type: Y.XmlFragment;
  readonly binding: { readonly mapping: unknown } | null;
}

/** Read every *remote* collaborator's awareness state and resolve their caret
 *  to a section.  Markdown is a lossy reserialization, so we report the section
 *  (not an exact character offset); the decode is best-effort and degrades to
 *  name-only when a position can't be resolved. */
function computeRemotePresences(editor: Editor, awareness: DocAwareness | null): RemotePresence[] {
  if (!awareness) return [];
  const ysync = ySyncPluginKey.getState(editor.state) as YSyncState | undefined;
  const localId = awareness.clientID;
  const seen = new Set<number>();
  const out: RemotePresence[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === localId) return;
    const s = state as {
      user?: { name?: string; color?: string; session?: number };
      cursor?: { head?: unknown } | null;
      mdCursor?: { head?: unknown } | null;
    };
    const user = s.user;
    if (!user || typeof user.session !== "number" || seen.has(user.session)) return;
    seen.add(user.session);

    // They are in the markdown view too: their caret offset is directly usable.
    const mdHead = typeof s.mdCursor?.head === "number" ? s.mdCursor.head : null;

    let blockIndex: number | null = null;
    let section: string | null = null;
    if (mdHead === null) {
      try {
        if (s.cursor?.head && ysync?.binding) {
          const abs = relativePositionToAbsolutePosition(
            ysync.doc,
            ysync.type,
            Y.createRelativePositionFromJSON(s.cursor.head),
            ysync.binding.mapping as Parameters<typeof relativePositionToAbsolutePosition>[3],
          );
          if (typeof abs === "number") {
            blockIndex = blockIndexForPos(editor, abs);
            section = sectionForPos(editor, abs);
          }
        }
      } catch {
        /* position decode is best-effort */
      }
    }
    out.push({
      session: user.session,
      name: user.name ?? "",
      color: user.color ?? "#999",
      mdHead,
      blockIndex,
      section,
    });
  });
  return out;
}

function samePresences(a: readonly RemotePresence[], b: readonly RemotePresence[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.session !== y.session ||
      x.name !== y.name ||
      x.color !== y.color ||
      x.mdHead !== y.mdHead ||
      x.blockIndex !== y.blockIndex ||
      x.section !== y.section
    ) {
      return false;
    }
  }
  return true;
}
import { parseMentionTrigger, type MentionTrigger } from "../../../utils/mentions";
import MentionAutocomplete, {
  type MentionCandidate,
  handleMentionKey,
  candidateInsertText,
} from "../mention/MentionAutocomplete";
import { useMentionCandidates } from "../mention/useMentionCandidates";
import { flattenHljs, type HljsToken } from "../markdown/hljsTokens";
import { useAppStore } from "../../../store";
import styles from "./LiveDocMarkdownView.module.css";

/** How long to wait after the last keystroke before pushing to the doc. */
const APPLY_DEBOUNCE_MS = 350;

const MENTION_POPUP_WIDTH = 260;
const MENTION_POPUP_MARGIN = 12;

/** Auto-detect a fenced code block's language (matching the lowlight
 *  highlighting used in the rendered view) so an "auto-detect" block shows
 *  ` ```lang ` in the markdown source.  Only confident matches win, so a
 *  couple of stray words don't get mislabelled. */
function detectCodeLanguage(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length < 3) return null;
  try {
    const result = hljs.highlightAuto(trimmed);
    if (result.language && (result.relevance ?? 0) >= 5) return result.language;
  } catch {
    /* detection is best-effort */
  }
  return null;
}

/** Pixel rect of the caret at character `offset`, measured from the
 *  highlight overlay (which mirrors the textarea's exact layout).  Used to
 *  anchor the mention popup. */
function caretRectFromOverlay(overlay: HTMLElement, offset: number): DOMRect | null {
  const walker = document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  let lastText: Text | null = null;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const rects = range.getClientRects();
      return rects.length ? rects[0] : range.getBoundingClientRect();
    }
    remaining -= len;
    lastText = node as Text;
    node = walker.nextNode();
  }
  if (lastText) {
    const range = document.createRange();
    range.setStart(lastText, lastText.textContent?.length ?? 0);
    range.collapse(true);
    return range.getBoundingClientRect();
  }
  return null;
}

type ChipKind = "user" | "role" | "everyone" | "here" | "image";

interface OverlayChip {
  readonly start: number;
  readonly end: number;
  readonly kind: ChipKind;
  /** What the overlay shows for this token (`@RealName`, `@role`, `⟦image⟧`…). */
  readonly display: string;
}

/** Mention markers + collapsed image tokens in the markdown source.  The
 *  textarea keeps the raw text (`<@123>`); the overlay renders these as the
 *  friendly `@USERNAME` chips the rendered view shows. */
function findChips(
  text: string,
  resolveName: (session: number) => string | undefined,
): OverlayChip[] {
  const chips: OverlayChip[] = [];
  const re = /⟦[^⟧]*⟧|<@(\d+)>|<@&([^>\s]+)>|@(everyone|here)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = re.lastIndex;
    if (m[0].startsWith("⟦")) {
      chips.push({ start, end, kind: "image", display: m[0] });
    } else if (m[1] !== undefined) {
      chips.push({ start, end, kind: "user", display: `@${resolveName(Number(m[1])) ?? `user-${m[1]}`}` });
    } else if (m[2] !== undefined) {
      chips.push({ start, end, kind: "role", display: `@${m[2]}` });
    } else {
      // @everyone / @here are mentions only at line start or after
      // whitespace, so `foo@here` stays plain text.
      const prev = start > 0 ? text[start - 1] : "";
      if (prev && !/\s/.test(prev)) continue;
      chips.push({ start, end, kind: m[3] === "everyone" ? "everyone" : "here", display: m[0] });
    }
  }
  return chips;
}

/** Map a caret offset in the raw source to the matching offset in the
 *  rendered overlay text (whose chips display different-length labels), so
 *  the mention popup can be anchored correctly. */
function sourceToOverlayOffset(chips: readonly OverlayChip[], pos: number): number {
  let delta = 0;
  for (const c of chips) {
    if (c.end <= pos) delta += c.display.length - (c.end - c.start);
    else break;
  }
  return pos + delta;
}

interface OverlaySelection {
  /** Collapsed caret position, or -1 when a range is selected / hidden. */
  readonly caret: number;
  readonly selFrom: number;
  readonly selTo: number;
  readonly showCaret: boolean;
}

function chipClassName(kind: ChipKind): string {
  return kind === "image" ? "ld-md-imgchip" : styles.mdMention;
}

/** A remote collaborator's caret to draw inline in the overlay. */
interface RemoteCaret {
  readonly offset: number;
  readonly color: string;
  readonly name: string;
}

/** Render the highlighted markdown source as React nodes, splicing in
 *  mention / image chips, a custom caret, and a custom selection highlight.
 *  The textarea's own caret + selection are hidden (CSS) because the chips
 *  change glyph widths, so the native ones would drift out of alignment. */
function buildOverlayNodes(
  text: string,
  tokens: readonly HljsToken[],
  chips: readonly OverlayChip[],
  sel: OverlaySelection,
  remoteCarets: readonly RemoteCaret[],
  pageAnchorOffsets: readonly number[],
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;

  const tokenStart: number[] = [];
  let p = 0;
  for (const tk of tokens) {
    tokenStart.push(p);
    p += tk.text.length;
  }
  let ti = 0;
  const clsAt = (pos: number): string => {
    while (ti + 1 < tokens.length && tokenStart[ti + 1] <= pos) ti++;
    while (ti > 0 && tokenStart[ti] > pos) ti--;
    return tokens[ti]?.cls ?? "";
  };

  const { caret, selFrom, selTo, showCaret } = sel;
  const hasSel = selFrom >= 0 && selTo > selFrom;
  const drawCaret = showCaret && !hasSel && caret >= 0;
  const caretNode = () => <span key={`caret${key++}`} className={styles.caret} aria-hidden="true" />;
  const remoteCaretNode = (rc: RemoteCaret) => (
    <span key={`rc${key++}`} className={styles.remoteCaret} style={{ backgroundColor: rc.color }} aria-hidden="true">
      <span className={styles.remoteCaretFlag} style={{ backgroundColor: rc.color }}>
        {rc.name}
      </span>
    </span>
  );
  const pageAnchorNode = () => (
    <span key={`pa${key++}`} className={styles.pageAnchor} data-md-page-anchor="" aria-hidden="true" />
  );
  const emitAt = (pos: number) => {
    for (const rc of remoteCarets) if (rc.offset === pos) nodes.push(remoteCaretNode(rc));
    for (const off of pageAnchorOffsets) if (off === pos) nodes.push(pageAnchorNode());
  };

  const bounds = new Set<number>([0, text.length]);
  for (const s of tokenStart) bounds.add(s);
  for (const c of chips) {
    bounds.add(c.start);
    bounds.add(c.end);
  }
  for (const rc of remoteCarets) bounds.add(rc.offset);
  for (const off of pageAnchorOffsets) bounds.add(off);
  if (drawCaret) bounds.add(caret);
  if (hasSel) {
    bounds.add(selFrom);
    bounds.add(selTo);
  }
  const ordered = [...bounds].filter((b) => b >= 0 && b <= text.length).sort((a, b) => a - b);
  const chipByStart = new Map(chips.map((c) => [c.start, c]));

  let caretDone = !drawCaret;
  let bi = 0;
  while (bi < ordered.length - 1) {
    const from = ordered[bi];
    if (!caretDone && from === caret) {
      nodes.push(caretNode());
      caretDone = true;
    }
    emitAt(from);
    const chip = chipByStart.get(from);
    if (chip) {
      const inSel = hasSel && from < selTo && chip.end > selFrom;
      nodes.push(
        <span key={`chip${key++}`} className={`${chipClassName(chip.kind)}${inSel ? ` ${styles.selection}` : ""}`}>
          {chip.display}
        </span>,
      );
      // A caret that fell inside the chip snaps to its trailing edge.
      if (!caretDone && caret > chip.start && caret <= chip.end) {
        nodes.push(caretNode());
        caretDone = true;
      }
      while (bi < ordered.length && ordered[bi] < chip.end) bi++;
      continue;
    }
    const to = ordered[bi + 1];
    const slice = text.slice(from, to);
    if (slice) {
      const inSel = hasSel && from >= selFrom && to <= selTo;
      const cls = [clsAt(from), inSel ? styles.selection : ""].filter(Boolean).join(" ");
      nodes.push(
        <span key={`t${key++}`} className={cls || undefined}>
          {slice}
        </span>,
      );
    }
    bi++;
  }
  if (!caretDone) nodes.push(caretNode());
  // Remote carets / page anchors sitting at the very end of the document.
  emitAt(text.length);
  // Keep the trailing empty line visible when the source ends with a newline.
  if (text.endsWith("\n")) nodes.push(<span key="trail"> </span>);
  return nodes;
}

/** Collapsed image tokens (`⟦…⟧`) are treated as atomic: locate their
 *  ranges so edits can never land inside one. */
function tokenRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /⟦[^⟧]*⟧/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push([m.index, m.index + m[0].length]);
  return out;
}

interface LiveDocMarkdownViewProps {
  readonly editor: Editor;
  /** Shared document, used to read/write the header/footer/page-number
   *  settings as a Pandoc YAML metadata block at the top of the source. */
  readonly doc: Y.Doc;
  /** Collaboration awareness, used to show where other people are editing. */
  readonly awareness?: DocAwareness | null;
  /** Receives the scrolling viewport so a parent can sync it with the
   *  rendered view in split mode. */
  readonly scrollRef?: Ref<HTMLDivElement>;
  /** Top-level block indices that start each page (page 0 excluded).  An
   *  invisible marker is dropped at each so the parent can align the two panes
   *  per page when scrolling. */
  readonly pageAnchors?: ReadonlyArray<number>;
  readonly readOnly?: boolean;
  /** Whether the rendered document is currently shown alongside (split
   *  view).  When `onToggleSplit` is provided, a toggle button appears in
   *  the toolbar so the user can switch between full-width markdown and the
   *  side-by-side layout. */
  readonly splitView?: boolean;
  readonly onToggleSplit?: () => void;
}

export default function LiveDocMarkdownView({
  editor,
  doc,
  awareness = null,
  scrollRef,
  pageAnchors,
  readOnly = false,
  splitView = false,
  onToggleSplit,
}: LiveDocMarkdownViewProps) {
  const { t } = useTranslation("chat");

  // Live presence: where each other collaborator is currently editing, so the
  // markdown view shows the same "who's-editing" awareness as the rendered one.
  const [presences, setPresences] = useState<RemotePresence[]>([]);
  useEffect(() => {
    if (!awareness) {
      setPresences([]);
      return;
    }
    const recompute = () => {
      const next = computeRemotePresences(editor, awareness);
      setPresences((prev) => (samePresences(prev, next) ? prev : next));
    };
    recompute();
    awareness.on("change", recompute);
    editor.on("update", recompute);
    return () => {
      awareness.off("change", recompute);
      editor.off("update", recompute);
    };
  }, [editor, awareness]);

  // Header/footer/page-number settings *and* the page layout (geometry +
  // decoration) are surfaced as a YAML front-matter block.  Keep them in refs
  // so `readDisplay` stays stable (it must not re-create on every meta
  // keystroke); a dedicated effect refreshes the view when they change
  // externally.
  const headerFooter = useLiveDocHeaderFooter(doc);
  const headerFooterRef = useRef(headerFooter);
  headerFooterRef.current = headerFooter;
  const pageSetup = useLiveDocPageSetup(doc);
  const pageSetupRef = useRef(pageSetup);
  pageSetupRef.current = pageSetup;
  const decoration = useLiveDocDecoration(doc);
  const decorationRef = useRef(decoration);
  decorationRef.current = decoration;
  /** The current layout block (geometry + decoration) for the front matter. */
  const layoutMeta = useCallback(
    (): LiveDocLayoutMeta => ({ pageSetup: pageSetupRef.current, decoration: decorationRef.current }),
    [],
  );

  // Resolve a session id to its display name for mention chips (shown in
  // this view's overlay and stamped onto the chips applied to the document).
  const users = useAppStore((s) => s.users);
  const resolveName = useCallback(
    (session: number) => users.find((u) => u.session === session)?.name,
    [users],
  );
  // Stable ref so `applyToDoc` doesn't churn (and prematurely flush) every
  // time the user list changes.
  const resolveNameRef = useRef(resolveName);
  resolveNameRef.current = resolveName;

  /** Read the document as collapsed markdown; refresh the payload map and the
   *  block-offset table used to place remote (rendered-view) carets. */
  const mapRef = useRef<Map<string, string>>(new Map());
  const blockStartsRef = useRef<number[]>([]);
  const readDisplay = useCallback((): string => {
    try {
      const { text, map } = abbreviateBase64(
        editorHtmlToMarkdown(editor.getHTML(), { detectLanguage: detectCodeLanguage, markBlocks: true }),
      );
      mapRef.current = map;
      const withFront = serializeFrontMatter(headerFooterRef.current, layoutMeta()) + text;
      const stripped = stripBlockSentinels(withFront);
      blockStartsRef.current = stripped.blockStarts;
      return stripped.text;
    } catch (e) {
      console.warn("[liveDocMarkdown] serialise failed:", e);
      blockStartsRef.current = [];
      return "";
    }
  }, [editor, layoutMeta]);

  /** A collaborator's caret offset in the markdown source: their own offset
   *  when they're in the markdown view, else their rendered-view block mapped
   *  through the block-offset table.  null = can't place a caret (toolbar
   *  chip instead). */
  const caretOffsetOf = useCallback((p: RemotePresence): number | null => {
    if (p.mdHead !== null) return p.mdHead;
    if (p.blockIndex !== null) {
      const start = blockStartsRef.current[p.blockIndex];
      if (typeof start === "number") return start;
    }
    return null;
  }, []);

  const [text, setText] = useState(readDisplay);
  const [editing, setEditing] = useState(false);

  // Custom caret / selection (the native ones are hidden because mention
  // chips change glyph widths - see the overlay renderer).
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [sel, setSel] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

  // Publish our caret in the markdown source so collaborators who are *also* in
  // the markdown view see it exactly; clear it when we blur / leave so they
  // fall back to the rendered-view section indicator.
  useEffect(() => {
    if (!awareness) return;
    awareness.setLocalStateField("mdCursor", focused ? { anchor: sel.start, head: sel.end } : null);
  }, [awareness, focused, sel.start, sel.end]);
  useEffect(() => () => awareness?.setLocalStateField("mdCursor", null), [awareness]);

  // @-mention autocomplete: the same picker the rendered view shows, but
  // inserting the wire markers (`<@SESSION>` / `<@&ROLE>`) the markdown
  // source speaks.
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionRect, setMentionRect] = useState<{ left: number; bottom: number } | null>(null);
  const mentionCandidates = useMentionCandidates(
    mentionTrigger?.kind ?? null,
    mentionTrigger?.query ?? "",
  );

  // Refs so event handlers / cleanup see the latest values without
  // re-binding (which would thrash the editor `update` subscription).
  const textRef = useRef(text);
  const dirtyRef = useRef(false);
  const applyingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  textRef.current = text;

  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);

  // The scrolling viewport.  We keep our own handle (to preserve the scroll
  // position across the textarea auto-grow below) while still forwarding the
  // node to the parent's `scrollRef` for the split-view lock-step sync.
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const setScrollEl = useCallback(
    (el: HTMLDivElement | null) => {
      scrollElRef.current = el;
      if (typeof scrollRef === "function") scrollRef(el);
      else if (scrollRef) (scrollRef as { current: HTMLDivElement | null }).current = el;
    },
    [scrollRef],
  );

  // The textarea's `select` event only fires once the selection settles, so the
  // overlay highlight would lag behind a drag.  Mirror the selection on every
  // document `selectionchange` (which fires continuously while dragging) so the
  // custom highlight tracks the selection live, like a native one.
  useEffect(() => {
    const onSelectionChange = () => {
      const ta = taRef.current;
      if (!ta || document.activeElement !== ta) return;
      setSel((prev) =>
        prev.start === ta.selectionStart && prev.end === ta.selectionEnd
          ? prev
          : { start: ta.selectionStart, end: ta.selectionEnd },
      );
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  /** Expand the collapsed base64 and replace the document content. */
  const applyToDoc = useCallback(
    (display: string) => {
      if (editor.isDestroyed || readOnly) return;
      // Pull the YAML metadata block off the top into the shared settings; the
      // rest is the document body.  Only write when the metadata actually
      // changed, so editing the body doesn't churn the shared settings.
      const { patch, pageSetup: psPatch, decoration: decoPatch, body } = parseFrontMatter(display);
      if (patch || psPatch || decoPatch) {
        const curHf = headerFooterRef.current;
        const curPs = pageSetupRef.current;
        const curDeco = decorationRef.current;
        const mergedHf = { ...curHf, ...(patch ?? {}) };
        const mergedPs = { ...curPs, ...(psPatch ?? {}) };
        const mergedDeco = { ...curDeco, ...(decoPatch ?? {}) };
        const before = serializeFrontMatter(curHf, { pageSetup: curPs, decoration: curDeco });
        const after = serializeFrontMatter(mergedHf, { pageSetup: mergedPs, decoration: mergedDeco });
        if (after !== before) {
          if (patch) setLiveDocHeaderFooter(doc, patch);
          if (psPatch) setLiveDocPageSetup(doc, psPatch);
          if (decoPatch) setLiveDocDecoration(doc, decoPatch);
        }
      }
      const full = expandBase64(body, mapRef.current);
      applyingRef.current = true;
      try {
        editor.commands.setContent(
          markdownToEditorHtml(full, { resolveMention: resolveNameRef.current }),
        );
      } finally {
        applyingRef.current = false;
      }
      dirtyRef.current = false;
      setEditing(false);
    },
    [editor, readOnly, doc],
  );

  /** Pull the latest document content into the view (discards pending edits). */
  const reload = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    dirtyRef.current = false;
    setEditing(false);
    setText(readDisplay());
  }, [readDisplay]);

  // Live: reflect external/remote document changes back into the view when
  // there are no unapplied local edits (otherwise the local edits win and
  // are flushed to the doc by the debounce below).
  useEffect(() => {
    const onDocChange = () => {
      if (applyingRef.current || dirtyRef.current) return;
      const next = readDisplay();
      if (next !== textRef.current) setText(next);
    };
    editor.on("update", onDocChange);
    editor.on("create", onDocChange);
    return () => {
      editor.off("update", onDocChange);
      editor.off("create", onDocChange);
    };
  }, [editor, readDisplay]);

  // Reflect external layout changes - header/footer/page-number *and* page
  // geometry / decoration (e.g. toggled from the ribbon) - into the
  // front-matter block when no local edits are pending.
  useEffect(() => {
    if (applyingRef.current || dirtyRef.current) return;
    const next = readDisplay();
    if (next !== textRef.current) setText(next);
  }, [headerFooter, pageSetup, decoration, readDisplay]);

  // Flush pending edits to the document when leaving the markdown view.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (dirtyRef.current && !readOnly) applyToDoc(textRef.current);
    };
  }, [applyToDoc, readOnly]);

  const onChange = useCallback(
    (value: string, caret?: number) => {
      setText(value);
      dirtyRef.current = true;
      setEditing(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => applyToDoc(value), APPLY_DEBOUNCE_MS);
      if (caret !== undefined) {
        requestAnimationFrame(() => {
          const ta = taRef.current;
          if (ta) {
            ta.selectionStart = ta.selectionEnd = caret;
            setSel({ start: caret, end: caret });
          }
        });
      }
    },
    [applyToDoc],
  );

  // Recompute the active `@`-mention trigger (and popup anchor) for the
  // current caret.  Called on every edit / caret move.
  const refreshMention = useCallback(
    (value: string, selStart: number, selEnd: number) => {
      if (readOnly || selStart !== selEnd) {
        setMentionTrigger(null);
        setMentionRect(null);
        return;
      }
      const next = parseMentionTrigger(value, selStart);
      setMentionTrigger((prev) =>
        prev?.anchor === next?.anchor && prev?.query === next?.query && prev?.kind === next?.kind
          ? prev
          : next,
      );
      if (!next) {
        setMentionRect(null);
        return;
      }
      setMentionIndex(0);
      // The overlay only reflects the new text after the next paint, so
      // measure the caret there once it has caught up.  Chips render shorter
      // / longer than their raw markers, so map the source offset across.
      requestAnimationFrame(() => {
        const overlay = overlayRef.current;
        const ta = taRef.current;
        if (!overlay || !ta) return;
        const overlayOffset = sourceToOverlayOffset(findChips(value, resolveName), selStart);
        const rect = caretRectFromOverlay(overlay, overlayOffset);
        if (rect) {
          setMentionRect({ left: rect.left, bottom: rect.bottom });
        } else {
          const box = ta.getBoundingClientRect();
          setMentionRect({ left: box.left + 8, bottom: box.top + 24 });
        }
      });
    },
    [readOnly, resolveName],
  );

  const closeMention = useCallback(() => {
    setMentionTrigger(null);
    setMentionRect(null);
  }, []);

  const insertMention = useCallback(
    (c: MentionCandidate) => {
      const trig = mentionTrigger;
      if (!trig) return;
      const replacement = candidateInsertText(c);
      const queryLen = trig.kind === "role" ? trig.query.length + 2 : trig.query.length + 1;
      const end = trig.anchor + queryLen;
      const value = textRef.current;
      const insert = `${replacement} `;
      const newText = value.slice(0, trig.anchor) + insert + value.slice(end);
      closeMention();
      onChange(newText, trig.anchor + insert.length);
      requestAnimationFrame(() => taRef.current?.focus());
    },
    [mentionTrigger, onChange, closeMention],
  );

  // Keep the highlighted candidate in range as the list filters.
  useEffect(() => {
    if (mentionIndex >= mentionCandidates.length) setMentionIndex(0);
  }, [mentionCandidates.length, mentionIndex]);

  // Treat collapsed image chips as atomic: block edits that would land
  // *inside* a `⟦…⟧` token, and delete the whole token at once when a
  // backspace/delete touches it.  Uses the native `beforeinput` event so we
  // see the precise `inputType` and can pre-empt it.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const handler = (e: InputEvent) => {
      const value = textRef.current;
      const ranges = tokenRanges(value);
      if (ranges.length === 0) return;
      const selStart = ta.selectionStart ?? 0;
      const selEnd = ta.selectionEnd ?? 0;
      const type = e.inputType;

      if (type.startsWith("delete")) {
        let from = selStart;
        let to = selEnd;
        if (selStart === selEnd) {
          if (type.toLowerCase().includes("backward")) from = selStart - 1;
          else to = selEnd + 1;
        }
        let hit = false;
        for (const [rf, rt] of ranges) {
          if (from < rt && to > rf) {
            from = Math.min(from, rf);
            to = Math.max(to, rt);
            hit = true;
          }
        }
        if (hit) {
          e.preventDefault();
          onChange(value.slice(0, Math.max(0, from)) + value.slice(to), Math.max(0, from));
        }
        return;
      }

      // Insertion / replacement: block if it would split a token (caret
      // strictly inside one, or a selection partially overlapping one).
      for (const [rf, rt] of ranges) {
        const overlaps = selStart < rt && selEnd > rf;
        const fullyCovers = selStart <= rf && selEnd >= rt;
        const caretInside = selStart > rf && selStart < rt;
        if ((overlaps && !fullyCovers) || caretInside) {
          e.preventDefault();
          return;
        }
      }
    };
    ta.addEventListener("beforeinput", handler);
    return () => ta.removeEventListener("beforeinput", handler);
  }, [onChange]);

  // Render the (collapsed) markdown source as highlighted React nodes with
  // mention / image chips, a custom caret, and a custom selection.
  const overlayNodes = useMemo(() => {
    let tokens: HljsToken[];
    try {
      tokens = flattenHljs(hljs.highlight(text, { language: "markdown", ignoreIllegals: true }).value);
    } catch {
      tokens = [{ text, cls: "" }];
    }
    const chips = findChips(text, resolveName);
    const collapsed = sel.start === sel.end;
    // Carets of every collaborator we can place: markdown-view users at their
    // exact offset, rendered-view users at their block's start (clamped in case
    // their source is briefly ahead of ours during a sync).
    const remoteCarets: RemoteCaret[] = [];
    for (const p of presences) {
      const off = caretOffsetOf(p);
      if (off !== null) {
        remoteCarets.push({ offset: Math.min(Math.max(off, 0), text.length), color: p.color, name: p.name });
      }
    }
    // Invisible per-page anchors at each page-start block's offset.
    const pageAnchorOffsets: number[] = [];
    for (const blockIndex of pageAnchors ?? []) {
      const off = blockStartsRef.current[blockIndex];
      if (typeof off === "number") pageAnchorOffsets.push(Math.min(Math.max(off, 0), text.length));
    }
    return buildOverlayNodes(
      text,
      tokens,
      chips,
      {
        caret: collapsed ? sel.start : -1,
        selFrom: collapsed ? -1 : Math.min(sel.start, sel.end),
        selTo: collapsed ? -1 : Math.max(sel.start, sel.end),
        showCaret: focused && !composing,
      },
      remoteCarets,
      pageAnchorOffsets,
    );
  }, [text, sel, focused, composing, resolveName, presences, caretOffsetOf, pageAnchors]);

  // Auto-grow the textarea to fit content (CSS keeps a one-page minimum);
  // the absolutely-positioned overlay tracks the box automatically.  Resetting
  // the height to "auto" momentarily collapses the box, which would clamp (and
  // so reset) the viewport's scrollTop - and in split view the lock-step sync
  // would then yank the rendered pane to the top.  Preserve scrollTop across
  // the remeasure so a doc edit (e.g. resizing an image) never scrolls us away.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const scroll = scrollElRef.current;
    const prevTop = scroll?.scrollTop ?? 0;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
    if (scroll && scroll.scrollTop !== prevTop) scroll.scrollTop = prevTop;
  }, [text]);

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <span className={styles.label}>{t("liveDoc.markdown.title", { defaultValue: "Markdown" })}</span>
        <span className={styles.flavor}>{t("liveDoc.markdown.flavor", { defaultValue: "Pandoc-flavored" })}</span>
        <span className={styles.status}>
          <span className={`${styles.dot} ${editing ? styles.dotEditing : ""}`} />
          {editing
            ? t("liveDoc.markdown.syncing", { defaultValue: "syncing…" })
            : t("liveDoc.markdown.synced", { defaultValue: "in sync" })}
        </span>
        {/* Collaborators whose caret we can place get an inline marker in the
            overlay; only those we couldn't resolve at all fall back to a
            section chip here. */}
        {presences.some((p) => caretOffsetOf(p) === null) && (
          <span className={styles.presence}>
            {presences
              .filter((p) => caretOffsetOf(p) === null)
              .map((p) => (
                <span
                  key={p.session}
                  className={styles.presenceChip}
                  style={{ borderColor: p.color }}
                  title={
                    p.section
                      ? `${p.name} - ${t("liveDoc.markdown.editingIn", { defaultValue: "editing in" })} “${p.section}”`
                      : `${p.name} - ${t("liveDoc.markdown.editing", { defaultValue: "editing" })}`
                  }
                >
                  <span className={styles.presenceDot} style={{ background: p.color }} aria-hidden="true" />
                  <span className={styles.presenceName}>{p.name}</span>
                  {p.section && <span className={styles.presenceWhere}>· {p.section}</span>}
                </span>
              ))}
          </span>
        )}
        <span className={styles.spacer} />
        {onToggleSplit && (
          <button
            type="button"
            className={`${styles.btn} ${splitView ? styles.btnActive : ""}`}
            onClick={onToggleSplit}
            aria-pressed={splitView}
            title={t("liveDoc.markdown.sideBySideHint", {
              defaultValue: "Show the rendered document alongside the markdown",
            })}
          >
            {t("liveDoc.markdown.sideBySide", { defaultValue: "Side by side" })}
          </button>
        )}
        <button type="button" className={styles.btn} onClick={reload}>
          {t("liveDoc.markdown.reload", { defaultValue: "Reload from document" })}
        </button>
      </div>

      <div className={styles.scroll} ref={setScrollEl}>
        <div
          className={styles.editorBox}
          onMouseDown={(e) => {
            // Clicking the empty pane below the text focuses the editor.
            if (e.target === e.currentTarget) taRef.current?.focus();
          }}
        >
          <pre ref={overlayRef} className={`${styles.overlay} hljs`} aria-hidden="true">
            {overlayNodes}
          </pre>
          <textarea
            ref={taRef}
            className={styles.textarea}
            value={text}
          readOnly={readOnly}
          spellCheck={false}
          aria-label={t("liveDoc.markdown.title", { defaultValue: "Markdown" })}
          onChange={(e) => {
            onChange(e.target.value);
            setSel({ start: e.target.selectionStart, end: e.target.selectionEnd });
            refreshMention(e.target.value, e.target.selectionStart, e.target.selectionEnd);
          }}
          onSelect={(e) => {
            setSel({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd });
            refreshMention(e.currentTarget.value, e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            closeMention();
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(e) => {
            // Mention popup navigation takes priority over editor keys.
            if (mentionTrigger && mentionCandidates.length > 0) {
              const action = handleMentionKey(e, {
                activeIndex: mentionIndex,
                count: mentionCandidates.length,
              });
              if (action) {
                e.preventDefault();
                if (action.kind === "move") setMentionIndex(action.index);
                else if (action.kind === "pick") {
                  const c = mentionCandidates[action.index];
                  if (c) insertMention(c);
                } else if (action.kind === "close") closeMention();
                return;
              }
            }
            if (e.key !== "Tab") return;
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart, selectionEnd } = el;
            const next = text.slice(0, selectionStart) + "  " + text.slice(selectionEnd);
            onChange(next);
            requestAnimationFrame(() => {
              el.selectionStart = el.selectionEnd = selectionStart + 2;
            });
          }}
          />
        </div>
      </div>
      {mentionTrigger &&
        mentionRect &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: mentionRect.bottom + 4,
              left: Math.max(
                MENTION_POPUP_MARGIN,
                Math.min(mentionRect.left, window.innerWidth - MENTION_POPUP_WIDTH - MENTION_POPUP_MARGIN),
              ),
              width: MENTION_POPUP_WIDTH,
              zIndex: 1000,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <MentionAutocomplete
              candidates={mentionCandidates}
              activeIndex={mentionIndex}
              onPick={insertMention}
              onActiveIndexChange={setMentionIndex}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
