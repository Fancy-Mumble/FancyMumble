/**
 * Persistent storage for user-authored translation bundles.
 *
 * Bundles are saved to `translations.json` via @tauri-apps/plugin-store so
 * a contributor's work survives app restarts.  On app boot {@link
 * loadCustomTranslations} reads every saved bundle and registers it with
 * the global i18next instance, making the new languages immediately
 * available to switch into.
 */

import { load } from "../utils/store";
import {
  I18N_NAMESPACES,
  registerLanguage,
  type I18nNamespace,
  type LocaleBundle,
} from "../i18n";

const STORE_FILE = "translations.json";
const KEY = "customLanguages";

/** Metadata + content for one user-authored language. */
export interface CustomTranslation {
  /** IETF / ISO-639 code such as `zh-Hant`, `pt-BR`, `nl`. */
  readonly code: string;
  /** Native display name (e.g. `日本語`). */
  readonly nativeName: string;
  /** English display name (e.g. `Japanese`). */
  readonly englishName: string;
  /** Country code used to render the flag (ISO 3166-1 alpha-2), if any. */
  readonly flagCountry: string | null;
  /** Per-namespace key->value bundle. */
  readonly bundle: Partial<LocaleBundle>;
  /** Last modified, epoch ms. */
  readonly updatedAt: number;
}

type CustomTranslationsMap = Record<string, CustomTranslation>;

async function getStore() {
  return load(STORE_FILE, { autoSave: true, defaults: {} });
}

/** Read every saved custom translation bundle. */
export async function loadCustomTranslations(): Promise<CustomTranslationsMap> {
  try {
    const store = await getStore();
    const raw = (await store.get<CustomTranslationsMap>(KEY)) ?? {};
    return raw;
  } catch (e) {
    console.warn("loadCustomTranslations failed:", e);
    return {};
  }
}

/** Persist a single custom-translation bundle. */
export async function saveCustomTranslation(
  entry: CustomTranslation,
): Promise<void> {
  const store = await getStore();
  const current = (await store.get<CustomTranslationsMap>(KEY)) ?? {};
  current[entry.code] = { ...entry, updatedAt: Date.now() };
  await store.set(KEY, current);
  await store.save();
}

/** Delete a saved custom-translation bundle by code. */
export async function deleteCustomTranslation(code: string): Promise<void> {
  const store = await getStore();
  const current = (await store.get<CustomTranslationsMap>(KEY)) ?? {};
  if (!(code in current)) return;
  delete current[code];
  await store.set(KEY, current);
  await store.save();
}

/**
 * Read all saved bundles and register them with i18next.  Call once on
 * app boot, *after* the i18n module has run its initial init.
 */
export async function bootstrapCustomTranslations(): Promise<void> {
  const all = await loadCustomTranslations();
  for (const entry of Object.values(all)) {
    registerLanguage(entry.code, entry.bundle);
  }
}

/** Empty placeholder bundle (every key set to "---") cloned from a source. */
export function buildPlaceholderBundle(
  source: Partial<LocaleBundle>,
): Partial<LocaleBundle> {
  const out: Partial<LocaleBundle> = {};
  for (const ns of I18N_NAMESPACES) {
    out[ns] = clonePlaceholders(source[ns] ?? {});
  }
  return out;
}

function clonePlaceholders(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!value || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = clonePlaceholders(v);
    } else {
      out[k] = "---";
    }
  }
  return out;
}

/** Flatten a nested namespace into a list of dotted keys + leaf values. */
export interface FlattenedEntry {
  readonly ns: I18nNamespace;
  /** Dot-separated key path inside the namespace. */
  readonly key: string;
  readonly value: string;
}

export function flattenBundle(
  bundle: Partial<LocaleBundle>,
): FlattenedEntry[] {
  const out: FlattenedEntry[] = [];
  for (const ns of I18N_NAMESPACES) {
    const nsObj = bundle[ns];
    if (!nsObj) continue;
    flattenInto(nsObj, "", (key, value) => out.push({ ns, key, value }));
  }
  return out;
}

function flattenInto(
  obj: Record<string, unknown>,
  prefix: string,
  push: (key: string, value: string) => void,
): void {
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flattenInto(v as Record<string, unknown>, next, push);
    } else if (typeof v === "string") {
      push(next, v);
    } else {
      push(next, String(v));
    }
  }
}

/** Set a dotted key inside a per-ns bundle, creating intermediate objects. */
export function setNestedValue(
  bundle: Partial<LocaleBundle>,
  ns: I18nNamespace,
  key: string,
  value: string,
): Partial<LocaleBundle> {
  const next: Partial<LocaleBundle> = { ...bundle };
  const nsObj = { ...(next[ns] ?? {}) };
  next[ns] = nsObj;
  const parts = key.split(".");
  let cursor: Record<string, unknown> = nsObj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const k = parts[i]!;
    const existing = cursor[k];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      const copy = { ...(existing as Record<string, unknown>) };
      cursor[k] = copy;
      cursor = copy;
    } else {
      const fresh: Record<string, unknown> = {};
      cursor[k] = fresh;
      cursor = fresh;
    }
  }
  cursor[parts[parts.length - 1]!] = value;
  return next;
}

/** Read a dotted key out of a bundle, returning undefined when absent. */
export function getNestedValue(
  bundle: Partial<LocaleBundle>,
  ns: I18nNamespace,
  key: string,
): string | undefined {
  const nsObj = bundle[ns];
  if (!nsObj) return undefined;
  const parts = key.split(".");
  let cursor: unknown = nsObj;
  for (const p of parts) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[p];
  }
  return typeof cursor === "string" ? cursor : undefined;
}
