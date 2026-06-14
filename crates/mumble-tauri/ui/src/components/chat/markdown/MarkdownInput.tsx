/**
 * MarkdownInput - a chat input with live markdown preview.
 *
 * Shows formatting decorations (bold, italic, underline, strikethrough,
 * code) inline while keeping the raw markdown syntax characters visible.
 * The underlying value is always plain-text markdown.
 *
 * Supports keyboard shortcuts: Ctrl+B, Ctrl+I, Ctrl+U.
 */

import {
  useRef,
  useCallback,
  useEffect,
  useState,
  useMemo,
  type KeyboardEvent,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import { flattenHljs } from "./hljsTokens";
import { loadHljs, loadedHljs, type HljsApi } from "./lazyHljs";
import styles from "./MarkdownInput.module.css";

// --- Markdown -> decorated spans -----------------------------------

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
  spoiler?: boolean;
  /** Inline user mention (<@SESSION>); rendered as @Username chip. */
  mention?: boolean;
  mentionSession?: number;
  /** Global CSS class from hljs for syntax-highlighted code tokens. */
  hljsClass?: string;
  /** Marker set by parseMarkdown; expanded to hljs tokens by expandFenceSegments. */
  fenceCode?: { lang: string; body: string };
}

/**
 * Regex matching URLs (http, https, ftp) in plain text.
 *
 * The character class is intentionally wide - it accepts commas, parens
 * and other punctuation that are perfectly valid inside a URL path or
 * query string (e.g. Wikipedia or rheinpfalz.de URLs that embed `,` in
 * slug fragments).  Trailing sentence punctuation that almost never
 * belongs to the URL (`.,;:!?` and dangling closing brackets) is
 * stripped afterwards by `trimTrailingPunctuation`.
 */
const URL_RE = /(?:https?|ftp):\/\/[^\s<>"'`]+/g;

/**
 * Strip trailing characters that are almost never part of the URL itself:
 *  - sentence punctuation: . , ; : ! ? '
 *  - unbalanced closing brackets/parens (a `)` is part of the URL only
 *    if the URL also contains an opening `(` before it).
 */
function trimTrailingPunctuation(url: string): string {
  const trailing = /[.,;:!?'”’…]+$/;
  let out = url.replace(trailing, "");
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last === ")" && (out.match(/\(/g)?.length ?? 0) <= (out.match(/\)/g)?.length ?? 0) - 1) {
      out = out.slice(0, -1);
    } else if (last === "]" && (out.match(/\[/g)?.length ?? 0) <= (out.match(/\]/g)?.length ?? 0) - 1) {
      out = out.slice(0, -1);
    } else if (last === ">" || last === "»") {
      out = out.slice(0, -1);
    } else {
      break;
    }
  }
  return out;
}

/**
 * Parse raw markdown text into decorated segments.
 * Handles: **bold**, *italic*, __underline__, ~~strike~~, `code`, URLs
 */
function parseMarkdown(raw: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let current = "";
  const pushCurrent = (flags?: Partial<Segment>) => {
    if (current) {
      // Split any accumulated plain text to detect URLs within it.
      pushWithUrls(segments, current, flags);
      current = "";
    }
  };

  while (i < raw.length) {
    // <@SESSION> user mention token
    if (raw[i] === "<" && raw[i + 1] === "@" && raw[i + 2] !== "&") {
      let j = i + 2;
      while (j < raw.length && raw[j] >= "0" && raw[j] <= "9") j++;
      if (j > i + 2 && raw[j] === ">") {
        pushCurrent();
        const session = parseInt(raw.slice(i + 2, j), 10);
        segments.push({ text: raw.slice(i, j + 1), mention: true, mentionSession: session });
        i = j + 1;
        continue;
      }
    }

    // ``` fenced code block (must be checked before single backtick) ```
    if (raw[i] === "`" && raw[i + 1] === "`" && raw[i + 2] === "`") {
      const lineEnd = raw.indexOf("\n", i + 3);
      if (lineEnd !== -1) {
        const lang = raw.slice(i + 3, lineEnd);
        const closeIdx = raw.indexOf("\n```", lineEnd);
        // Accept both closed blocks and unclosed blocks (still being typed).
        const body =
          closeIdx !== -1
            ? raw.slice(lineEnd + 1, closeIdx)
            : raw.slice(lineEnd + 1);
        const fullText =
          closeIdx !== -1
            ? raw.slice(i, closeIdx + 4)
            : raw.slice(i);
        pushCurrent();
        segments.push({ text: fullText, fenceCode: { lang, body } });
        i = closeIdx !== -1 ? closeIdx + 4 : raw.length;
        continue;
      }
    }

    // `` `code` ``
    if (raw[i] === "`") {
      pushCurrent();
      const end = raw.indexOf("`", i + 1);
      if (end !== -1) {
        segments.push({ text: raw.slice(i, end + 1), code: true });
        i = end + 1;
        continue;
      }
    }

    // **bold**
    if (raw[i] === "*" && raw[i + 1] === "*") {
      pushCurrent();
      const end = raw.indexOf("**", i + 2);
      if (end !== -1) {
        segments.push({ text: raw.slice(i, end + 2), bold: true });
        i = end + 2;
        continue;
      }
    }

    // ||spoiler||
    if (raw[i] === "|" && raw[i + 1] === "|") {
      pushCurrent();
      const end = raw.indexOf("||", i + 2);
      if (end !== -1) {
        segments.push({ text: raw.slice(i, end + 2), spoiler: true });
        i = end + 2;
        continue;
      }
    }

    // *italic* (single *)
    if (raw[i] === "*" && raw[i + 1] !== "*") {
      pushCurrent();
      const end = raw.indexOf("*", i + 1);
      if (end !== -1 && raw[end + 1] !== "*") {
        segments.push({ text: raw.slice(i, end + 1), italic: true });
        i = end + 1;
        continue;
      }
    }

    // __underline__
    if (raw[i] === "_" && raw[i + 1] === "_") {
      pushCurrent();
      const end = raw.indexOf("__", i + 2);
      if (end !== -1) {
        segments.push({ text: raw.slice(i, end + 2), underline: true });
        i = end + 2;
        continue;
      }
    }

    // ~~strikethrough~~
    if (raw[i] === "~" && raw[i + 1] === "~") {
      pushCurrent();
      const end = raw.indexOf("~~", i + 2);
      if (end !== -1) {
        segments.push({ text: raw.slice(i, end + 2), strike: true });
        i = end + 2;
        continue;
      }
    }

    current += raw[i];
    i++;
  }
  pushCurrent();
  return segments;
}

/** Push text into segments, splitting out URLs as `link` segments. */
function pushWithUrls(
  segments: Segment[],
  text: string,
  flags?: Partial<Segment>,
): void {
  URL_RE.lastIndex = 0;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ text: text.slice(lastIdx, match.index), ...flags });
    }
    const trimmed = trimTrailingPunctuation(match[0]);
    segments.push({ text: trimmed, link: true, ...flags });
    if (trimmed.length < match[0].length) {
      // Push the stripped trailing punctuation back as plain text.
      segments.push({ text: match[0].slice(trimmed.length), ...flags });
    }
    lastIdx = URL_RE.lastIndex;
  }
  if (lastIdx < text.length) {
    segments.push({ text: text.slice(lastIdx), ...flags });
  }
}

/**
 * Expand any `fenceCode` segments into hljs-coloured sub-segments.
 * All other segments pass through unchanged. Called once per value change
 * via useMemo so hljs runs only on edit, not on every cursor move.
 */
function expandFenceSegments(segments: Segment[], hljs: HljsApi | null): Segment[] {
  const result: Segment[] = [];
  for (const seg of segments) {
    if (!seg.fenceCode) {
      result.push(seg);
      continue;
    }
    const { lang, body } = seg.fenceCode;
    result.push({ text: `\`\`\`${lang}\n` });
    let tokens: Array<{ text: string; cls: string }>;
    if (hljs) {
      try {
        const hl =
          lang && hljs.getLanguage(lang)
            ? hljs.highlight(body, { language: lang, ignoreIllegals: true })
            : hljs.highlightAuto(body);
        tokens = flattenHljs(hl.value);
      } catch {
        tokens = [{ text: body, cls: "" }];
      }
    } else {
      // Highlighter not loaded yet: show the code plain; a re-render colourises
      // it once `loadHljs` resolves.
      tokens = [{ text: body, cls: "" }];
    }
    for (const t of tokens) {
      result.push({ text: t.text, hljsClass: t.cls || undefined });
    }
    // Only emit the closing fence marker when it was actually present in the raw text.
    if (seg.text.endsWith("\n\`\`\`")) {
      result.push({ text: "\n\`\`\`" });
    }
  }
  return result;
}

/** CSS class for a segment's formatting. */
function getSegmentClass(seg: Segment): string {
  const classes: string[] = [];
  if (seg.bold) classes.push(styles.mdBold);
  if (seg.italic) classes.push(styles.mdItalic);
  if (seg.underline) classes.push(styles.mdUnderline);
  if (seg.strike) classes.push(styles.mdStrike);
  if (seg.code) classes.push(styles.mdCode);
  if (seg.link) classes.push(styles.mdLink);
  if (seg.spoiler) classes.push(styles.mdSpoiler);
  return classes.join(" ");
}

/**
 * Render segments with a custom caret and selection highlight.
 *
 * The caret is a blinking vertical line inserted at the correct character
 * position *within* the formatted overlay, so it naturally tracks the real
 * glyph layout (bold chars are wider -> caret shifts accordingly).
 */
function renderFormattedOverlay(
  segments: Segment[],
  selStart: number,
  selEnd: number,
  showCursor: boolean,
  mentionResolver?: (session: number) => string | undefined,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let keyIdx = 0;

  const hasSelection = showCursor && selStart !== selEnd;
  const cursorPos = showCursor && !hasSelection ? selStart : -1;
  const selFrom = hasSelection ? Math.min(selStart, selEnd) : -1;
  const selTo = hasSelection ? Math.max(selStart, selEnd) : -1;

  // Boundary positions where segments must be split.
  const boundaries = new Set<number>();
  if (cursorPos >= 0) boundaries.add(cursorPos);
  if (hasSelection) {
    boundaries.add(selFrom);
    boundaries.add(selTo);
  }

  let charIdx = 0;
  let cursorInserted = cursorPos < 0;

  for (const seg of segments) {
    const segStart = charIdx;
    const segEnd = charIdx + seg.text.length;
    const cls = getSegmentClass(seg);

    // Mention segments are rendered atomically as @Username chips.
    if (seg.mention && seg.mentionSession !== undefined) {
      const name = mentionResolver?.(seg.mentionSession) ?? String(seg.mentionSession);
      const inSel = hasSelection && segStart < selTo && segEnd > selFrom;
      const chipCls = `${styles.mdMention}${inSel ? ` ${styles.selection}` : ""}`;

      if (!cursorInserted && cursorPos === segStart) {
        nodes.push(<span key="caret" className={styles.caret} />);
        cursorInserted = true;
      }
      nodes.push(<span key={keyIdx++} className={chipCls}>{`@${name}`}</span>);
      if (!cursorInserted && cursorPos > segStart && cursorPos <= segEnd) {
        nodes.push(<span key="caret" className={styles.caret} />);
        cursorInserted = true;
      }
      charIdx = segEnd;
      continue;
    }

    // Find split points strictly inside this segment.
    const localSplits = Array.from(boundaries)
      .filter((p) => p > segStart && p < segEnd)
      .map((p) => p - segStart);

    const breaks = [...new Set([0, ...localSplits, seg.text.length])].sort(
      (a, b) => a - b,
    );

    for (let bi = 0; bi < breaks.length - 1; bi++) {
      const from = breaks[bi];
      const to = breaks[bi + 1];
      const text = seg.text.slice(from, to);
      const globalFrom = segStart + from;
      const globalTo = segStart + to;

      // Insert caret before this slice if it starts at the cursor position.
      if (!cursorInserted && globalFrom === cursorPos) {
        nodes.push(<span key="caret" className={styles.caret} />);
        cursorInserted = true;
      }

      if (text) {
        const inSelection =
          hasSelection && globalFrom >= selFrom && globalTo <= selTo;
        const hlCls = seg.hljsClass ?? "";
        const base = [cls, hlCls].filter(Boolean).join(" ");
        const combined = inSelection ? `${base} ${styles.selection}`.trim() : base;
        nodes.push(
          <span key={keyIdx++} className={combined || undefined}>
            {text}
          </span>,
        );
      }
    }

    charIdx = segEnd;
  }

  // Caret at the very end of the text.
  if (!cursorInserted) {
    nodes.push(<span key="caret" className={styles.caret} />);
  }

  return nodes;
}

// --- Markdown -> HTML (for sending) -------------------------------

/** Convert markdown syntax to HTML for the Mumble message body. */
export function markdownToHtml(raw: string): string {
  let html = raw;
  // Escape HTML entities first
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Extract fenced code blocks first so their contents are not subject to
  // any further markdown processing (in particular the trailing newline -> <br>
  // pass would otherwise corrupt them and break syntax highlighting).
  const fenceStash: string[] = [];
  html = html.replace(
    /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g,
    (_match, lang: string, body: string) => {
      const cls = lang ? ` class="language-${lang}"` : "";
      const trimmed = body.replace(/\n$/, "");
      fenceStash.push(`<pre><code${cls}>${trimmed}</code></pre>`);
      return `\u0000FENCE${fenceStash.length - 1}\u0000`;
    },
  );

  // Stash inline code so $...$ inside backticks is not treated as math.
  const inlineCodeStash: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_m, code: string) => {
    inlineCodeStash.push(`<code>${code}</code>`);
    return `\u0000ICODE${inlineCodeStash.length - 1}\u0000`;
  });

  // Display math $$...$$ (may span multiple lines) - stash before the
  // newline pass so the content is not broken into fragments.
  const mathDisplayStash: string[] = [];
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_m, latex: string) => {
    mathDisplayStash.push(latex.trim());
    return `\u0000MATH_BLOCK${mathDisplayStash.length - 1}\u0000`;
  });

  // Inline math $...$
  html = html.replace(/\$([^$\n]+)\$/g, (_m, latex: string) =>
    `<span class="math-inline">${latex}</span>`,
  );

  // Restore inline code placeholders now that math has been processed.
  html = html.replace(/\u0000ICODE(\d+)\u0000/g, (_m, idx: string) =>
    inlineCodeStash[Number(idx)] ?? "",
  );

  // **bold**
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  // *italic*
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  // __underline__
  html = html.replace(/__(.+?)__/g, "<u>$1</u>");
  // ~~strikethrough~~
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");
  // ||spoiler||
  html = html.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>');
  // URLs -> clickable links (must run after entity escaping). Trailing
  // punctuation is stripped before the link is built so commas/parens
  // inside a URL are preserved while sentence punctuation isn't swallowed.
  html = html.replace(
    /(?:https?|ftp):\/\/[^\s<>"'`]+/g,
    (raw) => {
      const url = trimTrailingPunctuation(raw);
      const trail = raw.slice(url.length);
      const safe = url.replace(/"/g, "&quot;");
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>${trail}`;
    },
  );
  // Newlines -> <br> (must come last so inline formatting is applied first)
  html = html.replaceAll("\n", "<br>");

  // Restore fenced code blocks after the <br> pass so their newlines survive.
  html = html.replace(/\u0000FENCE(\d+)\u0000/g, (_m, idx: string) =>
    fenceStash[Number(idx)] ?? "",
  );
  // Restore display math blocks (newlines already stripped, wrap in a span
  // so MediaPreview can find and render them with KaTeX).
  html = html.replace(/\u0000MATH_BLOCK(\d+)\u0000/g, (_m, idx: string) => {
    const latex = mathDisplayStash[Number(idx)] ?? "";
    return `<span class="math-display">${latex}</span>`;
  });
  return html;
}

/** Reverse of markdownToHtml: convert stored HTML back to editable markdown text. */
export function htmlToMarkdown(html: string): string {
  let text = html;
  text = text.replaceAll(/<br\s*\/?>/gi, "\n");
  text = text.replaceAll(
    /<pre><code(?:\s+class="language-([a-zA-Z0-9_+-]+)")?>([\s\S]*?)<\/code><\/pre>/gi,
    (_match, lang: string | undefined, body: string) =>
      `\`\`\`${lang ?? ""}\n${body}\n\`\`\``,
  );
  text = text.replaceAll(/<a[^>]*>([^<]*)<\/a>/gi, "$1");
  text = text.replaceAll(/<code>([^<]*)<\/code>/gi, "`$1`");
  // Math spans (must come before the generic <span> strip)
  text = text.replaceAll(
    /<span\s+class="math-display"[^>]*>([\s\S]*?)<\/span>/gi,
    "$$$$1$$",
  );
  text = text.replaceAll(
    /<span\s+class="math-inline"[^>]*>([^<]*)<\/span>/gi,
    "$$1$",
  );
  text = text.replaceAll(/<b>([^<]*)<\/b>/gi, "**$1**");
  text = text.replaceAll(/<strong>([^<]*)<\/strong>/gi, "**$1**");
  text = text.replaceAll(/<i>([^<]*)<\/i>/gi, "*$1*");
  text = text.replaceAll(/<em>([^<]*)<\/em>/gi, "*$1*");
  text = text.replaceAll(/<u>([^<]*)<\/u>/gi, "__$1__");
  text = text.replaceAll(/<s>([^<]*)<\/s>/gi, "~~$1~~");
  text = text.replaceAll(
    /<span\s+class="spoiler"[^>]*>([^<]*)<\/span>/gi,
    "||$1||",
  );
  text = text.replaceAll(/<!--[\s\S]*?-->/g, "");
  text = text.replaceAll(/<[^>]*>/g, "");
  text = text.replaceAll("&lt;", "<");
  text = text.replaceAll("&gt;", ">");
  text = text.replaceAll("&amp;", "&");
  return text;
}

// --- Component ----------------------------------------------------

interface MarkdownInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPaste?: (e: ClipboardEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Notified whenever the textarea selection changes. */
  onSelectionChange?: (start: number, end: number) => void;
  /** Optional intercept for keystrokes - return true to consume. */
  onKeyDownCapture?: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Imperative API ref for parent-driven text edits (autocomplete, etc.). */
  apiRef?: React.RefObject<MarkdownInputApi | null>;
  /** Resolve a Mumble session ID to a display name for inline mention chips. */
  mentionResolver?: (session: number) => string | undefined;
}

/** Imperative methods exposed to a parent via `apiRef`. */
export interface MarkdownInputApi {
  /** Replace the substring [start, end) with `text` and place caret after it. */
  replaceRange(start: number, end: number, text: string): void;
  /** Focus the underlying textarea. */
  focus(): void;
}

export default function MarkdownInput({
  value,
  onChange,
  onSubmit,
  onPaste,
  placeholder,
  disabled,
  onSelectionChange,
  onKeyDownCapture,
  apiRef,
  mentionResolver,
}: Readonly<MarkdownInputProps>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  // True while the user is dragging a selection.  We must not clear
  // `focused` on blur during a drag: the pointer can leave the
  // textarea bounding box (e.g. dragging past the left edge), which
  // fires blur even though the selection is still active.
  const [isDragging, setIsDragging] = useState(false);
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);
  const [composing, setComposing] = useState(false);

  /** Read the textarea's current selection and push it into state. */
  const syncSelection = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      setSelStart(el.selectionStart);
      setSelEnd(el.selectionEnd);
      onSelectionChange?.(el.selectionStart, el.selectionEnd);
    }
  }, [onSelectionChange]);

  // Release the drag lock on pointer-up (or cancel) anywhere in the
  // document.  Also removes the body flag that suppresses pointer events
  // on contenteditable elements during the drag (see global.css).
  useEffect(() => {
    const endDrag = () => {
      setIsDragging(false);
      delete document.body.dataset.textareaDragging;
      syncSelection();
    };
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    return () => {
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      // Clean up in case the component unmounts mid-drag.
      delete document.body.dataset.textareaDragging;
    };
  }, [syncSelection]);

  // Wire the imperative API exposed to the parent.
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      replaceRange(start, end, text) {
        const el = textareaRef.current;
        if (!el) return;
        const newVal = value.slice(0, start) + text + value.slice(end);
        const caret = start + text.length;
        onChange(newVal);
        requestAnimationFrame(() => {
          el.focus();
          el.selectionStart = caret;
          el.selectionEnd = caret;
          setSelStart(caret);
          setSelEnd(caret);
          onSelectionChange?.(caret, caret);
        });
      },
      focus() {
        textareaRef.current?.focus();
      },
    };
    return () => {
      if (apiRef.current) apiRef.current = null;
    };
  }, [apiRef, value, onChange, onSelectionChange]);

  // Sync scroll between textarea and overlay.
  const syncScroll = useCallback(() => {
    if (textareaRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  // Auto-resize textarea and wrapper to content (up to max-height).
  useEffect(() => {
    const el = textareaRef.current;
    const wrapper = el?.parentElement;
    if (!el || !wrapper) return;
    // Reset both heights before measuring so scrollHeight reflects actual content,
    // not the previous explicit height (wrapper falls back to CSS min-height).
    wrapper.style.height = "auto";
    el.style.height = "auto";
    const maxHeight = 200;
    const clamped = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${clamped}px`;
    wrapper.style.height = `${clamped}px`;
  }, [value]);

  /** Wrap selection / insert at cursor with markdown markers. */
  const wrapSelection = useCallback(
    (before: string, after: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = value.slice(start, end);
      const newVal =
        value.slice(0, start) + before + selected + after + value.slice(end);
      onChange(newVal);
      // Restore cursor position after React re-render.
      requestAnimationFrame(() => {
        el.selectionStart = start + before.length;
        el.selectionEnd = end + before.length;
        el.focus();
        syncSelection();
      });
    },
    [value, onChange, syncSelection],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Allow the parent to intercept keys (e.g. mention popup navigation).
      if (onKeyDownCapture?.(e)) {
        return;
      }

      // Submit on Enter (without Shift).
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
        return;
      }

      // Markdown shortcuts.
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case "b":
            e.preventDefault();
            wrapSelection("**", "**");
            return;
          case "i":
            e.preventDefault();
            wrapSelection("*", "*");
            return;
          case "u":
            e.preventDefault();
            wrapSelection("__", "__");
            return;
        }
        // Ctrl/Cmd+Shift+H -> spoiler (H for "hide")
        if (e.shiftKey && e.key.toLowerCase() === "h") {
          e.preventDefault();
          wrapSelection("||", "||");
          return;
        }
      }
    },
    [onSubmit, wrapSelection, onKeyDownCapture],
  );

  const [hljs, setHljs] = useState<HljsApi | null>(() => loadedHljs());
  const parsed = useMemo(() => parseMarkdown(value), [value]);
  const hasFence = useMemo(() => parsed.some((s) => s.fenceCode), [parsed]);
  // Load the highlighter the first time a code fence appears; the state update
  // re-runs the segments memo to colourise it.
  useEffect(() => {
    if (hasFence && !hljs) void loadHljs().then(setHljs);
  }, [hasFence, hljs]);
  const segments = useMemo(() => expandFenceSegments(parsed, hljs), [parsed, hljs]);
  const showCursor = (focused || isDragging) && !composing;
  const showPlaceholder = !value && !focused;

  return (
    <div className={`${styles.wrapper} ${focused ? styles.focused : ""}`}>
      {/* Overlay: shows decorated text + custom caret + selection */}
      <div ref={overlayRef} className={styles.overlay} aria-hidden>
        {value
          ? renderFormattedOverlay(
              segments,
              selStart,
              selEnd,
              showCursor,
              mentionResolver,
            )
          : null}
        {showPlaceholder && (
          <span className={styles.placeholder}>{placeholder}</span>
        )}
      </div>
      {/* Actual editable textarea (fully invisible - input only) */}
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setSelStart(e.target.selectionStart);
          setSelEnd(e.target.selectionEnd);
          onSelectionChange?.(e.target.selectionStart, e.target.selectionEnd);
        }}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onScroll={syncScroll}
        onSelect={syncSelection}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onPointerDown={() => {
          setIsDragging(true);
          // While dragging, make all contenteditable elements (e.g. the
          // Tiptap live-doc editor) invisible to pointer hit-testing so
          // the browser cannot transfer the selection to them.
          document.body.dataset.textareaDragging = "1";
        }}
        onFocus={() => {
          setFocused(true);
          syncSelection();
        }}
        onBlur={() => {
          // Do not clear `focused` while a drag selection is still in
          // progress - the pointer may have left the element bounds.
          if (!isDragging) setFocused(false);
        }}
        disabled={disabled}
        rows={1}
        spellCheck
      />
    </div>
  );
}
