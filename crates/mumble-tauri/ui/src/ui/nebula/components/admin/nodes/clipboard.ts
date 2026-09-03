import { annotationsOf, type Annotation } from "./annotate";
import { fromPortOf, nextId, type Edge, type GraphNode, type NodeGraph, type NodeId } from "./graph";

/**
 * Copy and paste on a node canvas.
 *
 * A selection is nodes, the notes among them, and **the wires wholly inside
 * it**. That last part is the whole of the design: a wire with one end outside
 * the selection has no meaning once it is pasted somewhere else, and carrying
 * it would either dangle or silently re-attach to whatever happened to be
 * there. Copying four conditions and their filters gives you four conditions
 * and their filters, wired as they were; copying the filters alone gives you
 * four unwired filters, which is what was selected.
 *
 * Ids are minted fresh on *paste*, not on copy, so one copy pastes any number
 * of times and each is its own drawing.
 */

/** What a copy holds. Plain data, so it survives a trip through JSON. */
export interface Clipping<N extends GraphNode> {
  readonly nodes: readonly N[];
  readonly edges: readonly Edge[];
  readonly annotations: readonly Annotation[];
}

/** The tag that says a clipboard string came from a canvas like this one. */
const FORMAT = "fancy-mumble/node-clipping@1";

/**
 * The selection, lifted out of the graph.
 *
 * `null` when nothing selected is actually on the canvas, so a caller can tell
 * "copied nothing" from "copied an empty thing" without inspecting the result.
 */
export function copyOut<N extends GraphNode>(
  graph: NodeGraph<N>,
  selection: ReadonlySet<NodeId>,
): Clipping<N> | null {
  const nodes = graph.nodes.filter((node) => selection.has(node.id));
  const annotations = annotationsOf(graph).filter((note) => selection.has(note.id));
  if (nodes.length === 0 && annotations.length === 0) return null;

  const inside = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    // Both ends inside, always. See the note above: half a wire is not a wire.
    edges: graph.edges.filter((edge) => inside.has(edge.from) && inside.has(edge.to)),
    annotations,
  };
}

/**
 * Put a clipping down with `at` as its top-left corner.
 *
 * Every id is minted here rather than carried, and the wires are remapped onto
 * the new ones - so pasting beside the original gives two independent drawings
 * rather than two views of one.
 */
export function pasteInto<N extends GraphNode>(
  graph: NodeGraph<N>,
  clip: Clipping<N>,
  at: { x: number; y: number },
): { graph: NodeGraph<N>; added: readonly NodeId[] } {
  const corner = originOf(clip);
  const dx = Math.round(at.x - corner.x);
  const dy = Math.round(at.y - corner.y);

  const renamed = new Map<NodeId, NodeId>();
  const nodes = clip.nodes.map((node) => {
    const id = `n${nextId()}`;
    renamed.set(node.id, id);
    return { ...node, id, x: Math.max(0, node.x + dx), y: Math.max(0, node.y + dy) };
  });
  const annotations = clip.annotations.map((note) => ({
    ...note,
    id: `a${nextId()}`,
    x: Math.max(0, note.x + dx),
    y: Math.max(0, note.y + dy),
  }));

  const edges: Edge[] = clip.edges.flatMap((edge) => {
    const from = renamed.get(edge.from);
    const to = renamed.get(edge.to);
    if (from === undefined || to === undefined) return [];
    const port = fromPortOf(edge);
    return [
      port === "out"
        ? { id: `e${nextId()}`, from, to, port: edge.port }
        : { id: `e${nextId()}`, from, fromPort: port, to, port: edge.port },
    ];
  });

  return {
    graph: {
      ...graph,
      nodes: [...graph.nodes, ...nodes],
      edges: [...graph.edges, ...edges],
      annotations: [...annotationsOf(graph), ...annotations],
    },
    // The notes too: everything that arrived is selected, so the whole paste
    // moves as one and one Delete undoes it.
    added: [...nodes.map((node) => node.id), ...annotations.map((note) => note.id)],
  };
}

/** The top-left corner of everything in a clipping. */
function originOf<N extends GraphNode>(clip: Clipping<N>): { x: number; y: number } {
  const boxes = [...clip.nodes, ...clip.annotations];
  return {
    x: boxes.reduce((min, box) => Math.min(min, box.x), Number.POSITIVE_INFINITY),
    y: boxes.reduce((min, box) => Math.min(min, box.y), Number.POSITIVE_INFINITY),
  };
}

/* -- The system clipboard ------------------------------------------------- */

/**
 * A clipping as text, so a copy can leave this window.
 *
 * Two editors open on two servers is the ordinary way somebody moves a rule
 * they like from one to the other, and an in-memory clipboard cannot do it. The
 * text is tagged, so pasting something that is *not* a clipping - a URL, a
 * paragraph - is recognised as not one rather than parsed into a broken graph.
 */
export function encodeClipping<N extends GraphNode>(clip: Clipping<N>): string {
  return JSON.stringify({ format: FORMAT, ...clip });
}

/** A clipping read back, or null for text that is not one. */
export function decodeClipping<N extends GraphNode>(text: string): Clipping<N> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const held = parsed as Partial<Clipping<N>> & { format?: unknown };
    if (held.format !== FORMAT || !Array.isArray(held.nodes)) return null;
    return {
      nodes: held.nodes,
      edges: Array.isArray(held.edges) ? held.edges : [],
      annotations: Array.isArray(held.annotations) ? held.annotations : [],
    };
  } catch {
    // Anything unparseable is simply not a clipping. Pasting a sentence onto a
    // canvas should do nothing, not raise.
    return null;
  }
}
