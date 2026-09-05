import { describe as suite, expect, it } from "vitest";
import {
  conflictKey,
  conflictsIn,
  describeVisitor,
  matchesWhen,
  sameConflictKey,
  verdictAt,
  versionOf,
  type Facts,
} from "./solver";
import { makeNode, type Edge, type WelcomeGraph, type WelcomeNode } from "./model";
import { seedGraph } from "./seed";

/* -- Building a graph to solve -------------------------------------------- */

let counter = 0;
const at = <K extends WelcomeNode["kind"]>(
  kind: K,
  fields: Partial<Extract<WelcomeNode, { kind: K }>> = {},
): Extract<WelcomeNode, { kind: K }> => {
  counter += 1;
  return {
    ...(makeNode(kind, 0, 0) as Extract<WelcomeNode, { kind: K }>),
    ...fields,
    id: `${kind}${counter}`,
  };
};

const link = (from: WelcomeNode, to: WelcomeNode, port: Edge["port"]): Edge => ({
  id: `e${(counter += 1)}`,
  from: from.id,
  to: to.id,
  port,
});

function graphOf(nodes: WelcomeNode[], edges: Edge[]): WelcomeGraph {
  return { nodes, edges, enabled: true };
}

/**
 * One greeting behind a condition, with the filter every condition needs.
 *
 * Returns the pieces so a caller can order the greetings itself: node order is
 * what decides who wins, so a test about shadowing has to control it.
 */
function rule(condition: WelcomeNode, unknownAs: "yes" | "no" = "no") {
  const filter = at("filter", { unknownAs });
  const greeting = at("greeting", { body: "hi", html: "", view: "plain" });
  return {
    nodes: [condition, filter, greeting],
    edges: [link(condition, filter, "a"), link(filter, greeting, "when")],
    greeting,
  };
}

/* -- The evaluator -------------------------------------------------------- */

suite("the evaluator mirrors the server's", () => {
  it("answers unknown for a fact the server does not have", () => {
    const guest = rule(at("account", { state: "guest" }));
    const graph = graphOf(guest.nodes, guest.edges);
    const condition = guest.nodes[0];
    expect(verdictAt(graph, condition.id, {})).toBe("unknown");
    expect(verdictAt(graph, condition.id, { registered: false })).toBe("yes");
    expect(verdictAt(graph, condition.id, { registered: true })).toBe("no");
  });

  it("reads a client version of zero as unknown rather than as ancient", () => {
    // A peer that never sent a Version has zero, and reading it as a version
    // makes every "older than" rule match a client that said nothing at all.
    const old = rule(at("clientVersion", { op: "<", version: "1.5.0" }));
    const graph = graphOf(old.nodes, old.edges);
    const condition = old.nodes[0];
    expect(verdictAt(graph, condition.id, { version: [0, 0, 0] })).toBe("unknown");
    expect(verdictAt(graph, condition.id, { version: [1, 4, 0] })).toBe("yes");
    expect(verdictAt(graph, condition.id, { version: [1, 5, 0] })).toBe("no");
  });

  it("reads a missing fork version as a stock client rather than as unknown", () => {
    // The difference that matters: a definite no travels through a NOT and
    // comes back as the greeting for everyone *not* on the fork, where a maybe
    // would be swallowed and that greeting would reach nobody.
    const ours = rule(at("fancyVersion", { op: "any" }));
    const graph = graphOf(ours.nodes, ours.edges);
    const condition = ours.nodes[0];
    expect(verdictAt(graph, condition.id, { fancyVersion: [0, 0, 0] })).toBe("no");
    expect(verdictAt(graph, condition.id, { fancyVersion: [0, 2, 12] })).toBe("yes");
    // Nothing gathered the fact at all. That is the maybe.
    expect(verdictAt(graph, condition.id, {})).toBe("unknown");
  });

  it("does not call a stock client an old build of the fork", () => {
    const outdated = rule(at("fancyVersion", { op: "<", version: "0.4.0" }));
    const graph = graphOf(outdated.nodes, outdated.edges);
    const condition = outdated.nodes[0];
    expect(verdictAt(graph, condition.id, { fancyVersion: [0, 2, 12] })).toBe("yes");
    expect(verdictAt(graph, condition.id, { fancyVersion: [0, 4, 0] })).toBe("no");
    // Not one at all, so not an old one either - it must not be handed the
    // fork's own upgrade notice.
    expect(verdictAt(graph, condition.id, { fancyVersion: [0, 0, 0] })).toBe("no");
  });

  it("numbers the fork apart from Mumble", () => {
    // 0.4.0 of the fork on a client announcing Mumble 1.5.0: the same peer
    // answers opposite ways depending on which node asked.
    const facts: Facts = { version: [1, 5, 0], fancyVersion: [0, 4, 0] };
    const fork = rule(at("fancyVersion", { op: ">=", version: "1.0.0" }));
    expect(verdictAt(graphOf(fork.nodes, fork.edges), fork.nodes[0].id, facts)).toBe("no");
    const mumble = rule(at("clientVersion", { op: ">=", version: "1.0.0" }));
    expect(verdictAt(graphOf(mumble.nodes, mumble.edges), mumble.nodes[0].id, facts)).toBe("yes");
  });

  it("compares tenure strictly, both ways", () => {
    const fresh = rule(at("tenure", { op: "less", window: "1 week" }));
    const graph = graphOf(fresh.nodes, fresh.edges);
    const condition = fresh.nodes[0];
    const week = 604_800;
    expect(verdictAt(graph, condition.id, { ageSeconds: week - 1 })).toBe("yes");
    // Exactly the window matches neither "less" nor "more".
    expect(verdictAt(graph, condition.id, { ageSeconds: week })).toBe("no");
  });

  it("lets a filter settle an unknown the way it is set to", () => {
    const strict = rule(at("country", { codes: ["DE"] }), "no");
    const loose = rule(at("country", { codes: ["DE"] }), "yes");
    expect(matchesWhen(graphOf(strict.nodes, strict.edges), strict.greeting.id, {})).toBe(false);
    expect(matchesWhen(graphOf(loose.nodes, loose.edges), loose.greeting.id, {})).toBe(true);
  });

  it("takes a gate's answer from both its sides", () => {
    const de = at("country", { codes: ["DE"] });
    const deFilter = at("filter", { unknownAs: "no" });
    const guest = at("account", { state: "guest" });
    const guestFilter = at("filter", { unknownAs: "no" });
    const gate = at("gate", { gate: "and" });
    const greeting = at("greeting", { body: "hi", html: "", view: "plain" });
    const graph = graphOf(
      [de, deFilter, guest, guestFilter, gate, greeting],
      [
        link(de, deFilter, "a"),
        link(guest, guestFilter, "a"),
        link(deFilter, gate, "a"),
        link(guestFilter, gate, "b"),
        link(gate, greeting, "when"),
      ],
    );
    expect(matchesWhen(graph, greeting.id, { country: "DE", registered: false })).toBe(true);
    expect(matchesWhen(graph, greeting.id, { country: "DE", registered: true })).toBe(false);
    expect(matchesWhen(graph, greeting.id, { country: "FR", registered: false })).toBe(false);
  });

  it("matches nobody when nothing is wired to WHEN", () => {
    // What decides is the condition on WHEN, never the greeting itself.
    const lonely = at("greeting", { body: "hi", html: "", view: "plain" });
    expect(matchesWhen(graphOf([lonely], []), lonely.id, { registered: true })).toBe(false);
  });
});

suite("versions the operator typed", () => {
  it("fills in the parts that were left off", () => {
    expect(versionOf("1.5")).toEqual([1, 5, 0]);
    expect(versionOf("2")).toEqual([2, 0, 0]);
  });

  it("refuses what is not a version", () => {
    expect(versionOf("1.2.3.4")).toBeNull();
    expect(versionOf("next")).toBeNull();
    expect(versionOf("1.-2.0")).toBeNull();
  });
});

/* -- The conflicts ------------------------------------------------------- */

suite("greetings that shadow one another", () => {
  it("says nothing about a canvas with one greeting", () => {
    const conflicts = conflictsIn(seedGraph());
    expect(conflicts.decided).toBe(true);
    expect(conflicts.shadowed).toEqual([]);
    expect(conflicts.overlaps).toEqual([]);
  });

  it("finds the greeting that never wins", () => {
    // The reported bug: two greetings whose conditions can both hold. The
    // server takes the first definite match, so the second is drawn,
    // complete, enabled and seen by nobody.
    const first = rule(at("account", { state: "guest" }));
    const second = rule(at("account", { state: "guest" }));
    const graph = graphOf([...first.nodes, ...second.nodes], [...first.edges, ...second.edges]);

    const conflicts = conflictsIn(graph);
    expect(conflicts.shadowed.map((entry) => entry.greeting)).toEqual([second.greeting.id]);
    expect(conflicts.shadowed[0].behind).toEqual([first.greeting.id]);
  });

  it("clears the same pair once the order is swapped and the conditions differ", () => {
    // A specific greeting in front of a general one is the ordinary way to
    // write this, and it must not be reported as broken.
    const specific = rule(at("country", { codes: ["DE"] }));
    const general = rule(at("account", { state: "guest" }));
    const graph = graphOf([...specific.nodes, ...general.nodes], [...specific.edges, ...general.edges]);
    const conflicts = conflictsIn(graph);
    // Neither is shadowed: each reaches somebody the other does not.
    expect(conflicts.shadowed).toEqual([]);
    // But they do overlap - a German guest matches both - and the editor says
    // so, naming a visitor who is affected.
    expect(conflicts.overlaps).toHaveLength(1);
    expect(conflicts.overlaps[0].first).toBe(specific.greeting.id);
    expect(conflicts.overlaps[0].second).toBe(general.greeting.id);
    expect(describeVisitor(conflicts.overlaps[0].example)).toContain("guest");
  });

  it("finds a condition no visitor can satisfy", () => {
    // Registered and a guest at once. Nothing to reorder: it reaches nobody
    // whatever else is on the canvas, which is a different sentence.
    const guest = at("account", { state: "guest" });
    const guestFilter = at("filter", { unknownAs: "no" });
    const member = at("account", { state: "registered" });
    const memberFilter = at("filter", { unknownAs: "no" });
    const gate = at("gate", { gate: "and" });
    const greeting = at("greeting", { body: "hi", html: "", view: "plain" });
    const graph = graphOf(
      [guest, guestFilter, member, memberFilter, gate, greeting],
      [
        link(guest, guestFilter, "a"),
        link(member, memberFilter, "a"),
        link(guestFilter, gate, "a"),
        link(memberFilter, gate, "b"),
        link(gate, greeting, "when"),
      ],
    );
    const conflicts = conflictsIn(graph);
    expect(conflicts.shadowed).toHaveLength(1);
    expect(conflicts.shadowed[0].greeting).toBe(greeting.id);
    expect(conflicts.shadowed[0].behind).toEqual([]);
  });

  it("leaves disjoint greetings alone", () => {
    const guests = rule(at("account", { state: "guest" }));
    const members = rule(at("account", { state: "registered" }));
    const graph = graphOf([...guests.nodes, ...members.nodes], [...guests.edges, ...members.edges]);
    const conflicts = conflictsIn(graph);
    expect(conflicts.shadowed).toEqual([]);
    expect(conflicts.overlaps).toEqual([]);
  });

  it("counts a greeting with nothing wired to WHEN as reaching nobody", () => {
    const wired = rule(at("account", { state: "guest" }));
    const loose = at("greeting", { body: "hi", html: "", view: "plain" });
    const graph = graphOf([...wired.nodes, loose], wired.edges);
    expect(conflictsIn(graph).shadowed.map((entry) => entry.greeting)).toEqual([loose.id]);
  });

  it("takes the order from the nodes, which is the order the server walks", () => {
    const guests = rule(at("account", { state: "guest" }));
    const everyone = rule(at("account", { state: "guest" }));
    // The general one first: now the specific one behind it is the loser.
    const graph = graphOf([...everyone.nodes, ...guests.nodes], [...everyone.edges, ...guests.edges]);
    expect(conflictsIn(graph).shadowed.map((entry) => entry.greeting)).toEqual([guests.greeting.id]);
  });
});

suite("describing who is affected", () => {
  it("says something an operator can picture", () => {
    const facts: Facts = { registered: false, os: "Windows", country: "DE", ageSeconds: 86_400 };
    const said = describeVisitor(facts);
    expect(said).toContain("guest");
    expect(said).toContain("on Windows");
    expect(said).toContain("from DE");
    expect(said).toContain("1 days here");
  });

  it("says so when the visitor is anybody at all", () => {
    expect(describeVisitor({})).toBe("anybody at all");
  });
});

/* -- What the answer actually depends on ---------------------------------- */

/**
 * The page keeps the solver's answer until this key changes, so the key has to
 * move for everything the search reads and stay put for everything it does
 * not. Getting the first half wrong shows an operator a stale verdict about
 * who reaches whom; getting the second half wrong is the performance bug this
 * exists to fix, where writing a greeting re-ran a search over thousands of
 * visitors between every two letters.
 */
suite("what the conflict search depends on", () => {
  const built = rule(at("country", { codes: ["DE"] }));
  const graph = graphOf(built.nodes, built.edges);

  const rewrite = (id: string, fields: Partial<WelcomeNode>): WelcomeGraph => ({
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === id ? ({ ...node, ...fields } as WelcomeNode) : node)),
  });

  it("does not move when a greeting's prose is rewritten", () => {
    const typed = rewrite(built.greeting.id, { body: "something else entirely" });
    expect(sameConflictKey(conflictKey(graph), conflictKey(typed))).toBe(true);
  });

  it("does not move when a greeting's markup is rewritten", () => {
    const typed = rewrite(built.greeting.id, { html: "<p>house rules</p>" });
    expect(sameConflictKey(conflictKey(graph), conflictKey(typed))).toBe(true);
  });

  it("does not move when a node is merely dragged somewhere else", () => {
    const moved = rewrite(built.greeting.id, { x: 900, y: 400 });
    expect(sameConflictKey(conflictKey(graph), conflictKey(moved))).toBe(true);
  });

  it("moves when a condition changes", () => {
    const country = graph.nodes.find((node) => node.kind === "country");
    const widened = rewrite(country?.id ?? "", { codes: ["DE", "AT"] } as Partial<WelcomeNode>);
    expect(sameConflictKey(conflictKey(graph), conflictKey(widened))).toBe(false);
  });

  it("moves when a filter's answer to unknown changes", () => {
    const filter = graph.nodes.find((node) => node.kind === "filter");
    const flipped = rewrite(filter?.id ?? "", { unknownAs: "yes" } as Partial<WelcomeNode>);
    expect(sameConflictKey(conflictKey(graph), conflictKey(flipped))).toBe(false);
  });

  it("moves when a wire is drawn or cut", () => {
    const cut = { ...graph, edges: graph.edges.slice(1) };
    expect(sameConflictKey(conflictKey(graph), conflictKey(cut))).toBe(false);
  });

  it("moves when a greeting is added, which is what decides the order", () => {
    const second = at("greeting", { body: "second", html: "", view: "plain" });
    const grown = { ...graph, nodes: [...graph.nodes, second] };
    expect(sameConflictKey(conflictKey(graph), conflictKey(grown))).toBe(false);
  });

  it("agrees with the search itself: a key that held means the answer held", () => {
    // The claim the memo rests on, checked against the thing being memoised.
    const typed = rewrite(built.greeting.id, { body: "rewritten", html: "<p>and formatted</p>" });
    expect(sameConflictKey(conflictKey(graph), conflictKey(typed))).toBe(true);
    expect(conflictsIn(typed)).toEqual(conflictsIn(graph));
  });
});
