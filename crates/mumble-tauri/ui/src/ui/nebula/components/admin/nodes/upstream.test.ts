import { describe, expect, it } from "vitest";
import { upstreamClosures } from "./graph";
import type { Edge } from "./graph";

/**
 * What each node on a canvas is allowed to be affected by.
 *
 * This is not a tidiness question. The canvas leaves a node's card alone when
 * nothing it reads has changed, and this is what "reads" means - so a closure
 * that came back short would leave a preview showing yesterday's text with
 * nothing on screen to say so.
 */
const wire = (id: string, from: string, to: string): Edge => ({ id, from, to, port: "a" });

/** a → b → c, with d feeding c as well. */
const CHAIN: Edge[] = [wire("1", "a", "b"), wire("2", "b", "c"), wire("3", "d", "c")];

describe("upstream closures", () => {
  it("reaches all the way back, not just one wire", () => {
    // The whole point: `c` shows something derived from `a`, two wires away,
    // so an edit to `a` has to count as an edit to `c`.
    const closures = upstreamClosures(CHAIN);
    expect([...(closures?.get("c") ?? [])].sort()).toEqual(["a", "b", "d"]);
  });

  it("gives a node with one feeder just that feeder", () => {
    expect([...(upstreamClosures(CHAIN)?.get("b") ?? [])]).toEqual(["a"]);
  });

  it("says nothing at all about a node nothing feeds", () => {
    // Absent rather than empty is the same answer here, and it is the one the
    // canvas turns into a shared empty array rather than a fresh one per node.
    expect(upstreamClosures(CHAIN)?.get("a")).toBeUndefined();
  });

  it("does not let anything downstream leak in", () => {
    // `b` feeds `c`, so `c` may depend on `b` - never the other way round.
    expect(upstreamClosures(CHAIN)?.get("b")).not.toContain("c");
  });

  it("collects a diamond once, from both sides", () => {
    const diamond = [wire("1", "top", "left"), wire("2", "top", "right"), wire("3", "left", "end"), wire("4", "right", "end")];
    expect([...(upstreamClosures(diamond)?.get("end") ?? [])].sort()).toEqual(["left", "right", "top"]);
  });

  it("gives up on a graph with a loop in it rather than answering short", () => {
    // A canvas refuses to draw one, but a stored document can hold one, and a
    // half-walked loop yields a closure that is missing nodes. Answering
    // `null` is what makes every card redraw unconditionally instead.
    const loop = [wire("1", "a", "b"), wire("2", "b", "c"), wire("3", "c", "a")];
    expect(upstreamClosures(loop)).toBeNull();
  });

  it("has nothing to say about a canvas with no wires on it", () => {
    expect(upstreamClosures([])?.size).toBe(0);
  });
});
