import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

// Only the source/fallback language (en) is bundled eagerly.  de/fr/zh (and any
// custom languages) load on demand via the backend below, keeping ~200 kB of
// inactive-language JSON off the startup heap.  The full 4-language set for the
// translation editor lives in `./builtInBundles.ts` (loaded with that lazy page).
import enCommon from "../locales/common/en/common.json";
import enSettings from "../locales/common/en/settings.json";
import enChat from "../locales/common/en/chat.json";
import enServer from "../locales/common/en/server.json";
import enSidebar from "../locales/common/en/sidebar.json";

export const BUILT_IN_LANGUAGES = ["en", "de", "fr", "zh"] as const;
export type BuiltInLanguage = (typeof BUILT_IN_LANGUAGES)[number];

/**
 * Namespaces every UI pack shares.  Their JSON lives under
 * `locales/common/<lang>/`, and a string belongs there as soon as a second
 * pack says it - the pack folders hold only what one design says on its own.
 */
export const SHARED_NAMESPACES = ["common", "chat", "server", "settings", "sidebar"] as const;

/**
 * Namespaces owned by the Nebula pack, from `locales/nebula/<lang>/`.  They are
 * split along Nebula's own component folders rather than the shared feature
 * split, because that is the boundary a Nebula string is written against.
 */
export const NEBULA_NAMESPACES = [
  "nebulaCommon",
  "nebulaChrome",
  "nebulaSidebar",
  "nebulaChat",
  "nebulaConnect",
  "nebulaUser",
  "nebulaServer",
  "nebulaSettings",
] as const;

/** Public list of namespaces shipped with the app. */
export const I18N_NAMESPACES = [...SHARED_NAMESPACES, ...NEBULA_NAMESPACES] as const;
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

/**
 * Where a namespace's JSON lives, as `locales/<group>/<lang>/<file>.json`.
 * Namespace ids stay flat (`nebulaChat`, not `nebula/chat`) so they survive a
 * round trip through the translation editor, which names exported files after
 * them - a slash would not.
 */
const NAMESPACE_SOURCES: Record<I18nNamespace, { group: string; file: string }> = {
  common: { group: "common", file: "common" },
  chat: { group: "common", file: "chat" },
  server: { group: "common", file: "server" },
  settings: { group: "common", file: "settings" },
  sidebar: { group: "common", file: "sidebar" },
  nebulaCommon: { group: "nebula", file: "common" },
  nebulaChrome: { group: "nebula", file: "chrome" },
  nebulaSidebar: { group: "nebula", file: "sidebar" },
  nebulaChat: { group: "nebula", file: "chat" },
  nebulaConnect: { group: "nebula", file: "connect" },
  nebulaUser: { group: "nebula", file: "user" },
  nebulaServer: { group: "nebula", file: "server" },
  nebulaSettings: { group: "nebula", file: "settings" },
};

export const LANGUAGE_STORAGE_KEY = "mumble-language";

/** Source language used as the reference when adding a new translation. */
export const SOURCE_LANGUAGE: BuiltInLanguage = "en";

/**
 * Picker mode wraps every translation with an invisible header that
 * carries its namespace and key path so the overlay can recover both
 * by reading text content.  Wire format inside a single text node:
 *
 *   <MARK_START><tag-encoded "ns:key"><MARK_END>visible value
 *
 * The header BODY uses **Unicode tag characters** (U+E0020..U+E007F).
 * Tag chars are explicitly marked as *default-ignorable code points*
 * in Unicode and every modern browser - Windows included - renders
 * them as truly zero-width.  Each one maps 1:1 to a printable ASCII
 * character (U+E0061 ↔ 'a'), so we can decode the header back to
 * `"settings:profile.panelTitle"` in the picker overlay.
 *
 * The MARK_START / MARK_END delimiters use the well-tested ZW family
 * (U+200B / U+200D) so we can locate the header in a `String.indexOf`
 * scan without false positives from real text.
 *
 * The previous (visible-ASCII) scheme leaked the ns + key path into
 * the UI as readable text - this scheme cloaks it entirely.
 */
export const PICKER_MARK_START = String.fromCodePoint(0x200b);
export const PICKER_MARK_END = String.fromCodePoint(0x200d);

/** Visible ASCII character used to separate ns from key inside the
 *  encoded header.  Decoded after tag-stripping. */
const NS_KEY_DELIM = ":";

/** Tag offset used by Unicode "Tag" block to encode ASCII invisibly. */
const TAG_OFFSET = 0xe0000;

function encodeTags(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    // Tag block covers U+E0020..U+E007F, mirroring printable ASCII.
    // Non-ASCII characters in ns/key are vanishingly rare; we drop
    // them rather than carry garbage into the header.
    if (c >= 0x20 && c <= 0x7e) {
      out += String.fromCodePoint(TAG_OFFSET + c);
    }
  }
  return out;
}

function decodeTags(s: string): string {
  let out = "";
  // for..of iterates code points, which we need for the 5-digit U+E00xx range.
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= TAG_OFFSET + 0x20 && c <= TAG_OFFSET + 0x7e) {
      out += String.fromCodePoint(c - TAG_OFFSET);
    }
  }
  return out;
}

const EN_RESOURCES = {
  en: { common: enCommon, settings: enSettings, chat: enChat, server: enServer, sidebar: enSidebar },
} as const;

/**
 * Minimal i18next backend that lazy-loads a built-in language's namespace from
 * its split JSON chunk.  Called by i18next only for languages not already in
 * `resources` (i.e. de/fr/zh) - en is preloaded and custom languages are injected
 * via `addResourceBundle`, so neither hits this path.
 */
const lazyLocaleBackend = {
  type: "backend" as const,
  init() {
    /* no options */
  },
  read(
    language: string,
    namespace: string,
    callback: (err: unknown, data: Record<string, unknown> | null) => void,
  ) {
    const source = NAMESPACE_SOURCES[namespace as I18nNamespace];
    if (!source) {
      callback(new Error(`Unknown i18n namespace: ${namespace}`), null);
      return;
    }
    // Three interpolated segments, so Vite globs this as `../locales/*/*/*.json`
    // - one `*` per path segment, which is exactly the locale tree's shape.  A
    // namespace id carrying its own slash would collapse two segments into one
    // and find nothing.
    import(`../locales/${source.group}/${language}/${source.file}.json`)
      .then((m: { default: Record<string, unknown> }) => callback(null, m.default))
      .catch((err: unknown) => callback(err, null));
  },
};

/** Strongly-typed shape of a single language bundle. */
export type LocaleBundle = Record<I18nNamespace, Record<string, unknown>>;

let pickerActive = false;

// Register the picker post-processor *before* init.  i18next reads the
// `postProcess` array during init and silently drops names it doesn't
// recognise yet - registering later would mean the picker is a no-op
// on the first render after a hot reload, which is exactly when the
// user toggles it.
i18n.use({
  type: "postProcessor",
  name: "pickerMarker",
  process(value: string, key: string | string[], options: { ns?: string | string[] } | undefined) {
    if (!pickerActive) return value;
    if (typeof value !== "string") return value;
    const keyStr = Array.isArray(key) ? key[0] : key;
    if (!keyStr) return value;
    // When i18next can't find a translation it returns the key itself.
    // Wrapping that with a marker leaves the visible key path in the
    // UI, which looks broken - skip the marker so callers see the bare
    // key (matching the no-picker behaviour) and pick a different
    // string to translate.
    if (value === keyStr) return value;
    let ns: string;
    if (Array.isArray(options?.ns)) {
      ns = options.ns[0] ?? "common";
    } else if (typeof options?.ns === "string") {
      ns = options.ns;
    } else {
      ns = "common";
    }
    const header = encodeTags(ns + NS_KEY_DELIM + keyStr);
    return `${PICKER_MARK_START}${header}${PICKER_MARK_END}${value}`;
  },
});

void i18n
  .use(lazyLocaleBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: EN_RESOURCES,
    // en is bundled; de/fr/zh come from `lazyLocaleBackend` on demand.
    partialBundledLanguages: true,
    fallbackLng: SOURCE_LANGUAGE,
    nonExplicitSupportedLngs: true,
    defaultNS: "common",
    // Only the shared namespaces are loaded up front.  A pack's own namespaces
    // are dead weight in every other pack, so they are fetched when that pack's
    // chunk asks for them (see `@core/i18n/nebula`).
    ns: [...SHARED_NAMESPACES],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    },
    postProcess: ["pickerMarker"],
  });

/**
 * Enable/disable the picker marker post-processor.
 *
 * When active, every translation produced by `t()` is wrapped in a pair of
 * invisible marker characters that carry the namespace and key.  The
 * translation picker overlay parses these markers out of the DOM to map a
 * rendered string back to its source key.
 */
export function setPickerActive(active: boolean): void {
  if (pickerActive === active) return;
  pickerActive = active;
  // Force every component that consumes `t()` to re-render so the wrapped
  // strings actually show up in the DOM.  Emitting `languageChanged`
  // (with the *same* language) is the official react-i18next way to
  // trigger a global re-render without flipping any state.
  try {
    i18n.emit("languageChanged", i18n.language);
  } catch {
    /* ignore */
  }
}

export function isPickerActive(): boolean {
  return pickerActive;
}

/**
 * Parse a picker marker out of a rendered string.  Returns the (ns, key)
 * pair plus the plain visible value, or `null` when no marker is present.
 *
 * A text node may contain multiple markers concatenated together when a
 * component renders several `t()` results adjacently.  This helper returns
 * the *first* marker it finds - callers that need every key in a node can
 * use `parseAllPickerMarkers` instead.
 */
export function parsePickerMarker(text: string): { ns: string; key: string; value: string } | null {
  const start = text.indexOf(PICKER_MARK_START);
  if (start < 0) return null;
  const headerEnd = text.indexOf(PICKER_MARK_END, start);
  if (headerEnd < 0) return null;
  // Header body is tag-encoded ASCII - decode back into "ns:key".
  const encodedHeader = text.slice(start + PICKER_MARK_START.length, headerEnd);
  const decoded = decodeTags(encodedHeader);
  const sep = decoded.indexOf(NS_KEY_DELIM);
  if (sep < 0) return null;
  const ns = decoded.slice(0, sep);
  const key = decoded.slice(sep + NS_KEY_DELIM.length);
  // The visible value ends at the next MARK_START (start of the next
  // marker in the same text node) or at the end of the string.
  const valueStart = headerEnd + PICKER_MARK_END.length;
  const nextMarker = text.indexOf(PICKER_MARK_START, valueStart);
  const value = nextMarker >= 0 ? text.slice(valueStart, nextMarker) : text.slice(valueStart);
  return { ns, key, value };
}

/** Strip every picker marker (header only) from a rendered string. */
export function stripPickerMarkers(text: string): string {
  if (!text) return text;
  const re = new RegExp(`${PICKER_MARK_START}[^${PICKER_MARK_END}]*${PICKER_MARK_END}`, "g");
  return text.replace(re, "");
}

/** Add or replace a custom-language bundle and switch to it if requested. */
export function registerLanguage(
  code: string,
  bundle: Partial<LocaleBundle>,
  options?: { switch?: boolean },
): void {
  for (const ns of I18N_NAMESPACES) {
    i18n.addResourceBundle(code, ns, bundle[ns] ?? {}, true, true);
  }
  if (options?.switch) {
    void i18n.changeLanguage(code);
  }
}

/** Remove a custom-language bundle from the active i18n instance. */
export function unregisterLanguage(code: string): void {
  for (const ns of I18N_NAMESPACES) {
    i18n.removeResourceBundle(code, ns);
  }
}

export default i18n;
