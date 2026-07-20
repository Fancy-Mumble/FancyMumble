/**
 * Context-aware autocomplete for the simple-mode audit DSL: at each caret
 * position the engine must offer the grammatically-next thing (field →
 * operator → value → `and`), pull values from live domains, tolerate
 * half-typed input, and report the exact span an accepted suggestion replaces.
 */

import { describe, it, expect } from "vitest";
import {
  suggestAudit,
  SUGGEST_FIELDS,
  type AuditSuggestContext,
} from "../auditSuggest";

const ctx: AuditSuggestContext = {
  categories: ["ban", "kick", "acl", "channel"],
  userNames: ["mod3", "Alice", "bad troll"],
  channels: [
    { id: 4, name: "Lobby" },
    { id: 7, name: "AFK" },
  ],
};

/** Suggest at the end of `text` (the common "just typed this" case). */
const at = (text: string, caret = text.length) => suggestAudit(text, caret, ctx);
const labels = (text: string, caret = text.length) =>
  at(text, caret).suggestions.map((s) => s.label);

describe("field context", () => {
  it("offers every field on an empty query", () => {
    expect(labels("")).toEqual([...SUGGEST_FIELDS]);
  });

  it("prefix-filters fields by the partial word", () => {
    expect(labels("cat")).toEqual(["category"]);
    // startsWith hits rank first; `ts` follows as a substring match.
    expect(labels("s")).toEqual(["source", "severity", "ts"]);
  });

  it("reports the span covering the partial field word", () => {
    const r = at("cat");
    expect([r.from, r.to]).toEqual([0, 3]);
    expect(r.word).toBe("cat");
  });

  it("returns to field context after `and`", () => {
    expect(labels("source = client and ")).toEqual([...SUGGEST_FIELDS]);
  });
});

describe("operator context", () => {
  it("offers the operators a scalar field accepts", () => {
    expect(labels("severity ")).toEqual(["=", "~"]);
  });

  it("adds `in` for category and time ops for ts", () => {
    expect(labels("category ")).toEqual(["=", "~", "in"]);
    expect(labels("ts ")).toEqual([">", ">="]);
  });
});

describe("value context", () => {
  it("offers the enum domain for source and severity", () => {
    expect(labels("source = ")).toEqual(["server", "client", "plugin"]);
    expect(labels("severity = ")).toEqual(["info", "notice", "warning", "critical"]);
  });

  it("offers live categories and now-helpers", () => {
    expect(labels("category = ")).toEqual(["ban", "kick", "acl", "channel"]);
    expect(labels("ts > ")).toContain("now-7d");
  });

  it("completes user names for actor/target and quotes when needed", () => {
    const r = at("actor = ");
    expect(r.suggestions.map((s) => s.label)).toEqual(["mod3", "Alice", "bad troll"]);
    const troll = r.suggestions.find((s) => s.label === "bad troll");
    expect(troll?.apply).toBe('"bad troll" '); // spaces force quoting
  });

  it("labels channels by name but applies the numeric id", () => {
    const r = at("channel = ");
    expect(r.suggestions.map((s) => s.label)).toEqual(["Lobby", "AFK"]);
    expect(r.suggestions[0].apply).toBe("4 ");
    expect(r.suggestions[0].detail).toBe("#4");
  });

  it("filters values by prefix", () => {
    expect(labels("source = cl")).toEqual(["client"]);
  });
});

describe("quoted and in-list values", () => {
  it("stays in value context inside an unterminated quote and swallows the quote", () => {
    const text = 'actor = "Al';
    const r = at(text);
    expect(r.word).toBe("Al");
    expect(r.from).toBe(text.indexOf('"')); // replacement span includes the quote
    expect(r.suggestions.map((s) => s.label)).toEqual(["Alice"]);
  });

  it("keeps offering categories inside `category in (` until the list closes", () => {
    expect(labels("category in (ban, ")).toEqual(["ban", "kick", "acl", "channel"]);
    // After the list closes, we move on to `and`.
    expect(labels("category in (ban) ")).toEqual(["and"]);
  });
});

describe("and context", () => {
  it("suggests `and` after a completed term", () => {
    expect(labels("source = client ")).toEqual(["and"]);
    expect(labels('actor = "mod3" ')).toEqual(["and"]);
  });
});

describe("splice correctness", () => {
  it("accepting mid-word replaces only [from,to)", () => {
    const text = "sev";
    const r = at(text);
    const s = r.suggestions[0]; // severity
    const spliced = text.slice(0, r.from) + s.apply + text.slice(r.to);
    expect(spliced).toBe("severity ");
  });

  it("computes a caret-interior span, not just end-of-text", () => {
    // caret sits right after `cli` in the middle of the string
    const text = "source = cli and severity = info";
    const caret = "source = cli".length;
    const r = suggestAudit(text, caret, ctx);
    expect(r.word).toBe("cli");
    expect(r.suggestions.map((s) => s.label)).toEqual(["client"]);
    expect([r.from, r.to]).toEqual([9, 12]);
  });
});
