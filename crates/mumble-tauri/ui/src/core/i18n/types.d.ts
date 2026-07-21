import type enCommon from "../locales/en/common.json";
import type enSettings from "../locales/en/settings.json";
import type enChat from "../locales/en/chat.json";
import type enServer from "../locales/en/server.json";
import type enSidebar from "../locales/en/sidebar.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof enCommon;
      settings: typeof enSettings;
      chat: typeof enChat;
      server: typeof enServer;
      sidebar: typeof enSidebar;
    };
  }
}
