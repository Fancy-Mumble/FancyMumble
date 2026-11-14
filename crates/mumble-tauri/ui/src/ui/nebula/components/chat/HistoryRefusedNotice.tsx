import { Box, Button, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { radius } from "../../tokens";
import { Stack } from "../primitives";

interface HistoryRefusedNoticeProps {
  readonly channelId: number | null;
}

/**
 * The server refused a page of this channel's history.
 *
 * Without it a refused page looked exactly like the start of the channel:
 * scrolling back simply stopped. A rate-limited page is asked for again on its
 * own (see `persistentChat.refusal`), so this shows only what waiting will not
 * fix, and goes away when the next page arrives.
 */
export default function HistoryRefusedNotice({ channelId }: HistoryRefusedNoticeProps) {
  const { t } = useTranslation(["chat", "common"]);
  const refusal = useAppStore((s) => (channelId === null ? undefined : s.pchatHistoryRefused[channelId]));
  const retry = useAppStore((s) => s.retryHistoryFetch);
  if (channelId === null || !refusal) return null;

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1}
      data-testid={TID.pchatHistoryRefused}
      sx={(theme) => ({
        my: "6px",
        px: "12px",
        py: "8px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.bad}`,
      })}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={(theme) => ({ fontSize: 12, fontWeight: 600, color: theme.palette.nebula.bad })}>
          {t("chat:historyRefused.title")}
        </Typography>
        {refusal.detail ? (
          <Typography
            sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted, overflowWrap: "anywhere" })}
          >
            {refusal.detail}
          </Typography>
        ) : null}
      </Box>
      <Button
        size="small"
        sx={{ ml: "auto", flexShrink: 0 }}
        data-testid={TID.pchatHistoryRetry}
        aria-label={t("chat:historyRefused.retry")}
        onClick={() => void retry(channelId)}
      >
        {t("common:actions.retry")}
      </Button>
    </Stack>
  );
}
