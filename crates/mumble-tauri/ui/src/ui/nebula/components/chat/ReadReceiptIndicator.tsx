import { useMemo } from "react";
import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { allActiveUsersRead, getReadersForMessage } from "@core/features/chat/readreceipt/readReceiptStore";
import { CheckDoubleIcon, CheckIcon } from "@ui/icons";

interface ReadReceiptIndicatorProps {
  readonly messageId: string;
  readonly channelId: number;
  readonly allMessageIds: string[];
}

/**
 * The tick at the end of one's own message.
 *
 * Three states, and the difference between them is the whole point: sent, read
 * by some, read by everyone still in the channel. Standard prints the first two
 * in the same glyph and separates them by colour alone; the colour carries the
 * same weight here, but the count reaches the tooltip either way.
 */
export default function ReadReceiptIndicator({
  messageId,
  channelId,
  allMessageIds,
}: ReadReceiptIndicatorProps) {
  const readReceiptVersion = useAppStore((s) => s.readReceiptVersion);
  const users = useAppStore((s) => s.users);
  const ownSession = useAppStore((s) => s.ownSession);

  const { t } = useTranslation("chat");

  const ownHash = useMemo(() => users.find((u) => u.session === ownSession)?.hash, [users, ownSession]);

  const activeHashes = useMemo(
    () => users.filter((u) => u.channel_id === channelId && u.hash).map((u) => u.hash!),
    [users, channelId],
  );

  const allRead = useMemo(
    () => allActiveUsersRead(channelId, messageId, allMessageIds, activeHashes, ownHash),
    [channelId, messageId, allMessageIds, activeHashes, ownHash, readReceiptVersion],
  );

  const readerCount = useMemo(() => {
    const readers = getReadersForMessage(channelId, messageId, allMessageIds);
    return ownHash ? readers.filter((r) => r.cert_hash !== ownHash).length : readers.length;
  }, [channelId, messageId, allMessageIds, ownHash, readReceiptVersion]);

  const read = readerCount > 0;
  const title = !read
    ? t("readReceipt.sent")
    : allRead
      ? t("readReceipt.readByEveryone")
      : t("readReceipt.readByCount", { count: readerCount });
  const Glyph = read && allRead ? CheckDoubleIcon : CheckIcon;

  return (
    <Box
      component="span"
      title={title}
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        flex: "none",
        verticalAlign: "middle",
        ml: "4px",
        color: read ? theme.palette.nebula.accent : theme.palette.nebula.dim,
      })}
    >
      <Glyph width={13} height={13} aria-label={title} />
    </Box>
  );
}
