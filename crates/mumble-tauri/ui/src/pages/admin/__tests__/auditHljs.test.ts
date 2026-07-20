/**
 * Audit highlighting rides on the shared highlight.js pipeline: a custom
 * grammar for the simple-mode DSL and hljs's built-in `sql`. We assert the
 * classification each dialect needs and, above all, that tokenization stays
 * lossless (concatenated text == source) so the overlay lines up.
 */

import { describe, it, expect } from "vitest";
import hljs from "highlight.js/lib/common";
import { auditTokens, AUDIT_DSL_LANGUAGE } from "../auditHljs";
import type { HljsToken } from "../../../components/chat/markdown/hljsTokens";

const text = (toks: HljsToken[]) => toks.map((t) => t.text).join("");
/** Classes present for a given source token (there may be several). */
const clsOf = (toks: HljsToken[], word: string) =>
  toks.filter((t) => t.text === word).map((t) => t.cls);

describe("auditTokens - DSL", () => {
  it("is lossless, even with operators hljs would escape", () => {
    for (const q of [
      "",
      "category ~ kick and ts > now-7d",
      'actor = "bad troll" and severity=critical',
      "channel = 5 and text ~ spam",
    ]) {
      expect(text(auditTokens(hljs, q, AUDIT_DSL_LANGUAGE))).toBe(q);
    }
  });

  it("colours fields, joiners, operators, durations and strings", () => {
    const toks = auditTokens(hljs, 'category ~ kick and ts > now-7d and actor = "mod3"', AUDIT_DSL_LANGUAGE);
    expect(clsOf(toks, "category")[0]).toContain("built_in");
    expect(clsOf(toks, "ts")[0]).toContain("built_in");
    expect(clsOf(toks, "and")[0]).toContain("keyword");
    expect(clsOf(toks, "~")[0]).toContain("operator");
    expect(clsOf(toks, "now-7d")[0]).toContain("number");
    expect(clsOf(toks, '"mod3"')[0]).toContain("string");
  });
});

describe("auditTokens - SQL (built-in grammar)", () => {
  it("is lossless including comments and newlines", () => {
    for (const q of [
      "SELECT * FROM audit_entries WHERE category = 'audit.ban'",
      "select id, ts\nfrom audit_entries -- newest\norder by id desc",
    ]) {
      expect(text(auditTokens(hljs, q, "sql"))).toBe(q);
    }
  });

  it("colours SQL keywords and string literals", () => {
    const toks = auditTokens(hljs, "SELECT * FROM audit_entries WHERE category = 'audit.ban'", "sql");
    expect(clsOf(toks, "SELECT")[0]).toContain("keyword");
    expect(clsOf(toks, "'audit.ban'")[0]).toContain("string");
  });
});

describe("auditTokens - fallbacks", () => {
  it("returns one plain token when hljs is not loaded", () => {
    expect(auditTokens(null, "category = ban", AUDIT_DSL_LANGUAGE)).toEqual([
      { text: "category = ban", cls: "" },
    ]);
  });

  it("returns plain text for an unknown language", () => {
    expect(auditTokens(hljs, "whatever", "no-such-lang")).toEqual([
      { text: "whatever", cls: "" },
    ]);
  });
});
