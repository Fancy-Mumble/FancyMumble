import { describe as suite, expect, it } from "vitest";
import {
  MAX_BODY,
  canConnect,
  connect,
  describe,
  graphStatus,
  makeNode,
  markupOf,
  mayBeUnknown,
  patchNode,
  previewMarkup,
  previewText,
  removeDesignInput,
  removeNode,
  renameDesignInput,
  snippetsOf,
  switchView,
  usesOf,
  wiredInputsOf,
  writeMarkup,
  type MessageNode,
  type WelcomeGraph,
  type WelcomeNode,
} from "./model";
import { plainTextOf } from "./markup";

/**
 * A worked graph to ask questions of: four conditions, their filters, three
 * gates and a formatted greeting with two snippets on it.
 *
 * Its own fixture rather than the page's scaffold. It *was* the scaffold -
 * until the scaffold became the two-node "everyone, and what they read", which
 * is the right thing to open a fresh server on and a useless thing to test
 * gates and filters against. A test that reaches for whatever the product
 * happens to open with is a test that breaks when somebody improves the
 * opening, which is exactly what happened.
 */
const GREETING_HTML = [
  '<h2 style="text-align: center">Willkommen, {name}!</h2>',
  "<p>Deutschsprachige Runden laufen in {channel} - schreib gern auf Deutsch.</p>",
].join("");

function seedGraph(): WelcomeGraph {
  const wire = (id: string, from: string, to: string, port: string) => ({ id, from, to, port });
  return {
    nodes: [
      { id: "country", kind: "country", x: 30, y: 34, codes: ["DE", "AT", "CH"] },
      { id: "tenure", kind: "tenure", x: 30, y: 172, op: "less", window: "1 month" },
      { id: "version", kind: "clientVersion", x: 30, y: 310, op: "<", version: "1.5.0" },
      { id: "account", kind: "account", x: 30, y: 448, state: "guest" },
      { id: "fc", kind: "filter", x: 268, y: 34, unknownAs: "no" },
      { id: "ft", kind: "filter", x: 268, y: 172, unknownAs: "no" },
      { id: "fv", kind: "filter", x: 268, y: 310, unknownAs: "no" },
      { id: "fa", kind: "filter", x: 268, y: 448, unknownAs: "no" },
      { id: "and", kind: "gate", x: 486, y: 76, gate: "and" },
      { id: "or", kind: "gate", x: 486, y: 352, gate: "or" },
      { id: "xor", kind: "gate", x: 686, y: 208, gate: "xor" },
      {
        id: "rules",
        kind: "text",
        x: 686,
        y: 430,
        name: "rules",
        body: "House rules are pinned in #Lounge - two minutes, worth it.",
        html: "",
        view: "plain",
      },
      {
        id: "schedule",
        kind: "text",
        x: 686,
        y: 560,
        name: "schedule",
        body: "Rotation nights: Tue & Fri, 20:00 CET.",
        html: "",
        view: "plain",
      },
      {
        id: "greeting",
        kind: "greeting",
        x: 958,
        y: 150,
        once: true,
        body: plainTextOf(GREETING_HTML),
        html: GREETING_HTML,
        view: "rich",
        sections: [],
      },
    ],
    edges: [
      wire("c1", "country", "fc", "a"),
      wire("c2", "tenure", "ft", "a"),
      wire("c3", "version", "fv", "a"),
      wire("c4", "account", "fa", "a"),
      wire("e1", "fc", "and", "a"),
      wire("e2", "ft", "and", "b"),
      wire("e3", "fv", "or", "a"),
      wire("e4", "fa", "or", "b"),
      wire("e5", "and", "xor", "a"),
      wire("e6", "or", "xor", "b"),
      wire("e7", "xor", "greeting", "when"),
      wire("e8", "rules", "greeting", "plus"),
      wire("e9", "schedule", "greeting", "plus"),
    ],
    enabled: true,
  } as unknown as WelcomeGraph;
}

const SUBJECT = { name: "Lyn", channel: "#Gaming", server: "magical.rocks", allowHtml: true };

/** The worked graph's greeting, which is the formatted one. */
function greetingNode(graph: WelcomeGraph = seedGraph()): MessageNode {
  const node = graph.nodes.find((candidate) => candidate.kind === "greeting");
  if (!node || node.kind !== "greeting") throw new Error("the worked graph has no greeting");
  return node;
}

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

  suite("the two halves of a message", () => {
    it("derives the plain half whenever the markup changes", () => {
      // The invariant the whole rich-text half of this page rests on. An
      // operator who formats a paragraph and leaves the plain field on last
      // week's wording has published two greetings and can see only one.
      const patch = writeMarkup("<h2>Welcome</h2><p>Rules are pinned.</p>");
      expect(patch.html).toBe("<h2>Welcome</h2><p>Rules are pinned.</p>");
      expect(patch.body).toBe("Welcome\n\nRules are pinned.");
    });

    it("sends no markup from a node being written as plain text", () => {
      const graph = seedGraph();
      const snippet = graph.nodes.find((node) => node.id === "rules");
      expect(snippet && markupOf(snippet)).toBe("");
      expect(markupOf(greetingNode(graph))).not.toBe("");
    });

    it("keeps the markup when a node is switched back to plain, and stops sending it", () => {
      // Neither direction of the switch throws anything away, which is why
      // neither has to ask the operator to confirm.
      const greeting = greetingNode();
      const plain = { ...greeting, ...switchView(greeting, "plain") } as MessageNode;
      expect(plain.html).toBe(greeting.html);
      expect(markupOf(plain)).toBe("");

      const back = { ...plain, ...switchView(plain, "rich") } as MessageNode;
      expect(markupOf(back)).toBe(greeting.html);
    });

    it("seeds the editor from what was typed when a plain node is formatted", () => {
      const written = { ...makeNode("text", 0, 0), body: "Rules are in #Lounge." } as MessageNode;
      const rich = { ...written, ...switchView(written, "rich") } as MessageNode;
      expect(rich.html).toBe("<p>Rules are in #Lounge.</p>");
      // And the plain half still says the same thing afterwards.
      expect(rich.body).toBe("Rules are in #Lounge.");
    });

    it("names the node that is over the server's cap", () => {
      // The server refuses the whole document for one over-long body, so an
      // operator has to be told which node before the save, not after.
      const graph = seedGraph();
      const over = patchNode(graph, "greeting", {
        html: "<p>" + "x".repeat(MAX_BODY) + "</p>",
      } as Partial<WelcomeNode>);
      const status = graphStatus(over);
      expect(status.complete).toBe(false);
      expect(status.problems.some((problem) => problem.includes("SHOW THIS GREETING"))).toBe(true);
      expect(status.problems.some((problem) => problem.includes(String(MAX_BODY)))).toBe(true);
    });
  });

  suite("the preview", () => {
    it("assembles the markup the way the server does, snippets last", () => {
      const markup = previewMarkup(seedGraph(), SUBJECT);
      expect(markup).not.toBeNull();
      // The greeting is formatted and the two snippets are plain, so the
      // plain ones arrive wrapped - which is what the server's own fallback
      // does with them.
      expect(markup).toContain("<h2");
      expect(markup?.indexOf("Willkommen")).toBeLessThan(markup?.indexOf("House rules") ?? -1);
      expect(markup?.indexOf("House rules")).toBeLessThan(markup?.indexOf("Rotation") ?? -1);
    });

    it("fills the placeholders in both halves", () => {
      expect(previewMarkup(seedGraph(), SUBJECT)).toContain("Willkommen, Lyn!");
      expect(previewText(seedGraph(), SUBJECT)).toContain("Willkommen, Lyn!");
    });

    it("escapes a name on its way into markup", () => {
      // A display name is text somebody chose, and the preview renders what it
      // builds - so an unescaped one would be the plainest injection there is.
      const markup = previewMarkup(seedGraph(), { ...SUBJECT, name: "<script>x</script>" });
      expect(markup).toContain("&lt;script&gt;");
      expect(markup).not.toContain("<script>");
    });

    it("says nothing in markup when no part of the greeting has any", () => {
      // Such a graph is shown perfectly by the plain preview, and this one
      // would only wrap it in a stray paragraph.
      const graph = seedGraph();
      const flat = patchNode(graph, "greeting", { html: "", view: "plain" } as Partial<WelcomeNode>);
      expect(previewMarkup(flat, SUBJECT)).toBeNull();
      expect(previewText(flat, SUBJECT)).toContain("House rules");
    });
  });
});

suite("a design's inputs, which are its node's ports", () => {
  /** A greeting built as a design, with a snippet wired into its one slot. */
  function designed(): WelcomeGraph {
    const greeting = { ...makeNode("greeting", 0, 0), id: "g" } as WelcomeNode & { kind: "greeting" };
    const snippet = { ...makeNode("text", 0, 0), id: "t" };
    return {
      enabled: true,
      nodes: [
        {
          ...greeting,
          view: "design",
          design: {
            sheetW: 520,
            slots: [{ id: "s1", name: "rules" }],
            conditions: [{ id: "c1", name: "is_new_member", on: true }],
            blocks: [{ id: "b1", type: "slot", x: 0, y: 0, w: 400, slot: "rules" }],
            overrides: {},
          },
        },
        snippet,
      ],
      edges: [{ id: "e1", from: "t", to: "g", port: "in:rules" }],
      annotations: [],
    };
  }

  it("reads which inputs have a wire from the canvas", () => {
    expect([...wiredInputsOf(designed(), "g")]).toEqual(["rules"]);
  });

  it("carries the wire across a rename", () => {
    // The whole reason renaming is a graph operation: the port *is* the name,
    // so a rename that touched only the design would leave the snippet wired
    // to a port that no longer exists - drawn nowhere, removable by nobody.
    const graph = renameDesignInput(designed(), "g", "s1", "House Rules");
    const node = graph.nodes.find((entry) => entry.id === "g");
    expect(node?.kind === "greeting" && node.design?.slots[0]?.name).toBe("house_rules");
    expect(graph.edges[0]?.port).toBe("in:house_rules");
    expect([...wiredInputsOf(graph, "g")]).toEqual(["house_rules"]);
  });

  it("takes the wire with it when the input goes", () => {
    const graph = removeDesignInput(designed(), "g", "s1");
    expect(graph.edges).toEqual([]);
    const node = graph.nodes.find((entry) => entry.id === "g");
    expect(node?.kind === "greeting" && node.design?.slots).toEqual([]);
    // And the block that named it is unbound rather than left pointing at a
    // name nothing declares.
    expect(node?.kind === "greeting" && node.design?.blocks[0]?.slot).toBeUndefined();
  });

  it("leaves a graph alone when the input is not one of its own", () => {
    const graph = designed();
    expect(renameDesignInput(graph, "g", "nope", "x")).toBe(graph);
    expect(removeDesignInput(graph, "t", "s1")).toBe(graph);
  });
});
