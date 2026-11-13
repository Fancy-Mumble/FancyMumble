/**
 * The native (GPUI) view paints with the same thirteen themes, read from a
 * table generated here: `src/ui/gpui/assets/themes.json`, every theme in both
 * modes, already resolved by `schemeTokens` so the fallback chain is written
 * once, in TypeScript.
 *
 * This test fails when the table is stale. Regenerate it with
 *
 *     npx vitest run src/ui/nebula/nativeThemes.test.ts -u
 */
import { describe, expect, it } from "vitest";
import { NEBULA_THEMES, type NebulaPalette, type NebulaThemeDef } from "./themeCatalog";
import { schemeTokens } from "./themeScheme";
import type { NebulaMode } from "./tokens";

/** The table, from this file: six levels up is the repository root. */
const TABLE = "../../../../../../src/ui/gpui/assets/themes.json";

function mode(def: NebulaThemeDef, palette: NebulaPalette, which: NebulaMode) {
  return {
    tokens: schemeTokens(palette, def.skin, which),
    // The conversation's gradient as its two stops: the native view draws it
    // itself instead of parsing the composed `backdrop`.
    canvasA: palette.canvasA,
    canvasB: palette.canvasB,
  };
}

function table(): string {
  const themes = NEBULA_THEMES.map((def) => ({
    id: def.id,
    name: def.name,
    audience: def.audience,
    skin: def.skin,
    light: mode(def, def.light, "light"),
    dark: mode(def, def.dark, "dark"),
  }));
  return `${JSON.stringify({ themes }, null, 1)}\n`;
}

describe("the native view's theme table", () => {
  it("matches the catalogue", async () => {
    await expect(table()).toMatchFileSnapshot(TABLE);
  });
});
