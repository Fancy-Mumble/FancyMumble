import { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { useResolvedBackgroundSource, useStoredBackgroundUrl } from "@core/features/settings/chatBackground";
import {
  loadPersonalization,
  PERSONALIZATION_CHANGED_EVENT,
  type PersonalizationData,
} from "@standard/personalizationStorage";
import { useBakedStill } from "./stillBake";
import { alpha, useTheme } from "@mui/material/styles";
import { useMemo } from "react";
import { useAppStore } from "@core/store";

/** How often the watchdog samples the clip's position. */
const WATCHDOG_INTERVAL_MS = 1000;
/** Samples without progress before the clip is restarted. */
const WATCHDOG_STUCK_TICKS = 2;
/** Samples inside one seek before the element is loaded again. */
const WATCHDOG_STUCK_SEEK_TICKS = 3;
/**
 * Reloads one source may cost before the poster takes over for good.
 *
 * A clip this webview simply cannot decode reports that immediately, so the
 * budget is spent in a moment and costs nothing; a clip that failed once and
 * plays on the second attempt is worth those attempts.
 */
const MAX_RELOADS = 3;
/**
 * How long the window may sit unfocused before the wallpaper stops.
 *
 * Not immediate, because the client is often visible on a second screen while
 * the reader works elsewhere, and a wallpaper that freezes the instant it
 * loses focus reads as a stall. Long enough that an alt-tab and back never
 * shows a stopped clip, short enough that a window left in the background
 * stops costing anything.
 */
export const BLUR_GRACE_MS = 5000;

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
  const stencil = useTheme().palette.nebulaSkin.chrome === "stencil";
  // The name of the conversation on screen, broken onto two lines the way a
  // poster would set it.
  //
  // `selectedChannel`, not `currentChannel`: the first is the room being read,
  // the second the room being spoken in, and they part company the moment you
  // browse anywhere while staying in voice. The header, the empty state and the
  // composer all name the room being read, so a backdrop naming the other one
  // is not a second opinion - it is the wrong caption on the page. A DM has no
  // channel at all, and takes the name of whoever is on the other end.
  const channelName = useAppStore((state) => {
    if (state.selectedDmUser !== null) {
      return state.users.find((user) => user.session === state.selectedDmUser)?.name ?? "";
    }
    return state.channels.find((channel) => channel.id === state.selectedChannel)?.name ?? "";
  });
  const wordmark = useMemo(() => {
    const words = channelName.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "";
    const half = Math.ceil(words.length / 2);
    return [words.slice(0, half).join(" "), words.slice(half).join(" ")].filter(Boolean).join("\n").toUpperCase();
  }, [channelName]);

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

  // A still being blurred live is baked here, once, and the record then names
  // the processed file - see `stillBake.ts` for why the compositor should not
  // be doing this work on every paint.
  useBakedStill(personalization);

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
  // Reloads already spent on the current source.
  const reloads = useRef(0);
  useEffect(() => {
    reloads.current = 0;
    setVideoFailed(false);
  }, [videoSrc]);

  // Start the whole pipeline over, and give up on the clip once the budget is
  // spent. Used for both ways a clip dies mid-life - a decode error, and a
  // seek that never completes - because neither leaves anything behind worth
  // resuming; only a fresh load gets the frames moving again.
  const recover = useCallback((node: HTMLVideoElement) => {
    if (reloads.current >= MAX_RELOADS) {
      setVideoFailed(true);
      return;
    }
    reloads.current += 1;
    node.load();
    void node.play().catch(() => undefined);
  }, []);

  const reducedMotion = usePrefersReducedMotion();
  const playing = videoSrc !== null && !videoFailed && !reducedMotion;

  // Whether the displayed media still needs the live CSS filter, or already
  // carries the look in its pixels.
  const filtered = playing ? !bakedValid : !stillProcessed;

  // A looping wallpaper decoding behind a window nobody is looking at is pure
  // heat. The element keeps its buffered frames, so coming back is instant.
  //
  // Measured on WebKitGTK 2.52 with accelerated compositing off - which is how
  // this app runs on Linux - a full-column clip costs most of a CPU core for
  // as long as it is on screen, and the bill is paid per painted frame whether
  // or not anyone is looking. So it is parked whenever the window is hidden,
  // and again when the window has been unfocused for `BLUR_GRACE_MS`.
  //
  // The rest keeps the clip going where `loop` alone did not. The attribute
  // is honoured, yet the wallpaper has been seen frozen on its still after one
  // pass, and a wallpaper that ran once is worse than none. So the element is
  // restarted on `ended` (which `loop` should make unreachable), and a
  // watchdog restarts it when it has stopped advancing while claiming to
  // play - the stop the engine never announces, which no event can catch.
  //
  // A seek that never lands is the other half of that: the wrap-around at the
  // end of a pass can fail outright, and the element then sits in `seeking` on
  // its last frame with no event to follow. Seeking again would only ask the
  // same wedged pipeline for another position, so the watchdog loads the
  // element instead - see `recover`.
  //
  // And a park has to be as easy to leave as it was to enter. This webview
  // reports `document.hasFocus()` false while the reader is plainly working in
  // the window, so anything that checks it before resuming can strand the
  // wallpaper on one frame for the rest of the session - which is what it did.
  // Three ways out, then: the focus event on its own word, the watchdog when
  // the window is demonstrably back, and any pointer or key over the page.
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = videoRef.current;
    if (!playing || !node) return;
    const resume = () => void node.play().catch(() => undefined);
    const restart = () => {
      node.currentTime = 0;
      resume();
    };

    // Parking is deliberate, so the watchdog must not read the frozen
    // position as the stall it exists to repair - it would restart the very
    // clip that was just stopped, and from the top. Tracked as our own intent
    // rather than read off `node.paused`, which says nothing about who
    // stopped the clip or why.
    let parked = false;
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelPark = () => {
      if (blurTimer === undefined) return;
      clearTimeout(blurTimer);
      blurTimer = undefined;
    };
    const park = () => {
      parked = true;
      node.pause();
    };
    // A park lasts exactly as long as its reason, and every path that ends one
    // comes through here.
    const unpark = () => {
      cancelPark();
      parked = false;
      resume();
    };
    const parkAfterGrace = () => {
      cancelPark();
      blurTimer = setTimeout(() => {
        blurTimer = undefined;
        park();
      }, BLUR_GRACE_MS);
    };
    const sync = () => {
      cancelPark();
      if (document.hidden) {
        park();
        return;
      }
      if (document.hasFocus()) {
        unpark();
        return;
      }
      parkAfterGrace();
    };
    // Losing focus is a maybe - the window is usually still on screen - so the
    // clip only stops once the grace has run out. Getting it back is not a
    // maybe: the event itself is the answer. Asking `document.hasFocus()` here
    // as well is what left the wallpaper stopped, because on this webview it
    // can still say false at the moment the window comes forward, and then
    // nothing else was ever going to ask again.
    const onFocus = unpark;
    const onBlur = () => {
      if (document.hidden) {
        cancelPark();
        park();
        return;
      }
      parkAfterGrace();
    };
    // Whatever the window thinks, someone typing or moving a pointer over this
    // page is looking at it. The last word on a park that should have ended
    // and did not - and deliberately without re-arming the grace, because the
    // focus this asks about is the reading we do not trust. The clip runs on
    // until the next `blur`, which does arrive when the window really goes.
    const activity = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    const onActivity = () => {
      if (!parked || document.hidden) return;
      unpark();
    };

    let lastTime = -1;
    let stuckTicks = 0;
    let seekTicks = 0;
    const watchdog = setInterval(() => {
      // Not moving for a reason: parked or hidden.
      if (parked || document.hidden) {
        stuckTicks = 0;
        seekTicks = 0;
        // Unless the reason has gone. A missed focus event used to strand the
        // wallpaper on one frame for the rest of the session, because parking
        // is also what tells this watchdog to keep its hands off.
        if (parked && !document.hidden && document.hasFocus()) unpark();
        return;
      }
      // A seek lands within a frame or two. One that outlives several samples
      // is not a seek any more, it is the clip stuck at the end of a pass.
      if (node.seeking) {
        stuckTicks = 0;
        if (++seekTicks < WATCHDOG_STUCK_SEEK_TICKS) return;
        seekTicks = 0;
        recover(node);
        return;
      }
      seekTicks = 0;
      // Still buffering: nothing to read into a frozen position.
      if (node.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
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
    globalThis.addEventListener("blur", onBlur);
    globalThis.addEventListener("focus", onFocus);
    for (const name of activity) document.addEventListener(name, onActivity, { passive: true });
    sync();
    return () => {
      cancelPark();
      clearInterval(watchdog);
      node.removeEventListener("ended", restart);
      document.removeEventListener("visibilitychange", sync);
      globalThis.removeEventListener("blur", onBlur);
      globalThis.removeEventListener("focus", onFocus);
      for (const name of activity) document.removeEventListener(name, onActivity);
    };
  }, [playing, videoSrc, recover]);

  // Rounded because the slider hands over floats: `1 - 0.7` prints as
  // `0.30000000000000004`, which is valid CSS but re-keys emotion's cache on
  // every pass and reads as a bug in devtools.
  const brightness = Number((1 - dim).toFixed(3));
  const media = {
    width: "100%",
    height: "100%",
    objectFit: personalization?.chatBgFit === "tile" ? "none" : "cover",
    // Where the crop is taken from. `cover` keeps the middle by default,
    // which for a portrait in a column shorter than the picture is the part
    // of a person nobody chose the picture for.
    objectPosition: `${(personalization?.chatBgFocusX ?? 0.5) * 100}% ${
      (personalization?.chatBgFocusY ?? 0.5) * 100
    }%`,
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
      {/* A stencil skin puts the room's name behind the conversation as an
          outlined wordmark, and rings the far corner. Both are drawn, not
          coloured, so no palette can express them - and both sit under the
          wallpaper, which still wins when one is set. */}
      {stencil && (
        <>
          <Box
            aria-hidden
            sx={(theme) => ({
              position: "absolute",
              top: -180,
              right: -220,
              width: 760,
              height: 760,
              borderRadius: "50%",
              border: `3px solid ${theme.palette.nebula.line2}`,
              opacity: 0.5,
            })}
          />
          <Box
            aria-hidden
            sx={(theme) => ({
              position: "absolute",
              right: 60,
              bottom: 110,
              textAlign: "right",
              // The skin's poster voice, not its interface one: this is set at
              // 150px and hollowed to an outline, where a UI sans has nothing
              // to show and reads as unstyled text. Condensed and heavy is the
              // shape the artboard draws, and Saira carries both on its own
              // axes - no second family, and no browser faking either one.
              fontFamily: theme.palette.nebulaSkin.display ?? theme.palette.nebulaSkin.font,
              fontStyle: "italic",
              fontWeight: 800,
              fontStretch: "78%",
              fontSize: 150,
              lineHeight: 0.86,
              letterSpacing: "-.01em",
              color: "transparent",
              WebkitTextStroke: `2px ${theme.palette.nebula.line2}`,
              userSelect: "none",
              whiteSpace: "pre-line",
            })}
          >
            {wordmark}
          </Box>
          {/* The second ring is dashed and sits inside the first: two weights
              of the same arc, which is what keeps the corner from reading as
              one thick circle. */}
          <Box
            aria-hidden
            sx={(theme) => ({
              position: "absolute",
              top: -60,
              right: -100,
              width: 520,
              height: 520,
              borderRadius: "50%",
              border: `3px dashed ${theme.palette.nebula.line2}`,
              opacity: 0.34,
            })}
          />
          {/* The conversation stands on ground rather than floating on a flat
              wash: the canvas deepens toward the bottom and a hatched rule
              runs across it, just above where the composer sits. */}
          <Box
            aria-hidden
            sx={(theme) => ({
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 190,
              background: `linear-gradient(180deg, ${alpha(theme.palette.nebula.tile, 0)}, ${
                theme.palette.nebula.tile
              })`,
            })}
          />
          <Box
            aria-hidden
            sx={(theme) => ({
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 84,
              height: 10,
              background: `repeating-linear-gradient(115deg, ${theme.palette.nebula.line2} 0 12px, transparent 12px 24px)`,
              opacity: 0.7,
            })}
          />
        </>
      )}
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
          //
          // Even a real one is worth a retry first: a clip that has been
          // playing for minutes is plainly decodable, and an error at the
          // wrap-around says the pipeline lost its footing, not that the file
          // is unplayable.
          onError={(event) => {
            if (event.currentTarget.error) recover(event.currentTarget);
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
