import { lazy, Suspense } from "react";
import { Box } from "@mui/material";
import type { SettingsPageId } from "./SettingsNav";

/**
 * One chunk per page.
 *
 * Settings is opened for one thing at a time - a microphone, a language, a
 * shortcut - and the pages have little in common: Voice carries the meter and
 * the calibrator, Profile the card preview and the cropper. Loading twelve to
 * show one is the same mistake the client made with settings as a whole.
 */
const AccountSettings = lazy(() => import("./AccountSettings").then((m) => ({ default: m.AccountSettings })));
const AdvancedSettings = lazy(() =>
  import("./AdvancedSettings").then((m) => ({ default: m.AdvancedSettings })),
);
const ChannelsRolesSettings = lazy(() =>
  import("./ChannelsRolesSettings").then((m) => ({ default: m.ChannelsRolesSettings })),
);
const IdentitiesSettings = lazy(() =>
  import("./IdentitiesSettings").then((m) => ({ default: m.IdentitiesSettings })),
);
const LocalizationSettings = lazy(() =>
  import("./LocalizationSettings").then((m) => ({ default: m.LocalizationSettings })),
);
const NotificationsSettings = lazy(() =>
  import("./NotificationsSettings").then((m) => ({ default: m.NotificationsSettings })),
);
const PersonalizeSettings = lazy(() =>
  import("./PersonalizeSettings").then((m) => ({ default: m.PersonalizeSettings })),
);
const PrivacySettings = lazy(() => import("./PrivacySettings").then((m) => ({ default: m.PrivacySettings })));
const PluginsSettings = lazy(() => import("./PluginsSettings").then((m) => ({ default: m.PluginsSettings })));
const ProfileSettings = lazy(() => import("./ProfileSettings").then((m) => ({ default: m.ProfileSettings })));
const ShortcutsSettings = lazy(() =>
  import("./ShortcutsSettings").then((m) => ({ default: m.ShortcutsSettings })),
);
const VoiceSettings = lazy(() => import("./VoiceSettings").then((m) => ({ default: m.VoiceSettings })));

/**
 * The settings content area. The nav lives in the sidebar, as in the mock.
 *
 * Each page is mounted only while it is showing rather than hidden with CSS,
 * so a page that subscribes to backend events (Account, Voice) is not holding
 * a listener open for a screen nobody is looking at.
 */
export function SettingsScreen({
  page,
  onEditIdentityProfile,
}: Readonly<{
  page: SettingsPageId;
  /** Jumps to Profile with that identity loaded, from the Identities page. */
  onEditIdentityProfile?: (label: string) => void;
}>) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: "52px", py: "38px" }}>
      <Suspense fallback={null}>
        {page === "profile" && <ProfileSettings />}
        {page === "account" && <AccountSettings />}
        {page === "voice" && <VoiceSettings />}
        {page === "personalize" && <PersonalizeSettings />}
        {page === "notifications" && <NotificationsSettings />}
        {page === "privacy" && <PrivacySettings />}
        {page === "localization" && <LocalizationSettings />}
        {page === "shortcuts" && <ShortcutsSettings />}
        {page === "identities" && <IdentitiesSettings onEditProfile={onEditIdentityProfile} />}
        {page === "channels-roles" && <ChannelsRolesSettings />}
        {page === "plugins" && <PluginsSettings />}
        {page === "advanced" && <AdvancedSettings />}
      </Suspense>
    </Box>
  );
}
