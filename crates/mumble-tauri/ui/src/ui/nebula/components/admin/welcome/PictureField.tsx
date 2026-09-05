/**
 * Choosing a picture for a block, and making it fit without being asked to.
 *
 * The operator picks a file. What lands in the design is that file cropped to
 * the shape of the block, scaled to the size it will be seen at, and encoded as
 * far down as it has to go to fit the room left - with the result stated in
 * kilobytes, because that room is real and is paid on every join.
 */
import { useCallback, useRef, useState } from "react";
import { Box } from "@mui/material";
import { radius } from "../../../tokens";
import { Stack } from "../../primitives";
import { searchFit, roomFor, type Crop, type Fitted } from "./pictures";
import type { Block, DesignAsset } from "./design";

/** What the chooser hands back, ready to become an asset. */
export interface Picked extends Fitted {
  readonly id: string;
}

/**
 * Decode a file and shrink it until it fits.
 *
 * `createImageBitmap` rather than an `<img>` and a load event: it decodes off
 * the main thread and takes the file directly, so a four-megabyte wallpaper
 * never becomes a five-megabyte data URI on the way in just to be measured.
 */
async function fit(file: Blob, box: { w: number; h: number }, budget: number): Promise<Fitted | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const encode = (crop: Crop, size: { w: number; h: number }, format: string, quality: number) => {
      canvas.width = size.w;
      canvas.height = size.h;
      const context = canvas.getContext("2d");
      if (context === null) return "";
      // Cleared each time: the canvas is reused across every step of the
      // search, and a smaller step drawn over a larger previous one would
      // encode the leftovers around its edges.
      context.clearRect(0, 0, size.w, size.h);
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.w, size.h);
      const url = canvas.toDataURL(format, quality);
      // An engine that cannot write the format hands back a PNG instead, which
      // is not what was asked for and is always bigger - so it is skipped
      // rather than accepted as though it were the answer.
      return url.startsWith(`data:${format}`) ? url : "";
    };
    return searchFit({ w: bitmap.width, h: bitmap.height }, box, budget, encode);
  } finally {
    bitmap.close();
  }
}

const KB = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} kB`;

export function PictureField({
  block,
  assets,
  onPick,
  onClear,
  behind = false,
}: Readonly<{
  block: Block;
  assets: readonly DesignAsset[] | undefined;
  onPick: (picked: Picked) => void;
  onClear: () => void;
  /** Whether this stands for the picture *behind* the block rather than in it. */
  behind?: boolean;
}>) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = assets?.find((asset) => asset.id === (behind ? block.bgAsset : block.asset));
  // What this block may spend: everything not already spent, and never more
  // than one picture is allowed on its own. Replacing a picture gets its own
  // bytes back, or changing a photograph would cost twice.
  const room = roomFor(assets, current?.bytes ?? 0);

  const take = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      setProblem(null);
      try {
        const box = { w: Math.max(16, block.w), h: Math.max(16, block.h ?? Math.round(block.w * 0.6)) };
        const picked = await fit(file, box, room);
        if (picked === null) {
          setProblem(`No room: ${KB(room)} left, and this will not go under it.`);
          return;
        }
        onPick({ ...picked, id: current?.id ?? `a${Date.now().toString(36)}` });
      } catch {
        setProblem("That file is not a picture this can read.");
      } finally {
        setBusy(false);
      }
    },
    [block.w, block.h, room, onPick, current],
  );

  return (
    <Stack gap={0.75}>
      <Box
        onDragOver={(event: React.DragEvent) => event.preventDefault()}
        onDrop={(event: React.DragEvent) => {
          event.preventDefault();
          void take(event.dataTransfer.files[0]);
        }}
        onClick={() => input.current?.click()}
        sx={(theme) => ({
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          minHeight: 84,
          p: "8px",
          borderRadius: radius("sm"),
          border: `1px dashed ${theme.palette.nebula.line2}`,
          background: theme.palette.nebula.bg0,
          "&:hover": { borderColor: theme.palette.nebula.accent },
        })}
      >
        {current ? (
          <Box
            component="img"
            src={current.src}
            alt=""
            sx={{ maxWidth: "100%", maxHeight: 120, borderRadius: radius("sm"), display: "block" }}
          />
        ) : (
          <Box sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
            {busy ? "Fitting…" : "Drop a picture, or click to choose"}
          </Box>
        )}
      </Box>
      <Box
        component="input"
        ref={input}
        type="file"
        accept="image/*"
        sx={{ display: "none" }}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => void take(event.target.files?.[0])}
      />
      <Stack direction="row" gap={0.75} sx={{ alignItems: "center" }}>
        <Box sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim, flex: 1 })}>
          {problem ??
            (current
              ? `${KB(current.bytes)} · ${current.w}×${current.h} · ${KB(room)} left`
              : `${KB(room)} of room · sent to Fancy clients only`)}
        </Box>
        {current && (
          <Box
            component="button"
            type="button"
            onClick={onClear}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              fontSize: 10.5,
              color: theme.palette.nebula.dim,
              "&:hover": { color: theme.palette.nebula.accent },
            })}
          >
            Remove
          </Box>
        )}
      </Stack>
    </Stack>
  );
}
