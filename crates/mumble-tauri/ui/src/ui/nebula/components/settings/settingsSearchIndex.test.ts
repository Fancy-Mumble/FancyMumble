/**
 * The settings search's matching, and the index it matches against.
 *
 * Both halves are worth a test for the same reason: neither fails loudly. A
 * bad match returns fewer results, and an entry pointing at a page that does
 * not draw it opens that page and flashes nothing - which reads as a search
 * that "sometimes works".
 */

import { describe, expect, it } from "vitest";
import { SETTINGS_NAV, visibleSettingsPages, type SettingsPageId } from "./SettingsNav";
import { SETTINGS_SEARCH_INDEX, searchSettings, type SettingsSearchEntry } from "./settingsSearchIndex";

/** Every page, in nav order - what an administrator on a modern server sees. */
const ALL_PAGES = SETTINGS_NAV.map((entry) => ({ id: entry.id, label: entry.labelKey }));

/** Untranslated: the test is about matching, not about the catalogue. */
const asWritten = (entry: SettingsSearchEntry) => entry.title;

const pageIds = (query: string, pages = ALL_PAGES): SettingsPageId[] =>
  searchSettings(query, pages, asWritten).map((hit) => hit.page);

describe("searchSettings", () => {
  it("finds a setting by its heading", () => {
    expect(pageIds("noise suppression")).toEqual(["voice"]);
  });

  it("finds one by a word that is nowhere on the page", () => {
    // "ptt" is written on no control; it is why the keywords exist.
    expect(pageIds("ptt")).toEqual(["voice", "shortcuts"]);
  });

  it("needs every word, not just one of them", () => {
    const onAdvanced = (query: string) =>
      searchSettings(query, ALL_PAGES, asWritten).find((hit) => hit.page === "advanced")?.count ?? 0;

    expect(pageIds("log level")).toEqual(["advanced"]);
    // "log" alone reaches every switch about logging...
    expect(onAdvanced("log")).toBeGreaterThan(4);
    // ...and the second word narrows it to the ones about files.
    expect(onAdvanced("log file")).toBeLessThan(4);
  });

  it("counts the matches on each page and keeps the nav's order", () => {
    const hits = searchSettings("colour", ALL_PAGES, asWritten);
    expect(hits.map((hit) => hit.page)).toEqual(["profile", "personalize"]);
    expect(hits[0].count).toBeGreaterThan(0);
  });

  it("carries the headings it matched, for the page to flash", () => {
    const [voice] = searchSettings("ptt", ALL_PAGES, asWritten);
    expect(voice.titles).toContain("Activation mode");
  });

  it("says nothing at all for an empty query", () => {
    expect(searchSettings("   ", ALL_PAGES, asWritten)).toEqual([]);
  });

  it("never offers a page this session cannot open", () => {
    // No account support, no onboarding, no plugins: three pages the nav hides.
    const visible = visibleSettingsPages({
      accountSupported: false,
      onboardingSupported: false,
      hasPlugins: false,
    }).map((entry) => ({ id: entry.id, label: entry.labelKey }));

    expect(pageIds("2fa", visible)).toEqual([]);
    expect(pageIds("password", visible)).toEqual([]);
    // The pages that are always there still answer.
    expect(pageIds("wallpaper", visible)).toEqual(["personalize"]);
  });

  it("prefers the drawn text over the English one when they differ", () => {
    const german = (entry: SettingsSearchEntry) =>
      entry.titleKey === "advanced.dangerZone" ? "Gefahrenzone" : entry.title;
    expect(pageIds("gefahren")).toEqual([]);
    expect(searchSettings("gefahren", ALL_PAGES, german).map((hit) => hit.page)).toEqual(["advanced"]);
  });
});

describe("the index itself", () => {
  it("only points at pages the nav has", () => {
    const known = new Set<string>(SETTINGS_NAV.map((entry) => entry.id));
    for (const entry of SETTINGS_SEARCH_INDEX) expect(known.has(entry.page)).toBe(true);
  });

  it("covers every page, so no page is unreachable by name", () => {
    const covered = new Set(SETTINGS_SEARCH_INDEX.map((entry) => entry.page));
    for (const entry of SETTINGS_NAV) expect(covered.has(entry.id)).toBe(true);
  });

  it("says each thing once per page", () => {
    const seen = new Set<string>();
    for (const entry of SETTINGS_SEARCH_INDEX) {
      const key = `${entry.page}:${entry.title}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
