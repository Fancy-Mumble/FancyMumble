/**
 * Audit store behaviour: command wrappers must invoke the Tauri commands
 * with the exact argument shape the backend expects, and the appliers must
 * enforce the correlation / pagination / live-tail / revision rules.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

import { useAuditStore, AUDIT_PAGE_LIMIT } from "../auditStore";
import type { AuditEntry, AuditQueryArgs } from "../../../types";

function entry(id: number, over: Partial<AuditEntry> = {}): AuditEntry {
  return { id, ts: id * 1000, source: "server", category: "ban", severity: "info", ...over };
}

/** The args of the most recent query_audit_log invocation. */
function lastSentArgs(): AuditQueryArgs {
  const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === "query_audit_log");
  const call = calls[calls.length - 1];
  if (!call) throw new Error("query_audit_log was never invoked");
  return (call[1] as { args: AuditQueryArgs }).args;
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  useAuditStore.getState().clearAudit();
});

describe("runQuery", () => {
  it("stamps a queryId, default limit, and the live flag", async () => {
    await useAuditStore.getState().runQuery({ categories: ["ban"] });

    const sent = lastSentArgs();
    expect(sent.categories).toEqual(["ban"]);
    expect(sent.limit).toBe(AUDIT_PAGE_LIMIT);
    expect(sent.subscribe).toBe(false);
    expect(sent.queryId).toBeTruthy();
    expect(useAuditStore.getState().loading).toBe(true);
  });

  it("clears loading and records the error when the send fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("not connected"));
    await useAuditStore.getState().runQuery({});
    expect(useAuditStore.getState().loading).toBe(false);
    expect(useAuditStore.getState().error).toMatch(/not connected/);
  });
});

describe("applyResponse", () => {
  it("applies the response matching the current queryId", async () => {
    await useAuditStore.getState().runQuery({});
    const qid = lastSentArgs().queryId;

    useAuditStore.getState().applyResponse({
      queryId: qid,
      entries: [entry(3), entry(2)],
      hasMore: true,
      nextBeforeId: 2,
    });

    const s = useAuditStore.getState();
    expect(s.entries.map((e) => e.id)).toEqual([3, 2]);
    expect(s.hasMore).toBe(true);
    expect(s.nextBeforeId).toBe(2);
    expect(s.loading).toBe(false);
  });

  it("drops a stale response (wrong queryId)", async () => {
    await useAuditStore.getState().runQuery({});
    useAuditStore.getState().applyResponse({
      queryId: "stale-id",
      entries: [entry(99)],
      hasMore: false,
    });
    expect(useAuditStore.getState().entries).toEqual([]);
    expect(useAuditStore.getState().loading).toBe(true); // still waiting
  });

  it("appends on pagination and replaces on a fresh query", async () => {
    await useAuditStore.getState().runQuery({});
    useAuditStore.getState().applyResponse({
      queryId: lastSentArgs().queryId,
      entries: [entry(5), entry(4)],
      hasMore: true,
      nextBeforeId: 4,
    });

    await useAuditStore.getState().loadMore();
    const pageArgs = lastSentArgs();
    expect(pageArgs.beforeId).toBe(4);
    expect(pageArgs.subscribe).toBe(false);

    useAuditStore.getState().applyResponse({
      queryId: pageArgs.queryId,
      entries: [entry(3), entry(2)],
      hasMore: false,
    });
    expect(useAuditStore.getState().entries.map((e) => e.id)).toEqual([5, 4, 3, 2]);
    expect(useAuditStore.getState().hasMore).toBe(false);
  });

  it("surfaces a server rejection as the store error", async () => {
    await useAuditStore.getState().runQuery({ sql: "SELECT nope" });
    useAuditStore.getState().applyResponse({
      queryId: lastSentArgs().queryId,
      entries: [],
      hasMore: false,
      error: "advanced SQL unavailable",
    });
    expect(useAuditStore.getState().error).toBe("advanced SQL unavailable");
  });

  it("records a chain verification result", async () => {
    await useAuditStore.getState().verifyChain();
    const sent = lastSentArgs();
    expect(sent.verifyChain).toBe(true);

    useAuditStore.getState().applyResponse({
      queryId: sent.queryId,
      entries: [],
      hasMore: false,
      chainOk: true,
      chainHeight: 1234,
    });
    expect(useAuditStore.getState().chain).toMatchObject({ verifying: false, ok: true, height: 1234 });
  });
});

describe("applyEvent (live tail)", () => {
  it("prepends live entries only while live is on, deduplicating by id", async () => {
    useAuditStore.getState().applyEvent(entry(7));
    expect(useAuditStore.getState().entries).toEqual([]); // live off -> ignored

    await useAuditStore.getState().setLive(true);
    useAuditStore.getState().applyEvent(entry(7));
    useAuditStore.getState().applyEvent(entry(7)); // duplicate push
    useAuditStore.getState().applyEvent(entry(8));

    expect(useAuditStore.getState().entries.map((e) => e.id)).toEqual([8, 7]);
  });

  it("re-issues the current query with subscribe when toggling live", async () => {
    await useAuditStore.getState().runQuery({ categories: ["ban"] });
    await useAuditStore.getState().setLive(true);

    const sent = lastSentArgs();
    expect(sent.subscribe).toBe(true);
    expect(sent.categories).toEqual(["ban"]);
  });
});

describe("config", () => {
  it("applyConfig drops snapshots older than the current revision", () => {
    const cfg = (revision: number) => ({
      settings: [],
      revision,
      advancedSqlAvailable: false,
      chainHeight: 0,
    });
    useAuditStore.getState().applyConfig(cfg(5));
    useAuditStore.getState().applyConfig(cfg(3)); // stale
    expect(useAuditStore.getState().config?.revision).toBe(5);
    useAuditStore.getState().applyConfig(cfg(6));
    expect(useAuditStore.getState().config?.revision).toBe(6);
  });

  it("loadConfig pulls the backend cache", async () => {
    invokeMock.mockResolvedValueOnce({
      settings: [],
      revision: 2,
      advancedSqlAvailable: true,
      chainHeight: 10,
    });
    await useAuditStore.getState().loadConfig();
    expect(invokeMock).toHaveBeenCalledWith("get_audit_config", undefined);
    expect(useAuditStore.getState().config?.advancedSqlAvailable).toBe(true);
  });

  it("saveConfig sends the changed settings and clears busy", async () => {
    const changed = [{ key: "audit.ban.collect", type: "bool", group: "Audit", label: "", options: [], secret: false, value: "false" }];
    await useAuditStore.getState().saveConfig(changed);
    expect(invokeMock).toHaveBeenCalledWith("save_audit_config", { changed });
    expect(useAuditStore.getState().configBusy).toBe(false);
  });

  it("saveConfig surfaces a rejection and rethrows", async () => {
    invokeMock.mockRejectedValueOnce(new Error("denied"));
    await expect(useAuditStore.getState().saveConfig([])).rejects.toThrow();
    expect(useAuditStore.getState().configError).toMatch(/denied/);
  });
});

describe("clearAudit", () => {
  it("resets everything (disconnect / server switch)", async () => {
    await useAuditStore.getState().runQuery({});
    useAuditStore.getState().applyResponse({
      queryId: lastSentArgs().queryId,
      entries: [entry(1)],
      hasMore: true,
    });
    useAuditStore.getState().clearAudit();

    const s = useAuditStore.getState();
    expect(s.entries).toEqual([]);
    expect(s.hasMore).toBe(false);
    expect(s.live).toBe(false);
    expect(s.lastArgs).toBeNull();
    expect(s.config).toBeNull();
  });
});
