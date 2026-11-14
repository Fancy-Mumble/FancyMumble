import { useEffect, useMemo, useState } from "react";
import { getPreferences } from "@core/preferencesStorage";
import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { hashesOf, selectChannelHashKey, selectOwnHash } from "@core/store/selectors";
import { allActiveUsersRead, getReadersForMessage } from "@core/features/chat/readreceipt/readReceiptStore";
import { CheckDoubleIcon, CheckIcon } from "@ui/icons";

interface ReadReceiptIndicatorProps {
  readonly messageId: string;
  readonly channelId: number;
  readonly allMessageIds: readonly string[];
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
  // Two strings rather than the roster. A tick on a message has nothing to say
  // about anybody arriving or muting, but selecting `users` meant every row
  // carrying one re-rendered whenever the backend re-sent the list.
  const ownHash = useAppStore(selectOwnHash);
  const channelHashKey = useAppStore(selectChannelHashKey(channelId));

  const { t } = useTranslation("chat");
  // "Disable read receipts" is one bargain, as its hint says: not telling
  // others what you read is not being told what they read.
  const [disabled, setDisabled] = useState(false);
  useEffect(() => {
    let live = true;
    void getPreferences()
      .then((prefs) => live && setDisabled(prefs.disableReadReceipts ?? false))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const activeHashes = useMemo(() => hashesOf(channelHashKey), [channelHashKey]);

  const allRead = useMemo(
    () => allActiveUsersRead(channelId, messageId, allMessageIds, activeHashes, ownHash),
    [channelId, messageId, allMessageIds, activeHashes, ownHash, readReceiptVersion],
  );

  const readerCount = useMemo(() => {
    const readers = getReadersForMessage(channelId, messageId, allMessageIds);
    return ownHash ? readers.filter((r) => r.cert_hash !== ownHash).length : readers.length;
  }, [channelId, messageId, allMessageIds, ownHash, readReceiptVersion]);

  const read = !disabled && readerCount > 0;
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
