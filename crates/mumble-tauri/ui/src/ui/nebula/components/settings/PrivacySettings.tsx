import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { Banner, GroupRule, PageTitle, ToggleRow } from "./controls";
import { usePreferenceSettings } from "./usePreferenceSettings";

/**
 * The Privacy page.
 *
 * Every switch here trades a feature against something leaving this machine, so
 * the page states the consequence next to the switch rather than in a help
 * page - and states it in the position the switch is *currently* in. A banner
 * that only appears once you have already turned protection off is a warning
 * arriving after the decision.
 */
export function PrivacySettings() {
  const { t } = useTranslation("settings");
  const { prefs, toggle } = usePreferenceSettings();
  const richPresenceStatus = useAppStore((state) => state.richPresenceStatus);

  if (!prefs) return null;

  // Whether presence is actually being observed depends on which app reached
  // Discord's IPC socket first - invisible to the user, who would otherwise
  // experience the feature as silently doing nothing.
  const bridgeNote = prefs.enableRichPresence
    ? {
        blocked: t("privacy.richPresenceBlocked"),
        bridged: t("privacy.richPresenceBridged"),
        standalone: t("privacy.richPresenceStandalone"),
        intercepting: t("privacy.richPresenceIntercepting"),
      }[richPresenceStatus.bridgeState ?? "standalone"]
    : null;

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={t("privacy.panelTitle")} />

      <ToggleRow
        title={t("privacy.dualPath")}
        hint={t("privacy.dualPathHint")}
        checked={prefs.enableDualPath}
        onChange={() => toggle("enableDualPath")}
      >
        <Banner
          tone={prefs.enableDualPath ? "danger" : "warn"}
          title={
            prefs.enableDualPath ? t("privacy.dualPathWarningActive") : t("privacy.dualPathWarningMuted")
          }
        >
          {t("privacy.dualPathWarningActivePara")}
        </Banner>
      </ToggleRow>

      <GroupRule />

      <ToggleRow
        title={t("privacy.readReceipts")}
        hint={t("privacy.readReceiptsHint")}
        checked={prefs.disableReadReceipts ?? false}
        onChange={() => toggle("disableReadReceipts")}
      >
        {!prefs.disableReadReceipts && (
          <Banner tone="warn" title={t("privacy.readReceiptsWarning")}>
            {t("privacy.readReceiptsWarningPara")}
          </Banner>
        )}
      </ToggleRow>

      <ToggleRow
        title={t("privacy.typingIndicators")}
        hint={t("privacy.typingIndicatorsHint")}
        checked={prefs.disableTypingIndicators}
        onChange={() => toggle("disableTypingIndicators")}
      />

      <GroupRule />

      <ToggleRow
        title={t("privacy.osmMaps")}
        hint={t("privacy.osmMapsHint")}
        checked={prefs.disableOsmMaps}
        onChange={() => toggle("disableOsmMaps")}
      >
        {!prefs.disableOsmMaps && (
          <Banner tone="warn" title={t("privacy.osmMapsWarning")}>
            {t("privacy.osmMapsWarningPara")}
          </Banner>
        )}
      </ToggleRow>

      <ToggleRow
        title={t("privacy.linkPreviews")}
        hint={t("privacy.linkPreviewsHint")}
        checked={prefs.disableLinkPreviews}
        onChange={() => toggle("disableLinkPreviews")}
      >
        {!prefs.disableLinkPreviews && (
          <Banner tone="warn" title={t("privacy.linkPreviewsWarning")}>
            {t("privacy.linkPreviewsWarningPara")}
          </Banner>
        )}
      </ToggleRow>

      <ToggleRow
        title={t("privacy.externalEmbeds")}
        hint={t("privacy.externalEmbedsHint")}
        checked={prefs.enableExternalEmbeds}
        onChange={() => toggle("enableExternalEmbeds")}
      >
        {prefs.enableExternalEmbeds && (
          <Banner tone="warn" title={t("privacy.externalEmbedsWarning")}>
            {t("privacy.externalEmbedsWarningPara")}
          </Banner>
        )}
      </ToggleRow>

      <GroupRule />

      <ToggleRow
        title={t("privacy.streamerMode")}
        hint={t("privacy.streamerModeHint")}
        checked={prefs.streamerMode}
        onChange={() => toggle("streamerMode")}
      />

      <ToggleRow
        title={t("privacy.richPresence")}
        hint={t("privacy.richPresenceHint")}
        checked={prefs.enableRichPresence}
        onChange={() => toggle("enableRichPresence")}
      />

      {prefs.enableRichPresence && (
        <Box sx={{ pl: "14px" }}>
          <ToggleRow
            title={t("privacy.richPresenceArtwork")}
            hint={t("privacy.richPresenceArtworkHint")}
            checked={prefs.richPresenceArtwork}
            onChange={() => toggle("richPresenceArtwork")}
          />
          {bridgeNote && <Banner tone="info">{bridgeNote}</Banner>}
        </Box>
      )}
    </Box>
  );
}
