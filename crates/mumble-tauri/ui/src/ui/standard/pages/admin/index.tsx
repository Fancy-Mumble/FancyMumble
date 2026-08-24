import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { TabbedPage, type TabDef } from "../../components/elements/TabbedPage";
import {
  UsersGroupIcon,
  ShieldIcon,
  BlockIcon,
  LockIcon,
  EmojiPlusIcon,
  PuzzleIcon,
  StoreIcon,
  DatabaseIcon,
  SlidersIcon,
  PaletteIcon,
  HistoryIcon,
} from "../../icons";
import { useAppStore } from "@core/store";
import { RegisteredUsersTab } from "./RegisteredUsersTab";
import { BanListTab } from "./BanListTab";
import { ChannelAclTab } from "./ChannelAclTab";
import { RolesListPanel } from "./RolesListPanel";
import { CustomEmotesTab } from "./CustomEmotesTab";
import { ServerPluginsTab } from "./ServerPluginsTab";
import { MarketplaceTab } from "./MarketplaceTab";
import { FileServerTab } from "./FileServerTab";
import { ServerSettingsTab } from "./ServerSettingsTab";
import { LiveryTab } from "./LiveryTab";
import { AuditLogTab } from "./AuditLogTab";
import OnboardingAdminPanel from "../../components/onboarding/OnboardingAdminPanel";
import { isOnboardingSupported } from "@core/features/onboarding/onboardingStore";
import { PERM_MANAGE_EMOTES, PERM_WRITE } from "@core/utils/permissions";
import { fancyVersionEncode } from "@core/utils/version";
import styles from "./AdminPanel.module.css";

/** Minimum server version for the plugin admin API (0.4.0). */
export const PLUGIN_ADMIN_MIN_FANCY_VERSION = fancyVersionEncode(0, 4, 0);

export function isPluginAdminSupported(v: number | null | undefined): boolean {
  return v != null && v >= PLUGIN_ADMIN_MIN_FANCY_VERSION;
}

/** Minimum server version for the audit-log protocol (0.4.2). */
export const AUDIT_LOG_MIN_FANCY_VERSION = fancyVersionEncode(0, 4, 2);

/** The wire epoch on which every Fancy service has its own outer type. */
export const FANCY_PROTOCOL_EPOCH = 1;

/**
 * Whether the connected server can answer an audit query.
 *
 * Two ways to be sure, because there are two kinds of server that can.
 *
 * An epoch-0 server (the C++ fork) answers if its *product* version is new
 * enough, which is what the version is for. An epoch-1 server (Starling)
 * announces the epoch and deliberately **no version at all** - announcing one
 * would invite clients to send epoch-0 natives it cannot route. Audit is not
 * optional at epoch 1: the outer type is allocated to a service that every
 * epoch-1 server has, so speaking the epoch is itself the capability statement.
 *
 * Gating on the version alone is what hid the tab against Starling for ever,
 * and it would have hidden it on merit: no version is announced, and none ever
 * will be.
 */
export function isAuditLogSupported(v: number | null | undefined, fancyProtocol?: number | null): boolean {
  if (fancyProtocol === FANCY_PROTOCOL_EPOCH) return true;
  return v != null && v >= AUDIT_LOG_MIN_FANCY_VERSION;
}

type Tab =
  | "users"
  | "roles"
  | "bans"
  | "acl"
  | "emotes"
  | "onboarding"
  | "serverPlugins"
  | "marketplace"
  | "fileServer"
  | "serverSettings"
  | "livery"
  | "auditLog";

export default function AdminPanel() {
  const navigate = useNavigate();
  const { t } = useTranslation("settings");
  const [searchParams] = useSearchParams();
  const initialTab = (() => {
    const t = searchParams.get("tab");
    if (
      t === "users" ||
      t === "roles" ||
      t === "bans" ||
      t === "acl" ||
      t === "emotes" ||
      t === "onboarding" ||
      t === "serverPlugins" ||
      t === "marketplace" ||
      t === "fileServer" ||
      t === "serverSettings" ||
      t === "auditLog"
    ) {
      return t;
    }
    return "users";
  })();
  const [tab, setTab] = useState<Tab>(initialTab);
  // A pinned footer (e.g. Server Settings' / Onboarding's Save bar) is owned
  // by whichever tab is active - it hands its footer content up here via a
  // `setFooter` callback prop so it can render in `TabbedPage`'s real
  // bottom-pinned footer slot instead of scrolling away with the tab's own
  // content. Cleared on every tab switch so a stale footer never lingers.
  const [tabFooter, setTabFooter] = useState<ReactNode>(null);
  useEffect(() => {
    setTabFooter(null);
  }, [tab]);
  const customEmotesSupported = useAppStore((s) => s.fileServerCapabilities?.features.custom_emotes ?? false);
  const fileServerEnabled = useAppStore((s) => s.fileServerConfig != null);
  const rootChannelPerms = useAppStore((s) => s.channels.find((c) => c.id === 0)?.permissions ?? 0);
  const canManageEmotes = customEmotesSupported && (rootChannelPerms & PERM_MANAGE_EMOTES) !== 0;
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const serverFancyProtocol = useAppStore((s) => s.serverFancyProtocol);
  const onboardingSupported = isOnboardingSupported(serverFancyVersion);
  const canAdminPlugins = (rootChannelPerms & PERM_WRITE) !== 0;
  // The file-server admin dashboard needs server-admin rights (Write on root,
  // the same gate the server enforces) and a connected file server.
  const canManageFileServer = fileServerEnabled && (rootChannelPerms & PERM_WRITE) !== 0;
  // The audit page needs the audit protocol (0.4.2+) and the ViewAudit gate,
  // which resolves to Write on root today (same as the other admin surfaces).
  const canViewAudit =
    isAuditLogSupported(serverFancyVersion, serverFancyProtocol) && (rootChannelPerms & PERM_WRITE) !== 0;
  // If the file-server plugin is disabled at runtime while its tab is open,
  // its gate flips false - redirect back to a tab that still exists.
  useEffect(() => {
    if (tab === "fileServer" && !canManageFileServer) setTab("users");
    if (tab === "serverSettings" && !canAdminPlugins) setTab("users");
    if (tab === "livery" && !canAdminPlugins) setTab("users");
    if (tab === "auditLog" && !canViewAudit) setTab("users");
  }, [tab, canManageFileServer, canAdminPlugins, canViewAudit]);
  const tabs: TabDef<Tab>[] = [
    { id: "users", label: t("adminTabs.users"), icon: <UsersGroupIcon width={16} height={16} /> },
    { id: "roles", label: t("adminTabs.roles"), icon: <ShieldIcon width={16} height={16} /> },
    { id: "bans", label: t("adminTabs.bans"), icon: <BlockIcon width={16} height={16} /> },
    { id: "acl", label: t("adminTabs.acl"), icon: <LockIcon width={16} height={16} /> },
    ...(canManageEmotes
      ? [
          {
            id: "emotes" as const,
            label: t("adminTabs.emotes"),
            icon: <EmojiPlusIcon width={16} height={16} />,
          },
        ]
      : []),
    ...(onboardingSupported
      ? [
          {
            id: "onboarding" as const,
            label: t("adminTabs.onboarding"),
            icon: <UsersGroupIcon width={16} height={16} />,
          },
        ]
      : []),
    ...(canAdminPlugins
      ? [
          {
            id: "serverPlugins" as const,
            label: t("adminTabs.serverPlugins"),
            icon: <PuzzleIcon width={16} height={16} />,
          },
        ]
      : []),
    ...(canAdminPlugins
      ? [
          {
            id: "marketplace" as const,
            label: t("adminTabs.marketplace"),
            icon: <StoreIcon width={16} height={16} />,
          },
        ]
      : []),
    ...(canManageFileServer
      ? [
          {
            id: "fileServer" as const,
            label: t("adminTabs.fileServer", { defaultValue: "File server" }),
            icon: <DatabaseIcon width={16} height={16} />,
          },
        ]
      : []),
    ...(canAdminPlugins
      ? [
          {
            id: "serverSettings" as const,
            label: t("adminTabs.serverSettings", { defaultValue: "Server settings" }),
            icon: <SlidersIcon width={16} height={16} />,
          },
        ]
      : []),
    ...(canAdminPlugins
      ? [
          {
            id: "livery" as const,
            label: t("adminTabs.livery", { defaultValue: "Livery" }),
            icon: <PaletteIcon width={16} height={16} />,
          },
        ]
      : []),
    ...(canViewAudit
      ? [
          {
            id: "auditLog" as const,
            label: t("adminTabs.auditLog", { defaultValue: "Audit log" }),
            icon: <HistoryIcon width={16} height={16} />,
          },
        ]
      : []),
  ];

  return (
    <TabbedPage
      heading={t("heading")}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      onBack={() => navigate("/chat")}
      footer={tabFooter}
    >
      <div
        className={`${styles.content}${
          tab === "fileServer" || tab === "acl" || tab === "auditLog" ? ` ${styles.contentWide}` : ""
        }`}
      >
        {tab === "users" && <RegisteredUsersTab />}
        {tab === "roles" && <RolesListPanel />}
        {tab === "bans" && <BanListTab />}
        {tab === "acl" && <ChannelAclTab />}
        {tab === "emotes" && <CustomEmotesTab />}
        {tab === "onboarding" && <OnboardingAdminPanel setFooter={setTabFooter} />}
        {tab === "serverPlugins" && <ServerPluginsTab />}
        {tab === "marketplace" && <MarketplaceTab />}
        {tab === "fileServer" && <FileServerTab />}
        {tab === "serverSettings" && <ServerSettingsTab setFooter={setTabFooter} />}
        {tab === "livery" && <LiveryTab />}
        {tab === "auditLog" && <AuditLogTab />}
      </div>
    </TabbedPage>
  );
}
