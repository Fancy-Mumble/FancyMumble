import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import enCommon from "../locales/en/common.json";
import enSettings from "../locales/en/settings.json";
import enChat from "../locales/en/chat.json";
import enServer from "../locales/en/server.json";
import enSidebar from "../locales/en/sidebar.json";
import deCommon from "../locales/de/common.json";
import deSettings from "../locales/de/settings.json";
import deChat from "../locales/de/chat.json";
import deServer from "../locales/de/server.json";
import deSidebar from "../locales/de/sidebar.json";
import frCommon from "../locales/fr/common.json";
import frSettings from "../locales/fr/settings.json";
import frChat from "../locales/fr/chat.json";
import frServer from "../locales/fr/server.json";
import frSidebar from "../locales/fr/sidebar.json";

export const BUILT_IN_LANGUAGES = ["en", "de", "fr"] as const;
export type BuiltInLanguage = (typeof BUILT_IN_LANGUAGES)[number];

/** Public list of namespaces shipped with the app. */
export const I18N_NAMESPACES = ["common", "chat", "server", "settings", "sidebar"] as const;
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

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
 * in Unicode and every modern browser — Windows included — renders
 * them as truly zero-width.  Each one maps 1:1 to a printable ASCII
 * character (U+E0061 ↔ 'a'), so we can decode the header back to
 * `"settings:profile.panelTitle"` in the picker overlay.
 *
 * The MARK_START / MARK_END delimiters use the well-tested ZW family
 * (U+200B / U+200D) so we can locate the header in a `String.indexOf`
 * scan without false positives from real text.
 *
 * The previous (visible-ASCII) scheme leaked the ns + key path into
 * the UI as readable text — this scheme cloaks it entirely.
 */
export const PICKER_MARK_START = String.fromCodePoint(0x200B);
export const PICKER_MARK_END = String.fromCodePoint(0x200D);

/** Visible ASCII character used to separate ns from key inside the
 *  encoded header.  Decoded after tag-stripping. */
const NS_KEY_DELIM = ":";

/** Tag offset used by Unicode "Tag" block to encode ASCII invisibly. */
const TAG_OFFSET = 0xE0000;

function encodeTags(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    // Tag block covers U+E0020..U+E007F, mirroring printable ASCII.
    // Non-ASCII characters in ns/key are vanishingly rare; we drop
    // them rather than carry garbage into the header.
    if (c >= 0x20 && c <= 0x7E) {
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
    if (c >= TAG_OFFSET + 0x20 && c <= TAG_OFFSET + 0x7E) {
      out += String.fromCodePoint(c - TAG_OFFSET);
    }
  }
  return out;
}

export const BUILT_IN_RESOURCES = {
  en: { common: enCommon, settings: enSettings, chat: enChat, server: enServer, sidebar: enSidebar },
  de: { common: deCommon, settings: deSettings, chat: deChat, server: deServer, sidebar: deSidebar },
  fr: { common: frCommon, settings: frSettings, chat: frChat, server: frServer, sidebar: frSidebar },
} as const;

/** Strongly-typed shape of a single language bundle. */
export type LocaleBundle = Record<I18nNamespace, Record<string, unknown>>;

let pickerActive = false;

// Register the picker post-processor *before* init.  i18next reads the
// `postProcess` array during init and silently drops names it doesn't
// recognise yet — registering later would mean the picker is a no-op
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
    // UI, which looks broken — skip the marker so callers see the bare
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
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: BUILT_IN_RESOURCES,
    fallbackLng: SOURCE_LANGUAGE,
    nonExplicitSupportedLngs: true,
    defaultNS: "common",
    ns: [...I18N_NAMESPACES],
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
 * the *first* marker it finds — callers that need every key in a node can
 * use `parseAllPickerMarkers` instead.
 */
export function parsePickerMarker(
  text: string,
): { ns: string; key: string; value: string } | null {
  const start = text.indexOf(PICKER_MARK_START);
  if (start < 0) return null;
  const headerEnd = text.indexOf(PICKER_MARK_END, start);
  if (headerEnd < 0) return null;
  // Header body is tag-encoded ASCII — decode back into "ns:key".
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
  const value =
    nextMarker >= 0 ? text.slice(valueStart, nextMarker) : text.slice(valueStart);
  return { ns, key, value };
}

/** Strip every picker marker (header only) from a rendered string. */
export function stripPickerMarkers(text: string): string {
  if (!text) return text;
  const re = new RegExp(
    `${PICKER_MARK_START}[^${PICKER_MARK_END}]*${PICKER_MARK_END}`,
    "g",
  );
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
