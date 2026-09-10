import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore } from "@core/store";
import { previewKindForFilename, type FileAttachmentInfo } from "@core/features/chat/fileAttachments";
import { isCanonAttachment, saveCanonAttachment, useCanonPreview } from "@core/features/chat/starlingFiles";
import { formatBytes } from "@core/utils/format";
import { imageSizeFromSource, rememberImageSize } from "@core/utils/imageSize";
import { MediaLightbox } from "../media/MediaPreview";
import MediaPlayer from "@shared/mediaplayer/MediaPlayer";
import { FilePasswordDialog } from "./FilePasswordDialog";
import styles from "./FileAttachmentCard.module.css";

export type { FileAttachmentInfo, PreviewKind } from "@core/features/chat/fileAttachments";
export {
  decodeFileAttachmentPayload,
  encodeFileAttachmentMarker,
  FANCY_FILE_MARKER_RE,
  previewKindForFilename,
} from "@core/features/chat/fileAttachments";

interface FileAttachmentCardProps {
  readonly info: FileAttachmentInfo;
  /**
   * The reach-of-this-file flag, drawn by the caller. A picture is the whole
   * card when there is one, so the flag rides in its bottom-left corner
   * rather than pushing the image down a line; anything else has no image to
   * ride on and gets it above the row instead. The flag is told which of the
   * two it got: a scrim it needs over a photograph would only look like dirt
   * on the card.
   */
  readonly visibilityBadge?: (overlaid: boolean) => ReactNode;
  /**
   * Draw a photograph as itself, with no card around it.
   *
   * A picture is already the message; boxing it in a bordered panel and then
   * letterboxing it to that panel's width states the same thing twice and
   * makes the photograph the smaller half of it. In this mode the image keeps
   * its own shape and the filename/size/buttons row becomes a strip over the
   * top-right corner that appears under the pointer - nothing is taken away,
   * it just stops competing with the picture.
   *
   * Only a still image can be drawn this way. Everything else - a player, a
   * document, an expired link - has no picture to be, and falls back to the
   * card whatever this says.
   */
  readonly bare?: boolean;
  /**
   * Fill the box this card was handed, whatever shape the picture is.
   *
   * What `bare` means inside a gallery: several photographs sent together are
   * one block of tiles, and a tile that kept its own proportions would leave
   * the block ragged. The picture is drawn whole and centred on a blurred copy
   * of itself, the way a long single picture already is, so the cell is full
   * without the subject being cropped out of it. Implies `bare`, and like it
   * only applies to a picture.
   */
  readonly tile?: boolean;
}

/** Beyond this, an expiry is a date rather than a countdown: "expires 9/13"
 *  is what a viewer can act on next week, "39h left" is not. */
const COUNTDOWN_HORIZON_SECONDS = 48 * 3600;

/**
 * The shape a bare picture is given once it is longer than this.
 *
 * A bare picture is capped by height, which for anything long and thin takes
 * the width with it: a 1:8 screenshot of a chat log came out forty pixels
 * across - a thread of pixels, unreadable, and mostly hidden under the chips
 * that ride its corner. Past this shape the picture stops being shrunk and is
 * given a frame of exactly this shape instead: the whole picture, uncropped,
 * centred on a blurred copy of itself that fills what it does not. Every long
 * picture in the thread is then the same size as every other, which is the
 * point - a column of them no longer reads as a row of splinters.
 */
const FRAME_RATIO = 3 / 4;

/** `23h`, `44m`, `2d` - the largest unit that still says something.
 *
 * `formatDuration` gives two of them, which reads as "22h 59m left" where the
 * point being made is only "today". A countdown on a message is a glance, not
 * a stopwatch. */
function coarseCountdown(seconds: number): string {
  // Rounded down, not to nearest: a deadline that says more time than is left
  // is the one mistake this can make that costs somebody a file. Each branch
  // is guarded by its own unit, so the floor is never zero.
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${Math.max(1, Math.floor(seconds))}s`;
}

/** `9/13` - the day an expiry lands on, with no year and no clock. */
function shortExpiryDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
  });
}

/** `m:ss`, for the length of a clip. */
function clipLength(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/** A solid triangle, for the disc a clip wears until it is asked to play. */
function PlayGlyph({ size = 14 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />
    </svg>
  );
}

/**
 * What a file is, said once: size, then reach, then when it goes.
 *
 * These used to be a size, a pill and an italic `toLocaleString` timestamp -
 * which is long enough that the line wrapped, and with the reach flag sitting
 * on a row of its own above, one attachment was three rows of chrome around a
 * filename. Fixed order, one line, and a date only when the countdown is too
 * far out to mean anything.
 */
function FileFacts({
  info,
  expiresIn,
  className,
  extra,
}: Readonly<{
  info: FileAttachmentInfo;
  /** Pre-formatted expiry, or null when the file does not expire. */
  expiresIn: string | null;
  className: string;
  /** The reach flag, which rides the same line rather than a row of its own. */
  extra?: ReactNode;
}>) {
  const parts = [formatBytes(info.sizeBytes), info.mode === "public" ? null : info.mode, expiresIn].filter(
    (part): part is string => !!part,
  );
  return (
    <div className={className}>
      {parts.map((part, index) => (
        <Fragment key={part}>
          {index > 0 && (
            <span aria-hidden="true" className={styles.factSeparator}>
              ·
            </span>
          )}
          <span>{part}</span>
        </Fragment>
      ))}
      {extra}
    </div>
  );
}

/** HTML-comment marker used to embed a file attachment in a chat message
 *  body. Renderers detect the marker and render a {@link FileAttachmentCard}
 *  in place of the raw markdown link. Legacy clients see the inert comment. */
export default function FileAttachmentCard({
  info,
  visibilityBadge,
  bare: bareProp,
  tile,
}: FileAttachmentCardProps) {
  const bare = bareProp || tile;
  const { t } = useTranslation("chat");
  const downloadFile = useAppStore((s) => s.downloadFile);
  const addDownload = useAppStore((s) => s.addDownload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  /** A clip is a poster until it is asked for; this is that asking. */
  const [clipOpen, setClipOpen] = useState(false);
  /** The clip's own length and shape, read off the poster's metadata. */
  const [clipSeconds, setClipSeconds] = useState<number | null>(null);
  const [clipRatio, setClipRatio] = useState<number | null>(null);
  /** Bumped by Retry, to mount a player that has not already failed. */
  const [attempt, setAttempt] = useState(0);
  // Native password prompt (replaces window.prompt): the open flag drives the
  // dialog and a stored resolver hands the entered value back to `onSave`.
  const [pwPromptOpen, setPwPromptOpen] = useState(false);
  const pwResolverRef = useRef<((value: string | null) => void) | null>(null);
  const initiallyExpired = info.expiresAt != null && info.expiresAt > 0 && info.expiresAt * 1000 < Date.now();
  const [expired, setExpired] = useState<boolean>(initiallyExpired);

  const kind = previewKindForFilename(info.filename);
  const previewable = kind === "image" || kind === "audio" || kind === "video";
  // A file whose URL only the server can mint, one look at a time.
  const canon = isCanonAttachment(info);
  const { src: canonSrc, pending: canonPending } = useCanonPreview(info);

  // Post-download: local asset URL (works for any access mode).
  // Pre-download: public files only - URL is a signed but open link. A canon
  // attachment has no open link at all: what is drawn is an address on the
  // loopback origin, which a player pulls a range at a time and an `<img>`
  // loads lazily into the webview's cache.
  //
  // Saving does not move a canon player onto the saved copy: a webview's media
  // stack cannot load `asset:` at all (see `state/media_server.rs`), so the
  // local URL that works for a picture would silently break a video.
  const streams = canon && (kind === "audio" || kind === "video");
  const previewSrc = streams
    ? canonSrc
    : savedPath
      ? convertFileSrc(savedPath)
      : canon
        ? canonSrc
        : info.mode === "public" && previewable
          ? info.url
          : null;

  /**
   * The address a browser could open this file at, or null.
   *
   * Only the two reaches that are actually a link: public, which opens, and
   * password, which opens the prompt. A session-scoped file has a URL too, but
   * it is one only this client's session can follow, and an expired one is a
   * page that says so - neither is worth offering as "open in browser".
   *
   * Being a canon share is not a reason to withhold it: a public canon share
   * carries both a key and a URL (see `isCanonAttachment`), and the key only
   * says how *this* client fetches it - which is why what is drawn is a
   * loopback address off the session rather than the public one. The public
   * address is still there, and it is the one thing worth handing to somebody
   * else.
   */
  const openableLink =
    !expired && (info.mode === "public" || info.mode === "password") && /^https?:/i.test(info.url ?? "")
      ? info.url
      : null;

  const handleOpenInBrowser = useCallback(() => {
    openUrl(info.url).catch(() => {
      // Fallback for non-Tauri environments (e.g. Vite dev server) or when
      // the opener plugin call fails for any reason.
      window.open(info.url, "_blank", "noopener,noreferrer");
    });
  }, [info.url]);

  const handleImageClick = useCallback(() => {
    if (previewSrc) setLightboxOpen(true);
  }, [previewSrc]);

  /** The picture's own width/height, which is what caps its height when bare. */
  const [measured, setMeasured] = useState<number | null>(null);
  /**
   * The same number, known before the picture has decoded.
   *
   * A picture is remembered by its address the first time it is measured
   * (`rememberImageSize`), and a canon picture's address holds for the run,
   * so the second card to draw it - the row remounted after a scroll back -
   * reserves its box instead of laying itself out at nothing and correcting
   * itself a frame later. A picture nobody has measured yet still arrives the
   * slow way, through `measure`.
   */
  const knownSize = previewSrc ? imageSizeFromSource(previewSrc) : null;
  // What the picture measured always wins: a remembered size is a head start,
  // not a fact about the picture now at that address.
  const ratio = measured ?? (knownSize ? knownSize.width / knownSize.height : null);
  /** Longer than its own shape is worth drawing: framed rather than shrunk. */
  const framed = !!bare && !tile && ratio != null && ratio < FRAME_RATIO;
  const measure = useCallback((image: HTMLImageElement | null) => {
    if (!image?.naturalHeight) return;
    const next = image.naturalWidth / image.naturalHeight;
    // Worth keeping: a remote picture has no other way of being known, and
    // the next card to draw it reserves its box instead of growing into it.
    rememberImageSize(image.currentSrc || image.src, {
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    setMeasured((current) => (current === next ? current : next));
  }, []);

  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  /** A countdown while that still says something, a date once it does not. */
  const expiresIn = (() => {
    if (info.expiresAt == null || info.expiresAt <= 0) return null;
    const secondsLeft = info.expiresAt - Date.now() / 1000;
    if (secondsLeft <= 0) return null;
    if (secondsLeft < COUNTDOWN_HORIZON_SECONDS) {
      return t("fileAttachment.expiresIn", { duration: coarseCountdown(secondsLeft) });
    }
    return `${t("fileAttachment.expiresPrefix")} ${shortExpiryDate(info.expiresAt)}`;
  })();

  // Switch to expired state automatically once the announced expiry
  // timestamp passes, without waiting for a network failure.
  useEffect(() => {
    if (savedPath || expired) return;
    if (info.expiresAt == null || info.expiresAt <= 0) return;
    const msUntilExpiry = info.expiresAt * 1000 - Date.now();
    if (msUntilExpiry <= 0) {
      setExpired(true);
      return;
    }
    const timer = globalThis.setTimeout(() => setExpired(true), msUntilExpiry + 500);
    return () => globalThis.clearTimeout(timer);
  }, [info.expiresAt, savedPath, expired]);

  // Probe the URL when an inline preview fails to load. The file-server
  // returns HTTP 404 with a JSON body of `{"error":"link expired"}` for
  // expired signed URLs - distinguish that from a generic load failure.
  const probeForExpiry = useCallback(async () => {
    try {
      const resp = await fetch(info.url, { method: "GET" });
      if (resp.status === 404) {
        let body = "";
        try {
          body = await resp.text();
        } catch {
          // ignore body parse failure
        }
        if (body.toLowerCase().includes("expired")) {
          setExpired(true);
          return;
        }
      }
      setError("Preview failed to load.");
    } catch {
      setError("Preview failed to load.");
    }
  }, [info.url]);

  const handlePreviewError = useCallback(() => {
    if (expired) return;
    // Nothing to probe for a canon attachment: it has no URL to ask about,
    // and it never expires on its own - the server keeps it or collects it.
    if (canon) return;
    void probeForExpiry();
  }, [expired, probeForExpiry, canon]);

  // Never for a canon attachment: there is no address to open. The URL that
  // reaches this client is good for one request and about a minute.
  const canOpenInBrowser = !canon && (info.mode === "public" || info.mode === "password") && !expired;

  // Open the native password dialog and resolve with the entered value (or
  // null if cancelled).
  const askPassword = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        pwResolverRef.current = resolve;
        setPwPromptOpen(true);
      }),
    [],
  );

  const resolvePassword = useCallback((value: string | null) => {
    setPwPromptOpen(false);
    const resolve = pwResolverRef.current;
    pwResolverRef.current = null;
    resolve?.(value);
  }, []);

  const onSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({ defaultPath: info.filename });
      if (!dest) {
        setBusy(false);
        return;
      }
      let password: string | undefined;
      if (info.mode === "password") {
        const entered = await askPassword();
        if (entered === null) {
          setBusy(false);
          return;
        }
        password = entered;
      }
      const written = canon
        ? await saveCanonAttachment(
            info.key ?? "",
            dest,
            // A canon password share is sealed, so saving it takes the same
            // two steps a browser does: the password buys a ticket, and the
            // ticket buys the bytes. The other two modes need none of it.
            info.mode === "password" && password !== undefined ? { url: info.url, password } : undefined,
          )
        : await downloadFile({ url: info.url, destPath: dest, password });
      addDownload({
        filename: info.filename,
        destPath: dest,
        sizeBytes: written,
        // The key stands in for the URL in the downloads list, because it is
        // the only lasting name this file has.
        sourceUrl: canon ? (info.key ?? "") : info.url,
        mode: info.mode,
      });
      setSaved(true);
      setSavedPath(dest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("expired")) {
        setExpired(true);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }, [downloadFile, addDownload, info, askPassword, canon]);

  const preview = (() => {
    if (!previewSrc) return null;
    if (kind === "image") {
      return (
        <button
          type="button"
          className={framed ? `${styles.previewImageBtn} ${styles.frame}` : styles.previewImageBtn}
          onClick={handleImageClick}
          aria-label={t("fileAttachment.viewInLightbox", { filename: info.filename })}
          style={framed ? ({ "--frame-ratio": FRAME_RATIO } as CSSProperties) : undefined}
        >
          {/* The picture again, blurred, filling what the picture itself does
              not reach. Hidden from assistive technology: it is the same
              picture, and the one below already carries the name. A gallery
              tile is the same idea at cell size - the block's cells decide the
              shape, and the picture sits whole in the middle of one. */}
          {(framed || tile) && (
            <img
              src={previewSrc}
              alt=""
              aria-hidden="true"
              className={framed ? styles.frameBackdrop : styles.tileBackdrop}
              loading="lazy"
            />
          )}
          <img
            src={previewSrc}
            alt={info.filename}
            // Bare drops the filename row, so the name lives on the picture.
            title={bare ? info.filename : undefined}
            // The handle a right-click finds a picture by: a sent photograph
            // is as much a picture as a pasted one, and the same menu should
            // come up on either.
            data-picture=""
            // ...and the address that picture also lives at, where it has one
            // anybody can follow. A public link opens straight; a password
            // link opens the file server's own prompt, which is the point of
            // having sent it that way. What is drawn here is often neither -
            // a downloaded copy on disk, or bytes this client fetched - so
            // the link is carried separately rather than read off the `src`.
            data-picture-link={openableLink ?? undefined}
            className={
              tile
                ? styles.tileImage
                : framed
                  ? styles.framedImage
                  : bare
                    ? styles.bareImage
                    : styles.previewImage
            }
            // A cached picture can be complete before React ever sees a `load`,
            // so the ref measures it too rather than waiting for an event that
            // has already been and gone.
            ref={measure}
            // The ratio is the box: as a width cap when bare (see
            // `--bare-ratio` in the stylesheet), and as the shape the card's
            // own preview holds open before the picture fills it. Never on a
            // tile: there the block has already decided the box, and handing
            // the picture's own shape to a cell that is not that shape is the
            // one thing that makes a block ragged.
            style={
              ratio && !tile
                ? ({ [bare ? "--bare-ratio" : "--preview-ratio"]: ratio } as CSSProperties)
                : undefined
            }
            loading="lazy"
            onLoad={(event) => measure(event.currentTarget)}
            onError={handlePreviewError}
          />
        </button>
      );
    }
    if (kind === "audio") {
      // Our own controls rather than the platform's: see `MediaPlayer`. Retry
      // remounts the player on a fresh source, which for a canon attachment
      // means a freshly signed URL rather than the one that stopped working.
      return (
        <div className={styles.previewAudioWrap}>
          <MediaPlayer
            key={`${previewSrc}#${attempt}`}
            src={previewSrc}
            kind="audio"
            label={info.filename}
            onRetry={() => {
              handlePreviewError();
              setAttempt((count) => count + 1);
            }}
          />
        </div>
      );
    }
    return null;
  })();

  /** Save and Open, as the strip that rides a picture or a clip. */
  const frameActions = (
    <>
      <button
        type="button"
        className={styles.bareBtn}
        onClick={onSave}
        disabled={busy}
        title={saved ? t("fileAttachment.savedTooltip") : t("fileAttachment.downloadTooltip")}
      >
        {busy ? t("fileAttachment.saving") : saved ? t("fileAttachment.saved") : t("fileAttachment.save")}
      </button>
      {canOpenInBrowser && (
        <button
          type="button"
          className={styles.bareBtn}
          onClick={handleOpenInBrowser}
          title={t("fileAttachment.openTooltip")}
        >
          {t("fileAttachment.open")}
        </button>
      )}
    </>
  );

  // Only a still picture can carry the flag: a player already owns its own
  // bottom-left corner, and a card with no preview has no corner at all.
  const overlaysPreview = !!visibilityBadge && !!preview && kind === "image";

  if (expired) {
    return (
      <div className={`${styles.card} ${styles.expiredCard}`}>
        <div className={styles.cardRow}>
          <div className={`${styles.icon} ${styles.expiredIcon}`} aria-hidden="true">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
          </div>
          <div className={styles.body}>
            <div className={styles.filename}>{info.filename}</div>
            <div className={styles.expiredMessage}>{t("fileAttachment.expired")}</div>
            <FileFacts
              info={info}
              expiresIn={
                info.expiresAt != null && info.expiresAt > 0
                  ? `${t("fileAttachment.expiredPrefix")} ${shortExpiryDate(info.expiresAt)}`
                  : null
              }
              className={styles.meta}
              extra={visibilityBadge?.(false)}
            />
          </div>
        </div>
      </div>
    );
  }

  /** Everything a bare picture still has to offer, and the dialogs behind it. */
  const trailer = (
    <>
      {lightboxOpen &&
        previewSrc &&
        kind === "image" &&
        createPortal(
          <MediaLightbox
            item={{ kind: "image", src: previewSrc, alt: info.filename, spoiler: false }}
            onClose={closeLightbox}
            link={openableLink}
          />,
          document.body,
        )}
      {pwPromptOpen && (
        <FilePasswordDialog
          filename={info.filename}
          onConfirm={(pw) => resolvePassword(pw)}
          onCancel={() => resolvePassword(null)}
        />
      )}
    </>
  );

  /**
   * A clip, drawn the way a photograph already is: itself, and nothing else.
   *
   * A video used to mount a full-width player the moment the message arrived,
   * with a filename-and-size row bolted underneath - so a message carrying six
   * of them was six players, six control bars and six grey rows, all loading
   * at once. At rest it is now a poster the size of a picture tile, wearing
   * its length and its facts and nothing more. Asking for it swaps the poster
   * for the player in place, which is also the first moment anything past the
   * first frame is fetched.
   */
  if (kind === "video" && previewSrc) {
    const length = clipSeconds == null ? "" : clipLength(clipSeconds);
    // Inside a block of tiles the clip gives up its own shape and its facts:
    // the block states those once for the whole batch.
    const shell = tile ? `${styles.bare} ${styles.tile}` : styles.bare;
    const frame = tile
      ? `${styles.previewWrap} ${styles.clipTile}`
      : `${styles.previewWrap} ${clipOpen ? styles.clipOpen : styles.clipClosed}`;
    return (
      <div className={shell}>
        <div className={frame}>
          {clipOpen ? (
            <MediaPlayer
              key={`${previewSrc}#${attempt}`}
              src={previewSrc}
              kind="video"
              label={info.filename}
              title={info.filename}
              meta={<FileFacts info={info} expiresIn={expiresIn} className={styles.clipPlayerFacts} />}
              actions={frameActions}
              autoPlay
              onRetry={() => {
                handlePreviewError();
                setAttempt((count) => count + 1);
              }}
            />
          ) : (
            <>
              <button
                type="button"
                className={tile ? `${styles.clipPoster} ${styles.clipPosterTile}` : styles.clipPoster}
                style={clipRatio && !tile ? ({ "--clip-ratio": clipRatio } as CSSProperties) : undefined}
                onClick={() => setClipOpen(true)}
                aria-label={t("fileAttachment.playClip", { filename: info.filename })}
              >
                <video
                  className={styles.clipPosterFrame}
                  src={previewSrc}
                  preload="metadata"
                  muted
                  playsInline
                  onLoadedMetadata={(event) => {
                    const element = event.currentTarget;
                    setClipSeconds(Number.isFinite(element.duration) ? element.duration : null);
                    if (element.videoHeight > 0) setClipRatio(element.videoWidth / element.videoHeight);
                    // Metadata alone leaves the element a black rectangle on
                    // every engine we ship on. Seeking a hair into the clip is
                    // what makes it decode the frame the poster is *of*.
                    if (element.currentTime === 0 && Number.isFinite(element.duration)) {
                      element.currentTime = Math.min(0.1, element.duration / 2);
                    }
                  }}
                  onError={handlePreviewError}
                >
                  <track kind="captions" />
                </video>
                <span className={styles.clipDisc} aria-hidden="true">
                  <PlayGlyph size={16} />
                </span>
                {length && <span className={styles.clipLength}>{length}</span>}
              </button>
              <div className={styles.previewOverlay}>
                {tile ? (
                  visibilityBadge?.(true)
                ) : (
                  <FileFacts
                    info={info}
                    expiresIn={expiresIn}
                    className={styles.frameFacts}
                    extra={visibilityBadge?.(true)}
                  />
                )}
              </div>
              {!tile && <div className={styles.bareActions}>{frameActions}</div>}
            </>
          )}
        </div>
        {error && <div className={styles.bareError}>{error}</div>}
        {trailer}
      </div>
    );
  }

  // A picture on its way, in a cell that already has its shape.
  //
  // The block's cells are sized by the grid, not by what lands in them, so
  // there is a box here well before there is a photograph to put in it. What
  // used to fill it was the ordinary card - an icon, a filename, a size and a
  // Save button - crumpled into a square and replaced by a photograph a moment
  // later, with the block's own chips sitting on top of it. A picture-shaped
  // wait is the honest thing to draw, and it is the shape the picture arrives
  // at.
  if (tile && kind === "image" && canonPending && !previewSrc && !expired) {
    return (
      <div className={`${styles.bare} ${styles.tile}`}>
        <div className={styles.previewWrap}>
          <div className={styles.tileSkeleton} role="img" aria-label={info.filename} />
          <div className={styles.previewOverlay}>{visibilityBadge?.(true)}</div>
        </div>
      </div>
    );
  }

  if (bare && preview && kind === "image") {
    return (
      <div className={tile ? `${styles.bare} ${styles.tile}` : styles.bare}>
        <div className={styles.previewWrap}>
          {preview}
          {/* Facts ride the picture's bottom-left corner on their own scrim,
              so nothing is stacked underneath it. On a gallery tile there is
              no room for them and only the reach flag survives. */}
          <div className={styles.previewOverlay}>
            {tile ? (
              visibilityBadge?.(true)
            ) : (
              <FileFacts
                info={info}
                expiresIn={expiresIn}
                className={styles.frameFacts}
                extra={visibilityBadge?.(true)}
              />
            )}
          </div>
          <div className={styles.bareActions}>{frameActions}</div>
        </div>
        {error && <div className={styles.bareError}>{error}</div>}
        {trailer}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      {overlaysPreview ? (
        <div className={styles.previewWrap}>
          {preview}
          <div className={styles.previewOverlay}>{visibilityBadge?.(true)}</div>
        </div>
      ) : (
        preview
      )}
      <div className={styles.cardRow}>
        <div className={styles.icon} aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <div className={styles.body}>
          <div className={styles.filename}>{info.filename}</div>
          <FileFacts
            info={info}
            expiresIn={expiresIn}
            className={styles.meta}
            // The reach flag shares the facts line rather than taking a row of
            // its own above the card - unless there is a picture for it to sit
            // on, in which case it is already drawn there.
            extra={overlaysPreview ? undefined : visibilityBadge?.(false)}
          />
          {error && <div className={styles.error}>{error}</div>}
        </div>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={onSave}
          disabled={busy}
          title={saved ? t("fileAttachment.savedTooltip") : t("fileAttachment.downloadTooltip")}
        >
          {busy ? t("fileAttachment.saving") : saved ? t("fileAttachment.saved") : t("fileAttachment.save")}
        </button>
        {canOpenInBrowser && (
          <button
            type="button"
            className={styles.openBtn}
            onClick={handleOpenInBrowser}
            title={t("fileAttachment.openTooltip")}
          >
            {t("fileAttachment.open")}
          </button>
        )}
      </div>
      {trailer}
    </div>
  );
}
