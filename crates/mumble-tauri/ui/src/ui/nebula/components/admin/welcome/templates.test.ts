import { describe as suite, expect, it } from "vitest";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { richTextSurvives } from "../../primitives";
import { insertFragment, type Fragment } from "../nodes";
import { compileAll, compileTarget } from "./compile";
import { DESIGN_TEMPLATES, WELCOME_TEMPLATES } from "./templates";
import { MAX_BODY } from "./markup";
import {
  describe,
  graphStatus,
  isLegacy,
  isMessage,
  isScreen,
  markupOf,
  qtViolations,
  previewDesign,
  previewMarkup,
  previewText,
  type WelcomeGraph,
  type WelcomeNode,
} from "./model";

const SUBJECT = { name: "Lyn", channel: "#Gaming", server: "magical.rocks", allowHtml: true };

const EMPTY: WelcomeGraph = { nodes: [], edges: [], enabled: true };

/** The template, laid onto an empty canvas, exactly as the gallery lays it. */
function laid(fragment: Fragment<WelcomeNode>): WelcomeGraph {
  return insertFragment(EMPTY, fragment, { replace: true, width: () => 300 }).graph;
}

suite("the welcome template catalogue", () => {
  it("ships something to start from", () => {
    expect(WELCOME_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("names each template once", () => {
    const ids = WELCOME_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const template of WELCOME_TEMPLATES) {
    suite(template.label, () => {
      it("arrives as a graph the status bar calls complete", () => {
        // The whole promise of a template: press it, and the thing on screen
        // can be saved. One that landed with a to-fix badge would be worse
        // than no template, because the operator now has to debug somebody
        // else's drawing rather than draw their own.
        const status = graphStatus(laid(template.build()));
        expect(status.problems).toEqual([]);
        expect(status.complete).toBe(true);
      });

      it("reads back as a condition rather than reaching nobody", () => {
        // A greeting with nothing wired to WHEN is drawn, enabled, complete
        // and shown to no one - the failure this editor exists to make
        // visible, and the last one a template should ship with.
        expect(describe(laid(template.build()))).not.toBeNull();
      });

      it("opens in the editor rather than in the source view", () => {
        // Tiptap rewrites markup it has no node for, so the store opens such a
        // document as source to avoid flattening it. A shipped template that
        // tripped that check would be one nobody could edit the easy way.
        //
        // A screen is exempt, and has to be: its markup is *generated* from
        // its bands, the band list is its editor, and the WYSIWYG never opens
        // it. The legacy dialect is table markup on purpose, which Tiptap
        // deliberately cannot hold.
        for (const node of laid(template.build()).nodes) {
          const html = markupOf(node);
          if (html === "" || isScreen(node)) continue;
          expect(richTextSurvives(html, "document"), template.id).toBe(true);
        }
      });

      it("writes only what Qt can draw, where it is written for Qt", () => {
        // Mumble 1.5 and older render a subset of HTML 4: a tag outside it is
        // unwrapped, so a greeting that leaned on one arrives with its styling
        // silently gone.
        for (const node of laid(template.build()).nodes) {
          if (!isLegacy(node)) continue;
          const html = markupOf(node);
          expect(qtViolations(html), template.id).toEqual([]);
          // And it is laid out the only way Qt lays anything out.
          expect(html, template.id).toContain("<table");
        }
      });

      it("keeps its structure through the sanitiser", () => {
        // Every surface in this client renders untrusted markup through one
        // allow-list, so a tag that is not on it is missing from what people
        // actually read - and a template is markup this client wrote.
        for (const node of laid(template.build()).nodes) {
          const html = markupOf(node);
          if (html === "") continue;
          const clean = sanitizeHtml(html);
          for (const tag of html.matchAll(/<(\w+)[\s>]/g)) {
            expect(clean, `${template.id} keeps <${tag[1]}>`).toContain(`<${tag[1]}`);
          }
        }
      });

      it("fits in the body the server will take", () => {
        for (const node of laid(template.build()).nodes) {
          if (!isMessage(node)) continue;
          expect([...node.html].length, `${template.id} markup`).toBeLessThanOrEqual(MAX_BODY);
          expect([...node.body].length, `${template.id} plain`).toBeLessThanOrEqual(MAX_BODY);
        }
      });

      it("carries a plain half that says the same thing", () => {
        // Both halves go on the wire and the server picks one. A template
        // whose plain half was empty would look perfect on this operator's
        // server and arrive blank on the one with allow_html switched off.
        for (const node of laid(template.build()).nodes) {
          if (!isMessage(node) || node.html === "") continue;
          expect(node.body.trim(), template.id).not.toBe("");
        }
      });

      it("does not lean on a placeholder nothing substitutes", () => {
        // `{name}` is filled in by this page's preview and by nothing else in
        // the stack - not the server that composes the greeting, not the
        // client that shows it. A template using one would ship a greeting
        // that reads "Welcome, {name}" to everybody.
        const graph = laid(template.build());
        expect(previewText(graph, SUBJECT)).not.toContain("{");
        expect(previewMarkup(graph, SUBJECT) ?? "").not.toContain("{");
      });

      it("previews as the markup it was written as", () => {
        const graph = laid(template.build());
        const greeting = graph.nodes.find((node) => node.kind === "greeting");
        // The same question the node's own preview asks, and in the same
        // order: a designed greeting has no `html` to show, because a design
        // compiles to a different document per target and is assembled per
        // peer. Asking only the prose half called every designed template
        // empty.
        const markup =
          previewDesign(graph, SUBJECT, greeting?.id)?.body ?? previewMarkup(graph, SUBJECT);
        expect(markup, template.id).not.toBeNull();
        // The card's thumbnail is the same markup, so what the gallery shows
        // is what the canvas will hold.
        if (template.preview) expect(markup).toContain(template.preview.slice(0, 40));
      });

      it("wires only nodes it brought with it", () => {
        const fragment = template.build();
        const ids = new Set(fragment.nodes.map((node) => node.id));
        for (const drawn of fragment.wires) {
          expect(ids.has(drawn.from), `${template.id} from`).toBe(true);
          expect(ids.has(drawn.to), `${template.id} to`).toBe(true);
        }
      });

      it("builds a fresh copy every time, so adding it twice gives two", () => {
        const first = template.build();
        const second = template.build();
        const overlap = new Set(first.nodes.map((node) => node.id));
        expect(second.nodes.some((node) => overlap.has(node.id))).toBe(false);
      });
    });
  }
});

suite("the sheets the design editor can start from", () => {
  it("offers each one as a design that compiles on every target", () => {
    // Including Qt, which draws almost none of what the modern sheet is made
    // of. What matters is that it *compiles* - a target that cannot draw a
    // gradient has to end up with a flatter message, not a crash on the join
    // path.
    for (const entry of DESIGN_TEMPLATES) {
      const sheet = entry.build();
      expect(sheet.blocks.length, entry.id).toBeGreaterThan(0);
      for (const target of ["plain", "rich", "html", "qt"] as const) {
        expect(() => compileTarget(sheet, target), `${entry.id} on ${target}`).not.toThrow();
      }
    }
  });

  it("keeps every sheet it claims inside the cap the server pays on each join", () => {
    // Only the targets a sheet claims. The modern one is gradients, inlined
    // pictures and translucent rounded panels, none of which Classic can draw
    // and all of which cost it a table per block - so it does not claim that
    // target, and those readers get the greeting's written halves instead.
    for (const entry of DESIGN_TEMPLATES) {
      const sheet = entry.build();
      for (const [target, parts] of Object.entries(compileAll(sheet))) {
        const markup = parts.map((part) => part.literal ?? "").join("");
        expect(markup.length, `${entry.id} on ${target}`).toBeLessThan(4096);
      }
    }
  });

  it("sends nothing on a target its sheet does not claim", () => {
    const modern = DESIGN_TEMPLATES.find((entry) => entry.id === "modern")!.build();
    expect(compileAll(modern).qt).toEqual([]);
    expect(compileAll(modern).rich.length).toBeGreaterThan(0);
  });

  it("declares every input its own blocks gate on", () => {
    // A block gated on a name the design does not declare is dropped by the
    // server on every join, silently - so a template that shipped one would
    // be a template with an invisible element.
    for (const entry of DESIGN_TEMPLATES) {
      const sheet = entry.build();
      const names = new Set(sheet.conditions.map((input) => input.name));
      for (const block of sheet.blocks) {
        if (block.gate !== undefined) expect(names.has(block.gate), `${entry.id}/${block.gate}`).toBe(true);
      }
      const slots = new Set(sheet.slots.map((input) => input.name));
      for (const block of sheet.blocks) {
        if (block.type === "slot" && block.slot) {
          expect(slots.has(block.slot), `${entry.id}/${block.slot}`).toBe(true);
        }
      }
    }
  });
});
