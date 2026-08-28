import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useResolvedBackgroundSource, useStoredBackgroundUrl } from "@core/features/settings/chatBackground";
import {
  loadPersonalization,
  PERSONALIZATION_CHANGED_EVENT,
  type PersonalizationData,
} from "@standard/personalizationStorage";

/** How often the watchdog samples the clip's position. */
const WATCHDOG_INTERVAL_MS = 1000;
/** Samples without progress before the clip is restarted. */
const WATCHDOG_STUCK_TICKS = 2;

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
  //
  // The rest keeps the clip going where `loop` alone did not. The attribute
  // is honoured, yet the wallpaper has been seen frozen on its still after one
  // pass, and a wallpaper that ran once is worse than none. So the element is
  // restarted on `ended` (which `loop` should make unreachable), and a
  // watchdog restarts it when it has stopped advancing while claiming to
  // play - the stop the engine never announces, which no event can catch.
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = videoRef.current;
    if (!playing || !node) return;
    const resume = () => void node.play().catch(() => undefined);
    const restart = () => {
      node.currentTime = 0;
      resume();
    };
    const sync = () => (document.hidden ? node.pause() : resume());

    let lastTime = -1;
    let stuckTicks = 0;
    const watchdog = setInterval(() => {
      // Not moving for a reason: hidden, mid-seek, or still buffering.
      if (document.hidden || node.seeking || node.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        stuckTicks = 0;
        return;
      }
      const advanced = node.currentTime !== lastTime;
      lastTime = node.currentTime;
      if (advanced) {
        stuckTicks = 0;
        return;
      }
      if (++stuckTicks < WATCHDOG_STUCK_TICKS) return;
      stuckTicks = 0;
      restart();
    }, WATCHDOG_INTERVAL_MS);

    node.addEventListener("ended", restart);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(watchdog);
      node.removeEventListener("ended", restart);
      document.removeEventListener("visibilitychange", sync);
    };
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
          //
          // Only an `error` that carries a MediaError is that failure. The
          // poster's image loader dispatches its own `error` on this very
          // element, with `error` still null; treating that as a dead clip is
          // what left the wallpaper stuck on its still.
          onError={(event) => {
            if (event.currentTarget.error) setVideoFailed(true);
          }}
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
