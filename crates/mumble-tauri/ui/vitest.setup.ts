/**
 * Global Vitest setup: provides a react-i18next mock that returns real English
 * strings from the locale files. This ensures component tests see the same
 * translated text users see, rather than bare translation keys.
 *
 * It also fills the one hole jsdom leaves that a mounted editor falls through -
 * see below.
 */

import { vi } from "vitest";
import enChat from "./src/core/locales/en/chat.json";
import enCommon from "./src/core/locales/en/common.json";
import enServer from "./src/core/locales/en/server.json";
import enSettings from "./src/core/locales/en/settings.json";
import enSidebar from "./src/core/locales/en/sidebar.json";

type NestedRecord = { [key: string]: unknown };

const NAMESPACES: Record<string, NestedRecord> = {
  chat: enChat as NestedRecord,
  common: enCommon as NestedRecord,
  server: enServer as NestedRecord,
  settings: enSettings as NestedRecord,
  sidebar: enSidebar as NestedRecord,
};

function resolveKey(data: NestedRecord, key: string): unknown {
  const parts = key.split(".");
  let node: unknown = data;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as NestedRecord)[part];
  }
  return node;
}

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/{{(\w+)}}/g, (_match, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

function makeT(ns: string | string[]) {
  const namespacePriority = Array.isArray(ns) ? ns : [ns];

  return (key: string, opts?: Record<string, unknown>): unknown => {
    let resolvedKey = key;
    let namespacesToSearch = namespacePriority;

    const colonIdx = key.indexOf(":");
    if (colonIdx !== -1) {
      namespacesToSearch = [key.slice(0, colonIdx)];
      resolvedKey = key.slice(colonIdx + 1);
    } else if (typeof opts?.ns === "string") {
      namespacesToSearch = [opts.ns];
    }

    let value: unknown;
    for (const namespace of namespacesToSearch) {
      const data = NAMESPACES[namespace];
      if (!data) continue;
      value = resolveKey(data, resolvedKey);
      if (value === undefined && typeof opts?.count === "number") {
        const suffix = opts.count === 1 ? "_one" : "_other";
        value = resolveKey(data, `${resolvedKey}${suffix}`);
      }
      if (value !== undefined) break;
    }

    if (value === undefined) return key;
    if (opts?.returnObjects) return value;
    if (typeof value !== "string") return key;

    const interpVars: Record<string, unknown> = {};
    if (opts) {
      for (const [k, v] of Object.entries(opts)) {
        if (k !== "returnObjects" && k !== "ns" && k !== "count") {
          interpVars[k] = v;
        }
      }
      if (typeof opts.count === "number") interpVars["count"] = opts.count;
    }
    return interpolate(value, interpVars);
  };
}

vi.mock("react-i18next", () => ({
  useTranslation: (ns: string | string[] = "common") => ({
    t: makeT(ns),
    i18n: {
      changeLanguage: () => Promise.resolve(),
      language: "en",
    },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));


/**
 * The geometry jsdom leaves out, which a mounted editor falls through.
 *
 * jsdom lays nothing out, so it implements `getClientRects` on elements only
 * and `elementFromPoint` not at all. ProseMirror asks for all three the moment
 * an editor mounts and again on every edit - to place the caret, to scroll the
 * selection into view - so without these every test that renders an editor
 * dies on an uncaught exception instead of failing an assertion. Answering
 * "nothing is anywhere" is both true of jsdom and a case ProseMirror already
 * handles, being what a browser reports for an unrendered node.
 */
const NO_RECTS = Object.assign([], { item: () => null }) as unknown as DOMRectList;

if (typeof document !== "undefined" && !document.elementFromPoint) {
  Document.prototype.elementFromPoint = () => null;
}
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => NO_RECTS;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
if (typeof Text !== "undefined" && !("getClientRects" in Text.prototype)) {
  Object.defineProperty(Text.prototype, "getClientRects", {
    configurable: true,
    value: () => NO_RECTS,
  });
}
