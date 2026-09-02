/**
 * A node graph, and the rules every node graph obeys.
 *
 * Nothing in this module knows what a node *means*. It knows that a wire leaves
 * an output and lands on an input, that a port holds either one wire or many,
 * and that a graph is a graph rather than a loop - and it asks the calling
 * dialect about everything else. The welcome-message editor and the onboarding
 * editor are two dialects over exactly this shape.
 *
 * The one rule the whole design rests on, and the reason nothing here throws:
 * **an incomplete graph is not an error, it is a graph that is not finished.**
 * An operator wires a gate before wiring its second input. Whether a graph may
 * be *saved* is a separate question, and one only a dialect can answer.
 */

/** A node's identity. Opaque; only equality is ever asked of it. */
export type NodeId = string;

/** Which socket on a node a wire leaves by, or lands on. */
export type PortId = string;

/** What every node has, whatever else its dialect gives it. */
export interface GraphNode {
  readonly id: NodeId;
  readonly kind: string;
  x: number;
  y: number;
}

export interface Edge {
  readonly id: string;
  readonly from: NodeId;
  /**
   * The output the wire leaves by. Absent means `out`, which is the whole
   * story for a dialect whose nodes answer one question each.
   */
  readonly fromPort?: PortId;
  readonly to: NodeId;
  readonly port: PortId;
}

export interface NodeGraph<N extends GraphNode> {
  readonly nodes: readonly N[];
  readonly edges: readonly Edge[];
  /** Off means the graph does nothing, without losing what was drawn. */
  readonly enabled: boolean;
}

/** The default output name, for the many nodes that have exactly one. */
export const OUT: PortId = "out";

export const fromPortOf = (edge: Edge): PortId => edge.fromPort ?? OUT;

/** One wire, as the canvas hands it over at the moment of a drop. */
export interface Link {
  readonly from: NodeId;
  readonly fromPort?: PortId;
  readonly to: NodeId;
  readonly port: PortId;
}

/**
 * What a dialect has to say about wiring before the engine can enforce it.
 *
 * The full `NodeSpec` is one of these with a way to draw itself; the graph
 * functions ask for no more than this, so they stay testable without a DOM.
 */
export interface Wiring<N extends GraphNode> {
  inputs(node: N): readonly PortId[];
  outputs(node: N): readonly PortId[];
  /**
   * Whether a port holds several wires. Every port is single unless this says
   * otherwise, on both sides: re-dragging a single port replaces what held it,
   * which is how a mis-wired graph is corrected without hunting for an X.
   */
  multi?(node: N, port: PortId): boolean;
  /**
   * Kind-specific legality, on top of the rules every graph obeys. `fromPort`
   * is the output the wire leaves by, which is what distinguishes a node's
   * several outputs from one another.
   */
  accepts?(source: N, target: N, port: PortId, fromPort: PortId): boolean;
  /**
   * Whether this node's answer can still be undecided.
   *
   * `inherit` takes it from the node's inputs, which is what a combinator
   * does; a node that settles an undecided answer says `settled`, and one
   * that reads an optional fact says `undecided`. A dialect that says nothing
   * has no third state, and every port on it is drawn as settled.
   */
  undecided?(node: N): "settled" | "undecided" | "inherit";
}

export const nodeOf = <N extends GraphNode>(graph: NodeGraph<N>, id: NodeId): N | undefined =>
  graph.nodes.find((node) => node.id === id);

const holdsMany = <N extends GraphNode>(wiring: Wiring<N>, node: N, port: PortId): boolean =>
  wiring.multi?.(node, port) ?? false;

/**
 * Whether a wire may be drawn.
 *
 * Refused rather than drawn-and-marked-invalid: a wire the graph cannot mean is
 * one the operator has to find and delete later, and the canvas already knows
 * at the moment of the drop.
 */
export function canConnect<N extends GraphNode>(graph: NodeGraph<N>, wiring: Wiring<N>, link: Link): boolean {
  if (link.from === link.to) return false;
  const source = nodeOf(graph, link.from);
  const target = nodeOf(graph, link.to);
  if (!source || !target) return false;
  if (!wiring.outputs(source).includes(link.fromPort ?? OUT)) return false;
  if (!wiring.inputs(target).includes(link.port)) return false;
  if (wiring.accepts && !wiring.accepts(source, target, link.port, link.fromPort ?? OUT)) return false;

  // The wire `from -> to` closes a loop exactly when `to` is already upstream
  // of `from`, so that is the question asked - not whether `from` is upstream
  // of `to`, which is the same words in the wrong order and always false for a
  // wire worth refusing.
  return !dependsOn(graph, link.from, link.to);
}

/** Whether `node` already draws on `target`, directly or through other nodes. */
export function dependsOn<N extends GraphNode>(graph: NodeGraph<N>, node: NodeId, target: NodeId): boolean {
  const seen = new Set<NodeId>();
  const walk = (id: NodeId): boolean => {
    if (id === target) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return graph.edges.filter((edge) => edge.to === id).some((edge) => walk(edge.from));
  };
  return walk(node);
}

/** Add a wire, replacing whatever held either single-wire end of it. */
export function connect<N extends GraphNode>(
  graph: NodeGraph<N>,
  wiring: Wiring<N>,
  link: Link,
): NodeGraph<N> {
  if (!canConnect(graph, wiring, link)) return graph;
  const source = nodeOf(graph, link.from)!;
  const target = nodeOf(graph, link.to)!;
  const fromPort = link.fromPort ?? OUT;
  const singleIn = !holdsMany(wiring, target, link.port);
  const singleOut = !holdsMany(wiring, source, fromPort);

  const kept = graph.edges.filter((edge) => {
    // The same wire twice is one wire, whichever end is single.
    if (
      edge.from === link.from &&
      fromPortOf(edge) === fromPort &&
      edge.to === link.to &&
      edge.port === link.port
    )
      return false;
    if (singleIn && edge.to === link.to && edge.port === link.port) return false;
    if (singleOut && edge.from === link.from && fromPortOf(edge) === fromPort) return false;
    return true;
  });

  // `out` is left off rather than written down: a dialect whose nodes have one
  // output each produces edges with no source port at all, which is the shape
  // the server's own greeting document has. Spelling the default out here would
  // make every welcome edge carry a field the wire format has nowhere to put.
  const edge: Edge =
    fromPort === OUT
      ? { id: `e${nextId()}`, from: link.from, to: link.to, port: link.port }
      : { id: `e${nextId()}`, from: link.from, fromPort, to: link.to, port: link.port };
  return { ...graph, edges: [...kept, edge] };
}

export function disconnect<N extends GraphNode>(graph: NodeGraph<N>, edgeId: string): NodeGraph<N> {
  return { ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) };
}

/** Remove a node and every wire that touched it. */
export function removeNode<N extends GraphNode>(graph: NodeGraph<N>, id: NodeId): NodeGraph<N> {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== id),
    edges: graph.edges.filter((edge) => edge.from !== id && edge.to !== id),
  };
}

export function patchNode<N extends GraphNode>(
  graph: NodeGraph<N>,
  id: NodeId,
  patch: Partial<N>,
): NodeGraph<N> {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === id ? ({ ...node, ...patch } as N) : node)),
  };
}

/* -- Reading the wiring --------------------------------------------------- */

/** The wires landing on `port` of `node`, in the order they were drawn. */
export function edgesInto<N extends GraphNode>(graph: NodeGraph<N>, node: NodeId, port: PortId): Edge[] {
  return graph.edges.filter((edge) => edge.to === node && edge.port === port);
}

/** The nodes feeding `port` of `node`, in wiring order. */
export function sourcesOf<N extends GraphNode>(graph: NodeGraph<N>, node: NodeId, port: PortId): N[] {
  return edgesInto(graph, node, port)
    .map((edge) => nodeOf(graph, edge.from))
    .filter((node): node is N => node !== undefined);
}

/** The one node feeding a single-wire port. */
export function sourceOf<N extends GraphNode>(
  graph: NodeGraph<N>,
  node: NodeId,
  port: PortId,
): N | undefined {
  return sourcesOf(graph, node, port)[0];
}

/** The nodes `port` of `node` feeds, in wiring order. */
export function targetsOf<N extends GraphNode>(graph: NodeGraph<N>, node: NodeId, port: PortId = OUT): N[] {
  return graph.edges
    .filter((edge) => edge.from === node && fromPortOf(edge) === port)
    .map((edge) => nodeOf(graph, edge.to))
    .filter((node): node is N => node !== undefined);
}

/** How many wires leave this node at all - the `2×` badge on a shared node. */
export function usesOf<N extends GraphNode>(graph: NodeGraph<N>, id: NodeId): number {
  return graph.edges.filter((edge) => edge.from === id).length;
}

/** How many wires land on this node at all. */
export function feedsOf<N extends GraphNode>(graph: NodeGraph<N>, id: NodeId): number {
  return graph.edges.filter((edge) => edge.to === id).length;
}

/**
 * Whether this node's answer can still be undecided.
 *
 * A property of the drawing rather than of any one visitor: it asks whether
 * there is *some* case for which this wire has no answer. The canvas draws the
 * two differently, so the third state is visible before it silently costs
 * somebody the thing the graph was drawn to do.
 *
 * A cycle answers `true` - it is unfinished rather than settled - though
 * `canConnect` refuses to draw one in the first place.
 */
export function mayBeUnknown<N extends GraphNode>(
  graph: NodeGraph<N>,
  wiring: Wiring<N>,
  id: NodeId,
): boolean {
  const walk = (nodeId: NodeId, seen: Set<NodeId>): boolean => {
    if (seen.has(nodeId)) return true;
    seen.add(nodeId);
    const node = nodeOf(graph, nodeId);
    if (!node) return true;
    const state = wiring.undecided?.(node) ?? "settled";
    if (state !== "inherit") return state === "undecided";
    // An unwired input is undecided rather than settled: a half-drawn
    // combinator has no answer at all, which is the stronger of the two.
    return wiring.inputs(node).some((port) => {
      const edge = edgesInto(graph, node.id, port)[0];
      return !edge || walk(edge.from, seen);
    });
  };
  return walk(id, new Set());
}

let counter = 0;

/** An id no graph in this session has used. */
export function nextId(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}`;
}
