import { useMemo } from "react";
import { Box } from "@mui/material";
import { useAppStore } from "@core/store";
import { isAccountSettingsSupported } from "@core/features/settings/accountStore";
import { isOnboardingSupported } from "@core/features/onboarding/onboardingStore";
import { SectionLabel, Stack } from "../primitives";
import { radius } from "../../tokens";

export type SettingsPageId =
  | "profile"
  | "account"
  | "voice"
  | "personalize"
  | "notifications"
  | "privacy"
  | "localization"
  | "shortcuts"
  | "identities"
  | "channels-roles"
  | "plugins"
  | "advanced";

export interface NavEntry {
  id: SettingsPageId;
  label: string;
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
  { id: "profile", label: "Profile" },
  { id: "account", label: "Account", available: (context) => context.accountSupported },
  { id: "voice", label: "Voice" },
  { id: "personalize", label: "Personalize" },
  { id: "notifications", label: "Notifications" },
  { id: "privacy", label: "Privacy" },
  { id: "localization", label: "Language & format" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "identities", label: "Identities" },
  { id: "channels-roles", label: "Channels & roles", available: (context) => context.onboardingSupported },
  { id: "plugins", label: "Plugins", available: (context) => context.hasPlugins },
  { id: "advanced", label: "Advanced" },
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
  return (
    <Stack sx={{ pb: "10px" }}>
      <SectionLabel sx={{ px: "16px", pt: "10px", pb: "6px" }}>SETTINGS</SectionLabel>
      <Stack sx={{ px: "10px", gap: "1px" }}>
        {visibleSettingsPages(context).map((entry) => (
          <NavButton
            key={entry.id}
            label={entry.label}
            selected={admin?.active == null && entry.id === active}
            onClick={() => onSelect(entry.id)}
          />
        ))}
      </Stack>

      {admin && admin.entries.length > 0 && onOpenAdmin && (
        <>
          <SectionLabel sx={{ px: "16px", pt: "16px", pb: "6px" }}>SERVER ADMIN</SectionLabel>
          <Stack sx={{ px: "10px", gap: "1px" }}>
            {admin.entries.map((entry) => (
              <NavButton
                key={entry.id}
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
  label,
  selected,
  onClick,
}: Readonly<{ label: string; selected: boolean; onClick: () => void }>) {
  return (
    <Box
      component="button"
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
