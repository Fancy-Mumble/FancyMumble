import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import FileAttachmentCard from "@standard/components/chat/file/FileAttachmentCard";
import { previewKindForFilename, type FileAttachmentInfo } from "@core/features/chat/fileAttachments";
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
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "3px",
  width: `min(${GRID_W}px, 100%)`,
  borderRadius: radius("lg"),
  overflow: "hidden",
} as const;

/**
 * The files a message carries, when they are photographs.
 *
 * A batch staged together arrives as one message with a marker each, so this
 * is the same block the body's own pictures get - one picture keeps its shape,
 * several become tiles. Anything that is not all pictures falls back to a card
 * apiece: a document has no thumbnail to crop, and a grid of file icons is
 * worse than the list it replaced.
 *
 * Every tile carries its own flag. Reach is chosen once for the batch, so the
 * words on them do repeat - but the flag is also the button that copies that
 * file's link, and each file has its own. Drawn once, seven of the eight links
 * in a batch had no way to be copied at all.
 */
export function AttachmentGallery({ attachments }: Readonly<{ attachments: readonly FileAttachmentInfo[] }>) {
  if (attachments.length === 0) return null;

  const badge = (info: FileAttachmentInfo) => (overlaid: boolean) => (
    <AttachmentVisibilityBadge info={info} overlay={overlaid} />
  );

  const allPictures = attachments.every((info) => previewKindForFilename(info.filename) === "image");
  if (attachments.length === 1 || !allPictures) {
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

  return (
    <Box sx={GRID_SX}>
      {attachments.map((info, index) => (
        <Box
          key={`${info.url || info.key}:${index}`}
          sx={{
            minWidth: 0,
            overflow: "hidden",
            aspectRatio: tileAspect(attachments.length, index),
            gridColumn: attachments.length === 3 && index === 2 ? "1 / -1" : undefined,
          }}
        >
          <FileAttachmentCard info={info} tile visibilityBadge={badge(info)} />
        </Box>
      ))}
    </Box>
  );
}
