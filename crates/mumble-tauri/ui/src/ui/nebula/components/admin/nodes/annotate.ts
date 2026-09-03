import { nextId, type GraphNode, type NodeGraph, type NodeId } from "./graph";
import type { Tone } from "./spec";

/**
 * The canvas's second layer: what an operator writes *about* the drawing.
 *
 * A graph of forty nodes is readable to whoever drew it that afternoon and to
 * nobody else, including them a month later. The wires say what the rule does
 * and there is nowhere to say why - why this filter resolves unknown to yes,
 * which cluster is the German branch, that the second greeting is deliberately
 * behind the first. So the canvas gets a layer for exactly that, and it is
 * furniture: nothing here has a port, takes part in a wire, or is read by
 * anything on the evaluation path.
 *
 * A separate layer rather than more node kinds, and that is the whole design
 * decision. Making a title a `GraphNode` would put a thing with no truth value
 * into every walk that asks a node whether it is true - `mayBeUnknown`,
 * `dependsOn`, the dialect's `status` - and each of those would then need a
 * case for "this one is furniture". It also keeps the dialects out of it: both
 * editors get annotations without either one growing a kind, because the layer
 * is the engine's.
 *
 * The server stores it the same way, for the same reason, and deliberately
 * leaves it out of the document digest - documenting a canvas is not editing
 * the rule (`GreetingAnnotation` in `serverconfig.proto`).
 */

/** The four things an operator writes on a canvas. */
export type AnnotationKind = "title" | "note" | "frame" | "label";

export interface Annotation {
  readonly id: NodeId;
  x: number;
  y: number;
  /**
   * How big the operator made it.
   *
   * Always set for an annotation, unlike a node's: a frame with no size is not
   * a frame, and a note is a box whose whole job is to be the size of what it
   * is next to.
   */
  w: number;
  h: number;
  readonly kind: AnnotationKind;
  /** Plain text. A note is read on the canvas; markup here would buy nothing. */
  text: string;
  /** Which of the canvas's four marks it carries. */
  tone: Tone;
}

/** What each kind is when it first lands, and how small it may be dragged. */
export const ANNOTATION_SIZES: Record<AnnotationKind, { w: number; h: number; minW: number; minH: number }> =
  {
    // A heading sits over a column of nodes, so it starts about that wide.
    title: { w: 260, h: 40, minW: 80, minH: 28 },
    note: { w: 260, h: 108, minW: 100, minH: 44 },
    // Big enough to have something in it already: a frame dropped at
    // label size reads as a mistake rather than as a region.
    frame: { w: 420, h: 300, minW: 80, minH: 60 },
    label: { w: 150, h: 26, minW: 50, minH: 20 },
  };

/** The words each kind starts with, so a fresh one is not an empty box. */
const PLACEHOLDERS: Record<AnnotationKind, string> = {
  title: "Section",
  note: "What this part of the graph is for, and why it is drawn this way.",
  frame: "Region",
  label: "label",
};

export function makeAnnotation(kind: AnnotationKind, x: number, y: number): Annotation {
  const size = ANNOTATION_SIZES[kind];
  return {
    id: `a${nextId()}`,
    x,
    y,
    w: size.w,
    h: size.h,
    kind,
    text: PLACEHOLDERS[kind],
    // Quiet by default: an annotation is there to be read when looked for, not
    // to compete with the nodes for the eye.
    tone: "muted",
  };
}

/** The layer, which is empty on a graph nobody has annotated. */
export function annotationsOf<N extends GraphNode>(graph: NodeGraph<N>): readonly Annotation[] {
  return graph.annotations ?? [];
}

export function addAnnotation<N extends GraphNode>(
  graph: NodeGraph<N>,
  annotation: Annotation,
): NodeGraph<N> {
  return { ...graph, annotations: [...annotationsOf(graph), annotation] };
}

export function patchAnnotation<N extends GraphNode>(
  graph: NodeGraph<N>,
  id: NodeId,
  patch: Partial<Annotation>,
): NodeGraph<N> {
  return {
    ...graph,
    annotations: annotationsOf(graph).map((note) => (note.id === id ? { ...note, ...patch } : note)),
  };
}

export function removeAnnotation<N extends GraphNode>(graph: NodeGraph<N>, id: NodeId): NodeGraph<N> {
  return { ...graph, annotations: annotationsOf(graph).filter((note) => note.id !== id) };
}

/**
 * The nodes a frame encloses.
 *
 * Geometric rather than stored, and that is deliberate: a frame is not a group
 * an operator has to maintain membership of, it is a rectangle. Dragging a node
 * into one puts it in, dragging it out takes it out, and there is no state that
 * can disagree with what is on screen.
 */
export function enclosedBy<N extends GraphNode>(
  graph: NodeGraph<N>,
  frame: Annotation,
  width: (node: N) => number,
  height: (node: N) => number,
): N[] {
  return graph.nodes.filter(
    (node) =>
      node.x >= frame.x &&
      node.y >= frame.y &&
      node.x + width(node) <= frame.x + frame.w &&
      node.y + height(node) <= frame.y + frame.h,
  );
}
