import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { isOnboardingSupported } from "@core/features/onboarding/onboardingStore";
import { PERM_MANAGE_EMOTES, PERM_WRITE } from "@core/utils/permissions";
import { fancyVersionEncode } from "@core/utils/version";

/**
 * What the connected server and this session allow.
 *
 * Its own module rather than part of `AdminScreen`, because the pages ask these
 * questions too - a page importing them from the screen that renders it is a
 * cycle, and one whose only symptom would be a temporal-dead-zone throw at some
 * future import order.
 */

/** Minimum server version for the plugin admin API (0.4.0). */
export const PLUGIN_ADMIN_MIN_FANCY_VERSION = fancyVersionEncode(0, 4, 0);

export function isPluginAdminSupported(version: number | null | undefined): boolean {
  return version != null && version >= PLUGIN_ADMIN_MIN_FANCY_VERSION;
}

/** Minimum server version for the audit-log protocol (0.4.2). */
export const AUDIT_LOG_MIN_FANCY_VERSION = fancyVersionEncode(0, 4, 2);

/** The wire epoch on which every Fancy service has its own outer type. */
export const FANCY_PROTOCOL_EPOCH = 1;

/**
 * Whether the connected server can answer an audit query.
 *
 * Two ways to be sure, because there are two kinds of server that can. An
 * epoch-0 server (the C++ fork) answers if its *product* version is new enough.
 * An epoch-1 server (Starling) announces the epoch and deliberately no version
 * at all - announcing one would invite clients to send epoch-0 natives it
 * cannot route - so speaking the epoch is itself the capability statement.
 *
 * Gating on the version alone hid the page from Starling for ever, and would
 * have gone on hiding it: no version is announced, and none ever will be.
 */
export function isAuditLogSupported(
  version: number | null | undefined,
  fancyProtocol?: number | null,
): boolean {
  if (fancyProtocol === FANCY_PROTOCOL_EPOCH) return true;
  return version != null && version >= AUDIT_LOG_MIN_FANCY_VERSION;
}

export type AdminPageId =
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

export interface AdminCapabilities {
  canAdminister: boolean;
  canManageEmotes: boolean;
  canManageFileServer: boolean;
  canViewAudit: boolean;
  onboardingSupported: boolean;
}

/**
 * Which administration pages this session can actually use.
 *
 * Every gate is a permission the *server* enforces as well, so a page hidden
 * here is one whose every action would be refused - offering it and letting the
 * refusal explain itself is worse than not offering it.
 */
export function useAdminCapabilities(): AdminCapabilities {
  const customEmotesSupported = useAppStore(
    (state) => state.fileServerCapabilities?.features.custom_emotes ?? false,
  );
  const fileServerEnabled = useAppStore((state) => state.fileServerConfig != null);
  const rootPerms = useAppStore((state) => state.channels.find((c) => c.id === 0)?.permissions ?? 0);
  const serverFancyVersion = useAppStore((state) => state.serverFancyVersion);
  const serverFancyProtocol = useAppStore((state) => state.serverFancyProtocol);

  // Server-admin rights resolve to Write on the root channel, which is the same
  // gate the server puts in front of every one of these surfaces.
  const canAdminister = (rootPerms & PERM_WRITE) !== 0;
  return useMemo(
    () => ({
      canAdminister,
      canManageEmotes: customEmotesSupported && (rootPerms & PERM_MANAGE_EMOTES) !== 0,
      canManageFileServer: fileServerEnabled && canAdminister,
      canViewAudit: isAuditLogSupported(serverFancyVersion, serverFancyProtocol) && canAdminister,
      onboardingSupported: isOnboardingSupported(serverFancyVersion),
    }),
    [
      canAdminister,
      customEmotesSupported,
      fileServerEnabled,
      rootPerms,
      serverFancyVersion,
      serverFancyProtocol,
    ],
  );
}

interface AdminEntry {
  id: AdminPageId;
  labelKey: string;
  fallback: string;
  available: (capabilities: AdminCapabilities) => boolean;
}

export const ADMIN_PAGES: readonly AdminEntry[] = [
  { id: "users", labelKey: "adminTabs.users", fallback: "Users", available: (c) => c.canAdminister },
  { id: "roles", labelKey: "adminTabs.roles", fallback: "Roles", available: (c) => c.canAdminister },
  { id: "bans", labelKey: "adminTabs.bans", fallback: "Bans", available: (c) => c.canAdminister },
  { id: "acl", labelKey: "adminTabs.acl", fallback: "Permissions", available: (c) => c.canAdminister },
  { id: "emotes", labelKey: "adminTabs.emotes", fallback: "Emotes", available: (c) => c.canManageEmotes },
  {
    id: "onboarding",
    labelKey: "adminTabs.onboarding",
    fallback: "Onboarding",
    available: (c) => c.onboardingSupported && c.canAdminister,
  },
  {
    id: "serverPlugins",
    labelKey: "adminTabs.serverPlugins",
    fallback: "Server plugins",
    available: (c) => c.canAdminister,
  },
  {
    id: "marketplace",
    labelKey: "adminTabs.marketplace",
    fallback: "Marketplace",
    available: (c) => c.canAdminister,
  },
  {
    id: "fileServer",
    labelKey: "adminTabs.fileServer",
    fallback: "File server",
    available: (c) => c.canManageFileServer,
  },
  {
    id: "serverSettings",
    labelKey: "adminTabs.serverSettings",
    fallback: "Server settings",
    available: (c) => c.canAdminister,
  },
  { id: "livery", labelKey: "adminTabs.livery", fallback: "Livery", available: (c) => c.canAdminister },
  {
    id: "auditLog",
    labelKey: "adminTabs.auditLog",
    fallback: "Audit log",
    available: (c) => c.canViewAudit,
  },
];

/** The administration pages to list, already filtered and labelled. */
export function useAdminNavEntries(
  capabilities: AdminCapabilities,
): readonly { id: AdminPageId; label: string }[] {
  const { t } = useTranslation("settings");
  return ADMIN_PAGES.filter((entry) => entry.available(capabilities)).map((entry) => ({
    id: entry.id,
    // `t` is typed against the catalogue and these keys are in it; the fallback
    // covers a locale that has not caught up, rather than a typo.
    label: t(entry.labelKey as "adminTabs.users", { defaultValue: entry.fallback }),
  }));
}
