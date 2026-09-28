/**
 * Scheduling a message into the open channel, and the ones still waiting.
 *
 * The server stores and delivers the message, so this only calls the shared
 * store's scheduled-message actions and draws what they report. A dialog rather
 * than a popover like the pins: it is a form, and a form hanging over a
 * conversation invites typing into the wrong box.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Dialog, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useAppStore } from "@core/store";
import { ScheduleStatus } from "@core/store/slices/scheduled";
import { TID } from "@core/testids";
import { ClockIcon, CloseIcon, RefreshCwIcon, SendIcon, TrashIcon } from "@ui/icons";
import { radius } from "../../../tokens";
import type { TimeDisplay } from "../../../selectors";
import { Stack } from "../../primitives";
import {
  DEFAULT_LEAD_MS,
  checkDelivery,
  deliveryLabel,
  pendingScheduled,
  scheduledTargets,
  toLocalInputValue,
} from "./scheduledModel";

interface ScheduledMessagesDialogProps {
  readonly channelId: number;
  readonly channelName: string;
  /** The server delivers a scheduled message as plain text, so an encrypted
   *  channel gets told before anything is typed. */
  readonly encrypted?: boolean;
  readonly time: TimeDisplay;
  /** Take the whole screen, as every dialog does on a phone. */
  readonly fullScreen?: boolean;
  readonly onClose: () => void;
}

export function ScheduledMessagesDialog({
  channelId,
  channelName,
  encrypted = false,
  time,
  fullScreen = false,
  onClose,
}: ScheduledMessagesDialogProps) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  const channels = useAppStore((state) => state.channels);
  const messages = useAppStore((state) => state.scheduledMessages);
  const loading = useAppStore((state) => state.scheduledLoading);
  const lastAck = useAppStore((state) => state.scheduledLastAck);

  const [body, setBody] = useState("");
  const [when, setWhen] = useState(() => toLocalInputValue(Date.now() + DEFAULT_LEAD_MS));
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // The list is per connection and only arrives on request; asking on open is
  // what keeps it from showing whatever the last open left behind.
  useEffect(() => {
    void useAppStore.getState().listScheduledMessages();
  }, []);

  const pending = useMemo(() => pendingScheduled(messages), [messages]);

  // An ack outlives the attempt it answered, so a rejection is only shown
  // until the next try clears it (see `submit`).
  const ackError =
    lastAck?.status === ScheduleStatus.Rejected ? lastAck.reason || t("chat:scheduled.statusRejected") : null;
  const error = localError ?? ackError;

  const submit = async () => {
    const text = body.trim();
    if (!text || submitting) return;
    const check = checkDelivery(when, Date.now());
    if (!check.ok) {
      setLocalError(check.reason === "past" ? t("chat:scheduled.timeInPast") : t("chat:scheduled.invalidTime"));
      return;
    }
    const store = useAppStore.getState();
    setLocalError(null);
    store.applyScheduledMessageAck(null);
    setSubmitting(true);
    try {
      await store.scheduleMessage([channelId], text, check.deliverAt);
      setBody("");
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (scheduleId: string) => {
    try {
      await useAppStore.getState().cancelScheduledMessage(scheduleId);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  const now = Date.now();

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <Stack data-testid={TID.scheduledPanel} sx={{ minHeight: 0, flex: 1 }}>
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={(theme) => ({
            height: 52,
            flex: "none",
            px: "16px",
            borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
          })}
        >
          <Box sx={{ display: "flex" }}>
            <ClockIcon width={14} height={14} aria-hidden="true" />
          </Box>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
            {t("chat:scheduled.title")}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted, minWidth: 0 })} noWrap>
            # {channelName}
          </Typography>
          <Tooltip title={t("chat:scheduled.refresh")}>
            <IconButton
              size="small"
              sx={{ ml: "auto" }}
              aria-label={t("chat:scheduled.refresh")}
              data-testid={TID.scheduledRefresh}
              onClick={() => void useAppStore.getState().listScheduledMessages()}
            >
              <RefreshCwIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" aria-label={t("common:actions.close")} onClick={onClose}>
            <CloseIcon width={13} height={13} />
          </IconButton>
        </Stack>

        <Box
          component="form"
          // The native check would stop a past time silently, before the
          // message that explains it could be shown.
          noValidate
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            void submit();
          }}
          sx={{ p: "16px", display: "flex", flexDirection: "column", gap: "12px", flex: "none" }}
        >
          {encrypted && (
            <Typography
              role="note"
              sx={(theme) => ({
                fontSize: 12,
                color: theme.palette.nebula.warn,
                background: alpha(theme.palette.nebula.warn, 0.12),
                borderRadius: radius("md"),
                px: "10px",
                py: "7px",
              })}
            >
              {t("nebulaChat:scheduled.plaintextWarning")}
            </Typography>
          )}
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            maxRows={8}
            size="small"
            placeholder={t("chat:scheduled.messagePlaceholder")}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            slotProps={{ htmlInput: { "data-testid": TID.scheduledBodyInput } }}
          />
          <Stack direction="row" alignItems="center" gap={1.5} sx={{ flexWrap: "wrap" }}>
            <TextField
              size="small"
              type="datetime-local"
              label={t("chat:scheduled.deliverAt")}
              value={when}
              onChange={(event) => {
                setWhen(event.target.value);
                setLocalError(null);
              }}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { "data-testid": TID.scheduledTimeInput, min: toLocalInputValue(now) },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              startIcon={<SendIcon width={14} height={14} />}
              disabled={submitting || !body.trim()}
              data-testid={TID.scheduledSubmit}
              sx={{ ml: "auto" }}
            >
              {t("chat:scheduled.schedule")}
            </Button>
          </Stack>
          {error && (
            <Typography
              role="alert"
              data-testid={TID.scheduledError}
              sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.bad })}
            >
              {error}
            </Typography>
          )}
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {t("nebulaChat:scheduled.hint")}
          </Typography>
        </Box>

        <Box
          sx={(theme) => ({
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            maxHeight: fullScreen ? undefined : "min(40vh, 360px)",
            borderTop: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
            p: "6px",
          })}
        >
          {pending.length === 0 ? (
            <Typography
              data-testid={loading ? undefined : TID.scheduledEmpty}
              sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted, textAlign: "center", py: "22px" })}
            >
              {loading ? t("chat:scheduled.loading") : t("chat:scheduled.none")}
            </Typography>
          ) : (
            pending.map((message) => (
              <Stack
                key={message.scheduleId}
                direction="row"
                alignItems="flex-start"
                gap={1}
                data-testid={TID.scheduledItem}
                sx={(theme) => ({
                  p: "10px 12px",
                  borderRadius: radius("md"),
                  "&:hover": { background: theme.palette.nebula.hover },
                })}
              >
                <Stack gap={0.5} sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: 12.5,
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 3,
                      overflow: "hidden",
                    }}
                  >
                    {message.message}
                  </Typography>
                  <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })} noWrap>
                    {t("nebulaChat:scheduled.to", { channels: scheduledTargets(message, channels) })}
                    {" · "}
                    {t("chat:scheduled.deliversAt", { time: deliveryLabel(message.deliverAt, time, now) })}
                  </Typography>
                </Stack>
                <Tooltip title={t("chat:scheduled.cancel")}>
                  <IconButton
                    size="small"
                    aria-label={t("chat:scheduled.cancel")}
                    data-testid={TID.scheduledItemCancel}
                    onClick={() => void cancel(message.scheduleId)}
                  >
                    <TrashIcon width={13} height={13} />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))
          )}
        </Box>
      </Stack>
    </Dialog>
  );
}
