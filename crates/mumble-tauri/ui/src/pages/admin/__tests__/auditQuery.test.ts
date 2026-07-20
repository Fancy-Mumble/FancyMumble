/**
 * Dual-mode audit search: the simple-mode DSL must round-trip with the
 * filter pills (parse ⇄ serialize), lower to the exact wire args the
 * backend expects, reject what simple mode cannot express with a helpful
 * error, and route SQL to advanced mode untouched.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AuditQueryError,
  EMPTY_FILTERS,
  isSqlQuery,
  lowerToQueryArgs,
  parseAuditQuery,
  serializeAuditQuery,
  type AuditFilterState,
} from "../auditQuery";

const noUsers = () => undefined;

afterEach(() => {
  vi.useRealTimers();
});

describe("isSqlQuery", () => {
  it("routes SELECT / WITH to advanced mode, case-insensitively", () => {
    expect(isSqlQuery("SELECT * FROM audit_entries")).toBe(true);
    expect(isSqlQuery("  with recent as (select 1) select * from recent")).toBe(true);
  });

  it("keeps DSL and free text in simple mode", () => {
    expect(isSqlQuery('category = "ban"')).toBe(false);
    expect(isSqlQuery("selection process")).toBe(false); // word prefix != keyword
  });
});

describe("parseAuditQuery", () => {
  it("parses the design-doc example shape", () => {
    const f = parseAuditQuery('category = "ban" and target.name ~ "troll" and ts > now-7d and actor.name = "mod3"');
    expect(f.categories).toEqual(["ban"]);
    expect(f.target).toBe("troll");
    expect(f.since).toBe("7d");
    expect(f.actor).toBe("mod3");
  });

  it("parses category in (...) lists", () => {
    const f = parseAuditQuery('category in ("ban", kick, "mute")');
    expect(f.categories).toEqual(["ban", "kick", "mute"]);
  });

  it("collects bare words as free text", () => {
    const f = parseAuditQuery("spam wave");
    expect(f.text).toBe("spam wave");
  });

  it("parses source / severity / channel terms", () => {
    const f = parseAuditQuery("source = plugin and severity = critical and channel = 5");
    expect(f.source).toBe("plugin");
    expect(f.severity).toBe("critical");
    expect(f.channel).toBe("5");
  });

  it("rejects or / not with a pointer to SQL mode", () => {
    expect(() => parseAuditQuery('category = "ban" or category = "kick"')).toThrow(/SQL mode/);
  });

  it("rejects unknown operators for a field", () => {
    expect(() => parseAuditQuery("severity > info")).toThrow(AuditQueryError);
  });

  it("rejects unterminated strings", () => {
    expect(() => parseAuditQuery('category = "ban')).toThrow(/Unterminated/);
  });

  it("rejects a bad ts helper", () => {
    expect(() => parseAuditQuery("ts > yesterday")).toThrow(/now-7d/);
  });
});

describe("serializeAuditQuery (two-way binding)", () => {
  it("writes canonical text that parses back to the same filters", () => {
    const filters: AuditFilterState = {
      ...EMPTY_FILTERS,
      categories: ["ban", "kick"],
      source: "server",
      severity: "warning",
      actor: "mod3",
      target: "troll guy",
      channel: "5",
      text: "spam",
      since: "7d",
    };
    const text = serializeAuditQuery(filters);
    expect(text).toContain('category in (ban, kick)');
    expect(text).toContain('target = "troll guy"');
    const roundTripped = parseAuditQuery(text);
    expect(roundTripped).toEqual(filters);
  });

  it("emits nothing for empty filters", () => {
    expect(serializeAuditQuery({ ...EMPTY_FILTERS, categories: [] })).toBe("");
  });
});

describe("lowerToQueryArgs", () => {
  it("lowers filters to the wire arg shape", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const args = lowerToQueryArgs(
      {
        ...EMPTY_FILTERS,
        categories: ["ban"],
        source: "server",
        severity: "critical",
        actor: "42",
        target: "mod3",
        channel: "7",
        text: "spam",
        since: "24h",
      },
      (name) => (name === "mod3" ? 9 : undefined),
      200,
    );
    expect(args).toEqual({
      categories: ["ban"],
      source: "server",
      severity: "critical",
      actorUserId: 42,
      targetUserId: 9,
      channelId: 7,
      text: "spam",
      sinceMs: 1_700_000_000_000 - 24 * 3_600_000,
      limit: 200,
    });
  });

  it("expands a `~` category substring against the known vocabulary", () => {
    // The store matches categories exactly; `~ kick` must become `audit.kick`.
    const known = ["audit.ban", "audit.kick", "audit.acl", "signal.report"];
    const f = parseAuditQuery("category ~ kick");
    expect(f.categoryContains).toEqual(["kick"]);
    expect(f.categories).toEqual([]);
    const args = lowerToQueryArgs(f, noUsers, undefined, known);
    expect(args.categories).toEqual(["audit.kick"]);
  });

  it("unions exact and expanded categories, keeping an unmatched substring verbatim", () => {
    const known = ["audit.ban", "audit.kick"];
    const args = lowerToQueryArgs(
      { ...EMPTY_FILTERS, categories: ["audit.ban"], categoryContains: ["kick", "nope"] },
      noUsers,
      undefined,
      known,
    );
    expect(args.categories).toEqual(["audit.ban", "audit.kick", "nope"]);
  });

  it("round-trips a `~` category term through serialize/parse", () => {
    const text = serializeAuditQuery({ ...EMPTY_FILTERS, categoryContains: ["kick"] });
    expect(text).toBe("category ~ kick");
    expect(parseAuditQuery(text)).toEqual({ ...EMPTY_FILTERS, categoryContains: ["kick"] });
  });

  it("throws on an unresolvable user name", () => {
    expect(() => lowerToQueryArgs({ ...EMPTY_FILTERS, actor: "ghost" }, noUsers)).toThrow(/Unknown actor/);
  });

  it("throws on a non-numeric channel", () => {
    expect(() => lowerToQueryArgs({ ...EMPTY_FILTERS, channel: "lobby" }, noUsers)).toThrow(/numeric/);
  });

  it("omits every unset filter from the wire args", () => {
    expect(lowerToQueryArgs({ ...EMPTY_FILTERS }, noUsers)).toEqual({});
  });
});
