/**
 * Every page of the settings navigation reads differently, in every shipped
 * language.
 *
 * The bug: in German "Voice" and "Language" were both "Sprache" - one bare,
 * one as "Sprache & Format" - so the navigation offered what reads as the
 * same page twice. Two labels collide here when they are equal, or when one is
 * a whole `&`-separated part of the other.
 */
import { describe, expect, it } from "vitest";
import { BUILT_IN_LANGUAGES } from "@core/i18n";
import { BUILT_IN_RESOURCES } from "@core/i18n/builtInBundles";
import { SETTINGS_NAV } from "./SettingsNav";

const NEBULA_SETTINGS = import.meta.glob<Record<string, unknown>>("../../../../core/locales/nebula/*/settings.json", {
  eager: true,
  import: "default",
});

function lookup(bundle: unknown, path: string): string | undefined {
  const value = path.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    bundle,
  );
  return typeof value === "string" ? value : undefined;
}

function label(language: string, key: string): string {
  const [namespace, path] = key.split(":");
  const bundle =
    namespace === "nebulaSettings"
      ? NEBULA_SETTINGS[`../../../../core/locales/nebula/${language}/settings.json`]
      : BUILT_IN_RESOURCES[language as keyof typeof BUILT_IN_RESOURCES].settings;
  // A missing translation falls back to English, as i18next does.
  return lookup(bundle, path) ?? label("en", key);
}

function parts(text: string): string[] {
  return text
    .toLowerCase()
    .split("&")
    .map((part) => part.trim());
}

function collisions(labels: readonly string[]): string[] {
  const found: string[] = [];
  labels.forEach((left, i) =>
    labels.slice(i + 1).forEach((right) => {
      const same =
        left.toLowerCase() === right.toLowerCase() ||
        parts(left).includes(right.toLowerCase()) ||
        parts(right).includes(left.toLowerCase());
      if (same) found.push(`"${left}" / "${right}"`);
    }),
  );
  return found;
}

describe("settings navigation labels", () => {
  it.each(BUILT_IN_LANGUAGES)("are all different in Nebula's navigation (%s)", (language) => {
    expect(collisions(SETTINGS_NAV.map((entry) => label(language, entry.labelKey)))).toEqual([]);
  });

  it.each(BUILT_IN_LANGUAGES)("are all different in Standard's tabs (%s)", (language) => {
    const tabs = BUILT_IN_RESOURCES[language].settings.tabs as Record<string, string>;
    expect(collisions(Object.values(tabs))).toEqual([]);
  });
});
