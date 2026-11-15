import { describe, expect, it } from "vitest";
import i18next from "i18next";

/**
 * The app turns interpolation escaping off globally (React escapes text on its
 * own), so a message that is set as HTML - a translation with `<strong>` in it
 * - has to switch escaping back on for its own values. This pins down that the
 * per-call switch those dialogs rely on actually escapes, with the app's
 * global setting in force.
 */
describe("per-call interpolation escaping", () => {
  it("escapes the value and keeps the translation's own markup", async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: "en",
      interpolation: { escapeValue: false },
      resources: { en: { translation: { enter: "Password for <strong>{{target}}</strong>." } } },
    });

    // Untyped: this instance's one key is not in the app's generated key list.
    const t = i18n.t.bind(i18n) as unknown as (key: string, options: object) => string;
    const html = t("enter", {
      target: '<img src="x" onerror="alert(1)">',
      interpolation: { escapeValue: true },
    });

    expect(html).toContain("<strong>");
    expect(html).not.toContain("<img");
  });
});
