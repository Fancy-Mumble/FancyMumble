import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { TabbedPage, type TabDef } from "../../components/elements/TabbedPage";
import {
  UsersGroupIcon, ShieldIcon, BlockIcon, LockIcon, EmojiPlusIcon,
  PuzzleIcon, StoreIcon, DatabaseIcon, SlidersIcon,
} from "../../icons";
import { useAppStore } from "../../store";
import { RegisteredUsersTab } from "./RegisteredUsersTab";
import { BanListTab } from "./BanListTab";
import { ChannelAclTab } from "./ChannelAclTab";
import { RolesListPanel } from "./RolesListPanel";
import { CustomEmotesTab } from "./CustomEmotesTab";
import { ServerPluginsTab } from "./ServerPluginsTab";
import { MarketplaceTab } from "./MarketplaceTab";
import { FileServerTab } from "./FileServerTab";
import { ServerSettingsTab } from "./ServerSettingsTab";
import OnboardingAdminPanel from "../../components/onboarding/OnboardingAdminPanel";
import { isOnboardingSupported } from "../../components/onboarding/onboardingStore";
import { PERM_MANAGE_EMOTES, PERM_WRITE } from "../../utils/permissions";
import { fancyVersionEncode } from "../../utils/version";
import styles from "./AdminPanel.module.css";

/** Minimum server version for the plugin admin API (0.4.0). */
export const PLUGIN_ADMIN_MIN_FANCY_VERSION = fancyVersionEncode(0, 4, 0);

export function isPluginAdminSupported(v: number | null | undefined): boolean {
  return v != null && v >= PLUGIN_ADMIN_MIN_FANCY_VERSION;
}

type Tab =
  | "users" | "roles" | "bans" | "acl" | "emotes" | "onboarding"
  | "serverPlugins" | "marketplace" | "fileServer" | "serverSettings";

export default function AdminPanel() {
  const navigate = useNavigate();
  const { t } = useTranslation("settings");
  const [searchParams] = useSearchParams();
  const initialTab = (() => {
    const t = searchParams.get("tab");
    if (
      t === "users" || t === "roles" || t === "bans" || t === "acl" ||
      t === "emotes" || t === "onboarding" ||
      t === "serverPlugins" || t === "marketplace" || t === "fileServer" ||
      t === "serverSettings"
    ) {
      return t;
    }
    return "users";
  })();
  const [tab, setTab] = useState<Tab>(initialTab);
  const customEmotesSupported = useAppStore((s) => s.fileServerCapabilities?.features.custom_emotes ?? false);
  const fileServerEnabled = useAppStore((s) => s.fileServerConfig != null);
  const rootChannelPerms = useAppStore((s) => s.channels.find((c) => c.id === 0)?.permissions ?? 0);
  const canManageEmotes = customEmotesSupported && (rootChannelPerms & PERM_MANAGE_EMOTES) !== 0;
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const onboardingSupported = isOnboardingSupported(serverFancyVersion);
  const canAdminPlugins = (rootChannelPerms & PERM_WRITE) !== 0;
  // The file-server admin dashboard needs server-admin rights (Write on root,
  // the same gate the server enforces) and a connected file server.
  const canManageFileServer = fileServerEnabled && (rootChannelPerms & PERM_WRITE) !== 0;
  // If the file-server plugin is disabled at runtime while its tab is open,
  // its gate flips false - redirect back to a tab that still exists.
  useEffect(() => {
    if (tab === "fileServer" && !canManageFileServer) setTab("users");
    if (tab === "serverSettings" && !canAdminPlugins) setTab("users");
  }, [tab, canManageFileServer, canAdminPlugins]);
  const tabs: TabDef<Tab>[] = [
    { id: "users", label: t("adminTabs.users"), icon: <UsersGroupIcon width={16} height={16} /> },
    { id: "roles", label: t("adminTabs.roles"), icon: <ShieldIcon     width={16} height={16} /> },
    { id: "bans",  label: t("adminTabs.bans"),  icon: <BlockIcon      width={16} height={16} /> },
    { id: "acl",   label: t("adminTabs.acl"),   icon: <LockIcon       width={16} height={16} /> },
    ...(canManageEmotes
      ? [{ id: "emotes" as const, label: t("adminTabs.emotes"), icon: <EmojiPlusIcon width={16} height={16} /> }]
      : []),
    ...(onboardingSupported
      ? [{ id: "onboarding" as const, label: t("adminTabs.onboarding"), icon: <UsersGroupIcon width={16} height={16} /> }]
      : []),
    ...(canAdminPlugins
      ? [{ id: "serverPlugins" as const, label: t("adminTabs.serverPlugins"), icon: <PuzzleIcon width={16} height={16} /> }]
      : []),
    ...(canAdminPlugins
      ? [{ id: "marketplace" as const, label: t("adminTabs.marketplace"), icon: <StoreIcon width={16} height={16} /> }]
      : []),
    ...(canManageFileServer
      ? [{ id: "fileServer" as const, label: t("adminTabs.fileServer", { defaultValue: "File server" }), icon: <DatabaseIcon width={16} height={16} /> }]
      : []),
    ...(canAdminPlugins
      ? [{ id: "serverSettings" as const, label: t("adminTabs.serverSettings", { defaultValue: "Server settings" }), icon: <SlidersIcon width={16} height={16} /> }]
      : []),
  ];

  return (
    <TabbedPage
      heading={t("heading")}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      onBack={() => navigate("/chat")}
    >
      <div className={`${styles.content}${tab === "fileServer" ? ` ${styles.contentWide}` : ""}`}>
        {tab === "users" && <RegisteredUsersTab />}
        {tab === "roles" && <RolesListPanel />}
        {tab === "bans" && <BanListTab />}
        {tab === "acl" && <ChannelAclTab />}
        {tab === "emotes" && <CustomEmotesTab />}
        {tab === "onboarding" && <OnboardingAdminPanel />}
        {tab === "serverPlugins" && <ServerPluginsTab />}
        {tab === "marketplace" && <MarketplaceTab />}
        {tab === "fileServer" && <FileServerTab />}
        {tab === "serverSettings" && <ServerSettingsTab />}
      </div>
    </TabbedPage>
  );
}
