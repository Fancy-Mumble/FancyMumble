import { Box } from "@mui/material";
import { AccountSettings } from "./AccountSettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { ChannelsRolesSettings } from "./ChannelsRolesSettings";
import { IdentitiesSettings } from "./IdentitiesSettings";
import { LocalizationSettings } from "./LocalizationSettings";
import { NotificationsSettings } from "./NotificationsSettings";
import { PersonalizeSettings } from "./PersonalizeSettings";
import { PrivacySettings } from "./PrivacySettings";
import { PluginsSettings } from "./PluginsSettings";
import { ProfileSettings } from "./ProfileSettings";
import type { SettingsPageId } from "./SettingsNav";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { VoiceSettings } from "./VoiceSettings";

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
    </Box>
  );
}
