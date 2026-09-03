import type { ComponentType } from "react";
import type { GraphNode, NodeGraph, PortId, Wiring } from "./graph";
import type { TemplateGallery } from "./templates";

/**
 * What one dialect of the node editor has to say about itself.
 *
 * The canvas draws nodes, wires and ports; it has no idea whether a node asks
 * where somebody is from or which channels an answer puts them in. Everything
 * that differs between the welcome-message editor and the onboarding editor is
 * one of these objects - the kinds on the palette, how a node draws its body,
 * what a finished graph is, and the words the chrome says.
 *
 * A spec is built by the page, so it may close over anything the page has: the
 * translation function, the server's channel list, who a preview is pretending
 * to greet. That is why the editor takes a spec rather than a set of props.
 */

/** The four marks a node can carry, as palette keys rather than colours. */
export type Tone = "accent" | "ok" | "warn" | "muted";

/** Which side of a node a port sits on. */
export type PortSide = "in" | "out";

export interface GraphStatus {
  readonly complete: boolean;
  /** What is missing, in the order an operator would fix it. Empty when complete. */
  readonly problems: readonly string[];
}

/** What a node's body is handed, and everything it may do. */
export interface NodeBodyProps<N extends GraphNode> {
  readonly node: N;
  readonly graph: NodeGraph<N>;
  readonly onPatch: (patch: Partial<N>) => void;
}

/** What a node's attachment - a preview hung under the card - is handed. */
export interface NodeAttachmentProps<N extends GraphNode> {
  readonly node: N;
  readonly graph: NodeGraph<N>;
}

/** One end of a wire, as the browser prints it: "A · condition". */
export interface PortSummary {
  /** The port's own name, where it has one. A single port usually does not. */
  readonly name?: string;
  /** What travels on it - a condition, prose - which is what may be wired. */
  readonly type: string;
}

/**
 * One thing an operator can add, as the block browser describes it.
 *
 * A block is not a node kind: seven of them make a `gate`, each with its own
 * operator already chosen. That is the point - "XNOR" is a thing somebody
 * looks for by name, and "a logic gate you then have to configure" is not.
 */
export interface BlockDef<N extends GraphNode> {
  /** Unique within the dialect. The favourite and the search key off it. */
  readonly id: string;
  readonly label: string;
  /** One line, in the browser's card: what this block is true of. */
  readonly description: string;
  /** The section it is filed under, as the caption reads. */
  readonly category: string;
  readonly tone: Tone;
  /** A fresh node of this block, wherever it is dropped. */
  create(x: number, y: number): N;
  readonly inputs: readonly PortSummary[];
  readonly outputs: readonly PortSummary[];
  /**
   * Whether this block's node has ports that depend on what is written in it.
   *
   * True for exactly one kind of thing so far - a design block, whose input
   * ports *are* its declared signature - and it exists so the browser card can
   * say "one per input the design declares" honestly, instead of naming ports
   * that do not exist until somebody adds an input.
   *
   * Every other block promises the card and the node agree exactly, which is
   * what the block tests hold them to.
   */
  readonly dynamicPorts?: boolean;
}

/** The chrome's own words, so the editor itself needs no translation table. */
export interface EditorStrings {
  /** The action on a block's card. */
  readonly add: string;
  /** The button that opens the block browser. */
  readonly browse: string;
  readonly search: string;
  readonly favorites: string;
  /** Said in place of the sections when a search matches nothing. */
  readonly noMatches: string;
  readonly complete: string;
  readonly toFix: (count: number) => string;
  readonly reset: string;
  /** The badge that says this graph is the one in force. */
  readonly live: string;
  /** The badge that says it is drawn but does nothing. */
  readonly idle: string;
  readonly enabled: string;
}

export interface NodeSpec<N extends GraphNode> extends Wiring<N> {
  /** Which dialect this is. Keys the operator's starred blocks. */
  readonly id: string;
  /** What an operator may add, in the order the browser lists it. */
  readonly blocks: readonly BlockDef<N>[];
  /**
   * Finished drawings to start from, in the order the gallery lists them.
   *
   * Absent where a dialect has none, and the gallery button is then not
   * offered at all - an empty gallery behind a button is worse than no button,
   * because it costs a click to learn there is nothing there.
   */
  readonly templates?: TemplateGallery<N>;
  /** The header caption of a node: short and shouted. */
  label(node: N): string;
  /** How wide this node sits. Fixed per kind, so the canvas reads as a grid. */
  width(node: N): number;
  /**
   * The mark a node carries, in its header square and on its palette chip.
   *
   * By kind alone, so the palette can ask before a node exists: an operator
   * scanning a full canvas is looking for a kind of question, not an instance.
   */
  tone(node: Pick<N, "kind">): Tone;
  /**
   * Whether this node may be dragged bigger, and how small it may go.
   *
   * Per node rather than per dialect, because within one dialect it differs:
   * a node holding a document somebody is writing wants to be as wide as the
   * writing, and an AND gate has one dropdown on it and nothing a wider box
   * would show. A dialect that says nothing has no resizing at all, which is
   * the right answer for an editor whose nodes are all one field.
   */
  resizable?(node: N): boolean;
  /** The smallest this node may be dragged. Only asked of a resizable one. */
  minSize?(node: N): { w: number; h: number };
  /**
   * Whether this dialect keeps an annotation layer.
   *
   * Off unless the dialect can *store* one: offering titles and notes on a
   * canvas whose document has nowhere to put them means an operator writes
   * documentation and loses it on the next save, which is worse than not
   * offering it.
   */
  readonly annotate?: boolean;
  /**
   * Where a port sits on its node, in pixels from the node's top - or a CSS
   * length, for the many nodes whose one port sits in the middle.
   *
   * A port has to line up with the row it belongs to, or the operator is
   * guessing which wire they are about to replace.
   */
  portTop(node: N, port: PortId, index: number, side: PortSide): number | string;
  /** What a wire landing on `port` carries, which is what colours it. */
  wireTone(port: PortId): Tone;
  body: ComponentType<NodeBodyProps<N>>;
  /** The small count in a node's header - how many wires use it, and so on. */
  badge?(graph: NodeGraph<N>, node: N): string | null;
  /** Hung under the card: the preview that belongs to *this* node. */
  attachment?: ComponentType<NodeAttachmentProps<N>>;
  /** A node drawn as the surface everything else leads to. */
  emphasise?(node: N): boolean;
  /**
   * Why this port is drawn as a ring rather than a dot, or null when it is
   * settled. The returned sentence is its tooltip.
   */
  warnPort?(graph: NodeGraph<N>, node: N, port: PortId, side: PortSide): string | null;
  /** What still has to be drawn before this graph may be sent. */
  status(graph: NodeGraph<N>): GraphStatus;
  /**
   * Whether the graph does anything at all, for the badge in the footer.
   *
   * A graph can be enabled, complete and still reach nobody - the greeting
   * with nothing wired into WHEN is the case that costs an operator a day -
   * so the badge says `idle` rather than `live` and the sentence beside it
   * says why. Absent means the badge only follows the enabled switch.
   */
  liveness?(graph: NodeGraph<N>): "live" | "idle";
  readonly strings: EditorStrings;
}

/** How much taller than a node's box its attachment may run, for the extent. */
export const NODE_FOOTPRINT = 260;
