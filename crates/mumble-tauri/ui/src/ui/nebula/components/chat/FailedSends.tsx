import { Box, Button, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { radius } from "../../tokens";
import { Stack } from "../primitives";

interface FailedSendsProps {
  readonly channelId: number | null;
  readonly dmSession: number | null;
}

/**
 * The sends this conversation could not make, above the composer.
 *
 * Nebula renders nothing from `pendingMessages` - the optimistic bubble is a
 * Standard idea - so a send the backend refused used to leave no trace at all:
 * the composer emptied, no message arrived, and the reason went to the browser
 * console. That is the whole symptom of an encrypted channel with no key for
 * us, and it read as the server having eaten the message.
 *
 * Only failures are drawn. A send still in flight needs no announcement, and
 * the ones that arrive replace themselves with the real message.
 */
export default function FailedSends({ channelId, dmSession }: FailedSendsProps) {
  const { t } = useTranslation(["chat", "common"]);
  const pendingMessages = useAppStore((s) => s.pendingMessages);
  const dismiss = useAppStore((s) => s.dismissPendingMessage);
  const retry = useAppStore((s) => s.retryPendingMessage);

  const failed = pendingMessages.filter(
    (p) =>
      p.state === "failed" &&
      (dmSession === null ? p.channelId === channelId : p.dmSession === dmSession),
  );
  if (failed.length === 0) return null;

  return (
    <Stack gap={0.5} sx={{ px: "34px", pb: "6px" }}>
      {failed.map((pending) => (
        <Stack
          key={pending.pendingId}
          direction="row"
          alignItems="center"
          gap={1}
          data-testid={TID.chatSendFailed}
          sx={(theme) => ({
            px: "12px",
            py: "8px",
            borderRadius: radius("md"),
            background: theme.palette.nebula.card,
            border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.bad}`,
          })}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={(theme) => ({ fontSize: 12, fontWeight: 600, color: theme.palette.nebula.bad })}
            >
              {t("chat:pendingMessage.failed")}
            </Typography>
            {pending.errorMessage ? (
              <Typography
                sx={(theme) => ({
                  fontSize: 11,
                  color: theme.palette.nebula.muted,
                  overflowWrap: "anywhere",
                })}
              >
                {pending.errorMessage}
              </Typography>
            ) : null}
          </Box>
          <Button
            size="small"
            sx={{ ml: "auto", flexShrink: 0 }}
            onClick={() => void retry(pending.pendingId)}
          >
            {t("common:actions.retry")}
          </Button>
          <Button
            size="small"
            color="inherit"
            sx={{ flexShrink: 0 }}
            aria-label={t("chat:pendingMessage.dismissFailed")}
            onClick={() => dismiss(pending.pendingId)}
          >
            {t("common:actions.dismiss")}
          </Button>
        </Stack>
      ))}
    </Stack>
  );
}
