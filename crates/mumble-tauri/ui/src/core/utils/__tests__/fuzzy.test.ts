import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyMatchAny } from "../fuzzy";

describe("fuzzyMatch", () => {
  it("matches an in-order subsequence, case-insensitively", () => {
    expect(fuzzyMatch("abc", "a-b-c")).toBe(true);
    expect(fuzzyMatch("ABC", "alpha beta charlie")).toBe(true);
    expect(fuzzyMatch("img", "image.png")).toBe(true);
  });

  it("rejects out-of-order or missing characters", () => {
    expect(fuzzyMatch("cba", "abc")).toBe(false);
    expect(fuzzyMatch("xyz", "abc")).toBe(false);
  });

  it("treats an empty query as a match", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
  });
});

describe("fuzzyMatchAny", () => {
  it("matches when any field matches and ignores null/undefined", () => {
    expect(fuzzyMatchAny("png", ["report.pdf", "image.png", null])).toBe(true);
    expect(fuzzyMatchAny("zzz", ["a", undefined, "b"])).toBe(false);
    expect(fuzzyMatchAny("", ["a"])).toBe(true);
  });
});
