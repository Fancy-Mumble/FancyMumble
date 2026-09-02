import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";

import { useAppStore } from "@core/store";
import { PlayIcon } from "@ui/icons";
import { Stack } from "../../primitives";
import { radius } from "../../../tokens";

/**
 * What the message that started a watch-together session shows.
 *
 * The session itself is in the floating dock, so this is a record rather than a
 * control: it says a session was started here and how many people are in it.
 * Standard puts the whole player in this spot, which is why its player scrolls
 * away mid-film.
 *
 * Renders nothing once the session has ended, which is what Standard's card
 * does too - a finished session leaves no trace in the history rather than a
 * dead card for every film anyone ever put on.
 */
export function WatchMarker({ sessionId }: Readonly<{ sessionId: string }>) {
  const { t } = useTranslation("chat");
  const session = useAppStore((state) => state.watchSessions.get(sessionId));

  if (!session) return null;

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap="8px"
      sx={(theme) => ({
        mt: "6px",
        width: "fit-content",
        maxWidth: "100%",
        px: "10px",
        height: 30,
        borderRadius: radius("md"),
        border: "1px solid " + theme.palette.nebula.line,
        background: theme.palette.nebula.card2,
        color: theme.palette.nebula.muted,
      })}
    >
      <Box aria-hidden sx={(theme) => ({ display: "grid", color: theme.palette.nebula.accent })}>
        <PlayIcon width={12} height={12} />
      </Box>
      <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.text })}>
        {t("watch.watchTogether")}
      </Typography>
      <Typography sx={{ fontSize: 12 }}>
        {"· " + t("watch.watching", { count: session.participants.size })}
      </Typography>
    </Stack>
  );
}

export default WatchMarker;
