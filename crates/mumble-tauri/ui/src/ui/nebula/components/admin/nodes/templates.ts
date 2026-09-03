/**
 * Graph templates: a drawing an operator starts from rather than draws.
 *
 * A node canvas is the right way to *edit* a rule and a poor way to *begin*
 * one. An operator opening the welcome editor for the first time is looking at
 * an empty grid and a palette of eighteen blocks, and the thing they wanted -
 * "greet people who just got here, nicely" - is six nodes, four wires and a
 * paragraph of markup away. A template is those six nodes, already wired and
 * already written, dropped onto the canvas as a starting point they can then
 * take apart.
 *
 * Nothing here knows what a node means. A template is a `Fragment` - nodes
 * carrying real ids and wires between them - and this module offsets it,
 * appends it and mints the edge ids. Which fragments exist, and what they say,
 * is the dialect's business, exactly as its blocks are.
 *
 * Ids are minted by the fragment rather than remapped here. A `build()` calls
 * the dialect's own `makeNode`, which draws from the same counter every other
 * node does, so the nodes arrive unique and the wires can name them directly -
 * there is no template-local id space to translate out of, and so no way for a
 * translation to go wrong.
 */

import { nextId, type Edge, type GraphNode, type NodeGraph, type NodeId, type PortId } from "./graph";
import type { Tone } from "./spec";

/** One wire inside a fragment, naming nodes the same fragment carries. */
export interface TemplateWire {
  readonly from: NodeId;
  /** The output it leaves by. Absent means `out`, as everywhere else. */
  readonly fromPort?: PortId;
  readonly to: NodeId;
  readonly port: PortId;
}

/**
 * What a template draws.
 *
 * Positions are the fragment's own, measured from its top-left corner: a
 * fragment is laid out as though it were the only thing on the canvas, and
 * where it actually lands is decided at the moment it is inserted.
 */
export interface Fragment<N extends GraphNode> {
  readonly nodes: readonly N[];
  readonly wires: readonly TemplateWire[];
}

/**
 * One thing an operator can start from, as the gallery describes it.
 *
 * `shows` is the sentence the finished rule reads back as - the same sentence
 * the status bar will say once it is on the canvas. It is on the card because
 * it is the one thing that distinguishes two templates whose descriptions both
 * begin "a warm welcome for": who actually gets it.
 */
export interface GraphTemplate<N extends GraphNode> {
  /** Unique within the dialect. */
  readonly id: string;
  readonly label: string;
  /** One or two lines: what this draws, and when to reach for it. */
  readonly description: string;
  /** The section it is filed under, as the caption reads. */
  readonly category: string;
  readonly tone: Tone;
  /** Who the drawn rule reaches, in the words the status bar uses. */
  readonly shows?: string;
  /**
   * The markup this template's message carries, for the card to render.
   *
   * A gallery of formatted messages has to be *looked* at: two templates whose
   * descriptions both say "a warm welcome with the house rules" are told apart
   * by their headings, their spacing and their colour, and by nothing a
   * sentence can say. Named by the dialect rather than dug out of the fragment,
   * because only the dialect knows which of its nodes is the one people read.
   */
  readonly preview?: string;
  /** The drawing, built fresh - so adding one twice gives two of them. */
  build(): Fragment<N>;
}

/**
 * The gallery's own words, so the editor itself needs no translation table.
 *
 * Beside the templates rather than in `EditorStrings`, because the two arrive
 * together or not at all: a dialect with nothing to start from does not have to
 * translate the words for a gallery it never shows, and one that has templates
 * cannot forget to.
 */
export interface TemplateStrings {
  /** The button in the bar that opens the gallery. */
  readonly open: string;
  /** Said in place of the cards when a search matches nothing. */
  readonly empty: string;
  /** The action that puts a template beside what is already drawn. */
  readonly add: string;
  /** The action that throws the canvas away and draws the template instead. */
  readonly replace: string;
  /** Warned before replacing, and only when there is something to lose. */
  readonly replaceHint: string;
}

/**
 * A dialect's gallery: what can be started from, and what to call it.
 *
 * One optional thing on the spec rather than two, so there is no state in which
 * a dialect has templates and no words for them.
 */
export interface TemplateGallery<N extends GraphNode> {
  readonly items: readonly GraphTemplate<N>[];
  readonly strings: TemplateStrings;
}

/**
 * What a canvas that is on screen can do with a template.
 *
 * Handed up to the chrome the way a block drop is, and for the same reason:
 * inserting is the canvas's business, because it owns the view the operator is
 * looking through and the selection the new nodes should arrive in. The chrome
 * has neither, and a template dropped somewhere off-screen with nothing
 * selected is a template that looks like it did nothing at all.
 */
export interface CanvasInsert<N extends GraphNode> {
  insert(fragment: Fragment<N>, replace: boolean): void;
}

/** How far to the right of everything drawn a fragment is dropped. */
const LANE = 80;

/**
 * Where a fragment has to move to sit clear of what is already drawn.
 *
 * To the right rather than below, because a welcome graph reads left to right -
 * conditions, then logic, then the greeting - and a second rule stacked
 * underneath the first would put its conditions under the first one's greeting.
 */
export function offsetFor<N extends GraphNode>(
  graph: NodeGraph<N>,
  width: (node: N) => number,
): { dx: number; dy: number } {
  if (graph.nodes.length === 0) return { dx: 30, dy: 34 };
  const right = graph.nodes.reduce((max, node) => Math.max(max, node.x + width(node)), 0);
  const top = graph.nodes.reduce((min, node) => Math.min(min, node.y), Number.POSITIVE_INFINITY);
  return { dx: Math.round(right + LANE), dy: Math.round(top) };
}

/**
 * Put a fragment onto a graph.
 *
 * `replace` throws away what was drawn, which is what "start from this" means
 * on an empty-ish canvas; otherwise the fragment is added beside it, which is
 * how a server ends up with a second greeting for a second audience.
 *
 * `enabled` is deliberately left alone. Whether a graph is in force is a thing
 * the operator turned on or off, and a template is a drawing - loading one must
 * not quietly publish it, nor quietly take the live graph off the air.
 */
export function insertFragment<N extends GraphNode>(
  graph: NodeGraph<N>,
  fragment: Fragment<N>,
  options: Readonly<{ replace: boolean; width: (node: N) => number }>,
): { graph: NodeGraph<N>; added: readonly NodeId[] } {
  const base: NodeGraph<N> = options.replace ? { ...graph, nodes: [], edges: [] } : graph;
  const { dx, dy } = offsetFor(base, options.width);

  const moved = fragment.nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy }));
  const edges: Edge[] = fragment.wires.map((wire) =>
    wire.fromPort === undefined
      ? { id: `e${nextId()}`, from: wire.from, to: wire.to, port: wire.port }
      : { id: `e${nextId()}`, from: wire.from, fromPort: wire.fromPort, to: wire.to, port: wire.port },
  );

  return {
    graph: { ...base, nodes: [...base.nodes, ...moved], edges: [...base.edges, ...edges] },
    added: moved.map((node) => node.id),
  };
}

/**
 * A wire between two nodes a fragment is building, for readable catalogues.
 *
 * Takes the nodes rather than their ids, and takes them as bare `GraphNode`s -
 * the two ends of a wire are usually two *different* kinds, and a signature
 * that tied them to one type parameter would refuse the commonest wire there
 * is. Nothing here reads more than an id.
 */
export function wire(from: GraphNode, to: GraphNode, port: PortId, fromPort?: PortId): TemplateWire {
  return fromPort === undefined
    ? { from: from.id, to: to.id, port }
    : { from: from.id, fromPort, to: to.id, port };
}
