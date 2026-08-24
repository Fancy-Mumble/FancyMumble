import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useResolvedBackgroundSource, useStoredBackgroundUrl } from "@core/features/settings/chatBackground";
import {
  loadPersonalization,
  PERSONALIZATION_CHANGED_EVENT,
  type PersonalizationData,
} from "@standard/personalizationStorage";

/** Matches the OS "reduce motion" setting, and follows it if it changes. */
function usePrefersReducedMotion(): boolean {
  const query = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);

  useEffect(() => {
    const media = query();
    if (!media) return;
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/**
 * The wallpaper behind the conversation.
 *
 * The mock layers a blurred image under the message river and washes it out
 * with the window colour, which is also what gives the channel header and the
 * composer something to blur - `backdrop-filter` over a flat fill is invisible.
 * The image and its blur/opacity/dim are the user's existing chat-background
 * personalization, so Nebula renders the same picture Standard does, just as a
 * full-column backdrop instead of a tiled panel.
 *
 * A wallpaper may also be a clip. When the backend's bake of the current
 * blur/dim values exists, that file plays with no CSS filter at all - the
 * pixels already carry the look, and the compositor stops re-blurring every
 * frame. While a bake is missing or stale (a slider just moved), the raw clip
 * plays under a live CSS filter instead, so the look is always current even
 * when the optimized file is still being rendered. The poster still stands in
 * wherever the clip cannot play: while it buffers, when the reader asked for
 * less motion, and on a webview whose decoders cannot open it.
 */
export function ChatBackdrop() {
  const [personalization, setPersonalization] = useState<PersonalizationData | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      void loadPersonalization()
        .then((data) => {
          if (active) setPersonalization(data);
        })
        .catch(() => undefined);
    load();
    // Saving announces itself, so the backdrop follows the sliders live rather
    // than waiting for a remount.
    globalThis.addEventListener(PERSONALIZATION_CHANGED_EVENT, load);
    return () => {
      active = false;
      globalThis.removeEventListener(PERSONALIZATION_CHANGED_EVENT, load);
    };
  }, []);

  const sigma = personalization?.chatBgBlurSigma ?? 0;
  const dim = personalization?.chatBgDim ?? 0;

  // The bake is only trustworthy while its parameters match the live sliders;
  // a stale bake would show yesterday's blur.
  const videoName = personalization?.chatBgVideo ?? null;
  const bakedValid =
    videoName !== null &&
    personalization?.chatBgVideoBaked != null &&
    personalization.chatBgVideoBakedSigma === sigma &&
    personalization.chatBgVideoBakedDim === dim;
  const playName = bakedValid ? (personalization?.chatBgVideoBaked ?? null) : videoName;
  const videoSrc = useStoredBackgroundUrl(playName);

  // The still: for a clip, `chatBgBlurred` is the poster processed alongside
  // the bake, so it is exactly as current as the bake is. For a plain image,
  // a processed still (Standard bakes one) renders unfiltered; otherwise the
  // original takes the live CSS filter.
  const blurredRef = personalization?.chatBgBlurred ?? null;
  const originalRef = personalization?.chatBgOriginal ?? null;
  const stillProcessed = videoName ? bakedValid && blurredRef !== null : blurredRef !== null;
  const image = useResolvedBackgroundSource(stillProcessed ? blurredRef : originalRef);

  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => setVideoFailed(false), [videoSrc]);

  const reducedMotion = usePrefersReducedMotion();
  const playing = videoSrc !== null && !videoFailed && !reducedMotion;

  // Whether the displayed media still needs the live CSS filter, or already
  // carries the look in its pixels.
  const filtered = playing ? !bakedValid : !stillProcessed;

  // A looping wallpaper decoding behind a window nobody is looking at is pure
  // heat. The element keeps its buffered frames, so coming back is instant.
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!playing) return;
    const sync = () => {
      const node = videoRef.current;
      if (!node) return;
      if (document.hidden) node.pause();
      else void node.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [playing, videoSrc]);

  // Rounded because the slider hands over floats: `1 - 0.7` prints as
  // `0.30000000000000004`, which is valid CSS but re-keys emotion's cache on
  // every pass and reads as a bug in devtools.
  const brightness = Number((1 - dim).toFixed(3));
  const media = {
    width: "100%",
    height: "100%",
    objectFit: personalization?.chatBgFit === "tile" ? "none" : "cover",
    // The dim darkens the picture, not the conversation: painting it over the
    // whole column would take the wash, the message text and the chrome down
    // with it. Once the look is baked into the pixels only the saturation
    // nudge remains, and the compositor has nothing to recompute per frame.
    filter: filtered ? `blur(${sigma}px) saturate(1.05) brightness(${brightness})` : "saturate(1.05)",
    transform: "scale(1.08)",
    display: "block",
  } as const;

  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: "absolute",
        inset: 0,
        zIndex: -1,
        overflow: "hidden",
        // Nebula's own wash, under whatever the user set. Without it the chrome
        // above has a flat fill to blur, which renders as a solid band rather
        // than glass - the mock never shows this column without a picture
        // behind it.
        background: theme.palette.nebula.backdrop,
      })}
    >
      {playing ? (
        <Box
          component="video"
          ref={videoRef}
          src={videoSrc}
          // The poster covers the moment before the first frame is decoded,
          // so a wallpaper never flashes the bare wash on the way in.
          poster={image ?? undefined}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          // A clip this webview turns out not to decode - H.264 on a
          // WebKitGTK build without the proprietary GStreamer plugins - drops
          // back to the poster rather than leaving the column empty.
          onError={() => setVideoFailed(true)}
          sx={media}
        />
      ) : (
        image && <Box component="img" src={image} alt="" sx={media} />
      )}
      {/* The window colour over the top: without it the picture competes with
          the text, and with it the blurred edges stay readable. */}
      <Box
        sx={(theme) => ({
          position: "absolute",
          inset: 0,
          background: theme.palette.nebula.bg0,
          opacity: image || playing ? 1 - (personalization?.chatBgOpacity ?? 0.25) : 0,
        })}
      />
    </Box>
  );
}
