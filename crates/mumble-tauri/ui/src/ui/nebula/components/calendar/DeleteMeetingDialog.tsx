import { useTranslation } from "react-i18next";
import { Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import { Stack } from "../primitives";

interface DeleteMeetingDialogProps {
  /** The meeting being deleted, or null while none is. */
  readonly eventId: string | null;
  readonly onClose: () => void;
}

/**
 * Deleting a meeting, which asks first.
 *
 * Standard deletes on the click. An organiser's delete is relayed to everyone
 * invited and there is no undo, which is the kind of action this pack asks
 * about - and the question says who else loses it, because that is the part
 * nobody expects.
 */
export function DeleteMeetingDialog({ eventId, onClose }: Readonly<DeleteMeetingDialogProps>) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  const event = useCalendarStore((s) => (eventId ? s.events.find((e) => e.id === eventId) : undefined));
  const ownUserId = useAppStore((s) => s.users.find((u) => u.session === s.ownSession)?.user_id ?? null);
  if (!event) return null;

  const shared = ownUserId === event.organizerId && event.participants.length > 0;
  const confirm = () => {
    const store = useCalendarStore.getState();
    store.deleteEvent(event.id);
    store.closeDetail();
    store.closeDialog();
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogContent>
        <Stack gap={0.5}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
            {t("nebulaChat:calendar.delete.title", { title: event.title || t("chat:calendar.untitled") })}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
            {shared ? t("nebulaChat:calendar.delete.bodyShared") : t("nebulaChat:calendar.delete.body")}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" color="error" onClick={confirm}>
          {t("chat:calendar.delete")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
