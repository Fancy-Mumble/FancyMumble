import { useState } from "react";
import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import FileAttachmentCard from "@standard/components/chat/file/FileAttachmentCard";
import { previewKindForFilename, type FileAttachmentInfo } from "@core/features/chat/fileAttachments";
import { useAppStore } from "@core/store";
import { formatBytes } from "@core/utils/format";
import { rememberImageSize, type ImageSize } from "@core/utils/imageSize";
import { AttachmentVisibilityBadge } from "./AttachmentVisibilityBadge";
import type { BodyImage } from "../../selectors";
import { radius } from "../../tokens";

/** How wide a single picture is allowed to be, and how tall. */
const SINGLE_MAX_W = 420;
const SINGLE_MAX_H = 320;
/**
 * The shape a picture is given once it is longer than this.
 *
 * The height cap alone takes a long thin picture - a screenshot of a chat log,
 * a whole web page - down to a thread of pixels forty across, which is not a
 * picture of anything. Past this shape the cap gives way to a frame of exactly
 * this shape: the whole picture, uncropped, centred on a blurred copy of
 * itself that fills what it does not reach. Every long picture in the thread
 * is then the same size as every other.
 */
const FRAME_RATIO = 3 / 4;
/** The frame itself, taller than the plain cap so the picture has room. */
const FRAME_H = 400;
const FRAME_W = FRAME_H * FRAME_RATIO;

/**
 * What a picture pasted into the body weighs, or null when that is unknowable.
 *
 * A picture sent as a file says its size, its reach and when it expires on a
 * chip in its corner; a picture pasted into the body - which is what the
 * original client and every paste does - said nothing at all, and the two sat
 * next to each other in the same thread looking like one of them had been
 * told less about. Weight is the one fact a body picture actually has: it is
 * carried in the message, so this is the number, not an estimate of it.
 *
 * Only base64 answers. A picture the body points at by URL is a fetch away,
 * and a chip that had to wait on the network to say anything would appear
 * halfway through reading the message.
 */
function bodyImageBytes(src: string): number | null {
  const comma = src.indexOf(",");
  if (!src.startsWith("data:") || comma < 0) return null;
  if (!src.slice(0, comma).includes(";base64")) return null;
  const payload = src.slice(comma + 1);
  if (payload.length === 0) return null;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}
/** The tiled block is one object, so it has one width whatever it holds. */
const GRID_W = 460;

/**
 * What is behind a picture that does not cover its own box.
 *
 * A PNG with an alpha channel is a picture with holes in it, and a hole drawn
 * straight onto the thread reads as a bug in the thread: the half of a sticker
 * that is nothing looks exactly like a tile that failed to fill. The
 * checkerboard is what every image editor puts there, and it says the one
 * thing the empty half means - there is nothing here, on purpose.
 *
 * Behind everything, always. An opaque photograph covers it completely, so it
 * costs nothing and needs nobody to work out which pictures have an alpha
 * channel - a question CSS cannot ask, and one a canvas could only answer by
 * reading pixels back, which a remote picture will not allow anyway.
 *
 * Grey on grey rather than the editor's white on white: this sits inside a
 * conversation, and has to be legible under a dark theme without lighting up
 * the thread under a light one.
 */
const CHECKERBOARD_SX = {
  backgroundColor: "rgba(128,128,128,0.10)",
  backgroundImage: "repeating-conic-gradient(rgba(128,128,128,0.18) 0% 25%, transparent 0% 50%)",
  backgroundSize: "18px 18px",
} as const;

/**
 * The blurred copy that fills whatever the picture itself does not reach.
 *
 * The same thing a long single picture is already drawn on, at tile size: the
 * cell is the shape, the picture sits whole in the middle of it, and the gap
 * either side is the picture again rather than a hole in the block.
 */
const TILE_BACKDROP_SX = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  filter: "blur(18px) brightness(0.62) saturate(1.1)",
  // A blur samples past the edges it is given, which leaves the cell's own
  // border soft and pale. Overscanning hides that seam.
  transform: "scale(1.2)",
} as const;

/**
 * The picture on a tile: whole, centred, and never a contributor to layout.
 *
 * Absolute, not merely 100%/100%: out of the flow the picture has no say in
 * how big its cell is, so the cell is the grid's decision alone and every tile
 * of a block comes out the same size as every other.
 */
const TILE_IMAGE_SX = {
  position: "absolute",
  inset: 0,
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "contain",
} as const;

/**
 * What fills a picture's box until the picture does.
 *
 * Every box here has its shape before it has its picture - a tile from the
 * grid, a lone photograph from the size read out of its own bytes - so this
 * only ever covers a space that was already the right one. It pulses the way
 * an offloaded body does while it is being fetched: the same kind of waiting,
 * drawn the same way.
 */
function PictureSkeleton() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: "absolute",
        inset: 0,
        zIndex: 1,
        borderRadius: "inherit",
        background: theme.palette.nebula.card2,
        animation: "nebula-picture-pulse 1.4s ease-in-out infinite",
        "@keyframes nebula-picture-pulse": { "50%": { opacity: 0.45 } },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      })}
    />
  );
}

/**
 * Whether a picture has painted yet.
 *
 * A picture already in the cache is `complete` before React hears a `load`,
 * and one that fails never will: both count as done, or the skeleton sits
 * over a picture that is there, or shimmers for a picture that is not coming.
 */
function usePainted(): [boolean, (element: HTMLImageElement | null) => void, () => void] {
  const [painted, setPainted] = useState(false);
  const done = () => setPainted(true);
  const onMount = (element: HTMLImageElement | null) => {
    if (element?.complete) setPainted(true);
  };
  return [painted, onMount, done];
}

/** One tile of the block: its shape is the grid's, its picture arrives later. */
function Tile({
  image,
  aspect,
  span,
  onClick,
  label,
}: Readonly<{
  image: BodyImage;
  aspect: string;
  span: boolean;
  onClick: () => void;
  label: string;
}>) {
  const [painted, onMount, done] = usePainted();
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-label={label}
      sx={{
        all: "unset",
        ...CHECKERBOARD_SX,
        position: "relative",
        display: "block",
        // The backdrop below overscans its own edges; without this the blur of
        // one tile would wash over the tile beside it.
        overflow: "hidden",
        cursor: "zoom-in",
        lineHeight: 0,
        // The cell decides the shape, so every tile of a block is the same size
        // as every other whatever it happens to be a picture of. Both axes are
        // pinned as well: the shape decides how tall the row wants to be, but a
        // cell shorter than the row it landed in would sit at the top of it
        // with the block's own background showing beneath.
        width: "100%",
        height: "100%",
        aspectRatio: aspect,
        gridColumn: span ? "1 / -1" : undefined,
      }}
    >
      {!painted && <PictureSkeleton />}
      {/* The picture again, blurred, behind itself. Hidden from assistive
          technology: it is the same picture, and the button already carries
          its name. */}
      <Box component="img" src={image.src} alt="" aria-hidden loading="lazy" sx={TILE_BACKDROP_SX} />
      <Box
        component="img"
        src={image.src}
        alt={image.alt}
        loading="lazy"
        // What a right-click looks for: the row's menu has to tell a picture
        // worth acting on from an avatar or an emote, and the only thing they
        // do not share is this.
        data-picture=""
        ref={onMount}
        onLoad={done}
        onError={done}
        sx={TILE_IMAGE_SX}
      />
    </Box>
  );
}

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
 * block of tiles, each the same size as the next: the whole picture centred in
 * its cell on a blurred copy of itself, which is what a letterboxed thumbnail
 * used to leave as a hole of background.
 */
export function MediaGallery({ images, onOpen }: Readonly<MediaGalleryProps>) {
  const { t } = useTranslation("nebulaChat");
  if (images.length === 0) return null;

  const open = (image: BodyImage) => () => onOpen?.(image.src);
  // The picture's own words where it has them - a caption names this one
  // picture, where "Enlarge image" names every one of them the same.
  const label = (image: BodyImage) => image.alt || t("attachment.enlarge");

  if (images.length === 1) {
    return <SinglePicture image={images[0]!} onClick={open(images[0]!)} label={label(images[0]!)} />;
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
        <Tile
          key={`${image.src}:${index}`}
          image={image}
          aspect={tileAspect(images.length, index)}
          span={images.length === 3 && index === 2}
          onClick={open(image)}
          label={label(image)}
        />
      ))}
    </Box>
  );
}

/**
 * One picture, at its own shape - up to the point where its own shape stops
 * being worth drawing.
 *
 * The shape is settled before the picture loads wherever it can be: a pasted
 * photograph is carried in the message, and its own dimensions are a few bytes
 * into it. Then the box is the right one from the first frame, the decision
 * between a plain picture and a framed one is made once, and a thread of them
 * does not shuffle itself as they arrive. A picture the body only points at
 * still has to be waited for, and is measured on `load` as it always was.
 */
function SinglePicture({
  image,
  onClick,
  label,
}: Readonly<{ image: BodyImage; onClick: () => void; label: string }>) {
  const bytes = bodyImageBytes(image.src);
  const known = image.width && image.height ? { width: image.width, height: image.height } : null;
  const [measured, setMeasured] = useState<ImageSize | null>(null);
  const [painted, onMount, done] = usePainted();
  // A cached picture is complete before React sees a `load` event, so the ref
  // measures it as well rather than waiting for one that has already fired.
  const measure = (element: HTMLImageElement | null) => {
    if (!element?.naturalHeight) return;
    const next = { width: element.naturalWidth, height: element.naturalHeight };
    // Worth keeping: a picture the body points at by URL has no other way of
    // being known ahead of its decode, and the next row to draw it reserves
    // its box instead of growing into one.
    rememberImageSize(element.currentSrc || element.src, next);
    setMeasured((current) =>
      current && current.width === next.width && current.height === next.height ? current : next,
    );
  };
  /**
   * The picture's own size: what it measured, or what was read ahead of it.
   *
   * What the picture measured always wins, and it is a *size* rather than a
   * shape because the box below is built from both numbers. Measuring only
   * the shape left a picture whose bytes could not be read - one the body
   * points at by URL, one in a format the header reader does not cover - with
   * no box of its own for as long as it was on screen.
   */
  const size = measured ?? known;
  const ratio = size ? size.width / size.height : null;
  const framed = ratio != null && ratio < FRAME_RATIO;
  /**
   * The box the picture is going to fill, held open before it fills it.
   *
   * The same two caps the picture itself carries, applied to the frame around
   * it instead: its own width, the width cap, and the height cap written as a
   * width - which is the one that decides a landscape photograph's size.
   *
   * Not decoration, and not only about the thread jumping: without it the
   * button is shrink-to-fit around a picture whose height cap the browser
   * applies to what it *draws* and whose `min(…, 100%)` width cap it cannot
   * apply while measuring. A landscape photograph then sat at 420px inside a
   * box the height cap had made half as wide again, and the strip of button
   * beside it was the checkerboard - the "transparent" half of a picture with
   * nothing transparent about it.
   */
  const reserved =
    !framed && size !== null
      ? {
          width: `min(${size.width}px, ${SINGLE_MAX_W}px, calc(${SINGLE_MAX_H}px * ${ratio}))`,
          aspectRatio: `${size.width} / ${size.height}`,
        }
      : null;

  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-label={label}
      sx={{
        all: "unset",
        ...CHECKERBOARD_SX,
        position: "relative",
        display: "block",
        width: "fit-content",
        maxWidth: "100%",
        cursor: "zoom-in",
        lineHeight: 0,
        borderRadius: radius("lg"),
        ...(reserved ?? {}),
        ...(framed ? { width: FRAME_W, height: FRAME_H, overflow: "hidden" } : {}),
      }}
    >
      {!painted && <PictureSkeleton />}
      {/* The picture again, blurred, filling what the picture itself does not
          reach. Hidden from assistive technology: it is the same picture, and
          the button already carries its name. */}
      {framed && (
        <Box
          component="img"
          src={image.src}
          alt=""
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(22px) brightness(0.62) saturate(1.1)",
            // A blur samples past the edges it is given, which leaves the
            // frame's own border soft and pale. Overscanning hides that seam.
            transform: "scale(1.2)",
          }}
        />
      )}
      <Box
        component="img"
        src={image.src}
        alt={image.alt}
        loading="lazy"
        // See the tile: this is the handle the row's context menu picks a
        // picture out by.
        data-picture=""
        ref={(element: HTMLImageElement | null) => {
          measure(element);
          onMount(element);
        }}
        onLoad={(event: { currentTarget: HTMLImageElement }) => {
          measure(event.currentTarget);
          done();
        }}
        onError={done}
        sx={{
          display: "block",
          maxWidth: `min(${SINGLE_MAX_W}px, 100%)`,
          // No explicit width in the ordinary case, so the two caps shrink the
          // picture without ever letterboxing it: what is drawn is the whole
          // photograph. A picture past the frame's shape is the exception -
          // there the box is the frame, and the whole picture sits inside it
          // with the blurred copy behind filling the rest.
          ...(framed
            ? {
                position: "relative",
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }
            : // A reserved box is already the picture's own shape, so filling
              // it is the same drawing the caps would have arrived at - only
              // without the frame having to grow into it.
              {
                maxHeight: SINGLE_MAX_H,
                borderRadius: radius("lg"),
                ...(reserved ? { position: "relative", width: "100%", height: "100%" } : {}),
              }),
        }}
      />
      {/* The same corner an attachment wears its facts in, saying the one fact
          a pasted picture has. */}
      {bytes !== null && (
        <Box sx={{ ...CHIP_SX, left: "8px", bottom: "8px", borderRadius: radius("pill") }}>
          {formatBytes(bytes)}
        </Box>
      )}
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
              // Both axes pinned, so the cell is the column wide and the row
              // tall. The shape below still decides how tall the row wants to
              // be, but a cell shorter than the row it landed in would sit at
              // the top of it with the block's own background showing beneath
              // - which is the ragged half of a block, from the other side.
              width: "100%",
              height: "100%",
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
