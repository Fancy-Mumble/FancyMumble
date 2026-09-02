import { describe as suite, expect, it } from "vitest";
import {
  canConnect,
  connect,
  describe,
  graphStatus,
  makeNode,
  mayBeUnknown,
  patchNode,
  previewText,
  removeNode,
  snippetsOf,
  usesOf,
  type WelcomeGraph,
  type WelcomeNode,
} from "./model";
import { seedGraph } from "./seed";

const SUBJECT = { name: "Lyn", channel: "#Gaming", server: "magical.rocks" };

suite("welcome graph", () => {
  it("reads the mock's graph back as the sentence the status bar prints", () => {
    // The one assertion that ties the drawing to the design: this string is
    // what the mock shows, character for character.
    expect(describe(seedGraph())).toBe(
      "((country in DE/AT/CH and joined less than 1 month ago) xor (version < 1.5.0 or account is guest))",
    );
  });

  it("parenthesises every gate, including the outermost", () => {
    // Precedence between and/or/xor is not something an operator should have to
    // know to read their own rule back.
    const graph = seedGraph();
    expect(describe(graph)?.startsWith("((")).toBe(true);
  });

  it("says nothing rather than 'shows when' with an empty condition", () => {
    const graph = seedGraph();
    const cut: WelcomeGraph = { ...graph, edges: graph.edges.filter((e) => e.port !== "when") };
    expect(describe(cut)).toBeNull();
  });

  it("is complete only when every input is wired", () => {
    expect(graphStatus(seedGraph()).complete).toBe(true);

    const graph = seedGraph();
    const loose: WelcomeGraph = { ...graph, edges: graph.edges.filter((e) => e.id !== "e2") };
    const status = graphStatus(loose);
    expect(status.complete).toBe(false);
    // Names the node, so an operator knows where to look.
    expect(status.problems.some((p) => p.includes("AND") && p.includes("B"))).toBe(true);
  });

  it("counts a snippet's uses for its badge", () => {
    const graph = seedGraph();
    expect(usesOf(graph, "rules")).toBe(1);
    expect(snippetsOf(graph).map((s) => (s.kind === "text" ? s.name : ""))).toEqual(["rules", "schedule"]);
  });

  it("appends snippets to the greeting and fills the placeholders", () => {
    const text = previewText(seedGraph(), SUBJECT);
    expect(text).toContain("Willkommen, Lyn!");
    expect(text).toContain("in #Gaming");
    expect(text).toContain("House rules are pinned");
    expect(text).toContain("Rotation nights");
    expect(text).not.toContain("{name}");
  });

  suite("wiring rules", () => {
    it("refuses a wire that would cycle", () => {
      const graph = seedGraph();
      // XOR already feeds the greeting through AND/OR; feeding XOR back into
      // AND would close the loop that `describe` walks.
      expect(canConnect(graph, "xor", "and", "a")).toBe(false);
    });

    it("keeps prose out of a condition port and conditions out of PLUS TEXT", () => {
      const graph = seedGraph();
      expect(canConnect(graph, "rules", "and", "a")).toBe(false);
      expect(canConnect(graph, "country", "greeting", "plus")).toBe(false);
      expect(canConnect(graph, "rules", "greeting", "plus")).toBe(true);
    });

    it("replaces what held a single input, but lets PLUS TEXT hold several", () => {
      const graph = seedGraph();
      const rewired = connect(graph, "fa", "and", "a");
      expect(rewired.edges.filter((e) => e.to === "and" && e.port === "a")).toHaveLength(1);
      expect(rewired.edges.find((e) => e.to === "and" && e.port === "a")?.from).toBe("fa");

      const third = makeNode("text", 0, 0);
      const withThird = connect({ ...graph, nodes: [...graph.nodes, third] }, third.id, "greeting", "plus");
      expect(withThird.edges.filter((e) => e.port === "plus")).toHaveLength(3);
    });

    it("takes a node's wires with it when it goes", () => {
      const graph = removeNode(seedGraph(), "and");
      expect(graph.edges.some((e) => e.from === "and" || e.to === "and")).toBe(false);
      expect(graphStatus(graph).complete).toBe(false);
    });
  });

  it("re-describes itself after an edit rather than caching the old words", () => {
    const graph = patchNode(seedGraph(), "version", { version: "2.0.0" });
    expect(describe(graph)).toContain("version < 2.0.0");
  });

  suite("filters", () => {
    /** The seed's country condition, wired to the greeting through a filter. */
    function filtered(unknownAs: "yes" | "no"): WelcomeGraph {
      const graph = seedGraph();
      const filter = { ...makeNode("filter", 300, 40), id: "filter" } as WelcomeNode;
      return {
        ...graph,
        nodes: [...graph.nodes, { ...filter, unknownAs } as WelcomeNode],
        edges: [
          { id: "f1", from: "country", to: "filter", port: "a" as const },
          { id: "f2", from: "filter", to: "greeting", port: "when" as const },
        ],
      };
    }

    it("spells out only the setting that inverts the obvious reading", () => {
      // Every condition is filtered before it reaches a gate, so `no` is
      // what the sentence already means and saying it adds nothing. `yes`
      // is the one that changes who is greeted without changing a word of
      // the condition, so that one is said.
      expect(describe(filtered("no"))).toBe("country in DE/AT/CH");
      expect(describe(filtered("yes"))).toBe("country in DE/AT/CH (unknown counts as yes)");
    });

    it("settles everything downstream of it", () => {
      const graph = filtered("no");
      // A condition can always be undecided; the same condition through a
      // filter cannot, and that is the whole point of the node.
      expect(mayBeUnknown(graph, "country")).toBe(true);
      expect(mayBeUnknown(graph, "filter")).toBe(false);
    });

    it("settles a gate once every side of it is filtered", () => {
      const graph = seedGraph();
      // The seed filters all four conditions, so its gates are decided.
      expect(mayBeUnknown(graph, "and")).toBe(false);
      expect(mayBeUnknown(graph, "country")).toBe(true);

      // Unwire one side and it goes back to undecided.
      const loose = { ...graph, edges: graph.edges.filter((e) => e.id !== "e2") };
      expect(mayBeUnknown(loose, "and")).toBe(true);
    });

    it("counts an unwired gate input as undecided rather than as settled", () => {
      const graph = seedGraph();
      const loose = { ...graph, edges: graph.edges.filter((e) => e.id !== "e2") };
      expect(mayBeUnknown(loose, "and")).toBe(true);
    });

    it("takes a truth value and refuses prose, exactly as a gate does", () => {
      const graph = filtered("no");
      expect(canConnect(graph, "tenure", "filter", "a")).toBe(true);
      expect(canConnect(graph, "rules", "filter", "a")).toBe(false);
    });

    it("will not let a condition reach a gate without one", () => {
      const graph = seedGraph();
      // The whole rule, from the operator's side: this drag is refused,
      // and the same drag onto the filter above it is not.
      expect(canConnect(graph, "country", "and", "a")).toBe(false);
      expect(canConnect(graph, "fa", "and", "a")).toBe(true);
      expect(canConnect(graph, "and", "xor", "a")).toBe(true);
    });

    it("needs its input wired before the graph can be saved", () => {
      const graph = filtered("no");
      const loose = { ...graph, edges: graph.edges.filter((e) => e.id !== "f1") };
      const status = graphStatus(loose);
      expect(status.complete).toBe(false);
      expect(status.problems.some((p) => p.includes("FILTER") && p.includes("A"))).toBe(true);
    });
  });
});
