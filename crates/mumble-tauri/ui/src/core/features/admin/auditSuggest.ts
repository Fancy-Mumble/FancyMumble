/**
 * Context-aware autocomplete for the simple-mode audit search (spec 10.3).
 *
 * A Kibana-style typeahead over the same `field op value and ...` DSL that
 * {@link ./auditQuery!parseAuditQuery} consumes. Given the raw query text and
 * the caret position, {@link suggestAudit} works out what the grammar expects
 * *next* - a field, an operator, a value, or the `and` joiner - and returns the
 * matching suggestions plus the text span the accepted suggestion should
 * replace. The engine is deliberately tolerant of half-typed, not-yet-valid
 * input (the strict parser is not), so it can run on every keystroke.
 *
 * It is a pure function of (text, caret, context): no React, fully unit
 * testable. The component in {@link ./QueryAutocomplete} owns presentation and
 * keyboard handling; the value domains (categories, user names, channels) are
 * supplied by the caller from live app state.
 */

/** Fields the simple-mode DSL understands (mirrors auditQuery's KNOWN_FIELDS). */
export const SUGGEST_FIELDS = [
  "category",
  "source",
  "severity",
  "actor",
  "target",
  "channel",
  "text",
  "ts",
] as const;

const SOURCES = ["server", "client", "plugin"];
const SEVERITIES = ["info", "notice", "warning", "critical"];
/** `ts > now-<duration>` helpers offered as ready-made values. */
const TS_HELPERS = ["now", "now-1h", "now-24h", "now-7d", "now-30d"];

/**
 * Operators simple mode actually accepts per field. The tokenizer recognises
 * more (`!=`, `>=`, ...) but `applyTerm` rejects them for most fields, so we
 * only ever suggest what will parse: `=`/`~` for scalars, `in` additionally
 * for category, and `>`/`>=` for the `ts` lower bound.
 */
const FIELD_OPERATORS: Record<string, string[]> = {
  category: ["=", "~", "in"],
  source: ["=", "~"],
  severity: ["=", "~"],
  actor: ["=", "~"],
  target: ["=", "~"],
  channel: ["="],
  text: ["=", "~"],
  ts: [">", ">="],
};

/** Human-readable one-liners shown as the right-hand hint on a field row. */
const FIELD_HINTS: Record<string, string> = {
  category: "action type (ban, kick, acl…)",
  source: "server · client · plugin",
  severity: "info · notice · warning · critical",
  actor: "who performed the action",
  target: "who it was performed on",
  channel: "channel id",
  text: "free-text / reason match",
  ts: "time bound, e.g. ts > now-7d",
};

/** A single offered completion. */
export interface AuditSuggestion {
  /** Text shown in the dropdown row. */
  readonly label: string;
  /** Exact text spliced into the query (already quoted where needed). */
  readonly apply: string;
  /** What this suggestion is, for the row icon/label and styling. */
  readonly kind: "field" | "operator" | "value" | "keyword";
  /** Optional dim hint shown right-aligned. */
  readonly detail?: string;
}

/** Live value domains, supplied from app state by the caller. */
export interface AuditSuggestContext {
  /** Known + result-present categories. */
  readonly categories: readonly string[];
  /** Display names for actor/target completion. */
  readonly userNames: readonly string[];
  /** Channels for `channel = <id>` (label by name, apply the id). */
  readonly channels?: readonly { readonly id: number; readonly name: string }[];
}

/** The completion offer for the token under the caret. */
export interface AuditSuggestResult {
  /** Inclusive start of the span the accepted suggestion replaces. */
  readonly from: number;
  /** Exclusive end of that span (always the caret). */
  readonly to: number;
  /** The partial word being completed (for the caller, already unquoted). */
  readonly word: string;
  readonly suggestions: readonly AuditSuggestion[];
}

const WORD_CHAR = /[\w.\-*]/;

/** Quote a value only when it is not a bare word the tokenizer accepts. */
function quoteIfNeeded(v: string): string {
  return /^[\w.\-*]+$/.test(v) ? v : `"${v.replaceAll('"', "")}"`;
}

// -- Lenient scanner (never throws) --------------------------------

type ScanTok =
  | { kind: "field"; value: string }
  | { kind: "word"; value: string }
  | { kind: "string"; value: string }
  | { kind: "op"; value: string }
  | { kind: "and" }
  | { kind: "in" }
  | { kind: "paren"; value: "(" | ")" | "," };

const SCAN_RE = /"[^"]*"?|'[^']*'?|[<>=!~]+|[(),]|[\w.\-*]+/g;

/** Best-effort token scan of the text left of the caret. */
function scan(head: string): ScanTok[] {
  const out: ScanTok[] = [];
  for (const m of head.matchAll(SCAN_RE)) {
    const s = m[0];
    const c = s[0];
    if (c === '"' || c === "'") {
      out.push({ kind: "string", value: s.replace(/^['"]|['"]$/g, "") });
    } else if (c === "(" || c === ")" || c === ",") {
      out.push({ kind: "paren", value: c });
    } else if (/[<>=!~]/.test(c)) {
      out.push({ kind: "op", value: s });
    } else {
      const lower = s.toLowerCase();
      if (lower === "and") out.push({ kind: "and" });
      else if (lower === "in") out.push({ kind: "in" });
      else if ((SUGGEST_FIELDS as readonly string[]).includes(lower)) {
        out.push({ kind: "field", value: lower });
      } else out.push({ kind: "word", value: s });
    }
  }
  return out;
}

// -- Value domains -------------------------------------------------

function fieldValues(field: string, ctx: AuditSuggestContext): AuditSuggestion[] {
  const val = (v: string, detail?: string): AuditSuggestion => ({
    label: v,
    apply: `${quoteIfNeeded(v)} `,
    kind: "value",
    detail,
  });
  switch (field) {
    case "source":
      return SOURCES.map((s) => val(s));
    case "severity":
      return SEVERITIES.map((s) => val(s));
    case "category":
      return [...new Set(ctx.categories)].map((c) => val(c));
    case "ts":
      return TS_HELPERS.map((h) => val(h, "relative time"));
    case "actor":
    case "target":
      return [...new Set(ctx.userNames)].map((n) => val(n, "user"));
    case "channel":
      return (ctx.channels ?? []).map((c) => ({
        label: c.name,
        apply: `${c.id} `,
        kind: "value" as const,
        detail: `#${c.id}`,
      }));
    default:
      return [];
  }
}

function fieldSuggestions(): AuditSuggestion[] {
  return SUGGEST_FIELDS.map((f) => ({
    label: f,
    apply: `${f} `,
    kind: "field" as const,
    detail: FIELD_HINTS[f],
  }));
}

function operatorSuggestions(field: string): AuditSuggestion[] {
  const ops = FIELD_OPERATORS[field] ?? ["=", "~"];
  return ops.map((op) => ({
    label: op,
    apply: `${op} `,
    kind: op === "in" ? ("keyword" as const) : ("operator" as const),
    detail:
      op === "in" ? "match any of a list" : op === "~" ? "fuzzy / contains" : op === "=" ? "equals" : "after",
  }));
}

const AND_SUGGESTION: AuditSuggestion = {
  label: "and",
  apply: "and ",
  kind: "keyword",
  detail: "add another filter",
};

// -- Context resolution --------------------------------------------

type Ctx =
  | { where: "field" }
  | { where: "operator"; field: string }
  | { where: "value"; field: string }
  | { where: "in-list"; field: string }
  | { where: "and" };

/** Decide what the grammar expects next, from the tokens left of the caret. */
function resolveContext(toks: ScanTok[]): Ctx {
  // Inside an unclosed `field in ( ... ` list: keep offering that field's
  // values (only category supports `in`, but resolve generically).
  let openInField: string | null = null;
  for (let i = 0; i < toks.length; i += 1) {
    const tk = toks[i];
    if (tk.kind === "paren" && tk.value === "(") {
      // Was this `<field> in (` ?
      const a = toks[i - 2];
      const b = toks[i - 1];
      if (a && a.kind === "field" && b && b.kind === "in") openInField = a.value;
    } else if (tk.kind === "paren" && tk.value === ")") {
      openInField = null;
    }
  }
  if (openInField) return { where: "in-list", field: openInField };

  const last = toks[toks.length - 1];
  if (!last) return { where: "field" };

  switch (last.kind) {
    case "and":
    case "paren": // after "," or "(" (non-in) -> a fresh field reads best
      return last.kind === "paren" && last.value === ")" ? { where: "and" } : { where: "field" };
    case "field":
      return { where: "operator", field: last.value };
    case "in":
      return { where: "value", field: fieldBeforeOp(toks, toks.length - 1) };
    case "op":
      return { where: "value", field: fieldBeforeOp(toks, toks.length - 1) };
    case "string":
    case "word":
      return { where: "and" };
    default:
      return { where: "field" };
  }
}

/** Nearest field token to the left of position `opIdx`. */
function fieldBeforeOp(toks: ScanTok[], opIdx: number): string {
  for (let i = opIdx - 1; i >= 0; i -= 1) {
    if (toks[i].kind === "field") return (toks[i] as { value: string }).value;
    if (toks[i].kind === "and" || toks[i].kind === "paren") break;
  }
  return "";
}

// -- Ranking -------------------------------------------------------

/** startsWith beats substring; both beat non-matches (dropped). */
function rank(list: AuditSuggestion[], word: string): AuditSuggestion[] {
  if (!word) return list;
  const w = word.toLowerCase();
  const scored: { s: AuditSuggestion; score: number }[] = [];
  for (const s of list) {
    const l = s.label.toLowerCase();
    if (l.startsWith(w)) scored.push({ s, score: 0 });
    else if (l.includes(w)) scored.push({ s, score: 1 });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((x) => x.s);
}

// -- Public entry --------------------------------------------------

/**
 * Suggest completions for `text` at caret index `caret`.
 *
 * Returns the span `[from, to)` an accepted suggestion should replace (the
 * partial word under the caret, including a leading quote if the value is being
 * typed inside one) and the ranked, prefix-filtered suggestion list.
 */
export function suggestAudit(text: string, caret: number, ctx: AuditSuggestContext): AuditSuggestResult {
  const pos = Math.max(0, Math.min(caret, text.length));

  // Span of the partial word immediately left of the caret.
  let from = pos;
  while (from > 0 && WORD_CHAR.test(text[from - 1])) from -= 1;
  // If the partial is opened by a quote, swallow it so the replacement writes a
  // fresh, correctly-quoted value rather than nesting quotes.
  if (from > 0 && (text[from - 1] === '"' || text[from - 1] === "'")) from -= 1;

  const rawWord = text.slice(from, pos);
  const word = rawWord.replace(/^['"]/, "");

  const context = resolveContext(scan(text.slice(0, from)));

  let list: AuditSuggestion[];
  switch (context.where) {
    case "field":
      // At a fresh slot both a field and (rarely) `and` read fine, but a field
      // is what you almost always want first.
      list = fieldSuggestions();
      break;
    case "operator":
      list = operatorSuggestions(context.field);
      break;
    case "value":
    case "in-list":
      list = fieldValues(context.field, ctx);
      break;
    case "and":
      list = [AND_SUGGESTION];
      break;
    default:
      list = fieldSuggestions();
  }

  return { from, to: pos, word, suggestions: rank(list, word) };
}
