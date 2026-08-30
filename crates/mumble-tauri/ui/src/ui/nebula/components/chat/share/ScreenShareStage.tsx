import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Snackbar, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { isLinux, isMobile } from "@core/utils/platform";
import { presetOf } from "@core/features/chat/stream/streamSettings";
import type { ScreenShareHook } from "@standard/components/chat/stream/useScreenShare";
import { useCaptureExclusion } from "@standard/components/chat/stream/useCaptureExclusion";
import { getTrackContentMap } from "@standard/components/chat/stream/trackContent";
import { activeStreamViewerStrategy } from "@standard/components/chat/stream/viewerStrategy";
import { CameraIcon, FullscreenExitIcon, FullscreenIcon, KebabMenuIcon, WebcamIcon } from "@ui/icons";
import { Stack } from "../../primitives";
import { radius } from "../../../tokens";
import { FEED_BADGE, feedSummary, type StreamFeed } from "./feeds";
import { StreamSurface, usesNativeSurface } from "./StreamSurface";
import { useFeedStats } from "./useFeedStats";
import { copyStreamFrame, type ScreenshotOutcome } from "./streamScreenshot";
import { StageResizeHandle } from "./StageResizeHandle";
import { CONVERSATION_MIN, clampStageHeight, readStageHeight, writeStageHeight } from "./stageHeight";

// Heavy and off screen at rest: the panel pulls in a chart.
const StreamStatsPanel = lazy(() => import("@standard/components/chat/stream/StreamStatsPanel"));

/**
 * How the picture is scaled into the well.
 *
 * `actual` is the one that changes the layout rather than just the element: at
 * 1:1 the well scrolls, because that is the whole point of asking for the
 * broadcaster's real pixels on a screen smaller than theirs.
 */
type FitMode = "fit" | "fill" | "actual";

const FIT_LABEL: Record<FitMode, string> = { fit: "Fit", fill: "Fill", actual: "1:1" };

/**
 * The chrome over the picture is drawn in fixed dark colours in both themes.
 *
 * Everything else in Nebula follows the user's scheme; these controls sit on an
 * arbitrary video frame, where a light panel is a bright hole in someone's
 * game. The well behind them is likewise always near-black.
 */
const WELL_BG = "#05070c";
const GLASS_BG = "rgba(12,16,24,.55)";
const GLASS_BG_HOVER = "rgba(20,26,38,.8)";
const GLASS_LINE = "1px solid rgba(255,255,255,.09)";
const GLASS_BLUR = "blur(10px)";
const OVERLAY_TEXT = "#cfd5e0";

/** Filmstrip width, and the tile height inside it. */
const RAIL_WIDTH = 116;
const RAIL_WIDTH_EXPANDED = 156;
const TILE_HEIGHT = 68;

const SCREENSHOT_MESSAGE: Record<ScreenshotOutcome, string> = {
  copied: "Frame copied to the clipboard",
  unsupported: "This webview cannot put images on the clipboard",
  failed: "Could not capture that frame",
};

export interface ScreenShareStageProps {
  /** Every live feed in the channel, own broadcast first. Never empty - the
   *  caller only mounts the stage while something is live. */
  readonly feeds: readonly StreamFeed[];
  readonly share: ScreenShareHook;
  /** Opens the encoder-settings dialog the strip owns. */
  readonly onOpenQuality: () => void;
}

/**
 * The share stage: one feed large, every feed in a filmstrip beside it.
 *
 * The v2 mock replaced the equal-tiles grid with this, and the difference is
 * not decorative. An equal grid says every share matters the same, which stops
 * being true the moment two people share and one of them is the thing being
 * discussed. Here one feed is the subject and the rest stay visible enough to
 * switch to, with the conversation still running underneath.
 */
export function ScreenShareStage({ feeds, share, onOpenQuality }: Readonly<ScreenShareStageProps>) {
  const ownSession = useAppStore((state) => state.ownSession);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const currentChannel = useAppStore((state) => state.currentChannel);
  const capture = useCaptureExclusion();

  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<FitMode>("fit");
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [shot, setShot] = useState<ScreenshotOutcome | null>(null);
  // The split between picture and conversation, the user's to set; see
  // stageHeight.ts for why it is remembered per device.
  const [stageHeight, setStageHeight] = useState(readStageHeight);
  // What the handle last applied, ahead of the render that shows it: the
  // release that ends a drag can land before that render does.
  const latestStageHeight = useRef(stageHeight);
  useEffect(() => {
    latestStageHeight.current = stageHeight;
  }, [stageHeight]);

  const wrapper = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement | HTMLCanvasElement | null>(null);

  const focused = feeds.find((feed) => feed.key === focusKey) ?? feeds[0]!;
  const stats = useFeedStats(focused.session, focused.slot);
  const keys = feeds.map((feed) => feed.key).join("|");

  // A share of our own is what we just chose to do, so it takes the stage -
  // but only on the transition, so a later switch to someone else sticks.
  const wasBroadcasting = useRef(share.isBroadcasting);
  useEffect(() => {
    if (share.isBroadcasting && !wasBroadcasting.current) {
      const own = feeds.find((feed) => feed.own);
      if (own) setFocusKey(own.key);
    }
    wasBroadcasting.current = share.isBroadcasting;
  }, [feeds, share.isBroadcasting]);

  // Forget a feed that ended, so its key cannot silently reclaim the stage if
  // the same person starts sharing again later.
  useEffect(() => {
    setFocusKey((key) => (key !== null && !keys.split("|").includes(key) ? null : key));
  }, [keys]);

  // The browser owns the fullscreen state, so follow it rather than mirror it:
  // leaving through Escape or the window manager has to land here too.
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement !== wrapper.current) setExpanded(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Escape closes the in-window fallback, which no browser will close for us.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.fullscreenElement) return;
      event.stopPropagation();
      setExpanded(false);
    };
    globalThis.addEventListener("keydown", onKey, true);
    return () => globalThis.removeEventListener("keydown", onKey, true);
  }, [expanded]);

  const toggleExpanded = useCallback(() => {
    const element = wrapper.current;
    if (document.fullscreenElement === element) {
      void document.exitFullscreen().catch(() => setExpanded(false));
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    // Real fullscreen when the webview grants it; the fixed overlay we just
    // switched on covers the app window either way, so a refusal degrades to a
    // slightly smaller picture rather than to nothing happening.
    void element?.requestFullscreen?.().catch(() => {});
  }, [expanded]);

  const selectFeed = useCallback(
    (feed: StreamFeed) => {
      setFocusKey(feed.key);
      // Webview viewers normally auto-connect for the channel; when one has
      // not, picking the feed is the moment to ask for it. The native family
      // opens its own receive path per session and needs no prompt.
      if (!feed.live && !feed.own && !usesNativeSurface()) share.watchBroadcast(feed.session);
    },
    [share],
  );

  const takeScreenshot = useCallback(() => {
    void copyStreamFrame(media.current).then(setShot);
  }, []);

  // How tall the stage may get before the conversation under it is squeezed
  // past CONVERSATION_MIN: the column's remaining room, less the panel's own
  // chrome around the stage (padding, the grab bar, an open stats panel).
  const stageRoom = useCallback(() => {
    const panel = wrapper.current;
    const grid = stage.current;
    const column = panel?.parentElement;
    if (!panel || !grid || !column) return Number.POSITIVE_INFINITY;
    const chrome = panel.offsetHeight - grid.offsetHeight;
    return (
      column.getBoundingClientRect().bottom - panel.getBoundingClientRect().top - chrome - CONVERSATION_MIN
    );
  }, []);

  const resizeStage = useCallback(
    (height: number) => {
      const next = clampStageHeight(height, stageRoom());
      latestStageHeight.current = next;
      setStageHeight(next);
      return next;
    },
    [stageRoom],
  );
  const commitStageHeight = useCallback(() => writeStageHeight(latestStageHeight.current), []);

  // A height remembered on a large display must not swallow the conversation
  // on a small one, so the stage is refitted to the column when it mounts and
  // whenever the column changes size - and only shown, never stored, that
  // way: the preference stays what the user chose. Not while fullscreen, when
  // the column's geometry says nothing about the stage.
  useLayoutEffect(() => {
    if (expanded) return;
    const column = wrapper.current?.parentElement;
    if (!column) return;
    const fit = () => setStageHeight((height) => clampStageHeight(height, stageRoom()));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(column);
    return () => observer.disconnect();
  }, [expanded, stageRoom]);

  const popOut = useCallback(() => {
    setMenuOpen(false);
    if (ownSession === null || !activeServerId) return;
    invoke("open_stream_popout", {
      payload: {
        broadcaster_session: focused.session,
        broadcaster_name: focused.own ? null : focused.name,
        broadcaster_avatar: null,
        own_session: ownSession,
        server_id: activeServerId,
        channel_id: currentChannel,
      },
    }).catch((e) => console.error("open_stream_popout failed:", e));
  }, [activeServerId, currentChannel, focused.name, focused.own, focused.session, ownSession]);

  const statsSampler = useMemo(
    () => (statsOpen ? activeStreamViewerStrategy().createStatsSampler(focused.session) : null),
    [focused.session, statsOpen],
  );

  // One feed is not a choice, so it gets no chooser: the filmstrip appears
  // only once there is something to switch between, and the picture takes the
  // width the rail would have used.
  const showRail = feeds.length > 1;

  const quality = presetOf(share.settings)?.toUpperCase() ?? "Custom";
  const caption = [
    feedSummary(feeds),
    stats.rttMs === null ? null : `${Math.round(stats.rttMs)} ms`,
    stats.fps === null ? null : `${Math.round(stats.fps)} fps`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Box
      ref={wrapper}
      sx={(theme) => ({
        display: "flex",
        flexDirection: "column",
        ...(expanded
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 9000,
              padding: "14px 16px",
              gap: "10px",
              background: theme.palette.nebula.bg0,
            }
          : {
              flex: "none",
              margin: "12px 20px 0",
              padding: "6px",
              borderRadius: radius("lg"),
              border: `1px solid ${theme.palette.nebula.line2}`,
              background: theme.palette.nebula.panel,
              backdropFilter: "blur(18px)",
            }),
      })}
    >
      <Box
        ref={stage}
        sx={{
          display: "grid",
          gridTemplateColumns: showRail ? `1fr ${expanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH}px` : "1fr",
          gap: expanded ? "8px" : "6px",
          minHeight: 0,
          ...(expanded ? { flex: 1 } : { height: stageHeight }),
        }}
      >
        <Box
          sx={(theme) => ({
            position: "relative",
            borderRadius: radius("md"),
            background: WELL_BG,
            border: `1px solid ${theme.palette.nebula.line2}`,
            overflow: "hidden",
          })}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              ...(fitMode === "actual"
                ? { overflow: "auto", display: "block" }
                : { overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }),
            }}
          >
            <StreamSurface
              key={focused.key}
              feed={focused}
              primary
              style={MEDIA_STYLE[fitMode]}
              testId={usesNativeSurface() ? TID.streamNativeView : TID.streamViewerVideo}
              mediaRef={media}
            />
          </Box>

          {!focused.live && (
            <Stack sx={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
              <Typography sx={{ fontSize: 11.5, color: "#9aa0a8" }}>
                {focused.failed ? "Stream unavailable" : "Connecting…"}
              </Typography>
            </Stack>
          )}

          {/* The picture is arbitrary, so the chrome brings its own contrast. */}
          <Box
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: 52,
              background: "linear-gradient(180deg,rgba(6,9,16,.62),transparent)",
              pointerEvents: "none",
            }}
          />
          <Box
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 58,
              background: "linear-gradient(0deg,rgba(6,9,16,.68),transparent)",
              pointerEvents: "none",
            }}
          />

          <Stack
            direction="row"
            alignItems="center"
            gap="8px"
            sx={{ position: "absolute", left: 9, right: 9, top: 8 }}
          >
            <Stack
              direction="row"
              alignItems="center"
              gap="5px"
              sx={{
                flex: "none",
                padding: "2px 7px 2px 5px",
                borderRadius: radius("sm"),
                background: "rgba(217,87,87,.22)",
                border: "1px solid rgba(217,87,87,.4)",
                color: "#f3adad",
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: ".04em",
                backdropFilter: "blur(8px)",
              }}
            >
              <Box sx={{ width: 5, height: 5, borderRadius: "50%", background: "#e06b6b" }} />
              LIVE
            </Stack>
            <Typography
              sx={{
                fontSize: 11,
                fontWeight: 500,
                color: "#e9ecf3",
                textShadow: "0 1px 3px rgba(0,0,0,.5)",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {`${focused.name} · ${focused.kind}`}
            </Typography>
            {stats.width !== null && stats.height !== null && (
              <Typography
                sx={{ flex: "none", fontSize: 10, color: "#aeb6c4", fontVariantNumeric: "tabular-nums" }}
              >
                {`${stats.width}×${stats.height}`}
              </Typography>
            )}
            <Typography
              sx={{
                marginLeft: "auto",
                flex: "none",
                fontSize: 10,
                color: "#aeb6c4",
                fontVariantNumeric: "tabular-nums",
                textShadow: "0 1px 3px rgba(0,0,0,.5)",
                whiteSpace: "nowrap",
              }}
            >
              {caption}
            </Typography>
          </Stack>

          <Stack
            direction="row"
            alignItems="center"
            gap="6px"
            sx={{ position: "absolute", left: 9, right: 9, bottom: 8 }}
          >
            <Stack
              direction="row"
              gap="2px"
              sx={{
                padding: "2px",
                borderRadius: radius("md"),
                background: GLASS_BG,
                border: GLASS_LINE,
                backdropFilter: GLASS_BLUR,
              }}
            >
              {(Object.keys(FIT_LABEL) as FitMode[]).map((mode) => (
                <Box
                  key={mode}
                  component="button"
                  type="button"
                  onClick={() => setFitMode(mode)}
                  sx={{
                    padding: "0 8px",
                    height: 20,
                    border: "none",
                    borderRadius: radius("sm"),
                    display: "flex",
                    alignItems: "center",
                    fontSize: 10,
                    fontWeight: 500,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    background: fitMode === mode ? "rgba(52,168,235,.3)" : "transparent",
                    color: fitMode === mode ? "#d3ebfb" : "#b3bbc8",
                  }}
                >
                  {FIT_LABEL[mode]}
                </Box>
              ))}
            </Stack>

            <Stack direction="row" alignItems="center" gap="5px" sx={{ marginLeft: "auto" }}>
              <OverlayButton title="Copy a screenshot of this feed" onClick={takeScreenshot}>
                <CameraIcon width={12} height={12} />
              </OverlayButton>
              <OverlayButton
                title="Share your camera"
                testId={TID.cameraShareToggle}
                onClick={share.startCameraSharing}
              >
                <WebcamIcon width={12} height={12} />
              </OverlayButton>
              <OverlayButton
                title="Stream options"
                testId={TID.streamConfigMenu}
                active={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <KebabMenuIcon width={12} height={12} />
              </OverlayButton>
              <OverlayButton title={expanded ? "Exit fullscreen" : "Fullscreen"} onClick={toggleExpanded}>
                {expanded ? (
                  <FullscreenExitIcon width={12} height={12} />
                ) : (
                  <FullscreenIcon width={12} height={12} />
                )}
              </OverlayButton>
              {/* The only stream this client can end is its own, so the red
                  button means that and nothing else - a viewer watching
                  someone else is not offered a stop they cannot perform. */}
              {share.isBroadcasting && (
                <Box
                  component="button"
                  type="button"
                  onClick={share.stopSharing}
                  title="Stop sharing"
                  data-testid={TID.screenShareToggle}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "0 9px",
                    height: 26,
                    flex: "none",
                    borderRadius: radius("md"),
                    background: "rgba(217,87,87,.2)",
                    border: "1px solid rgba(217,87,87,.42)",
                    color: "#f0b0b0",
                    fontSize: 10.5,
                    fontWeight: 500,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    backdropFilter: GLASS_BLUR,
                    "&:hover": { background: "rgba(217,87,87,.3)" },
                  }}
                >
                  Stop
                </Box>
              )}
            </Stack>
          </Stack>

          {menuOpen && (
            <>
              {/* Click-away, inside the well so it covers fullscreen too. */}
              <Box onClick={() => setMenuOpen(false)} sx={{ position: "absolute", inset: 0, zIndex: 4 }} />
              <Stack
                sx={{
                  position: "absolute",
                  right: 9,
                  bottom: 42,
                  width: 212,
                  zIndex: 5,
                  padding: "5px",
                  borderRadius: radius("lg"),
                  background: "rgba(14,18,28,.92)",
                  border: "1px solid rgba(255,255,255,.1)",
                  boxShadow: "0 16px 40px rgba(0,0,0,.45)",
                  backdropFilter: "blur(20px)",
                }}
              >
                {share.isBroadcasting && (
                  <>
                    <StreamMenuItem
                      label="Stream quality"
                      value={quality}
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenQuality();
                      }}
                    />
                    <StreamMenuItem
                      label="Change source"
                      onClick={() => {
                        setMenuOpen(false);
                        share.startSharing();
                      }}
                    />
                    {/* While a screen is shared our own windows hide from every
                        capture API, the user's own screenshots included. X11
                        has no such mechanism, so there is nothing to offer. */}
                    {!isLinux && (
                      <StreamMenuItem
                        label="Allow screenshots"
                        value={capture.hidden ? "Off" : "On"}
                        onClick={() => capture.setHidden(!capture.hidden)}
                      />
                    )}
                  </>
                )}
                <StreamMenuItem
                  label="Stats for nerds"
                  value={statsOpen ? "On" : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                    setStatsOpen((open) => !open);
                  }}
                />
                {/* The popout builds its own webview viewer; the native family
                    has none to build it in, and mobile has no second window. */}
                {!focused.own && !usesNativeSurface() && !isMobile && (
                  <StreamMenuItem label="Pop out to window" onClick={popOut} />
                )}
              </Stack>
            </>
          )}
        </Box>

        {showRail && (
          <Stack gap="6px" sx={{ overflow: "auto", paddingRight: "2px" }}>
            {feeds.map((feed) => (
              <FilmstripTile
                key={feed.key}
                feed={feed}
                focused={feed.key === focused.key}
                onSelect={() => selectFeed(feed)}
              />
            ))}
          </Stack>
        )}
      </Box>

      {statsOpen && statsSampler && (
        <Suspense fallback={null}>
          <StreamStatsPanel
            sampler={statsSampler}
            contentByMid={getTrackContentMap(focused.session)}
            onClose={() => setStatsOpen(false)}
          />
        </Suspense>
      )}

      {!expanded && (
        <StageResizeHandle
          height={stageHeight}
          maxHeight={stageRoom}
          onChange={resizeStage}
          onCommit={commitStageHeight}
        />
      )}

      <Snackbar
        open={shot !== null}
        autoHideDuration={2600}
        onClose={() => setShot(null)}
        message={shot ? SCREENSHOT_MESSAGE[shot] : ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}

/** The mock's three scaling modes, as the style the media element wears. */
const MEDIA_STYLE: Record<FitMode, React.CSSProperties> = {
  fit: {
    display: "block",
    width: "100%",
    height: "100%",
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
  },
  fill: {
    display: "block",
    width: "100%",
    height: "100%",
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "cover",
  },
  // Intrinsic size, scrolled by the well: `auto` resolves to the video's or the
  // canvas's own pixel dimensions, which is what "1:1" means.
  actual: {
    display: "block",
    width: "auto",
    height: "auto",
    objectFit: "none",
    margin: "auto",
    flex: "none",
  },
};

function OverlayButton({
  title,
  onClick,
  active = false,
  testId,
  children,
}: Readonly<{
  title: string;
  onClick: () => void;
  active?: boolean;
  testId?: string;
  children: React.ReactNode;
}>) {
  return (
    <Box
      component="button"
      type="button"
      title={title}
      aria-label={title}
      data-testid={testId}
      onClick={onClick}
      sx={{
        width: 26,
        height: 26,
        flex: "none",
        padding: 0,
        borderRadius: radius("md"),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        border: GLASS_LINE,
        backdropFilter: GLASS_BLUR,
        background: active ? GLASS_BG_HOVER : GLASS_BG,
        color: active ? "#fff" : OVERLAY_TEXT,
        "&:hover": { color: "#fff", background: GLASS_BG_HOVER },
      }}
    >
      {children}
    </Box>
  );
}

function StreamMenuItem({
  label,
  value,
  onClick,
}: Readonly<{ label: string; value?: string; onClick: () => void }>) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: "9px",
        width: "100%",
        padding: "7px 9px",
        border: "none",
        borderRadius: radius("md"),
        background: "transparent",
        color: "#e4e8f0",
        fontSize: 12,
        fontFamily: "inherit",
        textAlign: "left",
        cursor: "pointer",
        "&:hover": { background: "rgba(255,255,255,.07)" },
      }}
    >
      {label}
      {value !== undefined && (
        <Box component="span" sx={{ marginLeft: "auto", fontSize: 10, color: "#8f97a5" }}>
          {value}
        </Box>
      )}
    </Box>
  );
}

function FilmstripTile({
  feed,
  focused,
  onSelect,
}: Readonly<{ feed: StreamFeed; focused: boolean; onSelect: () => void }>) {
  return (
    <Box
      onClick={onSelect}
      data-testid={TID.streamWatchTile}
      data-session={feed.session}
      sx={(theme) => ({
        position: "relative",
        flex: "none",
        height: TILE_HEIGHT,
        borderRadius: radius("md"),
        overflow: "hidden",
        background: WELL_BG,
        cursor: "pointer",
        border: focused
          ? `1.5px solid ${theme.palette.nebula.accent}`
          : `1px solid ${theme.palette.nebula.line2}`,
      })}
    >
      {/* The focused feed is on the stage, so its tile is a copy of it - see
          StreamSurface. Every other feed is drawn here for real. */}
      <StreamSurface
        feed={feed}
        primary={!focused}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: 0.92 }}
      />
      <Box
        component="span"
        sx={{
          position: "absolute",
          left: 5,
          bottom: 4,
          maxWidth: "calc(100% - 34px)",
          padding: "1px 6px",
          borderRadius: "999px",
          background: "rgba(8,11,18,.75)",
          backdropFilter: "blur(8px)",
          fontSize: 9,
          color: "#e6e9f0",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {feed.name}
      </Box>
      <Box
        component="span"
        sx={(theme) => ({
          position: "absolute",
          right: 6,
          top: 5,
          padding: "1px 5px",
          borderRadius: radius("sm"),
          background: "rgba(8,11,18,.7)",
          backdropFilter: "blur(6px)",
          fontSize: 8.5,
          fontWeight: 600,
          letterSpacing: ".05em",
          color: feed.kind === "camera" ? theme.palette.nebula.ok : "#aeb6c4",
        })}
      >
        {FEED_BADGE[feed.kind]}
      </Box>
    </Box>
  );
}
