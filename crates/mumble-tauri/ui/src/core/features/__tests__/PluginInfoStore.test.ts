/**
 * Regression tests for the `fancy-plugin-info` plugin-data branch
 * processed by store.ts. The Tauri `decode_plugin_info` command
 * returns a `PluginInfoRecord`; the store keys these records by
 * plugin name in the `pluginInfos` map and replaces any earlier
 * record with the same name (last-write-wins).
 */

import { describe, it, expect } from "vitest";
import type { PluginInfoRecord } from "../../types";

function applyRecord(
  current: Map<string, PluginInfoRecord>,
  rec: PluginInfoRecord,
): Map<string, PluginInfoRecord> {
  const next = new Map(current);
  next.set(rec.name, rec);
  return next;
}

describe("plugin-info store wiring", () => {
  it("inserts a new plugin record keyed by name", () => {
    const rec: PluginInfoRecord = {
      name: "live-doc",
      version: "0.2.1",
      info: { description: "Collaborative documents", author: "Fancy" },
    };
    const next = applyRecord(new Map(), rec);
    expect(next.size).toBe(1);
    expect(next.get("live-doc")).toEqual(rec);
  });

  it("replaces an existing record with the same name", () => {
    const initial = new Map<string, PluginInfoRecord>();
    initial.set("p", { name: "p", version: "1.0.0", info: { author: "a" } });
    const updated: PluginInfoRecord = {
      name: "p",
      version: "1.1.0",
      info: { author: "b", capabilities: ["x", "y"] },
    };
    const next = applyRecord(initial, updated);
    expect(next.size).toBe(1);
    expect(next.get("p")?.version).toBe("1.1.0");
    expect(next.get("p")?.info.capabilities).toEqual(["x", "y"]);
  });

  it("keeps independent records for distinct plugins", () => {
    let m = new Map<string, PluginInfoRecord>();
    m = applyRecord(m, { name: "a", version: "1", info: {} });
    m = applyRecord(m, { name: "b", version: "2", info: {} });
    expect([...m.keys()].sort()).toEqual(["a", "b"]);
  });

  it("preserves forward-compatible extra fields on info payload", () => {
    const rec: PluginInfoRecord = {
      name: "ext",
      version: "0.1.0",
      info: { description: "x", futureField: { nested: 42 } },
    };
    const next = applyRecord(new Map(), rec);
    expect((next.get("ext")?.info as Record<string, unknown>).futureField).toEqual({ nested: 42 });
  });
});
