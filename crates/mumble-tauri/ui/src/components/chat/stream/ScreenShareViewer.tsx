import { ActivityIcon, CloseIcon, EditIcon, ErrorCircleIcon, FullscreenExitIcon, FullscreenIcon, HighlighterIcon, MonitorIcon, PauseIcon, PlayIcon, PopoutIcon, ScreenShareIcon, VolumeIcon, VolumeOffIcon, WebcamIcon } from "../../../icons";
/**
 * Screen share viewer components.
 *
 * - OwnBroadcastPreview: shows local MediaStream directly (zero encoding)
 * - RemoteViewer: displays the WebRTC remote stream from another user
 * - StreamControls: overlay controls (play/pause, volume, fullscreen)
 * - ScreenShareViewer: container panel (video only, header is in ChatHeader)
 * - BroadcastBanner: notification bar shown when someone else is sharing
 */
import DrawingOverlay from "../drawing/DrawingOverlay";
import StreamStatsPanel from "./StreamStatsPanel";
import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../../store";
import { getBroadcastContent, getTrackContentMap, getViewerPc, useRemoteStreams } from "./useScreenShare";
import { TID } from "../../../testids";
import styles from "./ScreenShareViewer.module.css";

// ---------------------------------------------------------------------------
// Camera picture-in-picture tile (screen + camera shares)
// ---------------------------------------------------------------------------

/** The broadcaster's camera, floating over the stream viewport when they
 *  share screen + camera together. Purely presentational; a camera-only
 *  share renders in the main viewport instead (no tile). */
function CameraPipTile({ stream, session, own, onEnd }: {
  readonly stream: MediaStream;
  readonly session: number;
  readonly own: boolean;
  /** When provided (own broadcast), render an × that ends just the camera
   *  track (the screen keeps sharing). */
  readonly onEnd?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { t } = useTranslation("chat");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.play().catch(() => {});
    return () => { video.srcObject = null; };
  }, [stream]);

  return (
    <div className={styles.cameraPipWrap}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={styles.cameraPip}
        data-testid={TID.streamCameraVideo}
        data-own={own ? "true" : "false"}
        data-session={session}
      />
      {onEnd && (
        <button
          type="button"
          className={styles.cameraPipClose}
          onClick={onEnd}
          data-testid={TID.streamEndCamera}
          title={t("screenShare.endCamera")}
          aria-label={t("screenShare.endCamera")}
        >
          <CloseIcon width={13} height={13} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stream controls overlay
// ---------------------------------------------------------------------------

interface StreamControlsProps {
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether this is the own preview (volume/pause disabled). */
  readonly isOwnPreview?: boolean;
  /** When provided, render the "draw on screen" toggle button. The button
   *  toggles `drawingActiveChannels` for this channel in the global store,
   *  which controls the colour/width/clear toolbar in `DrawingOverlay`. */
  readonly drawChannelId?: number;
  /** When provided, render an additional "show desktop overlay" toggle
   *  button (broadcaster only).  Receives the current state and a setter
   *  so the parent can manage the click-through overlay window lifecycle. */
  readonly desktopOverlayOn?: boolean;
  readonly onToggleDesktopOverlay?: () => void;
  /** Which source kind the own broadcast is missing (broadcaster only).
   *  Renders an "add screen"/"add camera" shortcut that reopens the
   *  picker seeded with the live sources, so the share can be EXTENDED. */
  readonly missingSourceKind?: "screen" | "camera";
  readonly onAddSource?: () => void;
  /** When provided, renders a popout button that detaches the stream
   *  into a separate always-on-top window. */
  readonly onPopout?: () => void;
  /** When provided, renders the "Stats for Nerds" toggle button. */
  readonly statsOn?: boolean;
  readonly onToggleStats?: () => void;
}

function VolumeControl({ muted, volume, onToggleMute, onChange }: {
  readonly muted: boolean;
  readonly volume: number;
  readonly onToggleMute: () => void;
  readonly onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [show, setShow] = useState(false);
  const { t } = useTranslation(["chat", "common"]);
  return (
    <div
      className={styles.volumeGroup}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <button
        type="button"
        className={styles.controlBtn}
        onClick={onToggleMute}
        title={muted ? t("screenShare.unmute") : t("screenShare.mute")}
        aria-label={muted ? t("screenShare.unmute") : t("screenShare.mute")}
      >
        {muted || volume === 0
          ? <VolumeOffIcon width={16} height={16} />
          : <VolumeIcon width={16} height={16} />}
      </button>
      {show && (
        <input
          type="range"
          min={0}
          max={100}
          value={muted ? 0 : volume}
          onChange={onChange}
          className={styles.volumeSlider}
          aria-label={t("screenShare.volume")}
        />
      )}
    </div>
  );
}

function StreamControls({ videoRef, containerRef, isOwnPreview, drawChannelId, desktopOverlayOn, onToggleDesktopOverlay, missingSourceKind, onAddSource, onPopout, statsOn, onToggleStats }: StreamControlsProps) {
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { t } = useTranslation(["chat", "common"]);

  // Sync fullscreen state.
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [containerRef]);

  const togglePause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setPaused(false);
    } else {
      video.pause();
      setPaused(true);
    }
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, [videoRef]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const val = Number(e.target.value);
    setVolume(val);
    video.volume = val / 100;
    if (val === 0) {
      video.muted = true;
      setMuted(true);
    } else if (video.muted) {
      video.muted = false;
      setMuted(false);
    }
  }, [videoRef]);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement === container) {
      document.exitFullscreen().catch(() => {});
    } else {
      container.requestFullscreen().catch(() => {});
    }
  }, [containerRef]);

  const drawingActive = useAppStore((s) =>
    drawChannelId !== undefined && s.drawingActiveChannels.has(drawChannelId),
  );
  const toggleDrawing = useCallback(() => {
    if (drawChannelId === undefined) return;
    const set = new Set(useAppStore.getState().drawingActiveChannels);
    if (set.has(drawChannelId)) {
      set.delete(drawChannelId);
    } else {
      set.add(drawChannelId);
    }
    useAppStore.setState({ drawingActiveChannels: set });
  }, [drawChannelId]);

  return (
    <div className={styles.streamControls}>
      {/* Play / Pause (only for remote streams) */}
      {!isOwnPreview && (
        <button
          type="button"
          className={styles.controlBtn}
          onClick={togglePause}
          title={paused ? t("screenShare.play") : t("screenShare.pause")}
          aria-label={paused ? t("screenShare.play") : t("screenShare.pause")}
        >
          {paused
            ? <PlayIcon width={16} height={16} />
            : <PauseIcon width={16} height={16} />}
        </button>
      )}

      {/* Volume (only for remote streams) */}
      {!isOwnPreview && (
        <VolumeControl
          muted={muted}
          volume={volume}
          onToggleMute={toggleMute}
          onChange={handleVolumeChange}
        />
      )}

      {/* Draw on screen toggle */}
      {drawChannelId !== undefined && (
        <button
          type="button"
          className={`${styles.controlBtn} ${drawingActive ? styles.controlBtnActive : ""}`}
          onClick={toggleDrawing}
          title={drawingActive ? t("screenShare.drawOff") : t("screenShare.drawOn")}
          aria-label={drawingActive ? t("screenShare.drawOff") : t("screenShare.drawOn")}
          aria-pressed={drawingActive}
        >
          <EditIcon width={16} height={16} />
        </button>
      )}

      {/* Desktop overlay toggle (broadcaster only) */}
      {onToggleDesktopOverlay && (
        <button
          type="button"
          className={`${styles.controlBtn} ${desktopOverlayOn ? styles.controlBtnActive : ""}`}
          onClick={onToggleDesktopOverlay}
          title={desktopOverlayOn ? t("screenShare.hideOverlay") : t("screenShare.showOverlayTooltip")}
          aria-label={desktopOverlayOn ? t("screenShare.hideOverlay") : t("screenShare.showOverlay")}
          aria-pressed={desktopOverlayOn}
        >
          <HighlighterIcon width={16} height={16} />
        </button>
      )}

      {/* Add the missing source kind to the live broadcast (own preview
          only): a camera-only share offers "share screen too", a screen-only
          share offers "add camera". Opens the picker seeded with the live
          sources, so confirming EXTENDS the share. */}
      {missingSourceKind && onAddSource && (
        <button
          type="button"
          className={styles.controlBtn}
          onClick={onAddSource}
          data-testid={TID.streamAddSource}
          title={missingSourceKind === "screen"
            ? t("screenShare.addScreenTrack")
            : t("screenShare.addCameraTrack")}
          aria-label={missingSourceKind === "screen"
            ? t("screenShare.addScreenTrack")
            : t("screenShare.addCameraTrack")}
        >
          {missingSourceKind === "screen"
            ? <MonitorIcon width={16} height={16} />
            : <WebcamIcon width={16} height={16} />}
        </button>
      )}

      {/* "Stats for Nerds" toggle */}
      {onToggleStats && (
        <button
          type="button"
          className={`${styles.controlBtn} ${statsOn ? styles.controlBtnActive : ""}`}
          onClick={onToggleStats}
          title={statsOn ? t("screenShare.stats.hide") : t("screenShare.stats.toggle")}
          aria-label={statsOn ? t("screenShare.stats.hide") : t("screenShare.stats.toggle")}
          aria-pressed={statsOn}
        >
          <ActivityIcon width={16} height={16} />
        </button>
      )}

      {/* Spacer */}
      <div className={styles.controlsSpacer} />

      {/* Pop out into a separate always-on-top window (remote streams only) */}
      {onPopout && (
        <button
          type="button"
          className={styles.controlBtn}
          onClick={onPopout}
          title={t("screenShare.popout")}
          aria-label={t("screenShare.popout")}
        >
          <PopoutIcon width={16} height={16} />
        </button>
      )}

      {/* Fullscreen (remote streams only) */}
      {!isOwnPreview && (
        <button
          type="button"
          className={styles.controlBtn}
          onClick={toggleFullscreen}
          title={isFullscreen ? t("screenShare.exitFullscreen") : t("screenShare.fullscreen")}
          aria-label={isFullscreen ? t("screenShare.exitFullscreen") : t("screenShare.fullscreen")}
        >
          {isFullscreen
            ? <FullscreenExitIcon width={16} height={16} />
            : <FullscreenIcon width={16} height={16} />}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Own broadcast preview - just a <video> element with the local stream
// ---------------------------------------------------------------------------

interface OwnPreviewProps {
  /** The loopback own-preview stream; null while the broadcast is still
   *  connecting (the panel shows the "setting up" overlay until it arrives). */
  readonly stream: MediaStream | null;
  readonly channelId: number;
  readonly ownSession: number;
  /** See {@link StreamControlsProps.missingSourceKind}. */
  readonly missingSourceKind?: "screen" | "camera";
  readonly onAddSource?: () => void;
  /** Ends just the camera track (renders an × on the camera PiP tile). */
  readonly onEndCamera?: () => void;
}

function OwnBroadcastPreview({ stream, channelId, ownSession, missingSourceKind, onAddSource, onEndCamera }: OwnPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const webrtcConnecting = useAppStore((s) => s.webrtcConnecting);
  // The loopback camera PiP (screen + camera shares). Gated on `stream`
  // below so tabs that don't own the broadcast (stream = null) never
  // render it.
  const { camera: cameraStream } = useRemoteStreams(ownSession);
  const { t } = useTranslation(["chat", "common"]);
  // Persisted in the global store so the overlay stays open when the user
  // switches to a different server tab (which unmounts this component).
  // It is closed automatically by `stopBroadcasting()` in `useScreenShare`
  // when the broadcast actually ends.
  const desktopOverlayOn = useAppStore((s) => s.desktopDrawingOverlayOpen);
  const [statsOn, setStatsOn] = useState(false);
  // The own preview is served by the loopback viewer PC (keyed by our own
  // session), so the stats panel polls it like any remote viewer's PC.
  const getStatsPc = useCallback(() => getViewerPc(ownSession), [ownSession]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    return () => { video.srcObject = null; };
  }, [stream]);

  const openDesktopOverlay = useCallback(async () => {
    try {
      // The Rust side pins the overlay over the active broadcast's
      // capture source directly. The track settings below only feed its
      // legacy fallback (no Rust broadcast running); with the Rust-native
      // capture there is no local MediaStream and they resolve to null.
      const track = stream?.getVideoTracks()[0];
      const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings & { displaySurface?: string };
      await invoke("open_drawing_overlay", {
        channelId,
        ownSession,
        captureWidth: settings.width ?? null,
        captureHeight: settings.height ?? null,
        displaySurface: settings.displaySurface ?? null,
      });
      useAppStore.setState({ desktopDrawingOverlayOpen: true });
    } catch (e) {
      console.warn("open_drawing_overlay failed", e);
    }
  }, [channelId, ownSession, stream]);

  const closeDesktopOverlay = useCallback(async () => {
    await invoke("close_drawing_overlay").catch(() => {});
    useAppStore.setState({ desktopDrawingOverlayOpen: false });
  }, []);

  const toggleDesktopOverlay = useCallback(() => {
    if (desktopOverlayOn) {
      void closeDesktopOverlay();
    } else {
      void openDesktopOverlay();
    }
  }, [desktopOverlayOn, openDesktopOverlay, closeDesktopOverlay]);

  return (
    <div ref={containerRef} className={styles.streamViewport}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={styles.videoElement}
        data-testid={TID.streamViewerVideo}
        data-own="true"
        data-session={ownSession}
      />
      {stream !== null && cameraStream !== null && (
        <CameraPipTile stream={cameraStream} session={ownSession} own onEnd={onEndCamera} />
      )}
      {(webrtcConnecting || !stream) && (
        <div className={styles.connectingOverlay}>
          <div className={styles.connectingDots}>
            <span className={styles.connectingDot} />
            <span className={styles.connectingDot} />
            <span className={styles.connectingDot} />
          </div>
          <span className={styles.connectingText}>{t("screenShare.settingUp")}</span>
        </div>
      )}
      <StreamControls
        videoRef={videoRef}
        containerRef={containerRef}
        isOwnPreview
        drawChannelId={channelId}
        desktopOverlayOn={desktopOverlayOn}
        onToggleDesktopOverlay={toggleDesktopOverlay}
        missingSourceKind={missingSourceKind}
        onAddSource={onAddSource}
        statsOn={statsOn}
        onToggleStats={() => setStatsOn((v) => !v)}
      />
      <DrawingOverlay channelId={channelId} ownSession={ownSession} videoRef={videoRef} />
      {statsOn && (
        <StreamStatsPanel
          getPc={getStatsPc}
          videoRef={videoRef}
          contentByMid={getTrackContentMap(ownSession)}
          onClose={() => setStatsOn(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remote viewer - displays the WebRTC stream from the broadcaster
// ---------------------------------------------------------------------------

function RemoteViewer({ session, channelId, ownSession }: { readonly session: number; readonly channelId: number; readonly ownSession: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { primary: remoteStream, camera: cameraStream } = useRemoteStreams(session);
  const broadcaster = useAppStore((s) => s.users.find((u) => u.session === session));
  const activeServerId = useAppStore((s) => s.activeServerId);
  const { t } = useTranslation(["chat", "common"]);
  const [statsOn, setStatsOn] = useState(false);
  const getStatsPc = useCallback(() => getViewerPc(session), [session]);

  const handlePopout = useCallback(() => {
    if (!ownSession || !activeServerId) return;
    invoke("open_stream_popout", {
      payload: {
        broadcaster_session: session,
        broadcaster_name: broadcaster?.name ?? null,
        broadcaster_avatar: null,
        own_session: ownSession,
        server_id: activeServerId,
        channel_id: channelId,
      },
    }).catch((err) => console.error("open_stream_popout failed:", err));
  }, [session, broadcaster?.name, ownSession, activeServerId, channelId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = remoteStream;
    if (remoteStream) {
      video.play().catch(() => {});
    }
    return () => { video.srcObject = null; };
  }, [remoteStream]);

  return (
    <div ref={containerRef} className={styles.streamViewport}>
      {!remoteStream && (
        <div className={styles.streamPlaceholder}>
          <ScreenShareIcon className={styles.streamPlaceholderIcon} />
          <div className={styles.streamPlaceholderText}>
            <strong>{t("screenShare.connecting")}</strong>
            {t("screenShare.waitingForStream")}
          </div>
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={styles.videoElement}
        style={{ display: remoteStream ? "block" : "none" }}
        data-testid={TID.streamViewerVideo}
        data-own="false"
        data-session={session}
      />
      {remoteStream !== null && cameraStream !== null && (
        <CameraPipTile stream={cameraStream} session={session} own={false} />
      )}
      {remoteStream && (
        <StreamControls
          videoRef={videoRef}
          containerRef={containerRef}
          drawChannelId={channelId}
          onPopout={handlePopout}
          statsOn={statsOn}
          onToggleStats={() => setStatsOn((v) => !v)}
        />
      )}
      <DrawingOverlay channelId={channelId} ownSession={ownSession} videoRef={videoRef} />
      {statsOn && (
        <StreamStatsPanel
          getPc={getStatsPc}
          videoRef={videoRef}
          contentByMid={getTrackContentMap(session)}
          onClose={() => setStatsOn(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main viewer panel
// ---------------------------------------------------------------------------

interface ScreenShareViewerProps {
  readonly isOwnBroadcast: boolean;
  readonly localStream: MediaStream | null;
  /** Session ID of the broadcaster (required when isOwnBroadcast is false). */
  readonly session?: number;
  /** Channel ID for drawing overlay coordination. */
  readonly channelId?: number;
  /** Our own session ID for drawing overlay (filters out own echoes). */
  readonly ownSession?: number;
  /** See {@link StreamControlsProps.missingSourceKind} (own broadcast only). */
  readonly missingSourceKind?: "screen" | "camera";
  readonly onAddSource?: () => void;
  /** Ends just the camera track (own broadcast only). */
  readonly onEndCamera?: () => void;
}

export default function ScreenShareViewer({
  isOwnBroadcast,
  localStream,
  session,
  channelId = 0,
  ownSession = 0,
  missingSourceKind,
  onAddSource,
  onEndCamera,
}: ScreenShareViewerProps) {
  return (
    <div className={styles.broadcastArea}>
      {isOwnBroadcast
        ? (
          <OwnBroadcastPreview
            stream={localStream}
            channelId={channelId}
            ownSession={ownSession}
            missingSourceKind={missingSourceKind}
            onAddSource={onAddSource}
            onEndCamera={onEndCamera}
          />
        )
        : <RemoteViewer session={session ?? 0} channelId={channelId} ownSession={ownSession} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small UI elements for reuse in ChatHeader
// ---------------------------------------------------------------------------

/** "Share Screen" toggle button for the chat header. */
export function ShareScreenButton({
  active,
  onClick,
}: Readonly<{ active: boolean; onClick: () => void }>) {
  const { t } = useTranslation(["chat", "common"]);
  return (
    <button
      type="button"
      className={`${styles.shareScreenBtn} ${active ? styles.shareScreenBtnActive : ""}`}
      onClick={onClick}
      title={active ? t("screenShare.stopSharing") : t("screenShare.share")}
      aria-label={active ? t("screenShare.stopSharing") : t("screenShare.share")}
    >
      <ScreenShareIcon className={styles.shareScreenBtnIcon} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Broadcast notification banner
// ---------------------------------------------------------------------------

interface BroadcastBannerProps {
  /** Session IDs currently broadcasting (filtered to current channel). */
  readonly broadcasters: { session: number; name: string }[];
  /** Called when user clicks "Watch". */
  readonly onWatch: (session: number) => void;
  /** When false, all broadcasts are peer-to-peer (no server SFU available). */
  readonly sfuAvailable?: boolean;
}

/** Banner phrasing per announced share content ("screen" / "camera" / both). */
const BANNER_LABEL_KEYS = {
  screen: "screenShare.banner.isSharingScreen",
  camera: "screenShare.banner.isSharingCamera",
  both: "screenShare.banner.isSharingScreenCamera",
} as const;

/**
 * Notification bar shown above the chat when another user is sharing their
 * screen (and/or camera). Provides a "Watch" button to join the broadcast.
 * When the server has no SFU the banner is shown in amber to indicate
 * that the share is peer-to-peer rather than server-relayed.
 */
export function BroadcastBanner({ broadcasters, onWatch, sfuAvailable = true }: BroadcastBannerProps) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const { t } = useTranslation(["chat", "common"]);

  // Reset dismissed state when broadcasters change (new broadcaster should show).
  const broadcasterIds = useMemo(
    () => broadcasters.map((b) => b.session).sort().join(","),
    [broadcasters],
  );
  useEffect(() => {
    setDismissed((prev) => {
      const active = new Set(broadcasters.map((b) => b.session));
      const next = new Set([...prev].filter((id) => active.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [broadcasterIds]);

  const handleDismiss = useCallback((session: number) => {
    setDismissed((prev) => new Set([...prev, session]));
  }, []);

  const visible = broadcasters.filter((b) => !dismissed.has(b.session));
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((b) => (
        <div
          key={b.session}
          className={`${styles.broadcastBanner} ${!sfuAvailable ? styles.broadcastBannerP2P : ""}`}
          role="status"
          data-testid={TID.broadcastBanner}
          data-broadcaster-name={b.name}
        >
          <span className={`${styles.broadcastBannerDot} ${!sfuAvailable ? styles.broadcastBannerDotP2P : ""}`} />
          <span className={styles.broadcastBannerText}>
            <span className={styles.broadcastBannerName}>{b.name}</span>{" "}
            {t(BANNER_LABEL_KEYS[getBroadcastContent(b.session)])}
          </span>
          {!sfuAvailable && (
            <span className={styles.broadcastBannerP2PLabel} title={t("screenShare.p2pTooltip")}>
              {t("screenShare.p2pLabel")}
            </span>
          )}
          <button
            type="button"
            className={styles.broadcastBannerWatchBtn}
            onClick={() => onWatch(b.session)}
            data-testid={TID.broadcastWatch}
            data-session={b.session}
          >
            <ScreenShareIcon width={12} height={12} />
            {t("screenShare.banner.watch")}
          </button>
          <button
            type="button"
            className={styles.broadcastBannerDismiss}
            onClick={() => handleDismiss(b.session)}
            title={t("common:actions.dismiss")}
            aria-label={t("screenShare.banner.dismiss")}
          >
            <CloseIcon width={14} height={14} />
          </button>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// WebRTC error banner - same inline style as BroadcastBanner
// ---------------------------------------------------------------------------

interface WebRtcErrorBannerProps {
  readonly message: string;
  readonly onDismiss: () => void;
}

export function WebRtcErrorBanner({ message, onDismiss }: WebRtcErrorBannerProps) {
  const { t } = useTranslation(["chat", "common"]);
  return (
    <div className={styles.broadcastBanner} role="alert">
      <ErrorCircleIcon className={styles.broadcastBannerErrorIcon} width={14} height={14} />
      <span className={styles.broadcastBannerText}>{message}</span>
      <button
        type="button"
        className={styles.broadcastBannerDismiss}
        onClick={onDismiss}
        title={t("common:actions.dismiss")}
        aria-label={t("common:actions.dismiss")}
      >
        <CloseIcon width={14} height={14} />
      </button>
    </div>
  );
}
