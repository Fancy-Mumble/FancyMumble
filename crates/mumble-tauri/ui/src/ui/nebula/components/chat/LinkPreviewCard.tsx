import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";

import { useWatchStart } from "@core/features/chat/watch/useWatchStart";
import type { EmbedMedia, LinkEmbed } from "@core/types";
import { PlayIcon } from "@ui/icons";
import { LinkGuard, Stack } from "../primitives";
import { radius } from "../../tokens";

/**
 * The card under a message that carries a link.
 *
 * Nebula draws its own rather than reusing Standard's. Standard stacks the
 * pieces down the message and gives the picture the width of the bubble, so a
 * conversation of links becomes a column of billboards with the talking in
 * between. This is one compact row - picture, source, title, a line of
 * context - which reads as a citation of the message rather than as the
 * message.
 *
 * Pictures come from the preview the server inlined wherever there is one, and
 * from the origin only where the reader has allowed external resources: a card
 * that fetched its own thumbnail would tell every site linked here who is
 * reading, and when. `previewSrc` is the only place that decides it.
 */

/** The compact thumbnail, at 16:9. */
const THUMB_W = 132;
const THUMB_H = 74;

/**
 * The picture to draw for a media field, or nothing.
 *
 * The server's downscaled copy first and the origin URL only on consent -
 * returning `undefined` is the privacy-preserving answer, and the caller draws
 * a card without a picture rather than reaching for the network.
 */
function previewSrc(media: EmbedMedia | undefined, allowExternal: boolean): string | undefined {
  if (!media) return undefined;
  if (media.preview?.data_url) return media.preview.data_url;
  return allowExternal ? media.url : undefined;
}

/** What to call the place this came from, falling back to its hostname. */
function sourceLabel(embed: LinkEmbed): string {
  if (embed.site_name) return embed.site_name;
  if (embed.provider?.name) return embed.provider.name;
  try {
    return new URL(embed.url).hostname.replace(/^www\./, "");
  } catch {
    return embed.url;
  }
}

function EmbedCard({
  embed,
  allowExternalResources,
  channelId,
}: Readonly<{ embed: LinkEmbed; allowExternalResources: boolean; channelId: number }>) {
  const { t } = useTranslation(["chat", "nebulaChat"]);
  // Two steps rather than one: asking to play a video the reader has not
  // allowed the origin to serve shows what loading it would cost first.
  const [consented, setConsented] = useState(false);
  const [asked, setAsked] = useState(false);
  // The embed's own URL is the video, so the card can offer to start a session
  // on it without being told what the message said.
  const { canStart, busy, start } = useWatchStart(embed.url, channelId);

  const hasVideo = embed.type === "video" && !!embed.video?.url;
  const thumbSrc =
    previewSrc(embed.thumbnail, allowExternalResources) ?? previewSrc(embed.image, allowExternalResources);
  // A link *to* a picture is the picture, so it keeps the full width. Anything
  // else that merely came with one gets the thumbnail.
  const pictureSrc =
    embed.type === "image" || embed.type === "gifv"
      ? previewSrc(embed.image, allowExternalResources)
      : undefined;
  // The channel and the description answer the same question - what is this? -
  // so they share the one line, and the channel wins where there is one.
  const meta = embed.author?.name ?? embed.description;

  const play = () => {
    if (allowExternalResources) {
      setConsented(true);
      return;
    }
    setAsked(true);
  };

  return (
    <LinkGuard>
      <Box
        sx={(theme) => ({
          maxWidth: 460,
          mt: "6px",
          p: "10px",
          borderRadius: radius("lg"),
          border: "1px solid " + theme.palette.nebula.line,
          background: theme.palette.nebula.card2,
        })}
      >
        {hasVideo && consented && (
          <Box
            sx={{
              width: "100%",
              aspectRatio: "16 / 9",
              mb: "10px",
              borderRadius: radius("md"),
              overflow: "hidden",
              background: "#000",
            }}
          >
            <Box
              component="iframe"
              src={embed.video!.url}
              title={embed.title ?? sourceLabel(embed)}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              sandbox="allow-scripts allow-same-origin allow-popups"
              sx={{ width: "100%", height: "100%", border: 0, display: "block" }}
            />
          </Box>
        )}

        <Stack direction="row" gap="12px">
          {thumbSrc && !consented && (
            <Box
              sx={{
                position: "relative",
                flex: "none",
                width: THUMB_W,
                height: THUMB_H,
                borderRadius: radius("md"),
                overflow: "hidden",
              }}
            >
              <Box
                component="img"
                src={thumbSrc}
                alt=""
                loading="lazy"
                sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              {hasVideo && (
                <Box
                  component="button"
                  type="button"
                  aria-label={t("chat:linkPreview.playVideo")}
                  onClick={play}
                  sx={{
                    all: "unset",
                    position: "absolute",
                    inset: 0,
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    "&:hover > *": { transform: "scale(1.08)" },
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      display: "grid",
                      placeItems: "center",
                      width: 32,
                      height: 32,
                      borderRadius: "999px",
                      color: "#fff",
                      background: "rgba(12,16,28,.72)",
                      backdropFilter: "blur(6px)",
                      transition: "transform .12s ease",
                    }}
                  >
                    <PlayIcon width={13} height={13} />
                  </Box>
                </Box>
              )}
            </Box>
          )}

          <Stack sx={{ flex: 1, minWidth: 0, justifyContent: "center", gap: "3px" }}>
            <Stack direction="row" alignItems="center" gap="6px">
              {/* The site's initial, not its favicon: fetching one would tell
                  the origin who is reading, which is the whole thing the
                  server-side preview exists to avoid. */}
              <Box
                aria-hidden
                sx={(theme) => ({
                  display: "grid",
                  placeItems: "center",
                  flex: "none",
                  width: 14,
                  height: 14,
                  borderRadius: "4px",
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: 1,
                  textTransform: "uppercase",
                  color: theme.palette.nebula.muted,
                  background: theme.palette.nebula.accentSoft,
                })}
              >
                {sourceLabel(embed).slice(0, 1)}
              </Box>
              <Typography
                sx={(theme) => ({
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: ".02em",
                  color: theme.palette.nebula.dim,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                })}
              >
                {sourceLabel(embed)}
              </Typography>
            </Stack>

            {embed.title && (
              <Box
                component="a"
                href={embed.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={(theme) => ({
                  fontSize: 13.5,
                  fontWeight: 600,
                  lineHeight: 1.35,
                  color: theme.palette.nebula.text,
                  textDecoration: "none",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  "&:hover": { textDecoration: "underline" },
                })}
              >
                {embed.title}
              </Box>
            )}

            {(meta || canStart) && (
              <Stack direction="row" alignItems="center" gap="10px" sx={{ mt: "1px" }}>
                {meta && (
                  <Typography
                    sx={(theme) => ({
                      fontSize: 12,
                      color: theme.palette.nebula.muted,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    })}
                  >
                    {meta}
                  </Typography>
                )}
                {canStart && (
                  <CardButton onClick={() => void start()} sx={{ ml: "auto", flex: "none" }} icon>
                    {busy ? t("chat:contextMenu.watchTogetherBusy") : t("chat:contextMenu.watchTogether")}
                  </CardButton>
                )}
              </Stack>
            )}
          </Stack>
        </Stack>

        {pictureSrc && (
          <Box
            component="img"
            src={pictureSrc}
            alt={embed.title ?? ""}
            loading="lazy"
            sx={{
              display: "block",
              mt: "10px",
              width: "100%",
              maxHeight: 320,
              objectFit: "cover",
              borderRadius: radius("md"),
            }}
          />
        )}

        {asked && !consented && (
          <Stack direction="row" alignItems="center" gap="10px" sx={{ mt: "10px" }}>
            <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
              {t("chat:linkPreview.privacyGateText", { site: sourceLabel(embed) })}
            </Typography>
            <CardButton onClick={() => setConsented(true)} sx={{ ml: "auto", flex: "none" }}>
              {t("chat:linkPreview.loadContent")}
            </CardButton>
          </Stack>
        )}
      </Box>
    </LinkGuard>
  );
}

/** The small pill the card puts its own actions in. */
function CardButton({
  children,
  onClick,
  sx,
  icon = false,
}: Readonly<{
  children: React.ReactNode;
  onClick: () => void;
  sx?: object;
  icon?: boolean;
}>) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        px: "10px",
        height: 26,
        borderRadius: "999px",
        fontSize: 12,
        fontWeight: 600,
        color: theme.palette.nebula.text,
        border: "1px solid " + theme.palette.nebula.line2,
        background: theme.palette.nebula.card,
        "&:hover": {
          borderColor: theme.palette.nebula.accentLine,
          background: theme.palette.nebula.accentSoft,
        },
        ...sx,
      })}
    >
      {icon && <PlayIcon width={12} height={12} />}
      {children}
    </Box>
  );
}

export default memo(function LinkPreviewCard({
  embeds,
  allowExternalResources,
  channelId,
}: Readonly<{ embeds: LinkEmbed[]; allowExternalResources: boolean; channelId: number }>) {
  if (embeds.length === 0) return null;

  return (
    <Stack gap="6px">
      {embeds.map((embed) => (
        <EmbedCard
          key={embed.url}
          embed={embed}
          allowExternalResources={allowExternalResources}
          channelId={channelId}
        />
      ))}
    </Stack>
  );
});
