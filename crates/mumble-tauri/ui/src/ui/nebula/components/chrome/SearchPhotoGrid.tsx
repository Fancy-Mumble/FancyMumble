import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import type { PhotoEntry } from "@core/types";
import { radius } from "../../tokens";

/** Tiles per row. The arrow keys step a whole row at a time on the vertical. */
export const PHOTO_COLUMNS = 4;

/** Whole rows, so a page never ends on a half-filled one. */
const PAGE_SIZE = PHOTO_COLUMNS * 6;

/**
 * Every picture the session holds, newest first, a page at a time.
 *
 * Restarts from the first page each time `enabled` turns on, so a photo sent
 * while the panel was shut is there the next time it is opened. A page that
 * lands after the grid was left is dropped rather than drawn into the next one.
 */
export function useSearchPhotos(enabled: boolean) {
  const [photos, setPhotos] = useState<readonly PhotoEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const more = useRef(true);
  const offset = useRef(0);

  const load = useCallback(async (issued: number) => {
    if (busy.current || !more.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const page = await invoke<PhotoEntry[]>("get_photos", { offset: offset.current, limit: PAGE_SIZE });
      if (generation.current !== issued) return;
      more.current = page.length >= PAGE_SIZE;
      offset.current += page.length;
      // The same picture pasted twice is one picture here.
      setPhotos((shown) => {
        const seen = new Set(shown.map((photo) => photo.src));
        const fresh: PhotoEntry[] = [];
        for (const photo of page) {
          if (seen.has(photo.src)) continue;
          seen.add(photo.src);
          fresh.push(photo);
        }
        return [...shown, ...fresh];
      });
    } catch {
      if (generation.current === issued) more.current = false;
    } finally {
      if (generation.current === issued) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const issued = ++generation.current;
    setPhotos([]);
    setLoading(false);
    busy.current = false;
    more.current = true;
    offset.current = 0;
    void load(issued);
    return () => {
      generation.current += 1;
    };
  }, [enabled, load]);

  const loadMore = useCallback(() => void load(generation.current), [load]);

  return { photos, loading, loadMore };
}

interface SearchPhotoGridProps {
  photos: readonly PhotoEntry[];
  loading: boolean;
  active: number;
  onActivate: (index: number) => void;
  onOpen: (photo: PhotoEntry) => void;
  onNearEnd: () => void;
}

/** The Photos filter before anything is typed: the pictures themselves. */
export function SearchPhotoGrid({
  photos,
  loading,
  active,
  onActivate,
  onOpen,
  onNearEnd,
}: Readonly<SearchPhotoGridProps>) {
  const { t } = useTranslation("nebulaChrome");
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Re-created after every page: observing fires once straight away, which is
  // what asks for the next page when the last one did not fill the panel.
  // Guarded because a DOM without layout has no observer at all.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) onNearEnd();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onNearEnd, loading, photos.length]);

  return (
    <>
      {photos.length === 0 && !loading && (
        <Typography sx={(theme) => ({ p: "14px", fontSize: 12.5, color: theme.palette.nebula.muted })}>
          {t("search.photosEmpty")}
        </Typography>
      )}
      {photos.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${PHOTO_COLUMNS}, 1fr)`, gap: "6px", p: "2px" }}>
          {photos.map((photo, index) => (
            <PhotoTile
              // Pages only ever append, so a position is a stable key; the
              // source can be a whole picture's worth of base64.
              key={`photo-${index}`}
              photo={photo}
              index={index}
              active={index === active}
              // `place`, not `context`: i18next reads a `context` option as a
              // key variant to look up, not as something to interpolate.
              label={t("search.photoLabel", { sender: photo.sender_name, place: photo.context })}
              onActivate={() => onActivate(index)}
              onOpen={() => onOpen(photo)}
            />
          ))}
        </Box>
      )}
      {loading && (
        <Typography sx={(theme) => ({ p: "10px 14px", fontSize: 11.5, color: theme.palette.nebula.dim })}>
          {t("search.photosLoading")}
        </Typography>
      )}
      <Box ref={sentinelRef} aria-hidden sx={{ height: "1px" }} />
    </>
  );
}

interface PhotoTileProps {
  photo: PhotoEntry;
  index: number;
  active: boolean;
  label: string;
  onActivate: () => void;
  onOpen: () => void;
}

function PhotoTile({ photo, index, active, label, onActivate, onOpen }: Readonly<PhotoTileProps>) {
  return (
    <Box
      component="button"
      type="button"
      data-index={index}
      aria-label={label}
      title={label}
      onClick={onOpen}
      onMouseEnter={onActivate}
      sx={(theme) => ({
        all: "unset",
        boxSizing: "border-box",
        position: "relative",
        display: "block",
        cursor: "pointer",
        aspectRatio: "1",
        overflow: "hidden",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card2,
        // Over the picture rather than around it, so lighting a tile does not
        // nudge the grid.
        "&::after": {
          content: '""',
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          border: `2px solid ${active ? theme.palette.nebula.accent : "transparent"}`,
          pointerEvents: "none",
        },
      })}
    >
      <Box
        component="img"
        src={photo.src}
        alt=""
        loading="lazy"
        decoding="async"
        sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
      />
      {active && (
        <Typography
          component="span"
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            p: "14px 7px 5px",
            fontSize: 10.5,
            fontWeight: 600,
            color: "#fff",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            background: "linear-gradient(transparent, rgba(0,0,0,0.72))",
          }}
        >
          {photo.sender_name}
        </Typography>
      )}
    </Box>
  );
}
