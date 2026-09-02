import type enCommon from "../locales/common/en/common.json";
import type enSettings from "../locales/common/en/settings.json";
import type enChat from "../locales/common/en/chat.json";
import type enServer from "../locales/common/en/server.json";
import type enSidebar from "../locales/common/en/sidebar.json";
import type enNebulaCommon from "../locales/nebula/en/common.json";
import type enNebulaChrome from "../locales/nebula/en/chrome.json";
import type enNebulaSidebar from "../locales/nebula/en/sidebar.json";
import type enNebulaChat from "../locales/nebula/en/chat.json";
import type enNebulaConnect from "../locales/nebula/en/connect.json";
import type enNebulaUser from "../locales/nebula/en/user.json";
import type enNebulaServer from "../locales/nebula/en/server.json";
import type enNebulaSettings from "../locales/nebula/en/settings.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof enCommon;
      settings: typeof enSettings;
      chat: typeof enChat;
      server: typeof enServer;
      sidebar: typeof enSidebar;
      nebulaCommon: typeof enNebulaCommon;
      nebulaChrome: typeof enNebulaChrome;
      nebulaSidebar: typeof enNebulaSidebar;
      nebulaChat: typeof enNebulaChat;
      nebulaConnect: typeof enNebulaConnect;
      nebulaUser: typeof enNebulaUser;
      nebulaServer: typeof enNebulaServer;
      nebulaSettings: typeof enNebulaSettings;
    };
  }
}
