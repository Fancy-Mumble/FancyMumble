import { useState } from "react";
import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import FileAttachmentCard from "@standard/components/chat/file/FileAttachmentCard";
import { previewKindForFilename, type FileAttachmentInfo } from "@core/features/chat/fileAttachments";
import { useAppStore } from "@core/store";
import { formatBytes } from "@core/utils/format";
import { AttachmentVisibilityBadge } from "./AttachmentVisibilityBadge";
import type { BodyImage } from "../../selectors";
import { radius } from "../../tokens";

/** How wide a single picture is allowed to be, and how tall. */
const SINGLE_MAX_W = 420;
const SINGLE_MAX_H = 320;
/** The tiled block is one object, so it has one width whatever it holds. */
const GRID_W = 460;

/**
 * The shape of a tile, by how many are sharing the block.
 *
 * Two side by side read as a pair of photographs and keep a landscape shape;
 * from four up the block is a contact sheet and squares tile it evenly. Three
 * is the odd one: two on top and one spanning underneath, which is why the
 * last tile of a three gets a shape of its own rather than a leftover gap.
 */
function tileAspect(count: number, index: number): string {
  if (count === 2) return "3 / 2";
  if (count === 3) return index === 2 ? "2 / 1" : "1 / 1";
  return "1 / 1";
}

interface MediaGalleryProps {
  readonly images: readonly BodyImage[];
  /** Enlarge this picture. Given the `src` as written, never as resolved. */
  readonly onOpen?: (src: string) => void;
}

/**
 * The pictures a message carries, drawn as the message rather than inside it.
 *
 * One picture hangs at its own shape, capped so a tall photograph cannot push
 * the rest of the conversation off the screen. Several become one rounded
 * block of tiles - cropped to fill, because a grid of letterboxed thumbnails
 * is mostly background, and the whole picture is one click away regardless.
 */
export function MediaGallery({ images, onOpen }: Readonly<MediaGalleryProps>) {
  const { t } = useTranslation("nebulaChat");
  if (images.length === 0) return null;

  const open = (image: BodyImage) => () => onOpen?.(image.src);
  // The picture's own words where it has them - a caption names this one
  // picture, where "Enlarge image" names every one of them the same.
  const label = (image: BodyImage) => image.alt || t("attachment.enlarge");

  if (images.length === 1) {
    const image = images[0]!;
    return (
      <Box
        component="button"
        type="button"
        onClick={open(image)}
        aria-label={label(image)}
        sx={{
          all: "unset",
          display: "block",
          width: "fit-content",
          maxWidth: "100%",
          cursor: "zoom-in",
          lineHeight: 0,
        }}
      >
        <Box
          component="img"
          src={image.src}
          alt={image.alt}
          loading="lazy"
          sx={{
            display: "block",
            // No explicit width, so the two caps shrink the picture without
            // ever letterboxing it: what is drawn is the whole photograph.
            maxWidth: `min(${SINGLE_MAX_W}px, 100%)`,
            maxHeight: SINGLE_MAX_H,
            borderRadius: radius("lg"),
          }}
        />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "3px",
        width: `min(${GRID_W}px, 100%)`,
        // The block is the rounded thing, not the tiles: rounding each one
        // would put a gap of background inside every corner of the grid.
        borderRadius: radius("lg"),
        overflow: "hidden",
      }}
    >
      {images.map((image, index) => (
        <Box
          key={`${image.src}:${index}`}
          component="button"
          type="button"
          onClick={open(image)}
          aria-label={label(image)}
          sx={{
            all: "unset",
            display: "block",
            cursor: "zoom-in",
            lineHeight: 0,
            gridColumn: images.length === 3 && index === 2 ? "1 / -1" : undefined,
          }}
        >
          <Box
            component="img"
            src={image.src}
            alt={image.alt}
            loading="lazy"
            sx={{
              display: "block",
              width: "100%",
              height: "100%",
              aspectRatio: tileAspect(images.length, index),
              objectFit: "cover",
            }}
          />
        </Box>
      ))}
    </Box>
  );
}

/** The block a set of tiles forms, whatever they are tiles of. */
const GRID_SX = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "4px",
  width: `min(${GRID_W}px, 100%)`,
} as const;

/** How many tiles a block draws before the rest go behind a "+n". */
const MEDIA_TILE_CAP = 4;

/** A chip on the block: dark enough to read over anyone's photograph. */
const CHIP_SX = {
  position: "absolute",
  zIndex: 2,
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 10px",
  border: "var(--nebula-line-width, 1px) solid rgba(255,255,255,0.14)",
  background: "rgba(10,13,20,0.72)",
  backdropFilter: "blur(10px)",
  color: "#e6e8ee",
  fontSize: "11px",
  lineHeight: 1.5,
  whiteSpace: "nowrap",
} as const;

/** `23h`, `44m`, `2d` - rounded down, so it never promises time that is gone. */
function coarseCountdown(seconds: number): string {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${Math.max(1, Math.floor(seconds))}s`;
}

/** Whether a file is something a tile can be a picture of. */
function isTileable(info: FileAttachmentInfo): boolean {
  const kind = previewKindForFilename(info.filename);
  return kind === "image" || kind === "video";
}

/**
 * What a batch is, in one line: how many, how heavy, how long it lasts.
 *
 * Every card used to say its own size and its own expiry, so nine files sent
 * together repeated the same expiry nine times and never once said what the
 * batch weighed. The soonest expiry is the one that matters - it is when the
 * block starts losing pieces.
 */
function batchSummary(attachments: readonly FileAttachmentInfo[], itemsLabel: string): string {
  const bytes = attachments.reduce((sum, info) => sum + (info.sizeBytes || 0), 0);
  const expiries = attachments
    .map((info) => info.expiresAt)
    .filter((at): at is number => at != null && at > 0);
  const parts = [itemsLabel, formatBytes(bytes)];
  if (expiries.length > 0) {
    const secondsLeft = Math.min(...expiries) - Date.now() / 1000;
    if (secondsLeft > 0) parts.push(`${coarseCountdown(secondsLeft)} left`);
  }
  return parts.join(" · ");
}

/**
 * The files a message carries, as one object rather than a stack of them.
 *
 * A batch staged together arrives as one message with a marker each. Anything
 * with a picture in it - photographs and clips alike - becomes one block of
 * tiles: four of them, with the rest behind a "+n", and one line saying what
 * the whole batch is. Before this, a batch of clips was a row of full players,
 * each with its own transport, its own filename row and its own copy of the
 * same expiry, laid out sideways until it ran off the message.
 *
 * A document has no thumbnail to crop, so it keeps its card and sits under the
 * block rather than inside it.
 *
 * Every tile carries its own flag. Reach is chosen once for the batch, so the
 * words on them do repeat - but the flag is also the button that copies that
 * file's link, and each file has its own.
 */
export function AttachmentGallery({ attachments }: Readonly<{ attachments: readonly FileAttachmentInfo[] }>) {
  const { t } = useTranslation("nebulaChat");
  const [expanded, setExpanded] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const downloadFile = useAppStore((state) => state.downloadFile);
  const addDownload = useAppStore((state) => state.addDownload);

  // On a tile the flag is the icon alone: the block says the reach and the
  // expiry once above the tiles, so repeating the words on each of four is
  // clutter - but the icon is still this file's own copy-link button.
  const badge =
    (info: FileAttachmentInfo, compact = false) =>
    (overlaid: boolean) => <AttachmentVisibilityBadge info={info} overlay={overlaid} compact={compact} />;

  const media = attachments.filter(isTileable);
  const documents = attachments.filter((info) => !isTileable(info));

  /**
   * One directory, then every file in the batch into it.
   *
   * The per-file Save asks where each one goes, which for nine files is nine
   * dialogs. A password share is skipped rather than prompted nine times over;
   * its own card still has the button.
   */
  const saveAll = async () => {
    setSavingAll(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const directory = await open({ directory: true });
      if (typeof directory !== "string") return;
      for (const info of media) {
        if (info.mode === "password") continue;
        const destPath = `${directory}/${info.filename}`;
        try {
          const written = await downloadFile({ url: info.url, destPath });
          addDownload({
            filename: info.filename,
            destPath,
            sizeBytes: written,
            sourceUrl: info.url,
            mode: info.mode,
          });
        } catch {
          // One file that will not come does not cancel the other eight; its
          // own card still offers to try again on its own.
        }
      }
    } finally {
      setSavingAll(false);
    }
  };

  if (attachments.length === 0) return null;

  // One picture, or nothing with a picture in it: no block to make.
  if (media.length < 2) {
    return (
      <>
        {attachments.map((info, index) => (
          <FileAttachmentCard
            key={`${info.url || info.key}:${index}`}
            info={info}
            bare
            visibilityBadge={badge(info)}
          />
        ))}
      </>
    );
  }

  const capped = !expanded && media.length > MEDIA_TILE_CAP;
  const shown = capped ? media.slice(0, MEDIA_TILE_CAP) : media;
  const hidden = capped ? media.length - MEDIA_TILE_CAP : 0;

  return (
    <>
      <Box sx={GRID_SX}>
        {shown.map((info, index) => (
          <Box
            key={`${info.url || info.key}:${index}`}
            sx={{
              position: "relative",
              minWidth: 0,
              overflow: "hidden",
              borderRadius: "8px",
              aspectRatio: tileAspect(shown.length, index),
              gridColumn: shown.length === 3 && index === 2 ? "1 / -1" : undefined,
            }}
          >
            <FileAttachmentCard info={info} tile visibilityBadge={badge(info, true)} />
            {hidden > 0 && index === shown.length - 1 && (
              <Box
                component="button"
                type="button"
                onClick={() => setExpanded(true)}
                aria-label={t("attachment.showAll", { count: media.length })}
                sx={{
                  all: "unset",
                  position: "absolute",
                  inset: 0,
                  zIndex: 3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(9,11,17,0.6)",
                  color: "#f2f4f9",
                  fontSize: "18px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                +{hidden}
              </Box>
            )}
          </Box>
        ))}
        <Box sx={{ ...CHIP_SX, left: "8px", top: "8px", borderRadius: radius("pill") }}>
          {batchSummary(media, t("attachment.itemCount", { count: media.length }))}
        </Box>
        <Box
          component="button"
          type="button"
          onClick={() => void saveAll()}
          disabled={savingAll}
          sx={{
            ...CHIP_SX,
            right: "8px",
            top: "8px",
            borderRadius: "8px",
            cursor: savingAll ? "default" : "pointer",
            opacity: savingAll ? 0.6 : 1,
          }}
        >
          {savingAll ? t("attachment.savingAll") : t("attachment.saveAll")}
        </Box>
      </Box>
      {documents.map((info, index) => (
        <FileAttachmentCard
          key={`${info.url || info.key}:doc:${index}`}
          info={info}
          visibilityBadge={badge(info)}
        />
      ))}
    </>
  );
}
