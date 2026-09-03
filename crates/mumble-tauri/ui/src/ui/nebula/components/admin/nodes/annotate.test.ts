import { describe as suite, expect, it } from "vitest";
import {
  ANNOTATION_SIZES,
  addAnnotation,
  annotationsOf,
  enclosedBy,
  makeAnnotation,
  patchAnnotation,
  removeAnnotation,
} from "./annotate";
import type { GraphNode, NodeGraph } from "./graph";

interface Toy extends GraphNode {
  kind: "toy";
}

const toy = (id: string, x: number, y: number): Toy => ({ id, kind: "toy", x, y });

const empty: NodeGraph<Toy> = { nodes: [], edges: [], enabled: true };

suite("the annotation layer", () => {
  it("is empty on a graph nobody has annotated", () => {
    // Including every graph stored before the layer existed, which is why the
    // field is optional rather than an empty array everybody has to write.
    expect(annotationsOf(empty)).toEqual([]);
  });

  it("gives a fresh note a size and some words", () => {
    const note = makeAnnotation("note", 10, 20);
    expect(note.w).toBe(ANNOTATION_SIZES.note.w);
    // Not an empty box: one of those on a canvas reads as a rendering fault
    // rather than as something to type into.
    expect(note.text).not.toBe("");
    expect(note.tone).toBe("muted");
  });

  it("adds, edits and removes without touching the nodes", () => {
    const note = makeAnnotation("title", 0, 0);
    const withNote = addAnnotation(empty, note);
    expect(annotationsOf(withNote)).toHaveLength(1);

    const edited = patchAnnotation(withNote, note.id, { text: "Conditions", tone: "accent" });
    expect(annotationsOf(edited)[0].text).toBe("Conditions");
    expect(annotationsOf(edited)[0].tone).toBe("accent");

    const gone = removeAnnotation(edited, note.id);
    expect(annotationsOf(gone)).toEqual([]);
    expect(gone.nodes).toBe(empty.nodes);
  });

  it("gives every note its own id", () => {
    const ids = ["title", "note", "frame", "label"].map((kind) => makeAnnotation(kind as "title", 0, 0).id);
    expect(new Set(ids).size).toBe(4);
  });
});

suite("what a frame encloses", () => {
  const frame = makeAnnotation("frame", 100, 100);

  it("is whatever is inside the rectangle, and nothing stored", () => {
    // Geometric on purpose: a frame is not a group whose membership somebody
    // has to maintain, so there is no stored list that can disagree with what
    // is plainly on screen.
    const graph: NodeGraph<Toy> = {
      ...empty,
      nodes: [toy("in", 120, 120), toy("out", 900, 900), toy("half", 90, 120)],
    };
    const inside = enclosedBy(
      graph,
      frame,
      () => 60,
      () => 40,
    );
    expect(inside.map((node) => node.id)).toEqual(["in"]);
  });

  it("takes a node in the moment it is dragged inside", () => {
    const before: NodeGraph<Toy> = { ...empty, nodes: [toy("n", 900, 900)] };
    const after: NodeGraph<Toy> = { ...empty, nodes: [toy("n", 150, 150)] };
    const size = () => 60;
    expect(enclosedBy(before, frame, size, size)).toHaveLength(0);
    expect(enclosedBy(after, frame, size, size)).toHaveLength(1);
  });
});
