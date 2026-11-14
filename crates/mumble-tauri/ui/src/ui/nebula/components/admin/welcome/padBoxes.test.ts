/**
 * The welcome designer sets the room inside every box it draws, so the rule
 * that gives a server's hand-written boxes room (`core/utils/boxPadding.ts`)
 * leaves its output exactly as it was: every template, for both targets.
 */
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { assemble, compileTarget } from "./compile";
import { DESIGN_TEMPLATES, WELCOME_TEMPLATES } from "./templates";

/** Where two serialisations part, with a little either side, or "" if they do not. */
function parting(a: string, b: string): string {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at += 1;
  if (at === a.length && a.length === b.length) return "";
  return `${a.slice(Math.max(0, at - 160), at + 120)}
  vs
${b.slice(Math.max(0, at - 160), at + 120)}`;
}

describe("the welcome designer's own output", () => {
  for (const template of DESIGN_TEMPLATES) {
    for (const target of ["html", "qt"] as const) {
      it(`is unchanged by box padding: ${template.id} for ${target}`, () => {
        const design = template.build();
        const html = assemble(compileTarget(design, target), target, {
          condition: (name) => design.conditions.find((input) => input.name === name)?.on !== false,
          slot: () => "",
        });
        expect(parting(sanitizeHtml(html, { padBoxes: true }), sanitizeHtml(html))).toBe("");
      });
    }
  }
  for (const template of WELCOME_TEMPLATES) {
    if (typeof template.preview !== "string" || template.preview === "") continue;
    it(`is unchanged by box padding: the ${template.id} preview`, () => {
      const html = template.preview as string;
      expect(parting(sanitizeHtml(html, { padBoxes: true }), sanitizeHtml(html))).toBe("");
    });
  }
});
