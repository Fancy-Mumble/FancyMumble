/**
 * Full built-in language bundles (en + de + fr + zh), eagerly imported.
 *
 * This module is imported ONLY by the lazy translation editor
 * (`TranslationPopoutPage`), so all four languages land in the translator
 * chunk instead of the startup bundle/heap.  The running app never imports it:
 * it preloads only `en` (fallback/source) and fetches the active language on
 * demand through the i18n backend (see `./index.ts`).  The editor, by contrast,
 * needs every built-in language at once to show the source plus side-by-side
 * reference translations.
 */
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
import zhCommon from "../locales/zh/common.json";
import zhSettings from "../locales/zh/settings.json";
import zhChat from "../locales/zh/chat.json";
import zhServer from "../locales/zh/server.json";
import zhSidebar from "../locales/zh/sidebar.json";

export const BUILT_IN_RESOURCES = {
  en: { common: enCommon, settings: enSettings, chat: enChat, server: enServer, sidebar: enSidebar },
  de: { common: deCommon, settings: deSettings, chat: deChat, server: deServer, sidebar: deSidebar },
  fr: { common: frCommon, settings: frSettings, chat: frChat, server: frServer, sidebar: frSidebar },
  zh: { common: zhCommon, settings: zhSettings, chat: zhChat, server: zhServer, sidebar: zhSidebar },
} as const;
