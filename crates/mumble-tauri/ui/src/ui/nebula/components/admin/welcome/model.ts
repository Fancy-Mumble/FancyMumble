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
  type NodeGraph,
  type NodeId,
  type Wiring,
} from "../nodes/graph";
import type { GraphStatus } from "../nodes/spec";

/**
 * The identity, the wire and the graph are the engine's, not this file's.
 *
 * A welcome graph is one dialect of `NodeGraph`; the canvas that draws it and
 * the onboarding editor beside it are the same components over the same shape,
 * and the only thing this module adds is what the nodes *mean*.
 */
export type { Edge, NodeId } from "../nodes/graph";
export type { GraphStatus } from "../nodes/spec";

/** The comparisons a version condition offers. */
export type VersionOp = "<" | "<=" | "=" | ">=" | ">";

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

/** Which port on a node a wire lands on. */
export type PortId = "a" | "b" | "when" | "plus";

interface Positioned {
  readonly id: NodeId;
  x: number;
  y: number;
}

export type WelcomeNode = Positioned &
  (
    | { kind: "country"; codes: string[] }
    | { kind: "tenure"; op: TenureOp; window: TenureWindow }
    | { kind: "clientVersion"; op: VersionOp; version: string }
    | { kind: "account"; state: AccountState }
    | { kind: "group"; group: string }
    | { kind: "os"; os: OsChoice }
    | { kind: "gate"; gate: GateKind }
    | { kind: "filter"; unknownAs: UnknownAs }
    | { kind: "text"; name: string; body: string }
    | { kind: "greeting"; body: string; once: boolean }
  );

export type NodeKind = WelcomeNode["kind"];

/** A welcome graph: the nodes drawn, the wires between them, and whether it is on. */
export type WelcomeGraph = NodeGraph<WelcomeNode>;

/* -- Shape ---------------------------------------------------------------- */

/** The kinds that answer a yes/no question about the person arriving. */
const CONDITION_KINDS: readonly NodeKind[] = ["country", "tenure", "clientVersion", "account", "group", "os"];

export function isCondition(node: WelcomeNode): boolean {
  return CONDITION_KINDS.includes(node.kind);
}

/** Which input ports a node offers. A condition offers none. */
export function inputsOf(node: WelcomeNode): readonly PortId[] {
  if (node.kind === "gate") return node.gate === "not" ? ["a"] : ["a", "b"];
  if (node.kind === "filter") return ["a"];
  if (node.kind === "greeting") return ["when", "plus"];
  return [];
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
    // Text is prose appended to a greeting, never a truth value; the `plus`
    // port takes nothing else.
    const isText = source.kind === "text";
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
      return { id, x, y, kind, name: "", body: "" };
    case "greeting":
      return { id, x, y, kind, body: "", once: true };
  }
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
    if (!inner) return null;
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

/** The greeting node, of which a graph has exactly one. */
export function greetingOf(graph: WelcomeGraph): WelcomeNode | undefined {
  return graph.nodes.find((n) => n.kind === "greeting");
}

/**
 * The whole rule in one line, for the status bar.
 *
 * `null` when nothing is wired to the greeting - the bar then says what is
 * missing rather than printing an empty condition, because "shows when" with
 * nothing after it reads as "shows always", which is the opposite.
 */
export function describe(graph: WelcomeGraph): string | null {
  const greeting = greetingOf(graph);
  if (!greeting) return null;
  return expressionAt(graph, greeting.id, "when");
}

/** The snippets wired into the greeting's `plus` port, in wiring order. */
export function snippetsOf(graph: WelcomeGraph): WelcomeNode[] {
  const greeting = greetingOf(graph);
  if (!greeting) return [];
  return graph.edges
    .filter((e) => e.to === greeting.id && e.port === "plus")
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
  if (greeting.kind === "greeting" && greeting.body.trim() === "") {
    problems.push("The greeting has no text.");
  }
  if (!graph.edges.some((e) => e.to === greeting.id && e.port === "when")) {
    problems.push("Nothing is wired to WHEN, so the greeting would never show.");
  }

  for (const node of graph.nodes) {
    for (const port of inputsOf(node)) {
      // `plus` is optional by design: a greeting with no snippets is ordinary.
      if (port === "plus") continue;
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
}

/**
 * The greeting as one person would read it: body first, then each snippet.
 *
 * Snippets are appended rather than interleaved because that is what the wire
 * carries - one body, assembled server-side - and a preview that composed them
 * some other way would be showing something nobody will ever receive.
 */
export function previewText(graph: WelcomeGraph, subject: PreviewSubject): string {
  const greeting = greetingOf(graph);
  if (!greeting || greeting.kind !== "greeting") return "";
  const parts = [greeting.body, ...snippetsOf(graph).map((s) => (s.kind === "text" ? s.body : ""))];
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replaceAll("{name}", subject.name)
    .replaceAll("{channel}", subject.channel)
    .replaceAll("{server}", subject.server);
}
