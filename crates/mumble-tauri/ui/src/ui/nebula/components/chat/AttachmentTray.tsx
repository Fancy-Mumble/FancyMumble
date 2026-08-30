import { useState } from "react";
import { Box, InputBase, Tooltip, Typography } from "@mui/material";
import type { FileAccessMode } from "@core/types";
import type { StagedAttachment } from "@core/features/chat/useFileUpload";
import { formatBytes } from "@core/utils/format";
import { ChevronDownIcon, CloseIcon, Link2Icon, LockIcon, PlusIcon, UsersGroupIcon } from "@ui/icons";
import { Stack } from "../primitives";
import { NEBULA_MONO, radius } from "../../tokens";

/** The square a staged file is previewed in, and the disc that removes it. */
const TILE_PX = 54;
const TILE_CLOSE_PX = 17;

export type AttachmentQuality = "compressed" | "full";

/** A lifetime a share can be given, in seconds; `0` means it never expires. */
export const TTL_NEVER = 0;
export const TTL_24_HOURS = 24 * 60 * 60;
export const TTL_7_DAYS = 7 * 24 * 60 * 60;

/**
 * How the message's files go up, as chosen on the tray.
 *
 * One answer for the batch rather than one per file: the canvas draws the
 * options once, beside the tiles, because "who may see this" is a property
 * of the message being written and not of the third photograph in it.
 */
export interface ShareOptions {
  readonly mode: FileAccessMode;
  /** Only read when `mode` is `"password"`. */
  readonly password: string;
  readonly quality: AttachmentQuality;
  /** Seconds until the share expires; `0` = never. */
  readonly ttlSeconds: number;
}

export const DEFAULT_SHARE_OPTIONS: ShareOptions = {
  mode: "session",
  password: "",
  quality: "compressed",
  // A share defaults to outliving neither the conversation nor the sender's
  // memory of having sent it - seven days is long enough to be useful and
  // short enough that a link is not a permanent liability by accident.
  ttlSeconds: TTL_7_DAYS,
};

/**
 * Whether the options make the batch sendable.
 *
 * A password link with no password is the one combination the uploader
 * cannot take, so the composer holds send until one is typed or generated.
 */
export function shareOptionsReady(options: ShareOptions, attachments: readonly StagedAttachment[]): boolean {
  return attachments.length === 0 || options.mode !== "password" || options.password.length > 0;
}

/**
 * The files a message is about to carry, and how.
 *
 * Tiles on one scrolling line, because what you need to check about a picked
 * file is that it is the right one - which is a look at the picture, not a
 * filename in a list. The line ends in a dashed square rather than sending
 * you back to the paperclip. Beside it sit the two things worth deciding
 * before send - how big a photo goes up, and who can reach the link - folded
 * away under one button, because most messages take the defaults.
 */
export function AttachmentTray({
  attachments,
  disabled = false,
  target,
  canSharePublic,
  canExpire,
  options,
  onOptionsChange,
  onRemove,
  onAddMore,
}: Readonly<{
  attachments: readonly StagedAttachment[];
  disabled?: boolean;
  /** Where the message goes, e.g. "#Gaming" or "@Lorelando" - it names the narrowest audience. */
  target: string;
  /** Whether this server lets a file be reached by link at all, rather than only by channel. */
  canSharePublic: boolean;
  /** Whether this server honours a lifetime on a share at all. */
  canExpire: boolean;
  options: ShareOptions;
  onOptionsChange: (next: ShareOptions) => void;
  onRemove: (id: string) => void;
  onAddMore: () => void;
}>) {
  const [open, setOpen] = useState(false);

  // The quality row is only worth drawing while there is a copy to choose:
  // a batch of PDFs has nothing to compress, and a photo that came out no
  // smaller has nothing to offer either.
  const photos = attachments.filter((file) => file.compressed !== undefined);
  const compressing = photos.some((file) => file.compressed === "pending");
  const qualityRow = photos.some((file) => file.compressed === "pending" || !!file.compressed);
  // Visibility and expiry are always drawn, even on a server that can only
  // do one thing - a row that vanishes the moment it would say "no" reads as
  // a bug the first time someone goes looking for the option. Locked, each
  // collapses to the one choice that is real and says why the rest are not.
  const visibilityLocked = !canSharePublic;
  const expiryLocked = !canExpire;

  // Scoped to the photos, not the whole batch: a video or a PDF sent
  // alongside them does not shrink, and folding its bytes into both figures
  // would bury whatever the toggle actually buys - two totals a few hundred
  // KB apart, both rounding to the same "5.7 MiB" next to a 5.4 MiB video.
  const fullBytes = totalBytes(photos, false);
  const compressedBytes = totalBytes(photos, true);
  const here = target.startsWith("@") ? "This conversation" : "This channel";
  // The channel or person's name alone, for a note that says who "here" is
  // rather than the chip's own generic label.
  const audience = target.replace(/^[#@]/, "");
  const visibilityLabel = { session: here, public: "Anyone with link", password: "Password" }[options.mode];
  const qualityLabel = options.quality === "compressed" ? "Compressed" : "Full quality";
  const summary = [qualityRow ? qualityLabel : null, visibilityLabel].filter(Boolean).join(" · ");

  return (
    <>
      <Stack direction="row" alignItems="flex-start" gap="12px" sx={{ px: "4px", py: "6px" }}>
        <Stack direction="row" alignItems="center" gap="8px" sx={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          {attachments.map((file) => (
            <AttachmentTile key={file.id} file={file} onRemove={() => onRemove(file.id)} />
          ))}
          <Tooltip title="Add another file">
            <Box
              component="button"
              type="button"
              aria-label="Add another file"
              disabled={disabled}
              onClick={onAddMore}
              sx={(theme) => ({
                all: "unset",
                cursor: "pointer",
                flex: "none",
                boxSizing: "border-box",
                width: 44,
                height: TILE_PX,
                display: "grid",
                placeItems: "center",
                borderRadius: radius("md"),
                border: `1px dashed ${theme.palette.nebula.line2}`,
                color: theme.palette.nebula.dim,
                "&:hover": {
                  borderColor: theme.palette.nebula.accentLine,
                  color: theme.palette.nebula.accent,
                },
              })}
            >
              <PlusIcon width={14} height={14} />
            </Box>
          </Tooltip>
        </Stack>

        <Stack alignItems="flex-end" gap="3px" sx={{ flex: "none", pt: "2px" }}>
          <Stack
            component="button"
            direction="row"
            alignItems="center"
            gap="5px"
            aria-expanded={open}
            aria-label="Sending options"
            onClick={() => setOpen((was) => !was)}
            sx={(theme) => ({
              // `all: unset` lands after the `Stack` shim's own `direction`/
              // `alignItems`/`gap` entry in the merged sx array, so it wins
              // and resets the row back to inline - restated below rather
              // than left to the props, which is what actually broke it.
              all: "unset",
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "5px",
              cursor: "pointer",
              boxSizing: "border-box",
              padding: "4px 9px",
              borderRadius: radius("md"),
              fontSize: 10.5,
              fontWeight: 600,
              color: theme.palette.nebula.muted,
              background: theme.palette.nebula.card2,
              border: `1px solid ${theme.palette.nebula.line}`,
              "&:hover": {
                background: theme.palette.nebula.hover,
                color: theme.palette.nebula.text,
                borderColor: theme.palette.nebula.line2,
              },
            })}
          >
            Options
            <Box
              aria-hidden
              sx={{
                display: "flex",
                transition: "transform .14s ease",
                transform: open ? "rotate(180deg)" : "none",
              }}
            >
              <ChevronDownIcon width={9} height={9} strokeWidth={2.2} />
            </Box>
          </Stack>
          <Typography
            sx={(theme) => ({
              fontSize: 10,
              whiteSpace: "nowrap",
              pr: "2px",
              color: theme.palette.nebula.dim,
            })}
          >
            {summary}
          </Typography>
        </Stack>
      </Stack>

      {open && (
        <>
          {qualityRow && (
            <OptionRow label="Sending as" note={QUALITY_NOTES[options.quality]} first>
              <Chip
                selected={options.quality === "compressed"}
                onClick={() => onOptionsChange({ ...options, quality: "compressed" })}
                icon={<ShrinkGlyph />}
                detail={compressing ? "…" : formatBytes(compressedBytes)}
              >
                Compressed
              </Chip>
              <Chip
                selected={options.quality === "full"}
                onClick={() => onOptionsChange({ ...options, quality: "full" })}
                icon={<ExpandGlyph />}
                detail={formatBytes(fullBytes)}
              >
                Full quality
              </Chip>
            </OptionRow>
          )}

          {/* Locked collapses to the one real choice rather than three grey
              chips: a row of disabled buttons invites clicking to see what
              happens, and nothing does. */}
          <OptionRow
            label="Visible to"
            note={
              visibilityLocked ? "Only option on this server" : visibilityNote(options.mode, audience, here)
            }
            first={!qualityRow}
          >
            <Chip
              selected={visibilityLocked || options.mode === "session"}
              onClick={() => onOptionsChange({ ...options, mode: "session" })}
              icon={<UsersGroupIcon width={12} height={12} />}
            >
              {here}
            </Chip>
            {!visibilityLocked && (
              <>
                <Chip
                  selected={options.mode === "public"}
                  onClick={() => onOptionsChange({ ...options, mode: "public" })}
                  icon={<Link2Icon width={12} height={12} />}
                >
                  Anyone with link
                </Chip>
                <Chip
                  selected={options.mode === "password"}
                  onClick={() => onOptionsChange({ ...options, mode: "password" })}
                  icon={<LockIcon width={12} height={12} />}
                >
                  Password
                </Chip>
              </>
            )}
          </OptionRow>
          {!visibilityLocked && options.mode === "password" && (
            <Stack direction="row" alignItems="center" gap="8px" sx={{ px: "4px", pt: "2px", pb: "6px" }}>
              <InputBase
                autoFocus
                value={options.password}
                onChange={(event) => onOptionsChange({ ...options, password: event.target.value })}
                placeholder="Password for the link"
                inputProps={{ "aria-label": "Password for the link" }}
                sx={(theme) => ({
                  flex: 1,
                  minWidth: 0,
                  height: 30,
                  px: "10px",
                  borderRadius: "9px",
                  background: theme.palette.nebula.card2,
                  border: `1px solid ${theme.palette.nebula.accentLine}`,
                  fontFamily: NEBULA_MONO,
                  fontSize: 12,
                  letterSpacing: "0.14em",
                  "& .MuiInputBase-input": { padding: 0 },
                  "& .MuiInputBase-input::placeholder": { letterSpacing: 0 },
                })}
              />
              <Box
                component="button"
                type="button"
                onClick={() => onOptionsChange({ ...options, password: generatePassword() })}
                sx={(theme) => ({
                  all: "unset",
                  cursor: "pointer",
                  flex: "none",
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: theme.palette.nebula.accent,
                  "&:hover": { textDecoration: "underline" },
                })}
              >
                Generate
              </Box>
            </Stack>
          )}

          <OptionRow
            label="Expires"
            note={expiryLocked ? "Not supported here" : expiryNote(options.ttlSeconds)}
            first={false}
          >
            <Chip
              selected={expiryLocked || options.ttlSeconds === TTL_NEVER}
              onClick={() => onOptionsChange({ ...options, ttlSeconds: TTL_NEVER })}
            >
              Never
            </Chip>
            {!expiryLocked && (
              <>
                <Chip
                  selected={options.ttlSeconds === TTL_24_HOURS}
                  onClick={() => onOptionsChange({ ...options, ttlSeconds: TTL_24_HOURS })}
                >
                  24 hours
                </Chip>
                <Chip
                  selected={options.ttlSeconds === TTL_7_DAYS}
                  onClick={() => onOptionsChange({ ...options, ttlSeconds: TTL_7_DAYS })}
                >
                  7 days
                </Chip>
              </>
            )}
          </OptionRow>
        </>
      )}
    </>
  );
}

const QUALITY_NOTES: Record<AttachmentQuality, string> = {
  compressed: "Photos fit inside 2048 px",
  full: "Sent exactly as they are",
};

function visibilityNote(mode: FileAccessMode, audience: string, here: string): string {
  if (mode === "public") return "Public URL, no sign-in";
  if (mode === "password") return "Password unlocks the link";
  return here === "This channel" ? `Members of #${audience} only` : "Just the two of you";
}

/** What the "Expires" chip row says about the choice, once it can be honoured. */
function expiryNote(ttlSeconds: number): string {
  if (ttlSeconds === TTL_NEVER) return "Never expires";
  const at = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.now() + ttlSeconds * 1000));
  return `Expires ${at}`;
}

/**
 * The photos' size, as they would go up under one quality or the other.
 *
 * Takes the photos alone, never the whole batch: a file this toggle cannot
 * touch has nothing to say about which quality is picked.
 */
function totalBytes(photos: readonly StagedAttachment[], compressed: boolean): number {
  let total = 0;
  for (const file of photos) {
    const copy = compressed && file.compressed && file.compressed !== "pending" ? file.compressed : null;
    total += copy?.sizeBytes ?? file.sizeBytes ?? 0;
  }
  return total;
}

/** Twelve characters nobody has to think up, from the browser's own entropy. */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/** One line of the folded-out options: a label, its chips, and a note about the choice. */
function OptionRow({
  label,
  note,
  first,
  children,
}: Readonly<{ label: string; note: string; first: boolean; children: React.ReactNode }>) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap="10px"
      sx={(theme) => ({
        px: "4px",
        pt: first ? "7px" : "6px",
        pb: "4px",
        mt: first ? "2px" : 0,
        borderTop: first ? `1px solid ${theme.palette.nebula.line}` : "none",
      })}
    >
      <Typography
        sx={(theme) => ({ flex: "none", fontSize: 11, fontWeight: 600, color: theme.palette.nebula.muted })}
      >
        {label}
      </Typography>
      <Stack direction="row" gap="6px" sx={{ flexWrap: "wrap", minWidth: 0 }}>
        {children}
      </Stack>
      <Typography
        sx={(theme) => ({
          ml: "auto",
          flex: "none",
          fontSize: 10.5,
          textAlign: "right",
          whiteSpace: "nowrap",
          color: theme.palette.nebula.dim,
        })}
      >
        {note}
      </Typography>
    </Stack>
  );
}

/** A choice on an option row: lit in accent while it is the one taken. */
function Chip({
  selected,
  onClick,
  icon,
  detail,
  children,
}: Readonly<{
  selected: boolean;
  onClick: () => void;
  /** Absent for a row whose choices don't each have their own glyph, e.g. expiry. */
  icon?: React.ReactNode;
  /** A figure beside the label, e.g. the size the batch would be. */
  detail?: string;
  children: React.ReactNode;
}>) {
  return (
    <Stack
      component="button"
      direction="row"
      alignItems="center"
      gap="5px"
      aria-pressed={selected}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        // Same reset-then-restate as the "Options" toggle above - without
        // this the icon, label and detail stack into one unreadable line.
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "5px",
        cursor: "pointer",
        boxSizing: "border-box",
        padding: "4px 9px",
        borderRadius: radius("md"),
        fontSize: 10.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: selected ? theme.palette.nebula.accentSoft : theme.palette.nebula.card2,
        border: `1px solid ${selected ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
        color: selected ? theme.palette.nebula.text : theme.palette.nebula.muted,
        "&:hover": { background: selected ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover },
      })}
    >
      {icon && (
        <Box aria-hidden sx={{ display: "flex", flex: "none" }}>
          {icon}
        </Box>
      )}
      {children}
      {detail && (
        <Box component="span" sx={{ fontWeight: 500, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
          {detail}
        </Box>
      )}
    </Stack>
  );
}

/** The two quality glyphs, as the canvas draws them: arrows in, arrows out. */
function ShrinkGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 2.5h2.5V5M5 11.5H2.5V9M11.5 2.5L8 6M2.5 11.5L6 8" />
    </svg>
  );
}

function ExpandGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 2.5H2.5V5M9 11.5h2.5V9M2.5 2.5L6 6M11.5 11.5L8 8" />
    </svg>
  );
}

/**
 * One staged file, drawn as what it is.
 *
 * An image is its own label, so it gets the square and nothing else. Anything
 * without a picture gets the opposite treatment - a type badge, the name and
 * the size - because for those, three facts *are* the file.
 */
function AttachmentTile({ file, onRemove }: Readonly<{ file: StagedAttachment; onRemove: () => void }>) {
  const remove = `Remove ${file.filename}`;

  if (file.previewUrl) {
    return (
      <Box
        sx={(theme) => ({
          position: "relative",
          flex: "none",
          width: TILE_PX,
          height: TILE_PX,
          borderRadius: radius("md"),
          overflow: "hidden",
          border: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        <Box
          component="img"
          src={file.previewUrl}
          alt={file.filename}
          sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <TileClose label={remove} onClick={onRemove} />
      </Box>
    );
  }

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap="9px"
      sx={(theme) => ({
        position: "relative",
        flex: "none",
        boxSizing: "border-box",
        height: TILE_PX,
        pl: "8px",
        // Room for the disc on the corner, so a long name never runs under it.
        pr: "30px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card2,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Box
        aria-hidden
        sx={(theme) => ({
          width: 34,
          height: 38,
          flex: "none",
          display: "grid",
          placeItems: "center",
          borderRadius: radius("sm"),
          background: theme.palette.nebula.panel,
          border: `1px solid ${theme.palette.nebula.line2}`,
          fontFamily: NEBULA_MONO,
          fontSize: 8.5,
          fontWeight: 600,
          color: theme.palette.nebula.muted,
        })}
      >
        {extension(file.filename)}
      </Box>
      <Stack sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: 11.5,
            fontWeight: 500,
            maxWidth: 130,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {file.filename}
        </Typography>
        {file.sizeBytes !== undefined && (
          <Typography sx={(theme) => ({ fontSize: 10, mt: "1px", color: theme.palette.nebula.dim })}>
            {formatBytes(file.sizeBytes)}
          </Typography>
        )}
      </Stack>
      <TileClose label={remove} onClick={onRemove} />
    </Stack>
  );
}

/**
 * The cross that sits *on* a tile rather than beside it.
 *
 * A staged file is a picture, and a picture has no margin to put a button in -
 * so this one is a disc on the corner, dark enough to stay a cross over
 * whatever the photograph happens to be doing underneath it.
 */
function TileClose({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onClick={onClick}
      sx={{
        all: "unset",
        cursor: "pointer",
        position: "absolute",
        right: "4px",
        top: "4px",
        width: TILE_CLOSE_PX,
        height: TILE_CLOSE_PX,
        display: "grid",
        placeItems: "center",
        borderRadius: "50%",
        background: "rgba(8,11,18,.78)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        color: "#dfe4ec",
        "&:hover": { background: "rgba(8,11,18,.92)", color: "#ffffff" },
      }}
    >
      <CloseIcon width={9} height={9} />
    </Box>
  );
}

/** The file's kind, for a tray's type badge. */
export function extension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1
    ? "FILE"
    : filename
        .slice(dot + 1)
        .toUpperCase()
        .slice(0, 4);
}
