/**
 * Global Vitest setup: provides a react-i18next mock that returns real English
 * strings from the locale files. This ensures component tests see the same
 * translated text users see, rather than bare translation keys.
 */

import { vi } from "vitest";
import enChat from "./src/locales/en/chat.json";
import enCommon from "./src/locales/en/common.json";
import enServer from "./src/locales/en/server.json";
import enSettings from "./src/locales/en/settings.json";
import enSidebar from "./src/locales/en/sidebar.json";

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
