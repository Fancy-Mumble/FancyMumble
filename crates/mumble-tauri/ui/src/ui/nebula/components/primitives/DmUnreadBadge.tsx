import { useTranslation } from "react-i18next";
import { Box, Tooltip } from "@mui/material";
import { useAppStore } from "@core/store";
import { radius } from "../../tokens";

/**
 * How many direct messages this person has sent that are still unread.
 *
 * On their row wherever people are listed, as Standard has it: the channel
 * tree is where you see who is around, and an unread message from someone
 * standing right there is worth knowing without opening the conversations.
 */
export function DmUnreadBadge({ session }: Readonly<{ session: number }>) {
  const { t } = useTranslation("sidebar");
  const count = useAppStore((state) => state.dmUnreadCounts[session] ?? 0);
  if (count <= 0) return null;
  const label = t("channelList.dmUnread", { count });
  return (
    <Tooltip title={label}>
      <Box
        component="span"
        role="status"
        aria-label={label}
        data-dm-unread={count}
        sx={(theme) => ({
          flex: "none",
          display: "inline-grid",
          placeItems: "center",
          minWidth: 16,
          height: 16,
          px: "4px",
          borderRadius: radius("pill"),
          fontSize: 9.5,
          fontWeight: 700,
          color: theme.palette.nebula.onAccent,
          background: theme.palette.nebula.accent,
        })}
      >
        {count > 99 ? "99+" : count}
      </Box>
    </Tooltip>
  );
}
