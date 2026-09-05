import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { SectionLabel, Stack } from "../primitives";
import { radius } from "../../tokens";

export interface SessionStatusProps {
  /** Opens the connect screen so the user can pick a different server. */
  onOpenServers: () => void;
}

/**
 * What is shown in place of the conversation when the open session is not
 * connected.
 *
 * Nebula had no such surface. Standard gates its whole chat page on
 * `status !== "connected"` and Aurora returns a `SessionStatusScreen`; Nebula
 * only had an effect nudging `screen` towards "connect", and an effect is not
 * a gate - anything that later opened the chat screen (picking the server in
 * the rail, an event bridge, a deep link) put the user straight back into the
 * connected chrome. So a session that ended underneath them left the client
 * drawing a channel list with nothing in it, a voice dock for a call that was
 * over and a composer that could not send, with no word of what had happened.
 *
 * That is what a same-name eviction looks like from the evicted side, and a
 * dropped link looks identical: the server closes the socket and says nothing,
 * so this surface is the only thing that can.
 */
export function SessionStatus({ onOpenServers }: SessionStatusProps) {
  const { t } = useTranslation(["nebulaConnect", "common"]);
  const status = useAppStore((state) => state.status);
  const bootstrapStage = useAppStore((state) => state.bootstrapStage);
  const globalError = useAppStore((state) => state.error);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const sessionErrors = useAppStore((state) => state.sessionErrors);
  const scheduled = useAppStore((state) => state.reconnectScheduled);
  const nextAt = useAppStore((state) => state.nextReconnectAt);
  const attempts = useAppStore((state) => state.reconnectAttempts);
  const pending = useAppStore((state) => state.pendingConnect);
  const active = useAppStore((state) =>
    state.sessions.find((session) => session.id === state.activeServerId),
  );
  const [now, setNow] = useState(Date.now());

  const connecting = status === "connecting" || bootstrapStage !== null;
  useEffect(() => {
    if (!scheduled) return;
    const timer = globalThis.setInterval(() => setNow(Date.now()), 500);
    return () => globalThis.clearInterval(timer);
  }, [scheduled]);

  const reason = (activeServerId ? sessionErrors[activeServerId] : null) ?? globalError;
  const target = pending ?? active ?? null;
  const server = target ? `${target.username} · ${target.host}:${target.port}` : null;
  const retryIn = nextAt === null ? null : Math.max(0, Math.ceil((nextAt - now) / 1000));

  const reconnect = () => {
    if (!target) return;
    void useAppStore
      .getState()
      .connect(target.host, target.port, target.username, "certLabel" in target ? target.certLabel : null);
  };

  // The server's own words carry the message wherever there are any. Adding a
  // cause of our own would contradict them whenever the guess is wrong - a
  // dropped link is not a refusal, and neither is being replaced.
  const eyebrow = connecting
    ? t("nebulaConnect:dropped.eyebrowConnecting")
    : scheduled
      ? t("nebulaConnect:reconnect.title")
      : t("nebulaConnect:dropped.eyebrow");
  const title = connecting
    ? t("nebulaConnect:dropped.titleConnecting")
    : scheduled
      ? t("nebulaConnect:dropped.titleReconnecting")
      : reason
        ? t("nebulaConnect:dropped.titleFailed")
        : t("nebulaConnect:dropped.title");
  const detail = connecting
    ? (bootstrapStage ?? null)
    : scheduled
      ? t("nebulaConnect:reconnect.detail", {
          state:
            retryIn === null
              ? t("nebulaConnect:reconnect.waiting")
              : t("nebulaConnect:reconnect.retryIn", { seconds: retryIn }),
          attempt: attempts + 1,
        })
      : reason;

  return (
    <Stack
      data-testid={TID.sessionStatus}
      role="status"
      alignItems="center"
      justifyContent="center"
      sx={{ flex: 1, minHeight: 0, p: 3 }}
    >
      <Stack
        gap={1.5}
        sx={(theme) => ({
          width: "100%",
          maxWidth: 380,
          p: "20px",
          borderRadius: radius("lg"),
          background: `${theme.palette.nebula.tint},${theme.palette.nebula.bg0}`,
          border: `1px solid ${theme.palette.nebula.line2}`,
          boxShadow: theme.palette.nebula.shadow,
        })}
      >
        <Stack direction="row" alignItems="center" gap={1.5}>
          <Box
            aria-hidden
            sx={(theme) => ({
              width: 8,
              height: 8,
              flex: "0 0 auto",
              borderRadius: "50%",
              background: connecting || scheduled ? theme.palette.nebula.warn : theme.palette.nebula.bad,
              ...(connecting || scheduled
                ? {
                    animation: "nebula-status-pulse 1.2s ease-in-out infinite",
                    "@keyframes nebula-status-pulse": { "50%": { opacity: 0.25 } },
                  }
                : {}),
            })}
          />
          <SectionLabel>{eyebrow}</SectionLabel>
        </Stack>
        <Typography sx={{ fontSize: 16, fontWeight: 600 }}>{title}</Typography>
        {server !== null && (
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {server}
          </Typography>
        )}
        {detail !== null && detail !== "" && (
          <Stack
            gap={0.5}
            sx={(theme) => ({
              p: "10px 12px",
              borderRadius: radius("md"),
              background: theme.palette.nebula.card,
              border: `1px solid ${theme.palette.nebula.line2}`,
            })}
          >
            <SectionLabel>{t("nebulaConnect:dropped.reasonLabel")}</SectionLabel>
            <Typography sx={{ fontSize: 12.5 }}>{detail}</Typography>
          </Stack>
        )}
        {!connecting && (
          <Stack direction="row" gap={1} sx={{ mt: 0.5 }}>
            <Button variant="contained" size="small" disabled={target === null} onClick={reconnect}>
              {scheduled ? t("nebulaConnect:reconnect.retryNow") : t("nebulaConnect:dropped.reconnect")}
            </Button>
            <Button size="small" onClick={onOpenServers}>
              {t("nebulaConnect:dropped.chooseServer")}
            </Button>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
