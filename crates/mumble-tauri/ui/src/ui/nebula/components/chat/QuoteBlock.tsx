import { useCallback, useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { colorFor, formatTimestamp } from "@core/utils/format";
import { radius } from "../../tokens";
import { Stack } from "../primitives";

interface QuoteBlockProps {
  readonly messageId: string;
  readonly onScrollTo?: (messageId: string) => void;
}

/** The quote's own frame: a bar, the text, and an optional thumbnail. */
const SHELL = {
  all: "unset",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "stretch",
  width: "100%",
  maxWidth: 400,
  mb: "6px",
  overflow: "hidden",
  borderRadius: radius("sm"),
  transition: "background 0.15s",
} as const;

/** The author-coloured rule down the left edge. */
const BAR = { width: 3, flex: "none", borderRadius: `${radius("sm")} 0 0 ${radius("sm")}` } as const;

/** Decode the entities `sanitizeHtml` left behind. */
function decodeEntities(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/** Strip tags and comment markers, decode entities, then truncate. */
function previewText(html: string, maxLen = 120): string {
  const text = decodeEntities(
    html
      .replaceAll(/<!--[\s\S]*?-->/g, "")
      .replaceAll(/<[^>]*>/g, "")
      .trim(),
  );
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

/** The first image or video frame in a body, for the thumbnail. */
function extractThumbnailSrc(html: string): string | null {
  const imgMatch = /<img[^>]+src="([^"]+)"/i.exec(html);
  if (imgMatch) return imgMatch[1];
  const vidMatch = /<video[^>]+src="([^"]+)"/i.exec(html);
  if (vidMatch) return vidMatch[1];
  const sourceMatch = /<source[^>]+src="([^"]+)"/i.exec(html);
  return sourceMatch ? sourceMatch[1] : null;
}

/** The quoted message, wherever it is held - a channel or a direct message. */
function findMessage(
  messageId: string,
  messages: ChatMessage[],
  dmMessages: ChatMessage[],
): ChatMessage | undefined {
  return (
    messages.find((m) => m.message_id === messageId) ?? dmMessages.find((m) => m.message_id === messageId)
  );
}

/**
 * The quoted message above a reply.
 *
 * The bar down its left is the author's own colour, which is what makes a
 * thread scannable without reading names; the rest is deliberately quiet, since
 * this is a pointer to a message rather than a second copy of it.
 */
export default function QuoteBlock({ messageId, onScrollTo }: QuoteBlockProps) {
  const { t } = useTranslation("common");
  const messages = useAppStore((s) => s.messages);
  const dmMessages = useAppStore((s) => s.dmMessages);

  const quoted = useMemo(
    () => findMessage(messageId, messages, dmMessages),
    [messageId, messages, dmMessages],
  );

  const handleClick = useCallback(() => {
    onScrollTo?.(messageId);
  }, [messageId, onScrollTo]);

  if (!quoted) {
    return (
      <Box sx={(theme) => ({ ...SHELL, cursor: "default", background: theme.palette.nebula.card2 })}>
        <Box sx={(theme) => ({ ...BAR, background: theme.palette.nebula.dim })} />
        <Typography
          sx={(theme) => ({
            px: "8px",
            py: "4px",
            fontSize: 12,
            fontStyle: "italic",
            color: theme.palette.nebula.muted,
          })}
        >
          {t("quoteBlock.unavailable")}
        </Typography>
      </Box>
    );
  }

  const preview = previewText(quoted.body);
  const hasMedia = /<img|<video/i.test(quoted.body);
  const thumbnailSrc = hasMedia ? extractThumbnailSrc(quoted.body) : null;
  const senderColor = colorFor(quoted.sender_name);

  return (
    <Box
      component="button"
      type="button"
      onClick={handleClick}
      title={t("quoteBlock.scrollTitle")}
      sx={(theme) => ({
        ...SHELL,
        cursor: "pointer",
        background: theme.palette.nebula.card2,
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      <Box sx={{ ...BAR, background: senderColor }} />
      <Stack gap={0.125} sx={{ px: "8px", py: "4px", minWidth: 0, overflow: "hidden" }}>
        <Stack direction="row" alignItems="baseline" gap={0.75} sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: senderColor }}>
            {quoted.sender_name}
          </Typography>
          {quoted.timestamp != null && (
            <Typography
              component="time"
              dateTime={new Date(quoted.timestamp).toISOString()}
              sx={(theme) => ({ flex: "none", fontSize: 11, color: theme.palette.nebula.muted })}
            >
              {formatTimestamp(quoted.timestamp)}
            </Typography>
          )}
        </Stack>
        <Typography
          noWrap
          sx={(theme) => ({ fontSize: 13, lineHeight: 1.3, color: theme.palette.nebula.muted })}
        >
          {preview || (hasMedia ? t("quoteBlock.photoFallback") : t("quoteBlock.emptyFallback"))}
        </Typography>
      </Stack>
      {thumbnailSrc && (
        <Box
          component="img"
          src={thumbnailSrc}
          alt=""
          draggable={false}
          sx={{
            width: 40,
            height: 40,
            flex: "none",
            ml: "auto",
            objectFit: "cover",
            borderRadius: `0 ${radius("sm")} ${radius("sm")} 0`,
          }}
        />
      )}
    </Box>
  );
}
