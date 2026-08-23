import { describe, expect, it } from "vitest";
import { NEBULA_TOKENS } from "./tokens";

describe("Nebula tokens", () => {
  for (const mode of ["dark", "light"] as const) {
    describe(mode, () => {
      const tokens = NEBULA_TOKENS[mode];

      it("gives the conversation a backdrop distinct from the surface tint", () => {
        // The header and composer blur what is behind them. Reusing the smooth
        // surface tint blurs to something identical to itself, which is what
        // made that chrome render as a flat band rather than glass.
        expect(tokens.backdrop).toBeTruthy();
        expect(tokens.backdrop).not.toBe(tokens.tint);
      });

      it("layers several gradients so the blur has structure to work on", () => {
        expect(tokens.backdrop.match(/gradient\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
      });

      it("keeps the chrome fill translucent so the backdrop shows through", () => {
        expect(tokens.panel).toMatch(/^rgba\(/);
        const alpha = Number.parseFloat(tokens.panel.split(",").pop()!.replace(")", ""));
        expect(alpha).toBeLessThan(1);
      });
    });
  }
});
