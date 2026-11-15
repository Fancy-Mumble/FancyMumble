import { useEffect, useMemo } from "react";
import { Box, Button, Chip, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import {
  computeRoleLabels,
  computeVisibleChannels,
  isOnboardingSupported,
  useOnboardingStore,
} from "@core/features/onboarding/onboardingStore";
import { Stack } from "../primitives";
import { EmptyState, GroupTitle, PageTitle } from "./controls";

/**
 * The Channels & roles page: what this user answered when they joined.
 *
 * Read-only apart from the two buttons, because the answers are a form the
 * server defines - editing them means reopening that form rather than
 * inventing a second editor for the same questions here.
 */
export function ChannelsRolesSettings() {
  const { t } = useTranslation("settings");
  const config = useOnboardingStore((state) => state.config);
  const response = useOnboardingStore((state) => state.response);
  const setModalOpen = useOnboardingStore((state) => state.setModalOpen);
  const setResponse = useOnboardingStore((state) => state.setResponse);

  const channels = useAppStore((state) => state.channels);
  const serverFancyVersion = useAppStore((state) => state.serverFancyVersion);
  const supported = isOnboardingSupported(serverFancyVersion);

  // Refreshed on mount so answers changed on another device show here without
  // a reconnect.
  useEffect(() => {
    if (!supported) return;
    void invoke<boolean | null>("request_onboarding_response").catch(() => undefined);
  }, [supported]);

  const channelNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const channel of channels) map.set(channel.id, channel.name);
    return map;
  }, [channels]);

  const visibleChannels = useMemo(() => [...computeVisibleChannels(config, response)], [config, response]);
  const roleLabels = useMemo(() => computeRoleLabels(config, response), [config, response]);

  const heading = t("onboarding.channelsAndRoles.heading");

  if (!supported) {
    return (
      <Box sx={{ maxWidth: 640 }}>
        <PageTitle title={heading} />
        <EmptyState>{t("onboarding.channelsAndRoles.unsupportedServer")}</EmptyState>
      </Box>
    );
  }

  if (!config?.enabled) {
    return (
      <Box sx={{ maxWidth: 640 }}>
        <PageTitle title={heading} />
        <EmptyState>{t("onboarding.channelsAndRoles.notEnabled")}</EmptyState>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={heading} hint={t("onboarding.channelsAndRoles.subtitle")} />

      <GroupTitle>{t("onboarding.channelsAndRoles.visibleChannels")}</GroupTitle>
      {visibleChannels.length === 0 ? (
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
          {t("onboarding.channelsAndRoles.noChannels")}
        </Typography>
      ) : (
        <Stack direction="row" gap={0.625} flexWrap="wrap">
          {visibleChannels.map((id) => (
            <Chip key={id} size="small" label={`#${channelNames.get(id) ?? id}`} />
          ))}
        </Stack>
      )}

      <GroupTitle>{t("onboarding.channelsAndRoles.yourRoles")}</GroupTitle>
      {roleLabels.length === 0 ? (
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
          {t("onboarding.channelsAndRoles.noRoles")}
        </Typography>
      ) : (
        <Stack direction="row" gap={0.625} flexWrap="wrap">
          {roleLabels.map((label) => (
            <Chip
              key={label}
              size="small"
              label={label}
              sx={(theme) => ({
                background: theme.palette.nebula.accentSoft,
                borderColor: theme.palette.nebula.accentLine,
              })}
            />
          ))}
        </Stack>
      )}

      <Stack direction="row" gap={0.75} sx={{ mt: "22px" }}>
        <Button
          size="small"
          variant="outlined"
          // Clearing first means the form reopens blank rather than pre-filled,
          // which is what "start over" has to mean to be different from "change".
          onClick={() => {
            setResponse(null);
            setModalOpen(true);
          }}
        >
          {t("onboarding.channelsAndRoles.resetBtn")}
        </Button>
        <Button size="small" variant="contained" onClick={() => setModalOpen(true)}>
          {t("onboarding.channelsAndRoles.changeAnswersBtn")}
        </Button>
      </Stack>
    </Box>
  );
}
