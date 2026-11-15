/**
 * Dual-mode audit search (audit spec section 10.3).
 *
 * One search, two front-ends onto the same query, bound both ways:
 *
 *  - **Simple mode** - a small `field = value and ...` DSL that lowers to the
 *    structured `AuditQueryArgs` the wire query understands. `parseAuditQuery`
 *    parses it; `serializeAuditQuery` writes canonical text back from filter
 *    state, so editing the pills rewrites the text and vice versa.
 *  - **Advanced mode** - anything starting with `SELECT`/`WITH` is passed to
 *    the server verbatim as read-only SQL; the *server* is the security
 *    boundary (engine-enforced views), the client only routes it.
 *
 * Simple-mode grammar (conjunctive only - `or` / `not` need SQL mode):
 *
 *   query      := term (("and" | ",") term)*
 *   term       := field op value | field "in" "(" value ("," value)* ")" | word
 *   field      := category | source | severity | actor | target | channel | text | ts
 *   op         := "=" | "!=" | "~" | ">" | ">=" | "<" | "<="
 *   value      := quoted string | number | duration | word
 *   duration   := "now" | "now-" number ("m"|"h"|"d"|"w")
 *
 * Bare words become free-text terms. `actor`/`target` accept a numeric user
 * id directly or a name resolved through the caller-supplied resolver (the
 * wire query only carries ids). `ts > now-7d` becomes `sinceMs`.
 */

import type { AuditQueryArgs } from "../../types";

/** Milliseconds per duration unit for the `now-7d` time helpers. */
const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

/** Filter state driving the builder pills; a superset view of the DSL. */
export interface AuditFilterState {
  /** Exact category match (`category = x`, chips, `in (...)`). */
  categories: string[];
  /**
   * Substring category match (`category ~ x`). The backend only matches
   * categories exactly, so these are expanded against the known vocabulary at
   * lowering time - `~ kick` finds `audit.kick`.
   */
  categoryContains: string[];
  source: string;
  severity: string;
  /** Display name or numeric id, as typed/picked. */
  actor: string;
  target: string;
  channel: string;
  text: string;
  /** Duration token (e.g. "7d") or "" for no lower bound. */
  since: string;
}

export const EMPTY_FILTERS: AuditFilterState = {
  categories: [],
  categoryContains: [],
  source: "",
  severity: "",
  actor: "",
  target: "",
  channel: "",
  text: "",
  since: "",
};

/** Resolves a user display name to a user id (best effort, client-side). */
export type UserResolver = (name: string) => number | undefined;

export class AuditQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditQueryError";
  }
}

/** True when the text should be routed to advanced (server-side SQL) mode. */
export function isSqlQuery(text: string): boolean {
  return /^\s*(select|with)\b/i.test(text);
}

// -- Tokenizer -----------------------------------------------------

type Token =
  | { kind: "word"; value: string }
  | { kind: "string"; value: string }
  | { kind: "op"; value: string }
  | { kind: "punct"; value: "(" | ")" | "," };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === '"' || c === "'") {
      const end = input.indexOf(c, i + 1);
      if (end === -1)
        throw new AuditQueryError(`Unterminated string starting at "${input.slice(i, i + 12)}"`);
      tokens.push({ kind: "string", value: input.slice(i + 1, end) });
      i = end + 1;
    } else if (c === "(" || c === ")" || c === ",") {
      tokens.push({ kind: "punct", value: c });
      i += 1;
    } else if (/[=!~<>]/.test(c)) {
      const two = input.slice(i, i + 2);
      const op = two === "!=" || two === ">=" || two === "<=" ? two : c;
      if (!["=", "!=", "~", ">", "<", ">=", "<="].includes(op)) {
        throw new AuditQueryError(`Unknown operator "${op}"`);
      }
      tokens.push({ kind: "op", value: op });
      i += op.length;
    } else {
      // A word: identifiers (dotted), numbers, durations like now-7d.
      const m = /^[\w.\-*]+/.exec(input.slice(i));
      if (!m) throw new AuditQueryError(`Unexpected character "${c}"`);
      tokens.push({ kind: "word", value: m[0] });
      i += m[0].length;
    }
  }
  return tokens;
}

// -- Parser --------------------------------------------------------

/** Parse a `now-7d` / `now` time helper into epoch ms, or undefined. */
function parseTimeHelper(v: string): number | undefined {
  if (v === "now") return Date.now();
  const m = /^now-(\d+)([mhdw])$/.exec(v);
  if (!m) return undefined;
  return Date.now() - Number(m[1]) * UNIT_MS[m[2]];
}

/** The `since` pill token (e.g. "7d") for a `ts > now-7d` term. */
function timeHelperToken(v: string): string | undefined {
  const m = /^now-(\d+[mhdw])$/.exec(v);
  return m ? m[1] : undefined;
}

const KNOWN_FIELDS = new Set([
  "category",
  "source",
  "severity",
  "actor",
  "target",
  "channel",
  "text",
  "ts",
  // Dotted spellings from the design doc examples.
  "actor.name",
  "actor.id",
  "target.name",
  "target.id",
  "channel.id",
]);

/**
 * Parse simple-mode DSL text into filter state.
 *
 * Throws [`AuditQueryError`] with a human-readable message on grammar the
 * simple mode cannot express (suggesting SQL mode where appropriate).
 */
export function parseAuditQuery(input: string): AuditFilterState {
  // Fresh arrays: EMPTY_FILTERS is a shared const and applyTerm pushes in place.
  const filters: AuditFilterState = { ...EMPTY_FILTERS, categories: [], categoryContains: [] };
  const tokens = tokenize(input);
  const freeText: string[] = [];
  let i = 0;

  const peek = () => tokens[i];
  const next = () => tokens[i++];

  const valueOf = (t: Token | undefined): string => {
    if (!t || t.kind === "punct" || t.kind === "op") {
      throw new AuditQueryError("Expected a value");
    }
    return t.value;
  };

  while (i < tokens.length) {
    const t = next();
    if (t.kind === "word" && /^(and)$/i.test(t.value)) continue;
    if (t.kind === "punct" && t.value === ",") continue;
    if (t.kind === "word" && /^(or|not)$/i.test(t.value)) {
      throw new AuditQueryError(
        `"${t.value}" is not supported in simple mode - switch to SQL mode for boolean logic`,
      );
    }

    // field op value | field in (...)
    const isField = t.kind === "word" && KNOWN_FIELDS.has(t.value.toLowerCase());
    const op = peek();
    if (isField && op && (op.kind === "op" || (op.kind === "word" && /^in$/i.test(op.value)))) {
      const field = t.value.toLowerCase();
      void next(); // consume op / "in"

      if (op.kind === "word") {
        // in (...) - categories only.
        if (field !== "category") {
          throw new AuditQueryError(`"in" is only supported for category in simple mode`);
        }
        filters.categories.push(...parseInList(next, valueOf));
        continue;
      }

      const rawValue = valueOf(next());
      applyTerm(filters, field, op.value, rawValue);
      continue;
    }

    // Bare term -> free text.
    freeText.push(t.kind === "string" ? t.value : t.value);
  }

  if (freeText.length > 0) {
    filters.text = [filters.text, ...freeText].filter(Boolean).join(" ").trim();
  }
  return filters;
}

/** Consume the "( v, v, ... )" tail of an `in` clause. */
function parseInList(next: () => Token | undefined, valueOf: (t: Token | undefined) => string): string[] {
  const open = next();
  if (!open || open.kind !== "punct" || open.value !== "(") {
    throw new AuditQueryError(`Expected "(" after "in"`);
  }
  const values: string[] = [];
  for (;;) {
    const v = next();
    if (!v) throw new AuditQueryError(`Unterminated "in (...)" list`);
    if (v.kind === "punct" && v.value === ")") break;
    if (v.kind === "punct" && v.value === ",") continue;
    values.push(valueOf(v));
  }
  return values;
}

function applyTerm(filters: AuditFilterState, field: string, op: string, value: string): void {
  const eqOnly = () => {
    if (op !== "=" && op !== "~") {
      throw new AuditQueryError(`Operator "${op}" is not supported for ${field} in simple mode`);
    }
  };
  switch (field) {
    case "category":
      // `=` is an exact category; `~` is a substring, expanded against the
      // known vocabulary when lowered (the store only matches exactly).
      if (op === "~") filters.categoryContains.push(value);
      else if (op === "=") filters.categories.push(value);
      else throw new AuditQueryError(`Operator "${op}" is not supported for category in simple mode`);
      break;
    case "source":
      eqOnly();
      filters.source = value;
      break;
    case "severity":
      eqOnly();
      filters.severity = value;
      break;
    case "actor":
    case "actor.name":
    case "actor.id":
      eqOnly();
      filters.actor = value;
      break;
    case "target":
    case "target.name":
    case "target.id":
      eqOnly();
      filters.target = value;
      break;
    case "channel":
    case "channel.id":
      eqOnly();
      filters.channel = value;
      break;
    case "text":
      eqOnly();
      filters.text = [filters.text, value].filter(Boolean).join(" ").trim();
      break;
    case "ts": {
      if (op !== ">" && op !== ">=") {
        throw new AuditQueryError(
          `Only "ts > now-<duration>" is supported in simple mode - use the until picker or SQL mode`,
        );
      }
      const token = timeHelperToken(value);
      if (!token) {
        throw new AuditQueryError(`Expected a time helper like now-7d, got "${value}"`);
      }
      filters.since = token;
      break;
    }
    default:
      throw new AuditQueryError(`Unknown field "${field}"`);
  }
}

// -- Serializer (filters -> canonical DSL text) --------------------

function quoteIfNeeded(v: string): string {
  return /^[\w.\-*]+$/.test(v) ? v : `"${v.replaceAll('"', "")}"`;
}

/** Write canonical simple-mode text for the given filter state. */
export function serializeAuditQuery(filters: AuditFilterState): string {
  const terms: string[] = [];
  if (filters.categories.length === 1) {
    terms.push(`category = ${quoteIfNeeded(filters.categories[0])}`);
  } else if (filters.categories.length > 1) {
    terms.push(`category in (${filters.categories.map(quoteIfNeeded).join(", ")})`);
  }
  for (const c of filters.categoryContains) {
    terms.push(`category ~ ${quoteIfNeeded(c)}`);
  }
  if (filters.source) terms.push(`source = ${quoteIfNeeded(filters.source)}`);
  if (filters.severity) terms.push(`severity = ${quoteIfNeeded(filters.severity)}`);
  if (filters.actor) terms.push(`actor = ${quoteIfNeeded(filters.actor)}`);
  if (filters.target) terms.push(`target = ${quoteIfNeeded(filters.target)}`);
  if (filters.channel) terms.push(`channel = ${filters.channel}`);
  if (filters.since) terms.push(`ts > now-${filters.since}`);
  if (filters.text) terms.push(quoteIfNeeded(filters.text));
  return terms.join(" and ");
}

// -- Lowering (filters -> wire args) -------------------------------

/**
 * Lower filter state to the structured wire query.
 *
 * `resolveUser` maps display names to user ids for the actor/target pills;
 * numeric input is used directly. Unresolvable names throw so the UI can
 * explain instead of silently returning everything.
 */
export function lowerToQueryArgs(
  filters: AuditFilterState,
  resolveUser: UserResolver,
  limit?: number,
  knownCategories: readonly string[] = [],
): AuditQueryArgs {
  const args: AuditQueryArgs = {};
  // Exact categories pass through; `~` substrings expand against the known
  // vocabulary (the store matches `category IN (...)` exactly, so `~ kick`
  // becomes the concrete `audit.kick`). An unmatched substring is kept
  // verbatim so the query is honest about matching nothing.
  const cats = new Set(filters.categories);
  for (const token of filters.categoryContains) {
    const needle = token.toLowerCase();
    const hits = knownCategories.filter((k) => k.toLowerCase().includes(needle));
    if (hits.length > 0) hits.forEach((h) => cats.add(h));
    else cats.add(token);
  }
  if (cats.size > 0) args.categories = [...cats];
  if (filters.source) args.source = filters.source;
  if (filters.severity) args.severity = filters.severity;
  if (filters.channel) {
    const id = Number(filters.channel);
    if (!Number.isInteger(id) || id < 0) {
      throw new AuditQueryError(`Channel must be a numeric id, got "${filters.channel}"`);
    }
    args.channelId = id;
  }
  const user = (raw: string, label: string): number => {
    if (/^\d+$/.test(raw)) return Number(raw);
    const id = resolveUser(raw);
    if (id == null) {
      throw new AuditQueryError(`Unknown ${label} "${raw}" - use a numeric user id`);
    }
    return id;
  };
  if (filters.actor) args.actorUserId = user(filters.actor, "actor");
  if (filters.target) args.targetUserId = user(filters.target, "target");
  if (filters.text) args.text = filters.text;
  if (filters.since) {
    const since = parseTimeHelper(`now-${filters.since}`);
    if (since == null) throw new AuditQueryError(`Bad duration "${filters.since}"`);
    args.sinceMs = since;
  }
  if (limit != null) args.limit = limit;
  return args;
}
