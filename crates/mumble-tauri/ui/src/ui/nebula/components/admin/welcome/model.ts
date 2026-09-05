/**
 * The welcome-message graph: what an operator draws, and what it compiles to.
 *
 * A greeting is chosen by a *condition*, and a condition is drawn rather than
 * typed. Everything about which greeting a person sees lives in this module as
 * plain data and pure functions - the canvas draws it, the server evaluates the
 * same shape, and neither needs the other to say what a graph means.
 *
 * The one rule the whole design rests on: **an incomplete graph is not an
 * error, it is a graph that is not finished.** An operator wires a gate before
 * wiring its second input. So nothing here throws, `describe` renders what it
 * can, and `graphStatus` is what decides whether the thing may be saved.
 */

import {
  OUT,
  canConnect as allowed,
  connect as wire,
  mayBeUnknown as undecidedAt,
  nextId,
  patchNode,
  type NodeGraph,
  type NodeId,
  type Wiring,
} from "../nodes/graph";
import type { GraphStatus } from "../nodes/spec";
import { MAX_BODY, composeMarkup, composePlain, escapeHtml, paragraphsOf, plainTextOf } from "./markup";
import {
  isWebUrl,
  makeSection,
  markupOfScreen,
  plainOfScreen,
  screenSpeaks,
  urlsOf,
  type Section,
} from "./layout";
import { legacyMarkupOfScreen } from "./qtHtml";
import { designProblems, removeInput, renameInput, type Design } from "./design";
import { assemble, compileTarget } from "./compile";
import type { Variant } from "./design";

/**
 * The identity, the wire and the graph are the engine's, not this file's.
 *
 * A welcome graph is one dialect of `NodeGraph`; the canvas that draws it and
 * the onboarding editor beside it are the same components over the same shape,
 * and the only thing this module adds is what the nodes *mean*.
 */
export type { Edge, NodeId } from "../nodes/graph";
export type { GraphStatus } from "../nodes/spec";
export { MAX_BODY, paragraphsOf, plainTextOf } from "./markup";
export {
  ALIGNMENTS,
  BAND_TONES,
  PICTURES,
  SECTION_FIELDS,
  SECTION_KINDS,
  SECTION_LABELS,
  ALIGNABLE,
  TONEABLE,
  isWebUrl,
  makeSection,
  markupOfScreen,
  plainOfScreen,
  screenSpeaks,
  urlsOf,
  type Align,
  type BandTone,
  type Picture,
  type Section,
  type SectionKind,
} from "./layout";
export { hexColours, legacyMarkupOfScreen, qtSafe, qtStyle, qtViolations } from "./qtHtml";
export * from "./design";
export { assemble, compileAll, compileTarget, rowsOf, type Part } from "./compile";
export {
  ANNOTATION_SIZES,
  addAnnotation,
  annotationsOf,
  makeAnnotation,
  patchAnnotation,
  removeAnnotation,
  type Annotation,
  type AnnotationKind,
} from "../nodes/annotate";

/** The comparisons a version condition offers. */
export type VersionOp = "<" | "<=" | "=" | ">=" | ">";

/**
 * The same comparisons, plus the one only the fork's own version has.
 *
 * `any` is true of every build of the fork's client and of nothing else, and it
 * is the op the node mostly wants: "is this one of ours" is the question, and
 * spelling it `>= 0.0.0` reads like a comparison that happens to be vacuous.
 */
export const FANCY_OPS = ["any", "<", "<=", "=", ">=", ">"] as const;
export type FancyOp = (typeof FANCY_OPS)[number];

/** How long someone has been on the server, as the mock words it. */
export type TenureOp = "less" | "more";

/** The windows the tenure dropdown offers, in the order it offers them. */
export const TENURE_WINDOWS = ["1 day", "1 week", "1 month", "6 months", "1 year"] as const;
export type TenureWindow = (typeof TENURE_WINDOWS)[number];

/** What an account can be, at the moment it arrives. */
export const ACCOUNT_STATES = ["guest", "registered", "strong certificate"] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

/**
 * The operating systems worth naming.
 *
 * A *normalised* set, not the raw `Version.os` string, because the two clients
 * spell it differently - the Fancy client sends `std::env::consts::OS`
 * (lowercase `windows`/`macos`/`linux`) and stock Mumble sends its own
 * capitalisation. An operator picking "Windows" from a list means both.
 */
export const OS_CHOICES = ["Windows", "macOS", "Linux", "BSD", "Android", "iOS"] as const;
export type OsChoice = (typeof OS_CHOICES)[number];

/**
 * The gates. `not` takes one input; the rest take two.
 *
 * `xnor` is the one some diagrams write as XAND: true when its two
 * inputs agree.
 */
export const GATE_KINDS = ["and", "or", "xor", "nand", "nor", "xnor", "not"] as const;
export type GateKind = (typeof GATE_KINDS)[number];

/**
 * What a filter turns an undecided answer into.
 *
 * Both directions are real. “I could not tell where they are from, so
 * not the German greeting” is `no`; “I could not tell whether their
 * client is current, so warn them anyway” is `yes`.
 */
export type UnknownAs = "yes" | "no";

/**
 * Which port on a node a wire lands on.
 *
 * The four fixed ones, plus `in:<name>` for every input a design declares.
 * A string rather than a closed union because a design block's ports are its
 * *signature*: an operator adds an input, and a port appears. Nothing else in
 * the dialect has ports that depend on what is written inside the node.
 */
export type PortId = string;

/** The fixed ports, for the places that name one. */
export const PORT = { a: "a", b: "b", when: "when", plus: "plus" } as const;

/** The port a design input is wired to. */
export const inputPort = (name: string): PortId => `in:${name}`;

/** The input a port names, or null for one of the fixed four. */
export function inputOfPort(port: PortId): string | null {
  return port.startsWith("in:") ? port.slice(3) : null;
}

/**
 * How a message node is being written.
 *
 * A property of the *editing*, not of the greeting: what goes on the wire is
 * the markup half and the plain half, and this only says which field the
 * operator is looking at. It is reconstructed on load from whether the node
 * arrived with markup, so it costs the wire format nothing.
 *
 * `plain` is a node with no markup at all - the text nodes this editor had
 * before, and still the right answer for one line of prose. `rich` is the
 * WYSIWYG. `source` is the markup itself, which is not a power-user
 * affordance: an editor is a schema, and a document it has no node for comes
 * back out of it *smaller*, so a welcome text written by hand years ago has to
 * be editable as what it is.
 *
 * `screen` is the fourth, and the only one that is not about markup at all: the
 * greeting is built from bands - a hero, a button, a row of links - which the
 * client draws in its own type scale. See `layout.ts`. A screen still carries
 * the markup and plain halves, generated from its bands, because that is what
 * every client that has never heard of a band will show.
 *
 * `legacy` is the same bands compiled for Mumble 1.5 and older, which draw a
 * greeting with Qt and render a subset of HTML 4 - no flexbox, no grid, no
 * rounded corners, and layout done with tables. See `qtHtml.ts`. It is a
 * separate view rather than a switch on the compiler because the two are
 * different *greetings*: an operator writes one for the old clients, wires it
 * behind a version condition, and the modern one behind the other half.
 */
export type BodyView = "plain" | "rich" | "source" | "screen" | "legacy" | "design";

interface Positioned {
  readonly id: NodeId;
  x: number;
  y: number;
  /**
   * How big the operator dragged it. Zero, or absent, means the default for
   * the kind - which is what every node nobody has resized has.
   */
  w?: number;
  h?: number;
}

export type WelcomeNode = Positioned &
  (
    | { kind: "country"; codes: string[] }
    | { kind: "tenure"; op: TenureOp; window: TenureWindow }
    | { kind: "clientVersion"; op: VersionOp; version: string }
    | { kind: "fancyVersion"; op: FancyOp; version: string }
    | { kind: "account"; state: AccountState }
    | { kind: "group"; group: string }
    | { kind: "os"; os: OsChoice }
    | { kind: "gate"; gate: GateKind }
    | { kind: "filter"; unknownAs: UnknownAs }
    | { kind: "text"; name: string; body: string; html: string; view: BodyView }
    | {
        kind: "greeting";
        body: string;
        once: boolean;
        html: string;
        view: BodyView;
        /** The bands, when this greeting is built as a screen. */
        sections: Section[];
        /**
         * The design, when this greeting is one.
         *
         * Absent for every greeting written as prose, which is most of them -
         * so a graph that never used a design reads exactly as it did before
         * designs existed.
         */
        design?: Design;
      }
  );

/** The two kinds somebody writes prose into. */
export type MessageNode = Extract<WelcomeNode, { kind: "text" | "greeting" }>;

/** The one that can be a whole welcome screen. Bands live only here. */
export type GreetingNode = Extract<WelcomeNode, { kind: "greeting" }>;

/** What a greeting reaching everybody reads as, in the status bar and the node. */
export const EVERYONE = "everyone who arrives";

/**
 * Whether this node is the "everybody" condition.
 *
 * A filter with nothing wired to it and `unknown` settling to yes. That is not
 * a trick played on the evaluator - it is what both evaluators already say: an
 * empty input is `unknown`, and this filter turns `unknown` into `yes`, on the
 * client (`verdictAt`) and on the server (`truth` in
 * `starling/crates/runtime/src/greeting.rs`) alike.
 *
 * Worth having a name for, because it is the simplest useful greeting there
 * is - "show this to everyone" - and until it had one the editor called it an
 * unfinished filter and refused to save the graph.
 */
export function isEveryone(graph: WelcomeGraph, node: WelcomeNode): boolean {
  return (
    node.kind === "filter" &&
    node.unknownAs === "yes" &&
    !graph.edges.some((edge) => edge.to === node.id && edge.port === "a")
  );
}

export function isMessage(node: WelcomeNode): node is MessageNode {
  return node.kind === "text" || node.kind === "greeting";
}

/**
 * The markup half this node puts on the wire.
 *
 * Empty for a plain node even when it still holds markup from before somebody
 * switched it: the node on screen shows plain text, and a node that showed one
 * thing and sent another would be the worst kind of bug to find - visible only
 * to the people arriving. Switching back within the session gets the markup
 * again, because it was kept; saving as plain is what discards it.
 */
export function markupOf(node: WelcomeNode): string {
  return isMessage(node) && node.view !== "plain" ? node.html : "";
}

/** Whether this greeting is built from bands, in either dialect. */
export function isScreen(node: WelcomeNode): boolean {
  return node.kind === "greeting" && (node.view === "screen" || node.view === "legacy");
}

/** The bands this greeting is built from, and none for every other node. */
export function sectionsOf(node: WelcomeNode): readonly Section[] {
  return node.kind === "greeting" && isScreen(node) ? node.sections : [];
}

/** Whether this greeting's markup is written for Qt rather than for a browser. */
export function isLegacy(node: WelcomeNode): boolean {
  return node.kind === "greeting" && node.view === "legacy";
}

/**
 * The patch that sets a screen's bands, and the two prose halves with them.
 *
 * The same invariant `writeMarkup` keeps, one level up: all three
 * representations of a greeting are written together, always, so a client that
 * understands bands and one that does not are never shown different greetings.
 */
export function writeSections(sections: Section[], view: BodyView = "screen"): Partial<GreetingNode> {
  return {
    sections,
    // The dialect the bands compile into is the whole difference between the
    // two views, and it is decided here rather than at each call site: a
    // screen edited in the legacy view that saved modern markup would look
    // right in this editor and collapse on every client it was written for.
    html: view === "legacy" ? legacyMarkupOfScreen(sections) : markupOfScreen(sections),
    body: plainOfScreen(sections),
  };
}

export type NodeKind = WelcomeNode["kind"];

/** A welcome graph: the nodes drawn, the wires between them, and whether it is on. */
export type WelcomeGraph = NodeGraph<WelcomeNode>;

/* -- Shape ---------------------------------------------------------------- */

/** The kinds that answer a yes/no question about the person arriving. */
const CONDITION_KINDS: readonly NodeKind[] = [
  "country",
  "tenure",
  "clientVersion",
  "fancyVersion",
  "account",
  "group",
  "os",
];

export function isCondition(node: WelcomeNode): boolean {
  return CONDITION_KINDS.includes(node.kind);
}

/** Which input ports a node offers. A condition offers none. */
export function inputsOf(node: WelcomeNode): readonly PortId[] {
  if (node.kind === "gate") return node.gate === "not" ? ["a"] : ["a", "b"];
  if (node.kind === "filter") return ["a"];
  if (node.kind !== "greeting") return [];
  // A design's ports are its signature: one per declared input, in the order
  // the design declares them, so the node reads top to bottom as the design's
  // own list does. `plus` stays for a greeting written as prose - a design has
  // slots instead, which is the same idea with a name and a position.
  const design = node.design;
  if (!design) return ["when", "plus"];
  return [
    "when",
    ...design.slots.map((input) => inputPort(input.name)),
    ...design.conditions.map((input) => inputPort(input.name)),
  ];
}

/**
 * Which of a design's inputs actually have a wire on them.
 *
 * The design declares a signature; the canvas fills it. Nothing inside the
 * design records what is wired, deliberately - that is an edge, and a copy of
 * it in the document would be a second place for the same fact to be wrong.
 */
export function wiredInputsOf(graph: WelcomeGraph, node: NodeId): ReadonlySet<string> {
  const names = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.to !== node) continue;
    const name = inputOfPort(edge.port);
    if (name !== null) names.add(name);
  }
  return names;
}

/**
 * Rename one of a design's inputs, everywhere the name is a binding.
 *
 * Three places, and missing any one of them breaks something silently: the
 * design's own list, the blocks that name it, and **the wire on the canvas** -
 * whose port is the name. The design editor cannot reach that third one, which
 * is why renaming is a graph operation rather than a design one.
 */
export function renameDesignInput(
  graph: WelcomeGraph,
  node: NodeId,
  id: string,
  raw: string,
): WelcomeGraph {
  const target = graph.nodes.find((entry) => entry.id === node);
  if (target?.kind !== "greeting" || !target.design) return graph;
  const was = [...target.design.slots, ...target.design.conditions].find((entry) => entry.id === id);
  if (!was) return graph;

  const { design, name } = renameInput(target.design, id, raw);
  if (name === was.name) return graph;
  return {
    ...patchNode(graph, node, { design } as Partial<WelcomeNode>),
    edges: graph.edges.map((edge) =>
      edge.to === node && edge.port === inputPort(was.name) ? { ...edge, port: inputPort(name) } : edge,
    ),
  };
}

/**
 * Undeclare an input, and drop the wire that fed it.
 *
 * The wire goes because the port goes: an edge onto a port that no longer
 * exists is drawn nowhere and can never be removed by the operator who can see
 * it least - the one who cannot see it at all.
 */
export function removeDesignInput(graph: WelcomeGraph, node: NodeId, id: string): WelcomeGraph {
  const target = graph.nodes.find((entry) => entry.id === node);
  if (target?.kind !== "greeting" || !target.design) return graph;
  const gone = [...target.design.slots, ...target.design.conditions].find((entry) => entry.id === id);
  if (!gone) return graph;

  const design = removeInput(target.design, id);
  return {
    ...patchNode(graph, node, { design } as Partial<WelcomeNode>),
    edges: graph.edges.filter((edge) => !(edge.to === node && edge.port === inputPort(gone.name))),
  };
}

/** Whether this greeting is built in the design editor. */
export function isDesign(node: WelcomeNode): boolean {
  return node.kind === "greeting" && node.view === "design" && node.design !== undefined;
}

/** What an input port takes: prose, or a settled yes/no. */
export function inputKindOf(node: WelcomeNode, port: PortId): "text" | "bool" | null {
  const name = inputOfPort(port);
  if (name === null || node.kind !== "greeting" || !node.design) return null;
  if (node.design.slots.some((input) => input.name === name)) return "text";
  if (node.design.conditions.some((input) => input.name === name)) return "bool";
  return null;
}

/** Whether a node has an output at all. The greeting is the one that does not. */
export function hasOutput(node: WelcomeNode): boolean {
  return node.kind !== "greeting";
}

/**
 * What the engine has to know before it can enforce a wire.
 *
 * Everything welcome-specific about wiring, in one object: which ports a node
 * has, which of them hold several wires, what may be plugged into what, and
 * which nodes can still answer "unknown". The generic rules - a node is not
 * wired to itself, a port exists, a graph does not loop - are the engine's, and
 * are not repeated here.
 */
export const welcomeWiring: Wiring<WelcomeNode> = {
  inputs: inputsOf,
  outputs: (node) => (hasOutput(node) ? [OUT] : []),
  // One condition may feed several gates, and a greeting takes any number of
  // snippets. Every other port holds exactly one wire and replaces it.
  multi: (_node, port) => port === OUT || port === "plus",
  accepts: (source, target, port) => {
    const isText = source.kind === "text";

    // A design's own ports, which are typed: a slot takes prose, a toggle takes
    // a condition.
    //
    // A toggle takes the same sources the greeting's own WHEN does - any
    // condition, a gate, a filter. It used to demand a gate or a filter, on the
    // argument that an undecided answer driving a visibility toggle hides a
    // block for reasons nobody can see. True, but it made the *less*
    // consequential port the stricter one: WHEN decides whether anybody gets
    // the greeting at all and accepts a bare condition, while a toggle deciding
    // one block refused every node on the WHO palette - so an operator with a
    // canvas full of conditions could wire none of them in, and nothing on
    // screen said why. The undecided case is worth flagging, not forbidding,
    // and `warnPort` already flags it where it arises.
    const input = inputKindOf(target, port);
    if (input === "text") return isText;
    if (input === "bool") return !isText;
    // A wire onto an input the design no longer declares lands nowhere.
    if (inputOfPort(port) !== null) return false;

    // Text is prose appended to a greeting, never a truth value; the `plus`
    // port takes nothing else.
    if (port === "plus") return isText;
    if (isText) return false;

    // A gate takes settled answers only, so its inputs come from a filter or
    // from another gate. Combining a maybe with anything gives a maybe, and a
    // single unanswerable condition would take the whole expression with it -
    // the greeting then goes to nobody, with nothing on screen to say why. A
    // filter is where the operator decides what a maybe means, so it belongs
    // above every gate rather than below one.
    return !(target.kind === "gate" && source.kind !== "gate" && source.kind !== "filter");
  },
  // A filter is the node that settles an answer; a gate is only as settled as
  // what feeds it; every condition rests on a fact the server may not have.
  undecided: (node) => (node.kind === "filter" ? "settled" : node.kind === "gate" ? "inherit" : "undecided"),
};

/**
 * Whether a wire from `from` may land on `port` of `to`.
 *
 * Refused rather than drawn-and-marked-invalid: a wire the graph cannot mean is
 * one the operator has to find and delete later, and the canvas already knows
 * at the moment of the drop.
 */
export function canConnect(graph: WelcomeGraph, from: NodeId, to: NodeId, port: PortId): boolean {
  return allowed(graph, welcomeWiring, { from, to, port });
}

/** Add a wire, replacing whatever held that port. `plus` accepts several. */
export function connect(graph: WelcomeGraph, from: NodeId, to: NodeId, port: PortId): WelcomeGraph {
  return wire(graph, welcomeWiring, { from, to, port });
}

export { disconnect, patchNode, removeNode } from "../nodes/graph";

/** A fresh node of `kind`, with the defaults the mock shows. */
export function makeNode(kind: NodeKind, x: number, y: number): WelcomeNode {
  const id = `n${nextId()}`;
  switch (kind) {
    case "country":
      return { id, x, y, kind, codes: [] };
    case "tenure":
      return { id, x, y, kind, op: "less", window: "1 month" };
    case "clientVersion":
      return { id, x, y, kind, op: "<", version: "1.5.0" };
    case "fancyVersion":
      // `any` rather than a comparison, because a fresh node then already says
      // something true - "anybody on our client" - instead of naming a release
      // the operator has to correct before the node means anything.
      return { id, x, y, kind, op: "any", version: "" };
    case "account":
      return { id, x, y, kind, state: "guest" };
    case "group":
      return { id, x, y, kind, group: "" };
    case "os":
      return { id, x, y, kind, os: "Windows" };
    case "gate":
      return { id, x, y, kind, gate: "and" };
    case "filter":
      return { id, x, y, kind, unknownAs: "no" };
    case "text":
      return { id, x, y, kind, name: "", body: "", html: "", view: "plain" };
    case "greeting":
      return { id, x, y, kind, body: "", once: true, html: "", view: "plain", sections: [] };
  }
}

/**
 * The patch that sets a message node's markup, plain half and all.
 *
 * One function rather than two `onPatch` calls at each of the three call sites,
 * because the invariant is the point: the plain half is *derived* from the
 * markup, always, while the node is being written in the editor. An operator
 * who formats a paragraph and leaves the plain field on last week's wording has
 * published two different greetings and can only see one of them.
 */
export function writeMarkup(html: string): Partial<MessageNode> {
  return { html, body: plainTextOf(html) };
}

/**
 * The patch that moves a node between the three views.
 *
 * Switching from plain seeds the markup from what was typed, so nothing is lost
 * by pressing the button; switching to plain keeps the markup but stops sending
 * it, so nothing is lost by pressing it back. Neither direction asks the
 * operator to confirm anything, because neither direction throws anything away.
 */
export function switchView<N extends MessageNode>(node: N, view: BodyView): Partial<N> {
  if (view === node.view) return {} as Partial<N>;
  if (view === "screen" || view === "legacy") {
    if (node.kind !== "greeting") return {};
    // Narrowed once, here: the caller has a greeting or it has nothing, and
    // every field written below belongs to a greeting.
    const patch = (fields: Partial<GreetingNode>) => fields as Partial<N>;
    // An existing paragraph becomes the screen's first prose band rather than
    // being thrown away: switching to a screen means "lay this out", not
    // "start again".
    const carried: Section[] =
      node.sections.length > 0
        ? node.sections
        : [
            makeSection("hero"),
            ...(node.html.trim() === ""
              ? [makeSection("prose")]
              : [{ ...makeSection("prose"), html: node.html }]),
          ];
    return patch({ view, ...writeSections(carried, view) });
  }
  if (view === "plain") return { view } as Partial<N>;
  // A node that has never held markup starts from its own words rather than
  // from an empty editor: an operator switching a written paragraph to rich
  // text means "format this", not "start again".
  const html = node.html.trim() === "" ? paragraphsOf(node.body) : node.html;
  return { view, html, body: plainTextOf(html) } as Partial<N>;
}

/* -- Reading the graph back in words -------------------------------------- */

/** One condition, in the words the status bar uses. */
function phrase(node: WelcomeNode): string {
  switch (node.kind) {
    case "country":
      return node.codes.length > 0 ? `country in ${node.codes.join("/")}` : "country in …";
    case "tenure":
      return `joined ${node.op === "less" ? "less" : "more"} than ${node.window} ago`;
    case "clientVersion":
      return `version ${node.op} ${node.version}`;
    case "fancyVersion":
      return node.op === "any" ? "on the Fancy client" : `Fancy version ${node.op} ${node.version}`;
    case "account":
      return `account is ${node.state}`;
    case "group":
      return node.group ? `in group ${node.group}` : "in group …";
    case "os":
      return `os is ${node.os}`;
    default:
      return "…";
  }
}

/**
 * The condition feeding `port` of `node`, as prose.
 *
 * Every gate is parenthesised, including the outermost one. Precedence between
 * `and`, `or` and `xor` is not something an operator should have to hold in
 * their head to read their own rule back, and the drawing has no precedence in
 * it either - the parentheses *are* the shape they drew.
 */
function expressionAt(graph: WelcomeGraph, node: NodeId, port: PortId): string | null {
  const edge = graph.edges.find((e) => e.to === node && e.port === port);
  if (!edge) return null;
  return expressionOf(graph, edge.from);
}

function expressionOf(graph: WelcomeGraph, id: NodeId): string | null {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) return null;
  if (node.kind === "filter") {
    const inner = expressionAt(graph, node.id, "a");
    // Nothing wired in, and unknown counts as yes: that is true of every
    // arrival, which is how this canvas says "everybody". See `isEveryone`.
    if (!inner) return node.unknownAs === "yes" ? EVERYONE : null;
    // Only the surprising setting is spelled out. Every condition has to
    // pass through a filter to reach a gate, so `no` is what the sentence
    // already reads as - "country in DE" excludes anyone whose country
    // could not be determined. Annotating all of them would put the same
    // clause after every clause and bury the one that inverts it.
    return node.unknownAs === "yes" ? `${inner} (unknown counts as yes)` : inner;
  }
  if (node.kind !== "gate") return phrase(node);

  if (node.gate === "not") {
    const inner = expressionAt(graph, node.id, "a");
    return inner ? `not ${inner}` : null;
  }
  const left = expressionAt(graph, node.id, "a");
  const right = expressionAt(graph, node.id, "b");
  if (!left || !right) return null;
  return `(${left} ${node.gate} ${right})`;
}

/**
 * Every greeting on the canvas, in the order the server considers them.
 *
 * Node order, and that is not an implementation detail leaking out: the server
 * walks the stored nodes and shows the first definite match, so where a
 * greeting sits in this list is what decides who sees it when two of them
 * could. See `conflictsIn` in the solver beside this.
 */
export function greetingsOf(graph: WelcomeGraph): MessageNode[] {
  return graph.nodes.filter((node): node is MessageNode => node.kind === "greeting");
}

/**
 * The first greeting, for the places that speak about the graph as a whole.
 *
 * A graph may hold several. Anything that is *about* one of them - its
 * preview, its condition, its snippets - takes an id instead, because a page
 * that showed the first greeting's text under every greeting node is the bug
 * this signature used to cause.
 */
export function greetingOf(graph: WelcomeGraph): WelcomeNode | undefined {
  return graph.nodes.find((n) => n.kind === "greeting");
}

/**
 * One greeting's condition in one line.
 *
 * `null` when nothing is wired to it - the bar then says what is missing
 * rather than printing an empty condition, because "shows when" with nothing
 * after it reads as "shows always", which is the opposite.
 */
export function describeGreeting(graph: WelcomeGraph, greeting: NodeId): string | null {
  return expressionAt(graph, greeting, "when");
}

/** The first greeting's condition, for the places that speak about the graph. */
export function describe(graph: WelcomeGraph): string | null {
  const greeting = greetingOf(graph);
  return greeting ? describeGreeting(graph, greeting.id) : null;
}

/** The snippets wired into a greeting's `plus` port, in wiring order. */
export function snippetsOf(graph: WelcomeGraph, greeting?: NodeId): WelcomeNode[] {
  const id = greeting ?? greetingOf(graph)?.id;
  if (id === undefined) return [];
  return graph.edges
    .filter((e) => e.to === id && e.port === "plus")
    .map((e) => graph.nodes.find((n) => n.id === e.from))
    .filter((n): n is WelcomeNode => n?.kind === "text");
}

/** How many greetings use this snippet - the `1x` badge on a text node. */
export function usesOf(graph: WelcomeGraph, id: NodeId): number {
  return graph.edges.filter((e) => e.from === id && e.port === "plus").length;
}

/**
 * Whether this node's output can still be undecided.
 *
 * A property of the drawing rather than of any one arrival: it asks
 * whether there is *some* visitor for whom this wire has no answer. Every
 * condition can be undecided, because every fact behind one is optional -
 * a server with no geo-IP database cannot name a country, and a guest has
 * no account age. A filter never can, which is the whole of what it is
 * for. A gate inherits it from its inputs.
 *
 * The canvas draws the two differently, so the third state is visible
 * before it costs somebody a greeting that silently never went out.
 */
export function mayBeUnknown(graph: WelcomeGraph, id: NodeId): boolean {
  return undecidedAt(graph, welcomeWiring, id);
}

/* -- Whether it may be saved ---------------------------------------------- */

/**
 * What still has to be drawn before this can be sent.
 *
 * Every entry names a node the operator can go and look at. "Invalid graph"
 * tells somebody staring at eleven nodes nothing at all.
 */
export function graphStatus(graph: WelcomeGraph): GraphStatus {
  const problems: string[] = [];
  const greeting = greetingOf(graph);

  if (!greeting) {
    problems.push("No greeting node - add one to say what people see.");
    return { complete: false, problems };
  }
  if (greeting.kind === "greeting" && greeting.design && greeting.view === "design") {
    problems.push(...designProblems(greeting.design, wiredInputsOf(graph, greeting.id)));
  } else if (greeting.kind === "greeting" && isScreen(greeting)) {
    // A screen of nothing but dividers has a body - the generated markup is a
    // row of rules - so "is the body empty" is the wrong question to ask of it.
    if (!screenSpeaks(greeting.sections)) {
      problems.push("The welcome screen has no bands with anything in them.");
    }
    for (const url of urlsOf(greeting.sections)) {
      if (url !== "" && !isWebUrl(url)) {
        problems.push(`A link on the welcome screen is not http:// or https://: ${url}`);
      }
    }
  } else if (greeting.kind === "greeting" && greeting.body.trim() === "") {
    problems.push("The greeting has no text.");
  }
  if (!graph.edges.some((e) => e.to === greeting.id && e.port === "when")) {
    problems.push("Nothing is wired to WHEN, so the greeting would never show.");
  }

  for (const node of graph.nodes) {
    for (const port of inputsOf(node)) {
      // `plus` is optional by design: a greeting with no snippets is ordinary.
      if (port === "plus") continue;
      // A design's inputs are named in the design's own problems, with more to
      // say than "empty input" - which of them, and what uses it.
      if (inputOfPort(port) !== null) continue;
      // A filter left open on purpose is the "everyone" condition, not an
      // unfinished one - see `isEveryone`.
      if (isEveryone(graph, node)) continue;
      if (!graph.edges.some((e) => e.to === node.id && e.port === port)) {
        problems.push(`${labelOf(node)} has an empty ${port.toUpperCase()} input.`);
      }
    }
    if (node.kind === "country" && node.codes.length === 0) {
      problems.push("A country node names no countries.");
    }
    if (node.kind === "group" && node.group.trim() === "") {
      problems.push("A group node names no group.");
    }
    if (node.kind === "text" && node.body.trim() === "") {
      problems.push("A reusable text node is empty.");
    }
    // Checked against the server's own cap rather than left to the save: the
    // server refuses the *whole document* for one over-long body, and an
    // operator staring at a rejected graph of forty nodes has no way to tell
    // which one it was.
    for (const half of [markupOf(node), isMessage(node) ? node.body : ""]) {
      if ([...half].length > MAX_BODY) {
        problems.push(`${labelOf(node)} is ${[...half].length} characters; the server takes ${MAX_BODY}.`);
      }
    }
  }

  return { complete: problems.length === 0, problems };
}

/** The header caption of a node, as the mock sets it: short and shouted. */
export function labelOf(node: WelcomeNode): string {
  switch (node.kind) {
    case "country":
      return "COUNTRY IS ONE OF";
    case "tenure":
      return "ON SERVER SINCE";
    case "clientVersion":
      return "CLIENT VERSION";
    case "fancyVersion":
      return "FANCY VERSION";
    case "account":
      return "ACCOUNT";
    case "group":
      return "GROUP";
    case "os":
      return "OS";
    case "gate":
      return node.gate.toUpperCase();
    case "filter":
      return "FILTER";
    case "text":
      return "REUSABLE TEXT";
    case "greeting":
      return "SHOW THIS GREETING";
  }
}

/* -- Preview -------------------------------------------------------------- */

/** What the placeholders in a greeting body stand for while previewing. */
export interface PreviewSubject {
  readonly name: string;
  readonly channel: string;
  readonly server: string;
  /**
   * Whether this server will send the markup half at all.
   *
   * Its `allow_html` setting, and the preview needs it: a server with the
   * setting off sends the plain form, because a client that cannot render tags
   * prints them and a greeting full of `<p>` reads as a broken server. A
   * preview that showed headings regardless would be showing a document
   * nobody receives.
   */
  readonly allowHtml: boolean;
  /**
   * The server's own artwork, for the bands that draw it.
   *
   * Object URLs the client already fetched and verified, never a URL a server
   * chose - the same pictures every member of this server already has, which
   * is why an `image` band costs the greeting document nothing.
   */
  readonly icon?: string | null;
  readonly banner?: string | null;
}

/** One greeting's parts, in the order the server assembles them. */
function partsOf(graph: WelcomeGraph, greeting?: NodeId): MessageNode[] {
  const id = greeting ?? greetingOf(graph)?.id;
  if (id === undefined) return [];
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node || node.kind !== "greeting") return [];
  return [node, ...snippetsOf(graph, id).filter((part): part is MessageNode => part.kind === "text")];
}

/**
 * The greeting as one person would read it: body first, then each snippet.
 *
 * Snippets are appended rather than interleaved because that is what the wire
 * carries - one body, assembled server-side - and a preview that composed them
 * some other way would be showing something nobody will ever receive.
 */
/**
 * A design greeting, assembled the way the server assembles it.
 *
 * The prose previews read a node's `body` and `html`; a design has neither -
 * its content is a sheet of blocks - so they came back empty and the preview
 * drew an ellipsis. This runs the same two steps the server runs: compile the
 * design for the target the server will actually send, then walk the parts,
 * dropping the ones whose condition is off and substituting the wired snippet
 * into each slot.
 *
 * Which target: the markup one when the server sends markup, the plain one when
 * `allow_html` is off. Previewing the HTML on a server that will send text
 * would be showing a document nobody receives.
 */
export function previewDesign(
  graph: WelcomeGraph,
  subject: PreviewSubject,
  greeting?: NodeId,
): { body: string; target: Variant } | null {
  const id = greeting ?? greetingOf(graph)?.id;
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node || node.kind !== "greeting" || !node.design) return null;

  const target: Variant = subject.allowHtml ? "html" : "plain";
  const design = node.design;

  return {
    target,
    body: assemble(compileTarget(design, target), target, {
      // What the sheet assumes while it is being drawn. The server evaluates
      // the wire against a real visitor; a preview has no visitor, so it shows
      // the operator's own toggle - the same one the design editor draws with.
      condition: (name) => design.conditions.find((input) => input.name === name)?.on !== false,
      slot: (name) => wiredSnippet(graph, node.id, name, target),
    }),
  };
}

/** What the node wired to one of a design's slots actually says. */
function wiredSnippet(graph: WelcomeGraph, greeting: NodeId, name: string, target: Variant): string {
  for (const edge of graph.edges) {
    if (edge.to !== greeting || inputOfPort(edge.port) !== name) continue;
    const from = graph.nodes.find((node) => node.id === edge.from);
    if (from?.kind !== "text") continue;
    return target === "plain" ? from.body : markupOf(from) || paragraphsOf(from.body);
  }
  return "";
}

export function previewText(graph: WelcomeGraph, subject: PreviewSubject, greeting?: NodeId): string {
  return fill(composePlain(partsOf(graph, greeting).map((node) => node.body)), subject, false);
}

/**
 * The same greeting as markup, for a server that will send the markup half.
 *
 * Assembled by the server's own rule: each part contributes its markup where
 * it has any and its plain text otherwise, and the parts are joined with
 * nothing between them because each is a block that closes itself. A node
 * mid-way through being written contributes what it has, so the preview keeps
 * up with the typing rather than emptying out.
 *
 * `null` when no part carries markup at all, which is a graph the plain preview
 * shows perfectly well and this one would only wrap in a stray paragraph.
 */
export function previewMarkup(
  graph: WelcomeGraph,
  subject: PreviewSubject,
  greeting?: NodeId,
): string | null {
  const parts = partsOf(graph, greeting);
  if (!parts.some((node) => markupOf(node) !== "")) return null;
  const composed = composeMarkup(parts.map((node) => markupOf(node) || paragraphsOf(node.body)));
  return fill(composed, subject, true);
}

/**
 * The placeholders filled in, escaped where they are going into markup.
 *
 * A member's own name is text they chose, and putting it into a document
 * without escaping it is the plainest injection there is - a display name of
 * `<script>` would otherwise be one.
 */
function fill(text: string, subject: PreviewSubject, markup: boolean): string {
  const value = (raw: string) => (markup ? escapeHtml(raw) : raw);
  return text
    .replaceAll("{name}", value(subject.name))
    .replaceAll("{channel}", value(subject.channel))
    .replaceAll("{server}", value(subject.server));
}
