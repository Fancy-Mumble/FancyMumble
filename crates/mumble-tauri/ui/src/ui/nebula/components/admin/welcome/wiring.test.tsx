import { describe as suite, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider } from "@mui/material";
import { createNebulaTheme } from "@nebula/theme";
import { NodeEditor, canConnect } from "@nebula/components/admin/nodes";
import { welcomeSpec } from "@nebula/components/admin/welcome/spec";
import { starterDesign } from "@nebula/components/admin/welcome/design";
import { seedGraph } from "@nebula/components/admin/welcome/seed";
import {
  makeNode,
  previewDesign,
  welcomeWiring,
  type WelcomeGraph,
} from "@nebula/components/admin/welcome/model";

// The canvas measures its ports with one; jsdom has neither this nor pointer
// capture, and a real webview has both.
if (typeof ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}

/** Built through the model's own constructor, so the nodes are real ones. */
function graph(): WelcomeGraph {
  const text = { ...makeNode("text", 0, 0), id: "t", body: "Be kind" };
  const greeting = {
    ...makeNode("greeting", 400, 0),
    id: "g",
    view: "design" as const,
    design: starterDesign(),
  };
  return { nodes: [text, greeting], edges: [] } as unknown as WelcomeGraph;
}

suite("a design node's sockets", () => {
  it("draws one per declared input, so there is something to wire to", () => {
    const view = render(
      <ThemeProvider theme={createNebulaTheme("dark")}>
        <NodeEditor spec={welcomeSpec} graph={graph()} onChange={() => undefined} summary="" />
      </ThemeProvider>,
    );
    const ports = [...view.container.querySelectorAll("[data-port]")].map((el) =>
      el.getAttribute("data-port"),
    );
    expect(ports).toContain("g:in:when");
    expect(ports).toContain("g:in:in:rules");
    expect(ports).toContain("g:in:in:is_new_member");
    expect(ports).toContain("t:out:out");
  });
});

suite("what may feed a design's ports", () => {
  const pair = (kind: Parameters<typeof makeNode>[0]): WelcomeGraph =>
    ({
      nodes: [
        { ...makeNode(kind, 0, 0), id: "s" },
        { ...makeNode("greeting", 400, 0), id: "d", view: "design", design: starterDesign() },
      ],
      edges: [],
    }) as unknown as WelcomeGraph;

  const wire = (kind: Parameters<typeof makeNode>[0], port: string) =>
    canConnect(pair(kind), welcomeWiring, { from: "s", to: "d", port });

  // The bug: a toggle demanded a gate or a filter, which refused every node on
  // the WHO palette - so a canvas full of conditions could wire none of them
  // in, and the refusal was silent. It also made the less consequential port
  // the stricter one: WHEN decides whether anybody gets the greeting and takes
  // a bare condition.
  for (const kind of ["country", "account", "os", "group", "tenure", "clientVersion"] as const) {
    it(`takes a ${kind} condition on a toggle, as WHEN does`, () => {
      expect(wire(kind, "in:is_new_member")).toBe(true);
      expect(wire(kind, "when")).toBe(true);
    });
  }

  it("still takes a gate and a filter", () => {
    expect(wire("filter", "in:is_new_member")).toBe(true);
    expect(wire("gate", "in:is_new_member")).toBe(true);
  });

  it("keeps prose off a toggle and conditions off a slot", () => {
    expect(wire("text", "in:is_new_member")).toBe(false);
    expect(wire("country", "in:rules")).toBe(false);
  });

  it("takes prose on a slot", () => {
    expect(wire("text", "in:rules")).toBe(true);
  });

  it("refuses a wire onto an input the design no longer declares", () => {
    expect(wire("text", "in:gone")).toBe(false);
  });
});

suite("what each socket says it carries", () => {
  // A slot's wire was falling through to `muted` and arriving grey - which on
  // this canvas means "not yet decided", so a perfectly settled wire into a
  // design looked like a problem.
  const design = { ...makeNode("greeting", 0, 0), view: "design" as const, design: starterDesign() };

  it("types a slot as prose and a toggle as a condition", () => {
    expect(welcomeSpec.portInfo(design, "in:rules", "in")).toMatchObject({ type: "text", tone: "ok" });
    expect(welcomeSpec.portInfo(design, "in:is_new_member", "in")).toMatchObject({
      type: "condition",
      tone: "accent",
    });
  });

  it("names a design's inputs the way the design does", () => {
    expect(welcomeSpec.portInfo(design, "in:rules", "in").label).toBe("rules");
    expect(welcomeSpec.portInfo(design, "in:is_new_member", "in").label).toBe("is_new_member");
  });

  it("leaves the greeting's own ports as they were", () => {
    expect(welcomeSpec.portInfo(design, "plus", "in")).toMatchObject({ label: "PLUS", tone: "ok" });
    expect(welcomeSpec.portInfo(design, "when", "in")).toMatchObject({ label: "WHEN", tone: "accent" });
  });

  it("stays quiet for a port the design no longer declares", () => {
    expect(welcomeSpec.portInfo(design, "in:gone", "in").tone).toBe("muted");
  });

  it("names an output by what comes out of it", () => {
    const text = makeNode("text", 0, 0);
    const country = makeNode("country", 0, 0);
    expect(welcomeSpec.portInfo(text, "out", "out")).toMatchObject({ label: "TEXT", type: "text" });
    expect(welcomeSpec.portInfo(country, "out", "out")).toMatchObject({
      label: "CONDITION",
      type: "condition",
    });
  });

  it("gives every socket on every kind a word to go by", () => {
    // The complaint this answers: a canvas of unlabelled dots, where some of
    // them happened to have a name in the body and the rest had nothing.
    for (const block of welcomeSpec.blocks) {
      const node = block.create(0, 0);
      for (const port of welcomeSpec.inputs(node)) {
        expect(welcomeSpec.portInfo(node, port, "in").label).not.toBe("");
      }
      for (const port of welcomeSpec.outputs(node)) {
        expect(welcomeSpec.portInfo(node, port, "out").label).not.toBe("");
      }
    }
  });
});

suite("previewing a design greeting", () => {
  // The prose previews read a node's `body` and `html`; a design has neither,
  // so they came back empty and the preview drew an ellipsis. It is compiled
  // and assembled the way the server does it instead.
  const subject = { name: "Lyn", channel: "#Gaming", server: "here", allowHtml: true };

  const canvas = (edges: unknown[] = []): WelcomeGraph =>
    ({
      nodes: [
        { ...makeNode("text", 0, 0), id: "t", name: "Rules", body: "Be kind." },
        { ...makeNode("greeting", 400, 0), id: "d", view: "design", design: starterDesign() },
      ],
      edges,
    }) as unknown as WelcomeGraph;

  it("draws the design's own blocks rather than nothing", () => {
    const out = previewDesign(canvas(), subject, "d");
    expect(out).not.toBeNull();
    expect(out?.body).toContain("Welcome aboard");
  });

  it("substitutes the snippet wired into a slot", () => {
    const wired = canvas([{ id: "e", from: "t", to: "d", port: "in:rules", fromPort: "out" }]);
    expect(previewDesign(wired, subject, "d")?.body).toContain("Be kind.");
  });

  it("drops a block whose toggle is previewing off", () => {
    const graph = canvas();
    const design = (graph.nodes[1] as { design: ReturnType<typeof starterDesign> }).design;
    design.conditions = design.conditions.map((input) => ({ ...input, on: false }));
    expect(previewDesign(graph, subject, "d")?.body).not.toContain("Register your account");
  });

  it("sends the plain half where the server has allow_html off", () => {
    const out = previewDesign(canvas(), { ...subject, allowHtml: false }, "d");
    expect(out?.target).toBe("plain");
    expect(out?.body).not.toContain("<table");
  });
});

/**
 * Every socket saying what it is, on the card, beside its own dot.
 *
 * The complaint this answers: a canvas of bare coloured dots, where knowing
 * which one took a condition and which took prose meant remembering it.
 */
suite("what the card says about its sockets", () => {
  /** One canvas holding exactly the nodes a test wants to look at. */
  const withNodes = (nodes: unknown[]) =>
    render(
      <ThemeProvider theme={createNebulaTheme("dark")}>
        <NodeEditor
          spec={welcomeSpec}
          graph={{ nodes, edges: [], enabled: true } as unknown as WelcomeGraph}
          onChange={() => undefined}
          summary=""
        />
      </ThemeProvider>,
    );

  const drawn = () =>
    render(
      <ThemeProvider theme={createNebulaTheme("dark")}>
        <NodeEditor spec={welcomeSpec} graph={seedGraph()} onChange={() => undefined} summary="" />
      </ThemeProvider>,
    );

  it("names every socket it draws", () => {
    const view = drawn();
    const sockets = [...view.container.querySelectorAll("[data-port]")];
    expect(sockets.length).toBeGreaterThan(0);
    for (const socket of sockets) {
      const [id, , port] = (socket.getAttribute("data-port") ?? "").split(":");
      const card = socket.closest("[data-node-id]");
      const row = card?.querySelector(`[data-port-row="${port}"]`);
      expect(row, `${id}'s ${port} has no name beside it`).not.toBeNull();
      expect(row?.textContent?.trim()).not.toBe("");
    }
  });

  it("says which end a greeting's two inputs are", () => {
    const view = drawn();
    const card = view.container.querySelector('[data-node-id="greeting"]');
    expect(card?.querySelector('[data-port-row="when"]')?.textContent).toBe("WHEN");
    expect(card?.querySelector('[data-port-row="plus"]')?.textContent).toBe("PLUS");
  });

  it("names a snippet's output by what comes out of it", () => {
    const view = withNodes([{ ...makeNode("text", 0, 0), id: "rules", name: "rules" }]);
    const card = view.container.querySelector('[data-node-id="rules"]');
    expect(card?.querySelector('[data-port-row="out"]')?.textContent).toBe("TEXT");
  });

  it("no longer writes a gate's inputs out twice", () => {
    // The body used to draw A and B itself, so once the sockets were named
    // the same two words appeared twenty pixels apart.
    const view = withNodes([{ ...makeNode("gate", 0, 0), id: "and", gate: "and" }]);
    const card = view.container.querySelector('[data-node-id="and"]');
    expect([...(card?.querySelectorAll("*") ?? [])].filter((el) => el.textContent === "A")).toHaveLength(1);
  });
});
