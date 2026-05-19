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

export const SUPPORTED_LANGUAGES = ["en", "de", "fr"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = "mumble-language";

const resources = {
  en: { common: enCommon, settings: enSettings, chat: enChat, server: enServer, sidebar: enSidebar },
  de: { common: deCommon, settings: deSettings, chat: deChat, server: deServer, sidebar: deSidebar },
  fr: { common: frCommon, settings: frSettings, chat: frChat, server: frServer, sidebar: frSidebar },
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    nonExplicitSupportedLngs: true,
    defaultNS: "common",
    ns: ["common", "chat", "server", "settings", "sidebar"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    },
  });

export default i18n;
