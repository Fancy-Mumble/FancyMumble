/**
 * Which greetings can actually reach somebody, and which are shadowed.
 *
 * A welcome graph may hold several greetings, and the server shows **one**: it
 * walks the nodes in the order they are stored and takes the first definite
 * match (`choose` in `starling/crates/runtime/src/greeting.rs`). That rule is
 * predictable and it is also the canvas's quietest failure - draw two greetings
 * whose conditions can both hold, and the second one is never seen by anybody,
 * with nothing on screen to say so. Both nodes look finished, both preview
 * their own text, and the graph is "complete".
 *
 * So the conditions are *solved* rather than eyeballed. Everything here is a
 * small-model search: the facts a condition can turn on have finite domains
 * once the graph is written down - the countries it names, the account ages
 * either side of the windows it mentions, present or absent for every optional
 * fact - so asking "is there a visitor both of these match" is asking whether
 * any point in that product satisfies both, and the answer is exact rather
 * than a heuristic.
 *
 * Two things make the answer worth trusting:
 *
 * 1. **The evaluator is the server's.** `verdictAt` mirrors `truth` clause for
 *    clause, including the parts that look like details and are not: a version
 *    of zero is unknown rather than old, tenure compares strictly, a filter
 *    resolves an unreadable setting the way its default does, and `guest` is
 *    the negation of `registered` rather than a state of its own.
 * 2. **Unknown is a value in the domain.** Every fact behind a condition is
 *    optional - a server with no geo-IP database cannot name a country - and a
 *    search that only tried known facts would call a greeting reachable that
 *    in practice reaches nobody.
 *
 * What it does *not* do is claim to know which facts a particular server
 * gathers. A greeting that needs a country is reachable here, because it is
 * reachable on a server that has geo-IP; whether this one does is a question
 * this editor cannot answer and must not guess at.
 */

import { edgesInto, nodeOf, type NodeId } from "../nodes/graph";
import {
  ACCOUNT_STATES,
  OS_CHOICES,
  greetingsOf,
  isMessage,
  type OsChoice,
  type TenureWindow,
  type WelcomeGraph,
  type WelcomeNode,
} from "./model";
import { WINDOW_SECONDS } from "./windows";

/** The server's tri-state. `unknown` is a fact the server does not have. */
export type Verdict = "yes" | "no" | "unknown";

/**
 * What the server knows about one arriving peer.
 *
 * `undefined` is *unknown*, not false, and the difference is the whole design:
 * a condition on a fact nobody has withholds its greeting rather than matching
 * on a zero.
 *
 * `registered` and `strongCert` are two facts rather than one enum, because
 * that is what they are on the wire: a registered account may or may not have
 * presented a strong certificate, and `guest` is simply not-registered.
 */
export interface Facts {
  readonly country?: string;
  readonly ageSeconds?: number;
  /** `major.minor.patch`, compared component-wise as the server compares it. */
  readonly version?: readonly [number, number, number];
  /**
   * The fork's own version, where the peer announced one.
   *
   * All-zero is a *stock Mumble* client rather than a peer that said nothing,
   * which is why it settles below instead of answering unknown: the server
   * reads a missing `fancy_version` the same way everywhere else.
   */
  readonly fancyVersion?: readonly [number, number, number];
  readonly registered?: boolean;
  readonly strongCert?: boolean;
  readonly groups?: readonly string[];
  readonly os?: OsChoice;
}

/* -- The server's evaluator ------------------------------------------------ */

const not = (value: Verdict): Verdict => (value === "yes" ? "no" : value === "no" ? "yes" : "unknown");

const and = (a: Verdict, b: Verdict): Verdict =>
  a === "no" || b === "no" ? "no" : a === "yes" && b === "yes" ? "yes" : "unknown";

const or = (a: Verdict, b: Verdict): Verdict =>
  a === "yes" || b === "yes" ? "yes" : a === "no" && b === "no" ? "no" : "unknown";

const xor = (a: Verdict, b: Verdict): Verdict =>
  a === "unknown" || b === "unknown" ? "unknown" : a === b ? "no" : "yes";

const of = (held: boolean): Verdict => (held ? "yes" : "no");

/** `[major, minor, patch]` from what the operator typed, or null. */
export function versionOf(text: string): readonly [number, number, number] | null {
  const parts = text.trim().split(".");
  if (parts.length > 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) return null;
  return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
}

/** Component-wise, which is the order the server's packed form has. */
function compareVersions(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** One condition against the facts, clause for clause with the server's. */
function conditionVerdict(node: WelcomeNode, facts: Facts): Verdict {
  switch (node.kind) {
    case "country":
      if (facts.country === undefined) return "unknown";
      return of(node.codes.some((code) => code.toUpperCase() === facts.country?.toUpperCase()));
    case "tenure": {
      if (facts.ageSeconds === undefined) return "unknown";
      const window = WINDOW_SECONDS[node.window];
      // Strictly, both ways: an account exactly as old as the window matches
      // neither, which is the server's own comparison.
      return of(node.op === "less" ? facts.ageSeconds < window : facts.ageSeconds > window);
    }
    case "clientVersion": {
      const want = versionOf(node.version);
      // Zero is what a peer that never sent a Version has, and it is not a
      // version - reading it as one makes every "older than" rule match a
      // client that said nothing at all.
      if (facts.version === undefined || want === null) return "unknown";
      if (facts.version[0] === 0 && facts.version[1] === 0 && facts.version[2] === 0) return "unknown";
      const order = compareVersions(facts.version, want);
      switch (node.op) {
        case "<":
          return of(order < 0);
        case "<=":
          return of(order <= 0);
        case "=":
          return of(order === 0);
        case ">=":
          return of(order >= 0);
        case ">":
          return of(order > 0);
      }
      return "unknown";
    }
    case "fancyVersion": {
      if (facts.fancyVersion === undefined) return "unknown";
      const zero = facts.fancyVersion.every((part) => part === 0);
      // Not the fork's client at all, which is a definite no to every op -
      // `any` included, and the `<` ones included: a stock client is not an
      // older build of something it is not a build of.
      if (zero) return "no";
      if (node.op === "any") return "yes";
      const want = versionOf(node.version);
      if (want === null) return "unknown";
      const order = compareVersions(facts.fancyVersion, want);
      switch (node.op) {
        case "<":
          return of(order < 0);
        case "<=":
          return of(order <= 0);
        case "=":
          return of(order === 0);
        case ">=":
          return of(order >= 0);
        case ">":
          return of(order > 0);
      }
      return "unknown";
    }
    case "account":
      if (node.state === "strong certificate") {
        return facts.strongCert === undefined ? "unknown" : of(facts.strongCert);
      }
      if (facts.registered === undefined) return "unknown";
      return of(node.state === "guest" ? !facts.registered : facts.registered);
    case "group":
      if (facts.groups === undefined) return "unknown";
      return of(facts.groups.includes(node.group));
    case "os":
      return facts.os === undefined ? "unknown" : of(facts.os === node.os);
    default:
      // A snippet is prose, and a greeting is the thing being decided rather
      // than part of the decision.
      return "unknown";
  }
}

/**
 * Whether the condition ending at `id` holds for `facts`.
 *
 * `seen` guards a stored document rather than an operator: the canvas refuses
 * to draw a cycle, but a graph written by something else must not spin.
 */
export function verdictAt(
  graph: WelcomeGraph,
  id: NodeId,
  facts: Facts,
  seen: Set<NodeId> = new Set(),
): Verdict {
  if (seen.has(id)) return "unknown";
  seen.add(id);
  const node = nodeOf(graph, id);
  let verdict: Verdict = "unknown";
  if (node) {
    if (node.kind === "gate") {
      const a = feeding(graph, id, "a", facts, seen);
      if (node.gate === "not") verdict = not(a);
      else {
        const b = feeding(graph, id, "b", facts, seen);
        switch (node.gate) {
          case "and":
            verdict = and(a, b);
            break;
          case "or":
            verdict = or(a, b);
            break;
          case "xor":
            verdict = xor(a, b);
            break;
          case "nand":
            verdict = not(and(a, b));
            break;
          case "nor":
            verdict = not(or(a, b));
            break;
          case "xnor":
            verdict = not(xor(a, b));
            break;
        }
      }
    } else if (node.kind === "filter") {
      const inner = feeding(graph, id, "a", facts, seen);
      verdict = inner === "unknown" ? (node.unknownAs === "yes" ? "yes" : "no") : inner;
    } else {
      verdict = conditionVerdict(node, facts);
    }
  }
  // Removed rather than left behind: a node feeding two gates is visited twice
  // on purpose, and only a walk currently inside one is a cycle.
  seen.delete(id);
  return verdict;
}

function feeding(graph: WelcomeGraph, id: NodeId, port: string, facts: Facts, seen: Set<NodeId>): Verdict {
  const edge = edgesInto(graph, id, port)[0];
  return edge ? verdictAt(graph, edge.from, facts, seen) : "unknown";
}

/**
 * Whether this greeting shows to `facts`.
 *
 * What decides is the condition wired into WHEN, never the greeting node
 * itself: a greeting is the thing being chosen, so asking whether *it* is true
 * answers unknown and shows nobody anything. A greeting with nothing wired
 * there matches nobody, which is the same answer the server gives it.
 */
export function matchesWhen(graph: WelcomeGraph, greeting: NodeId, facts: Facts): boolean {
  const edge = edgesInto(graph, greeting, "when")[0];
  return edge !== undefined && verdictAt(graph, edge.from, facts) === "yes";
}

/* -- The search space ----------------------------------------------------- */

/**
 * How many visitors the solver will try before it gives up.
 *
 * Generous, because the product is built from the facts *these two conditions
 * mention* rather than from all of them, and a realistic pair reaches a few
 * thousand. The cap exists so a pathological graph - a dozen group nodes and
 * six version thresholds - makes the editor say "not settled" rather than
 * freeze the canvas somebody is drawing on.
 */
const MAX_VISITORS = 200_000;

/** A sentinel country that is not any of the ones a graph names. */
const ELSEWHERE = "ZZ";

/** What a peer that announced no fork version has: not a version, a client. */
const STOCK_MUMBLE = [0, 0, 0] as const;

/**
 * A build of the fork, for the case where nothing names a version.
 *
 * `any` is true of every fork client and names none, so without a non-zero
 * value in the domain the search would only ever try stock Mumble and would
 * report a greeting for fork users as reaching nobody. Which build it is does
 * not matter; that it is not zero does.
 */
const SOME_FANCY_BUILD = [0, 4, 2] as const;

/** The facts a subgraph actually reads, so nothing else is enumerated. */
interface Used {
  countries: Set<string>;
  windows: Set<TenureWindow>;
  versions: Set<string>;
  /** The fork's versions named, and whether anything asks about it at all. */
  fancyVersions: Set<string>;
  fancy: boolean;
  groups: Set<string>;
  oses: Set<OsChoice>;
  account: boolean;
  strongCert: boolean;
}

function usedBy(graph: WelcomeGraph, roots: readonly NodeId[]): Used {
  const used: Used = {
    countries: new Set(),
    windows: new Set(),
    versions: new Set(),
    fancyVersions: new Set(),
    fancy: false,
    groups: new Set(),
    oses: new Set(),
    account: false,
    strongCert: false,
  };
  const seen = new Set<NodeId>();
  const walk = (id: NodeId) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = nodeOf(graph, id);
    if (!node) return;
    switch (node.kind) {
      case "country":
        for (const code of node.codes) used.countries.add(code.toUpperCase());
        break;
      case "tenure":
        used.windows.add(node.window);
        break;
      case "clientVersion":
        used.versions.add(node.version);
        break;
      case "fancyVersion":
        used.fancy = true;
        // `any` names no version, and a node still being written may name one
        // that does not parse. Both still put the fact in the search.
        if (node.op !== "any") used.fancyVersions.add(node.version);
        break;
      case "group":
        used.groups.add(node.group);
        break;
      case "os":
        used.oses.add(node.os);
        break;
      case "account":
        if (node.state === "strong certificate") used.strongCert = true;
        else used.account = true;
        break;
      default:
        break;
    }
    for (const edge of graph.edges.filter((candidate) => candidate.to === id)) walk(edge.from);
  };
  for (const root of roots) walk(root);
  return used;
}

/** The values of one fact worth trying, `undefined` among them. */
function domains(used: Used): {
  countries: (string | undefined)[];
  ages: (number | undefined)[];
  versions: (readonly [number, number, number] | undefined)[];
  fancyVersions: (readonly [number, number, number] | undefined)[];
  registered: (boolean | undefined)[];
  strongCerts: (boolean | undefined)[];
  groupSets: (readonly string[] | undefined)[];
  oses: (OsChoice | undefined)[];
} {
  const countries: (string | undefined)[] =
    used.countries.size === 0 ? [undefined] : [...used.countries, ELSEWHERE, undefined];

  // One age either side of every window named, which is enough: a tenure
  // condition can only change its answer at a threshold it names.
  const ages: (number | undefined)[] = [undefined];
  if (used.windows.size > 0) {
    for (const window of used.windows) {
      const seconds = WINDOW_SECONDS[window];
      ages.push(Math.max(0, seconds - 1), seconds, seconds + 1);
    }
  }

  const versions: (readonly [number, number, number] | undefined)[] = [undefined];
  if (used.versions.size > 0) {
    // Zero is in the list on purpose: it is what a peer that never announced a
    // version has, and the server reads it as unknown rather than as ancient.
    versions.push([0, 0, 0]);
    for (const text of used.versions) {
      const parsed = versionOf(text);
      if (!parsed) continue;
      versions.push(parsed, bump(parsed, 1), bump(parsed, -1));
    }
  }

  const fancyVersions: (readonly [number, number, number] | undefined)[] = [undefined];
  if (used.fancy) {
    // All-zero is stock Mumble, and it is in the list whatever the ops are:
    // "does this rule reach anybody who is not on our client" is the question
    // the fork's node exists to make answerable.
    fancyVersions.push(STOCK_MUMBLE, SOME_FANCY_BUILD);
    for (const text of used.fancyVersions) {
      const parsed = versionOf(text);
      if (!parsed) continue;
      fancyVersions.push(parsed, bump(parsed, 1), bump(parsed, -1));
    }
  }

  const groupSets: (readonly string[] | undefined)[] = [undefined];
  if (used.groups.size > 0) {
    // Every combination of the names mentioned: a visitor holds any subset,
    // and two group conditions are independent of each other.
    const names = [...used.groups];
    for (let mask = 0; mask < 1 << names.length; mask += 1) {
      groupSets.push(names.filter((_, index) => (mask & (1 << index)) !== 0));
    }
  }

  const oses: (OsChoice | undefined)[] =
    used.oses.size === 0
      ? [undefined]
      : [...used.oses, ...(used.oses.size < OS_CHOICES.length ? [elsewhereOs(used.oses)] : []), undefined];

  return {
    countries,
    ages,
    versions,
    fancyVersions,
    registered: used.account ? [true, false, undefined] : [undefined],
    strongCerts: used.strongCert ? [true, false, undefined] : [undefined],
    groupSets,
    oses,
  };
}

/** An operating system the graph does not name, for "none of the above". */
function elsewhereOs(named: ReadonlySet<OsChoice>): OsChoice {
  return OS_CHOICES.find((choice) => !named.has(choice)) ?? OS_CHOICES[0];
}

/** The same version, one patch up or down, clamped at zero. */
function bump(version: readonly [number, number, number], by: number): readonly [number, number, number] {
  return [version[0], version[1], Math.max(0, version[2] + by)];
}

/**
 * Every visitor worth trying against `roots`, or null when there are too many.
 *
 * A generator rather than an array: the commonest question is "is there one at
 * all", and the answer usually arrives long before the space is exhausted.
 */
function* visitors(used: Used): Generator<Facts> {
  // Counted rather than nested seven loops deep: the odometer below is the
  // same product, and adding an eighth fact to the search is then a line in
  // `axes` instead of another level of indentation.
  const axes = axesOf(used);
  const at = axes.map(() => 0);
  const total = axes.reduce((product, axis) => product * axis.values.length, 1);

  for (let step = 0; step < total; step += 1) {
    const facts: Record<string, unknown> = {};
    for (const [index, axis] of axes.entries()) facts[axis.fact] = axis.values[at[index]];
    yield facts as Facts;

    // Roll the odometer: the last axis moves fastest, and a wheel that comes
    // back to zero carries into the one before it.
    for (let wheel = axes.length - 1; wheel >= 0; wheel -= 1) {
      at[wheel] += 1;
      if (at[wheel] < axes[wheel].values.length) break;
      at[wheel] = 0;
    }
  }
}

/** One fact, and every value of it worth trying. */
interface Axis {
  readonly fact: keyof Facts;
  readonly values: readonly unknown[];
}

function axesOf(used: Used): readonly Axis[] {
  const space = domains(used);
  return [
    { fact: "country", values: space.countries },
    { fact: "ageSeconds", values: space.ages },
    { fact: "version", values: space.versions },
    { fact: "fancyVersion", values: space.fancyVersions },
    { fact: "registered", values: space.registered },
    { fact: "strongCert", values: space.strongCerts },
    { fact: "groups", values: space.groupSets },
    { fact: "os", values: space.oses },
  ];
}

function sizeOf(used: Used): number {
  return axesOf(used).reduce((product, axis) => product * axis.values.length, 1);
}

/* -- What the editor asks ------------------------------------------------- */

/** One greeting that the server will never get as far as showing. */
export interface Shadowed {
  /** The greeting nobody sees. */
  readonly greeting: NodeId;
  /**
   * The greetings that take every visitor this one would have had, earliest
   * first. Empty when the condition simply cannot hold for anybody.
   */
  readonly behind: readonly NodeId[];
}

/** Two greetings that can both match. The earlier one wins that visitor. */
export interface Overlap {
  readonly first: NodeId;
  readonly second: NodeId;
  /** A visitor both of them match, for saying who is affected. */
  readonly example: Facts;
}

export interface Conflicts {
  /**
   * Greetings that show to nobody: unsatisfiable, or wholly covered by
   * greetings the server reaches first.
   */
  readonly shadowed: readonly Shadowed[];
  /**
   * Pairs that can both match the same visitor while each still reaches
   * somebody of its own. Not a fault - a specific greeting in front of a
   * general one is the ordinary way to write this - but worth saying out loud,
   * because the order that decides it is the order the nodes happen to be in.
   */
  readonly overlaps: readonly Overlap[];
  /**
   * False when the search space was too large to settle. Nothing above is then
   * a claim about the graph, and the editor says so rather than reporting an
   * all-clear it did not earn.
   */
  readonly decided: boolean;
}

/** Nothing found, and nothing to find: the answer for a graph with no greeting. */
export const SETTLED: Conflicts = { shadowed: [], overlaps: [], decided: true };

/**
 * What `conflictsIn` would read, as something cheap to compare.
 *
 * Settling a canvas is a search over every visitor its conditions can tell
 * apart, which on a canvas with a few greetings and a handful of conditions is
 * thousands of evaluations. Running that on every keystroke is what made
 * writing a greeting feel heavy - and it is pure waste, because **prose cannot
 * change the answer**: who a greeting reaches is decided by the wires and the
 * conditions, never by what it says.
 *
 * So a message node contributes only its identity here. That is not an
 * optimisation to be sanity-checked against `conflictsIn` - it is the same
 * fact `conflictsIn` already relies on, which reads a greeting for its id and
 * its WHEN wire and nothing else.
 */
export function conflictKey(graph: WelcomeGraph): readonly unknown[] {
  return [graph.edges, ...graph.nodes.map((node) => (isMessage(node) ? node.id : node))];
}

/** Whether two of those describe the same question. */
export function sameConflictKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((held, at) => held === b[at]);
}

/**
 * Which greetings conflict, and which reach nobody.
 *
 * Exact, within the cap: the domains are built from what the conditions in
 * question mention, and `unknown` is one of the values every fact takes, so a
 * greeting reported as reaching nobody reaches nobody on any server.
 */
export function conflictsIn(graph: WelcomeGraph): Conflicts {
  const greetings = greetingsOf(graph);
  if (greetings.length === 0) return SETTLED;

  const used = usedBy(
    graph,
    greetings.flatMap((greeting) => edgesInto(graph, greeting.id, "when").map((edge) => edge.from)),
  );
  if (sizeOf(used) > MAX_VISITORS) return { shadowed: [], overlaps: [], decided: false };

  const order = greetings.map((greeting) => greeting.id);
  /** For each greeting, the visitors it matches that no earlier one takes. */
  const own = new Map<NodeId, Facts | null>(order.map((id) => [id, null]));
  /** For each greeting, whether its condition can hold at all. */
  const ever = new Set<NodeId>();
  const covers = new Map<NodeId, Set<NodeId>>(order.map((id) => [id, new Set()]));
  const overlaps: Overlap[] = [];
  const paired = new Set<string>();

  for (const facts of visitors(used)) {
    const matching = order.filter((id) => matchesWhen(graph, id, facts));
    if (matching.length === 0) continue;
    for (const id of matching) ever.add(id);

    const winner = matching[0];
    if (own.get(winner) === null) own.set(winner, facts);

    for (const loser of matching.slice(1)) {
      covers.get(loser)?.add(winner);
      const key = `${winner}|${loser}`;
      if (!paired.has(key)) {
        paired.add(key);
        overlaps.push({ first: winner, second: loser, example: facts });
      }
    }
  }

  const shadowed: Shadowed[] = [];
  for (const id of order) {
    if (!ever.has(id)) {
      shadowed.push({ greeting: id, behind: [] });
      continue;
    }
    // It matched somebody, but never first: every visitor it would have had
    // is taken by a greeting the server reaches before it.
    if (own.get(id) === null) {
      shadowed.push({ greeting: id, behind: [...(covers.get(id) ?? [])] });
    }
  }

  // A pair is only worth mentioning while both still reach somebody: once the
  // later one reaches nobody at all, `shadowed` is the thing to say about it.
  const alive = new Set(order.filter((id) => own.get(id) !== null));
  return {
    shadowed,
    overlaps: overlaps.filter((overlap) => alive.has(overlap.second)),
    decided: true,
  };
}

/** One visitor in the words an operator would use to describe them. */
export function describeVisitor(facts: Facts): string {
  const parts: string[] = [];
  if (facts.registered !== undefined) {
    parts.push(facts.registered ? ACCOUNT_STATES[1] : ACCOUNT_STATES[0]);
  }
  if (facts.strongCert) parts.push(ACCOUNT_STATES[2]);
  if (facts.os !== undefined) parts.push(`on ${facts.os}`);
  if (facts.country !== undefined) {
    parts.push(facts.country === ELSEWHERE ? "from anywhere else" : `from ${facts.country}`);
  }
  if (facts.version !== undefined) parts.push(`client ${facts.version.join(".")}`);
  if (facts.ageSeconds !== undefined) parts.push(`${Math.round(facts.ageSeconds / 86_400)} days here`);
  if (facts.groups !== undefined && facts.groups.length > 0) parts.push(`in ${facts.groups.join(", ")}`);
  return parts.length > 0 ? parts.join(", ") : "anybody at all";
}
