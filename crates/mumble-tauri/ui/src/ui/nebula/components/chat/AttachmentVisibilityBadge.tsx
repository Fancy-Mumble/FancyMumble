import { useState } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import type { FileAttachmentInfo } from "@core/features/chat/fileAttachments";
import { formatDuration } from "@core/utils/format";
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
 */
export function AttachmentVisibilityBadge({
  info,
  overlay = false,
}: Readonly<{ info: FileAttachmentInfo; overlay?: boolean }>) {
  const [copied, setCopied] = useState(false);
  if (info.mode === "session") return null;

  const expired = info.expiresAt != null && info.expiresAt > 0 && info.expiresAt * 1000 < Date.now();
  const expiresIn =
    info.expiresAt != null && info.expiresAt > 0 && !expired
      ? formatDuration(Math.max(0, info.expiresAt - Date.now() / 1000))
      : null;

  const label = info.mode === "password" ? "Password protected" : "Public link";
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
    <Tooltip title={canCopy ? (copied ? "Copied" : "Copy link") : expired ? "This link has expired" : label}>
      <Stack
        component={canCopy ? "button" : "div"}
        direction="row"
        alignItems="center"
        gap="5px"
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
          padding: "3px 9px",
          borderRadius: radius("md"),
          fontSize: 10.5,
          fontWeight: 600,
          ...(overlay
            ? {
                color: expired ? "rgba(255, 255, 255, 0.66)" : "#fff",
                background: "rgba(10, 12, 20, 0.58)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255, 255, 255, 0.16)",
                boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
              }
            : {
                color: expired ? theme.palette.nebula.dim : theme.palette.nebula.accent,
                background: expired ? theme.palette.nebula.card2 : theme.palette.nebula.accentSoft,
                border: `1px solid ${expired ? theme.palette.nebula.line : theme.palette.nebula.accentLine}`,
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
        <Typography component="span" sx={{ fontSize: "inherit", fontWeight: "inherit", color: "inherit" }}>
          {expired ? "Link expired" : copied ? "Copied" : label}
        </Typography>
        {expiresIn && !copied && (
          <Typography
            component="span"
            sx={(theme) => ({
              fontSize: "inherit",
              fontWeight: 500,
              color: overlay ? "rgba(255, 255, 255, 0.72)" : theme.palette.nebula.dim,
            })}
          >
            · {expiresIn} left
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
