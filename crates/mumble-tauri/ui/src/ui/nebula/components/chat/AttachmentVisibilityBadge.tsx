import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Tooltip, Typography } from "@mui/material";
import type { FileAttachmentInfo } from "@core/features/chat/fileAttachments";
import { CheckIcon, CopyIcon, LockIcon, Link2Icon } from "@ui/icons";
import { Stack } from "../primitives";
import { radius } from "../../tokens";

/**
 * The flag on a sent file that says it reaches further than the channel.
 *
 * Every attachment card looks the same today regardless of who can open it -
 * a channel-only photo and a public link read identically once sent. Rather
 * than label the common case, this only ever draws for the exceptional one:
 * silence already means "just here", which is what most attachments are.
 *
 * Absent entirely for a canon upload: that protocol has no visibility field
 * to have set this to something other than session in the first place.
 *
 * `overlay` draws it to sit on top of a picture instead of on the card: it
 * cannot borrow a surface colour there, because whatever is behind it is
 * someone else's photograph, so it brings its own dark scrim.
 *
 * The countdown is not here: the card's own facts line says size, reach and
 * expiry once, in that order, and this sitting beside it said the expiry a
 * second time to a different rounding. This says only where the file reaches.
 *
 * `compact` keeps the button and drops the words. On one tile of a block the
 * words are the same words as on the other three, and the block already says
 * the reach and the expiry once above them - so four copies of "Public link ·
 * 23h 59m left" is four times the clutter and none of the information. The
 * icon is still the button that copies this file's own link, which is the
 * half of the flag a batch cannot do without; the tooltip carries the words.
 */
export function AttachmentVisibilityBadge({
  info,
  overlay = false,
  compact = false,
}: Readonly<{ info: FileAttachmentInfo; overlay?: boolean; compact?: boolean }>) {
  const { t } = useTranslation("nebulaChat");
  const [copied, setCopied] = useState(false);
  if (info.mode === "session") return null;

  const expired = info.expiresAt != null && info.expiresAt > 0 && info.expiresAt * 1000 < Date.now();

  const label = info.mode === "password" ? t("attachment.passwordProtected") : t("attachment.publicLink");
  const canCopy = !expired && !!info.url;

  const copyLink = async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access denied or unavailable - the badge just stays as it was.
    }
  };

  return (
    <Tooltip
      title={
        canCopy
          ? copied
            ? t("attachment.copied")
            : t("attachment.copyLink")
          : expired
            ? t("attachment.linkHasExpired")
            : label
      }
    >
      <Stack
        component={canCopy ? "button" : "div"}
        direction="row"
        alignItems="center"
        gap="5px"
        // Icon-only, so the name a reader would have read off the flag has to
        // be given: the words are what a screen reader was using.
        aria-label={compact ? (canCopy ? t("attachment.copyLink") : label) : undefined}
        onClick={canCopy ? () => void copyLink() : undefined}
        sx={(theme) => ({
          all: "unset",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "5px",
          cursor: canCopy ? "pointer" : "default",
          boxSizing: "border-box",
          width: "fit-content",
          // On a gallery tile the flag has a corner rather than a picture's
          // width to sit in, and the icon that copies the link is the last
          // thing in the row - so the words give way before it does.
          maxWidth: "100%",
          minWidth: 0,
          padding: "3px 9px",
          borderRadius: radius("md"),
          fontSize: 10.5,
          fontWeight: 600,
          ...(overlay
            ? {
                color: expired ? "rgba(255, 255, 255, 0.66)" : "#fff",
                background: "rgba(10, 12, 20, 0.58)",
                backdropFilter: "blur(10px)",
                border: "var(--nebula-line-width, 1px) solid rgba(255, 255, 255, 0.16)",
                boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
              }
            : {
                color: expired ? theme.palette.nebula.dim : theme.palette.nebula.accent,
                background: expired ? theme.palette.nebula.card2 : theme.palette.nebula.accentSoft,
                border: `var(--nebula-line-width, 1px) solid ${expired ? theme.palette.nebula.line : theme.palette.nebula.accentLine}`,
              }),
          "&:hover": canCopy ? { filter: "brightness(1.08)" } : undefined,
        })}
      >
        <Box aria-hidden sx={{ display: "flex", flex: "none" }}>
          {copied ? (
            <CheckIcon width={11} height={11} />
          ) : info.mode === "password" ? (
            <LockIcon width={11} height={11} />
          ) : (
            <Link2Icon width={11} height={11} />
          )}
        </Box>
        {!compact && (
          <Typography
            component="span"
            sx={{
              fontSize: "inherit",
              fontWeight: "inherit",
              color: "inherit",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {expired ? t("attachment.linkExpired") : copied ? t("attachment.copied") : label}
          </Typography>
        )}
        {canCopy && !copied && (
          <Box aria-hidden sx={{ display: "flex", flex: "none", opacity: 0.7 }}>
            <CopyIcon width={10} height={10} />
          </Box>
        )}
      </Stack>
    </Tooltip>
  );
}
