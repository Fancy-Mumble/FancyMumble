import { describe, expect, it } from "vitest";
import { reconcileList, reconcileSet, sameEntry } from "./reconcile";

interface Row {
  id: number;
  name: string;
  muted?: boolean;
  tags?: string[];
}

const row = (id: number, name: string, extra: Partial<Row> = {}): Row => ({ id, name, ...extra });

describe("sameEntry", () => {
  it("accepts two records that say the same thing", () => {
    expect(sameEntry(row(1, "Sebi"), row(1, "Sebi"))).toBe(true);
  });

  it("rejects one that differs in any field", () => {
    expect(sameEntry(row(1, "Sebi"), row(1, "Zewi"))).toBe(false);
    expect(sameEntry(row(1, "Sebi", { muted: true }), row(1, "Sebi", { muted: false }))).toBe(false);
  });

  it("rejects one that has gained or lost a field", () => {
    // A field that is present and undefined is still a field: the two records
    // came off different versions of the wire and are not interchangeable.
    expect(sameEntry(row(1, "Sebi"), { ...row(1, "Sebi"), muted: undefined })).toBe(false);
  });

  it("compares a list-valued field by its elements", () => {
    expect(sameEntry(row(1, "Sebi", { tags: ["a", "b"] }), row(1, "Sebi", { tags: ["a", "b"] }))).toBe(true);
    expect(sameEntry(row(1, "Sebi", { tags: ["a"] }), row(1, "Sebi", { tags: ["b"] }))).toBe(false);
  });
});

describe("reconcileList", () => {
  const keyOf = (entry: Row) => entry.id;

  it("hands back the list it already had when nothing has changed", () => {
    const prev = [row(1, "Sebi"), row(2, "Zewi")];
    const next = [row(1, "Sebi"), row(2, "Zewi")];
    // The identity is the point: this is what stops a re-render of everything
    // that selected the list.
    expect(reconcileList(prev, next, keyOf)).toBe(prev);
  });

  it("keeps the entries that did not change when one did", () => {
    const prev = [row(1, "Sebi"), row(2, "Zewi")];
    const next = [row(1, "Sebi"), row(2, "Zewi", { muted: true })];
    const merged = reconcileList(prev, next, keyOf);

    expect(merged).not.toBe(prev);
    expect(merged[0]).toBe(prev[0]);
    expect(merged[1]).toBe(next[1]);
  });

  it("matches by key rather than by position", () => {
    // Somebody joining at the top must not make strangers of everyone below.
    const prev = [row(1, "Sebi"), row(2, "Zewi")];
    const next = [row(3, "New"), row(1, "Sebi"), row(2, "Zewi")];
    const merged = reconcileList(prev, next, keyOf);

    expect(merged[1]).toBe(prev[0]);
    expect(merged[2]).toBe(prev[1]);
  });

  it("notices a list that only got shorter", () => {
    const prev = [row(1, "Sebi"), row(2, "Zewi")];
    const merged = reconcileList(prev, [row(1, "Sebi")], keyOf);

    expect(merged).not.toBe(prev);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(prev[0]);
  });

  it("notices a reordering, while keeping the people in it", () => {
    const prev = [row(1, "Sebi"), row(2, "Zewi")];
    const merged = reconcileList(prev, [row(2, "Zewi"), row(1, "Sebi")], keyOf);

    expect(merged).not.toBe(prev);
    expect(merged[0]).toBe(prev[1]);
    expect(merged[1]).toBe(prev[0]);
  });
});

describe("reconcileSet", () => {
  it("hands back the set it already had for the same members", () => {
    const prev = new Set([1, 2, 3]);
    expect(reconcileSet(prev, [3, 2, 1])).toBe(prev);
  });

  it("builds a new one when a member joins or leaves", () => {
    const prev = new Set([1, 2]);
    expect(reconcileSet(prev, [1, 2, 3])).not.toBe(prev);
    expect(reconcileSet(prev, [1])).not.toBe(prev);
  });
});
