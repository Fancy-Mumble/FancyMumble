/**
 * Global Vitest setup: provides a react-i18next mock that returns real English
 * strings from the locale files. This ensures component tests see the same
 * translated text users see, rather than bare translation keys.
 *
 * It also fills the one hole jsdom leaves that a mounted editor falls through -
 * see below.
 */

import { vi } from "vitest";
// The shared namespaces moved into `locales/common/` and the packs took their
// own strings with them. Both layouts are read, newer over older, because the
// move is still in flight and a key that has not been carried across yet is
// still the string the user sees.
import legacyChat from "./src/core/locales/en/chat.json";
import legacyCommon from "./src/core/locales/en/common.json";
import legacyServer from "./src/core/locales/en/server.json";
import legacySettings from "./src/core/locales/en/settings.json";
import legacySidebar from "./src/core/locales/en/sidebar.json";
import enChat from "./src/core/locales/common/en/chat.json";
import enCommon from "./src/core/locales/common/en/common.json";
import enServer from "./src/core/locales/common/en/server.json";
import enSettings from "./src/core/locales/common/en/settings.json";
import enSidebar from "./src/core/locales/common/en/sidebar.json";
import nebulaCommon from "./src/core/locales/nebula/en/common.json";
import nebulaChrome from "./src/core/locales/nebula/en/chrome.json";
import nebulaSidebar from "./src/core/locales/nebula/en/sidebar.json";
import nebulaChat from "./src/core/locales/nebula/en/chat.json";
import nebulaConnect from "./src/core/locales/nebula/en/connect.json";
import nebulaUser from "./src/core/locales/nebula/en/user.json";
import nebulaServer from "./src/core/locales/nebula/en/server.json";
import nebulaSettings from "./src/core/locales/nebula/en/settings.json";

type NestedRecord = { [key: string]: unknown };

/** Later bundles win, key by key, all the way down. */
function merge(...bundles: NestedRecord[]): NestedRecord {
  const out: NestedRecord = {};
  for (const bundle of bundles)
    for (const [key, value] of Object.entries(bundle)) {
      const mine = out[key];
      out[key] =
        value && typeof value === "object" && !Array.isArray(value)
          ? merge(
              (mine && typeof mine === "object" ? mine : {}) as NestedRecord,
              value as NestedRecord,
            )
          : value;
    }
  return out;
}

const NAMESPACES: Record<string, NestedRecord> = {
  chat: merge(legacyChat as NestedRecord, enChat as NestedRecord),
  common: merge(legacyCommon as NestedRecord, enCommon as NestedRecord),
  server: merge(legacyServer as NestedRecord, enServer as NestedRecord),
  settings: merge(legacySettings as NestedRecord, enSettings as NestedRecord),
  sidebar: merge(legacySidebar as NestedRecord, enSidebar as NestedRecord),
  nebulaCommon: nebulaCommon as NestedRecord,
  nebulaChrome: nebulaChrome as NestedRecord,
  nebulaSidebar: nebulaSidebar as NestedRecord,
  nebulaChat: nebulaChat as NestedRecord,
  nebulaConnect: nebulaConnect as NestedRecord,
  nebulaUser: nebulaUser as NestedRecord,
  nebulaServer: nebulaServer as NestedRecord,
  nebulaSettings: nebulaSettings as NestedRecord,
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

/**
 * jsdom lays nothing out, so it has no notion of scrolling an element into
 * view and does not implement the method at all. Any list that keeps its
 * active row visible - the mention popup, the slash menu, jump-to-message -
 * therefore dies on an uncaught TypeError instead of failing an assertion.
 * A no-op is what a browser does for an element that is already in view.
 */
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * `<dialog>`'s own methods, which jsdom declares the element for but does not
 * implement. Anything that confirms before acting - the external-link guard
 * most of all - calls `showModal` from a mount effect, so without these the
 * component throws on mount instead of the test seeing the prompt it renders.
 * Flipping the `open` attribute is what the spec says the methods do, minus
 * the top layer and focus moves jsdom has no notion of either way.
 */
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

/**
 * `localStorage`, which this environment does not hand over.
 *
 * jsdom creates it (constructing a JSDOM here directly gives one), but the
 * vitest jsdom environment on these versions exposes `sessionStorage` and not
 * `localStorage` - so anything settings-backed reads `undefined` and dies on
 * `removeItem`. The product never sees this: a webview has the real thing.
 *
 * Backed by a Map rather than delegated to `sessionStorage`, so a test that
 * fills it cannot leak into one that expects it empty.
 */
if (typeof globalThis.localStorage === "undefined") {
  const cells = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return cells.size;
    },
    key: (index: number) => [...cells.keys()][index] ?? null,
    getItem: (key: string) => cells.get(key) ?? null,
    setItem: (key: string, value: string) => void cells.set(key, String(value)),
    removeItem: (key: string) => void cells.delete(key),
    clear: () => cells.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  }
}
