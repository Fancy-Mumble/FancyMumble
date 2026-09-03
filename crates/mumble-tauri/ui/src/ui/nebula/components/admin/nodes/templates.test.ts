import { describe as suite, expect, it } from "vitest";
import { insertFragment, offsetFor, wire, type Fragment } from "./templates";
import type { GraphNode, NodeGraph } from "./graph";

/**
 * The template engine, over a made-up dialect.
 *
 * Deliberately not the welcome one: everything this module does is about
 * positions, ids and wires, and testing it through a real catalogue would tie
 * the assertions to somebody's paragraph of German.
 */
interface Toy extends GraphNode {
  kind: "in" | "out";
}

const toy = (id: string, kind: Toy["kind"], x: number, y: number): Toy => ({ id, kind, x, y });

const WIDTH = () => 100;

function fragment(): Fragment<Toy> {
  const source = toy("f1", "in", 0, 0);
  const sink = toy("f2", "out", 200, 40);
  return { nodes: [source, sink], wires: [wire(source, sink, "a")] };
}

const empty: NodeGraph<Toy> = { nodes: [], edges: [], enabled: false };

const occupied: NodeGraph<Toy> = {
  nodes: [toy("a", "in", 30, 60), toy("b", "out", 400, 200)],
  edges: [{ id: "e0", from: "a", to: "b", port: "a" }],
  enabled: true,
};

suite("laying a template onto a graph", () => {
  it("puts a fragment on an empty canvas at the canvas's own margin", () => {
    const laid = insertFragment(empty, fragment(), { replace: false, width: WIDTH });
    expect(laid.graph.nodes.map((node) => [node.x, node.y])).toEqual([
      [30, 34],
      [230, 74],
    ]);
  });

  it("adds it clear of the right-hand edge of everything drawn", () => {
    // To the right rather than below, because a welcome graph reads left to
    // right - stacking would put a rule's conditions under another's greeting.
    const laid = insertFragment(occupied, fragment(), { replace: false, width: WIDTH });
    const added = laid.graph.nodes.slice(occupied.nodes.length);
    // 400 + 100 wide + the lane.
    expect(added[0].x).toBe(580);
    expect(added.every((node) => node.x >= 500)).toBe(true);
  });

  it("keeps the fragment's own shape while moving it", () => {
    const laid = insertFragment(occupied, fragment(), { replace: false, width: WIDTH });
    const added = laid.graph.nodes.slice(occupied.nodes.length);
    expect(added[1].x - added[0].x).toBe(200);
    expect(added[1].y - added[0].y).toBe(40);
  });

  it("keeps what was drawn, and its wires, when adding", () => {
    const laid = insertFragment(occupied, fragment(), { replace: false, width: WIDTH });
    expect(laid.graph.nodes).toHaveLength(4);
    expect(laid.graph.edges.map((edge) => edge.id)).toContain("e0");
    expect(laid.graph.edges).toHaveLength(2);
  });

  it("throws the canvas away when replacing", () => {
    const laid = insertFragment(occupied, fragment(), { replace: true, width: WIDTH });
    expect(laid.graph.nodes.map((node) => node.id)).toEqual(["f1", "f2"]);
    expect(laid.graph.edges).toHaveLength(1);
  });

  it("mints an id for every wire it draws", () => {
    const first = insertFragment(empty, fragment(), { replace: false, width: WIDTH });
    const second = insertFragment(first.graph, fragment(), { replace: false, width: WIDTH });
    const ids = second.graph.edges.map((edge) => edge.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves the default output off the wire, as the graph module does", () => {
    // A dialect whose nodes have one output each produces edges with no source
    // port at all, which is the shape the server's own document has.
    const laid = insertFragment(empty, fragment(), { replace: false, width: WIDTH });
    expect(laid.graph.edges[0].fromPort).toBeUndefined();
  });

  it("writes the output down when a wire leaves by a named one", () => {
    const source = toy("f1", "in", 0, 0);
    const sink = toy("f2", "out", 0, 0);
    const named: Fragment<Toy> = { nodes: [source, sink], wires: [wire(source, sink, "in", "picks")] };
    const laid = insertFragment(empty, named, { replace: false, width: WIDTH });
    expect(laid.graph.edges[0].fromPort).toBe("picks");
  });

  it("does not publish, or unpublish, the graph it lands on", () => {
    // Whether a graph is in force is a thing the operator switched. Loading a
    // template must not quietly broadcast a drawing, nor take a live one down.
    expect(insertFragment(empty, fragment(), { replace: true, width: WIDTH }).graph.enabled).toBe(false);
    expect(insertFragment(occupied, fragment(), { replace: true, width: WIDTH }).graph.enabled).toBe(true);
  });

  it("names what it added, so the canvas can select it", () => {
    const laid = insertFragment(occupied, fragment(), { replace: false, width: WIDTH });
    expect(laid.added).toEqual(["f1", "f2"]);
  });
});

suite("where a fragment lands", () => {
  it("starts at the margin on an empty canvas", () => {
    expect(offsetFor(empty, WIDTH)).toEqual({ dx: 30, dy: 34 });
  });

  it("lines a fragment up with the top of what is drawn", () => {
    // Level with the existing rule rather than at the origin: two rules side by
    // side read as two rules, and one hanging above the other reads as a mess.
    expect(offsetFor(occupied, WIDTH).dy).toBe(60);
  });
});
