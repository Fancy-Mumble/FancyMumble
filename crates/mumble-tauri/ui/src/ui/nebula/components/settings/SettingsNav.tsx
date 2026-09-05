import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { useAppStore } from "@core/store";
import { isAccountSettingsSupported } from "@core/features/settings/accountStore";
import { isOnboardingSupported } from "@core/features/onboarding/onboardingStore";
import { SectionLabel, Stack } from "../primitives";
import { radius } from "../../tokens";
import { TAB_ID_ATTR } from "@core/testids";

export type SettingsPageId =
  | "profile"
  | "account"
  | "voice"
  | "personalize"
  | "notifications"
  | "privacy"
  | "localization"
  | "shortcuts"
  | "overlay"
  | "identities"
  | "channels-roles"
  | "plugins"
  | "advanced";

/** The namespaces the nav's labels come from. */
const NAV_NS = ["nebulaSettings", "settings"] as const;

/**
 * The keys the nav labels its pages with, spelled out as a union so `t()`
 * still checks them - a bare `string` would opt the whole nav out of the
 * catalogue's type checking.
 */
export type NavLabelKey =
  | `settings:tabs.${
      | "profile"
      | "account"
      | "voice"
      | "personalize"
      | "notifications"
      | "privacy"
      | "shortcuts"
      | "identities"
      | "plugins"
      | "advanced"}`
  | "nebulaSettings:nav.overlay"
  | "nebulaSettings:nav.localization"
  | "nebulaSettings:nav.channelsRoles";

export interface NavEntry {
  id: SettingsPageId;
  /** What the page is called, as a key `t` can resolve. */
  labelKey: NavLabelKey;
  /** Hidden unless this holds; absent means always shown. */
  available?: (context: SettingsNavContext) => boolean;
}

/**
 * What decides whether a page is worth offering.
 *
 * Every one of these is a statement about the *server or session*, not about
 * the user's preferences: a page hidden here is one that would have nothing to
 * show or nothing that would work, rather than one the user has turned off.
 */
export interface SettingsNavContext {
  /** Connected, registered, and on a server that speaks account settings. */
  accountSupported: boolean;
  /** The server is new enough to answer onboarding queries. */
  onboardingSupported: boolean;
  /** The active server advertises at least one plugin. */
  hasPlugins: boolean;
}

/**
 * Nebula's settings pages.
 *
 * Every page Standard offers is drawn here in Nebula's own language rather than
 * handed off, so switching design never means switching surface mid-task.
 * Order follows Standard's tab order, which puts identity first and the
 * settings that can break something last.
 */
export const SETTINGS_NAV: readonly NavEntry[] = [
  { id: "profile", labelKey: "settings:tabs.profile" },
  { id: "account", labelKey: "settings:tabs.account", available: (context) => context.accountSupported },
  { id: "voice", labelKey: "settings:tabs.voice" },
  { id: "personalize", labelKey: "settings:tabs.personalize" },
  { id: "notifications", labelKey: "settings:tabs.notifications" },
  { id: "privacy", labelKey: "settings:tabs.privacy" },
  // Standard titles these two; Nebula writes them in sentence case like the
  // rest of its chrome, so they keep keys of their own.
  { id: "localization", labelKey: "nebulaSettings:nav.localization" },
  { id: "shortcuts", labelKey: "settings:tabs.shortcuts" },
  // Desktop-only, and Nebula names it itself - Standard has no such page.
  { id: "overlay", labelKey: "nebulaSettings:nav.overlay" },
  { id: "identities", labelKey: "settings:tabs.identities" },
  {
    id: "channels-roles",
    labelKey: "nebulaSettings:nav.channelsRoles",
    available: (context) => context.onboardingSupported,
  },
  { id: "plugins", labelKey: "settings:tabs.plugins", available: (context) => context.hasPlugins },
  { id: "advanced", labelKey: "settings:tabs.advanced" },
];

/**
 * What the connected server and this session allow, read off the store.
 *
 * The gates match Standard's tab-by-tab ones exactly: the same session on the
 * same server has to offer the same pages whichever design is drawing them.
 */
export function useSettingsNavContext(): SettingsNavContext {
  const connected = useAppStore((state) => state.status === "connected");
  const serverFancyVersion = useAppStore((state) => state.serverFancyVersion);
  const hasPlugins = useAppStore((state) => state.pluginRegistry.length > 0);
  // Account settings register *this* user with the server, so an unregistered
  // session (user_id 0 or none) has nothing there to edit.
  const ownUserId = useAppStore((state) => {
    const own = state.users.find((user) => user.session === state.ownSession);
    return own?.user_id ?? null;
  });

  return useMemo(
    () => ({
      accountSupported:
        connected && ownUserId != null && ownUserId > 0 && isAccountSettingsSupported(serverFancyVersion),
      onboardingSupported: isOnboardingSupported(serverFancyVersion),
      hasPlugins,
    }),
    [connected, hasPlugins, ownUserId, serverFancyVersion],
  );
}

export function visibleSettingsPages(context: SettingsNavContext): readonly NavEntry[] {
  return SETTINGS_NAV.filter((entry) => entry.available?.(context) ?? true);
}

export function SettingsNav({
  active,
  context,
  admin,
  onSelect,
  onOpenAdmin,
}: Readonly<{
  active: SettingsPageId;
  context: SettingsNavContext;
  /** The administration section, shown only where the user may administer. */
  admin?: { entries: readonly { id: string; label: string }[]; active: string | null };
  onSelect: (id: SettingsPageId) => void;
  onOpenAdmin?: (id: string) => void;
}>) {
  const { t } = useTranslation(NAV_NS);
  // The nav is routinely taller than the column it lives in - a dozen
  // settings pages, plus a server admin section as long again - so it
  // scrolls the way the other sidebar lists do rather than running its last
  // entries off the bottom of the window where nothing can reach them.
  return (
    <Stack sx={{ flex: 1, minHeight: 0, overflowY: "auto", pb: "10px" }}>
      <SectionLabel sx={{ px: "16px", pt: "10px", pb: "6px" }}>
        {t("nebulaSettings:nav.sectionSettings")}
      </SectionLabel>
      <Stack sx={{ px: "10px", gap: "1px" }}>
        {visibleSettingsPages(context).map((entry) => (
          <NavButton
            key={entry.id}
            page={entry.id}
            label={t(entry.labelKey)}
            selected={admin?.active == null && entry.id === active}
            onClick={() => onSelect(entry.id)}
          />
        ))}
      </Stack>

      {admin && admin.entries.length > 0 && onOpenAdmin && (
        <>
          <SectionLabel sx={{ px: "16px", pt: "16px", pb: "6px" }}>
            {t("nebulaSettings:nav.sectionServerAdmin")}
          </SectionLabel>
          <Stack sx={{ px: "10px", gap: "1px" }}>
            {admin.entries.map((entry) => (
              <NavButton
                key={entry.id}
                page={entry.id}
                label={entry.label}
                selected={entry.id === admin.active}
                onClick={() => onOpenAdmin(entry.id)}
              />
            ))}
          </Stack>
        </>
      )}
    </Stack>
  );
}

function NavButton({
  page,
  label,
  selected,
  onClick,
}: Readonly<{ page: string; label: string; selected: boolean; onClick: () => void }>) {
  return (
    <Box
      component="button"
      {...{ [TAB_ID_ATTR]: page }}
      aria-current={selected}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        cursor: "pointer",
        px: "12px",
        py: "8px",
        borderRadius: radius("md"),
        fontSize: 12.5,
        fontWeight: selected ? 600 : 400,
        color: selected ? theme.palette.nebula.text : theme.palette.nebula.muted,
        background: selected ? theme.palette.nebula.accentSoft : "transparent",
        border: `1px solid ${selected ? theme.palette.nebula.accentLine : "transparent"}`,
        "&:hover": {
          background: selected ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover,
        },
      })}
    >
      {label}
    </Box>
  );
}
