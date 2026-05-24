import { CloseIcon, EditIcon, ErrorCircleIcon, FullscreenExitIcon, FullscreenIcon, PauseIcon, PlayIcon, PopoutIcon, ScreenShareIcon, VolumeIcon, VolumeOffIcon } from "../../../icons";
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
import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../../store";
import { useRemoteStream } from "./useScreenShare";
import styles from "./ScreenShareViewer.module.css";

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
  /** When provided, renders a popout button that detaches the stream
   *  into a separate always-on-top window. */
  readonly onPopout?: () => void;
}

function VolumeControl({ muted, volume, onToggleMute, onChange }: {
  readonly muted: boolean;
  readonly volume: number;
  readonly onToggleMute: () => void;
  readonly onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [show, setShow] = useState(false);
  const { t } = useTranslation("chat");
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

function StreamControls({ videoRef, containerRef, isOwnPreview, drawChannelId, desktopOverlayOn, onToggleDesktopOverlay, onPopout }: StreamControlsProps) {
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { t } = useTranslation("chat");

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
          <ScreenShareIcon width={16} height={16} />
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
  readonly stream: MediaStream;
  readonly channelId: number;
  readonly ownSession: number;
}

function OwnBroadcastPreview({ stream, channelId, ownSession }: OwnPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const webrtcConnecting = useAppStore((s) => s.webrtcConnecting);
  const { t } = useTranslation("chat");
  // Persisted in the global store so the overlay stays open when the user
  // switches to a different server tab (which unmounts this component).
  // It is closed automatically by `stopBroadcasting()` in `useScreenShare`
  // when the broadcast actually ends.
  const desktopOverlayOn = useAppStore((s) => s.desktopDrawingOverlayOpen);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    return () => { video.srcObject = null; };
  }, [stream]);

  const openDesktopOverlay = useCallback(async () => {
    try {
      // Pass the captured track's pixel size + display surface kind so
      // the Rust side can either pin the overlay over the shared window
      // (display_surface = "window") or cover the matching monitor.
      const track = stream.getVideoTracks()[0];
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
      />
      {webrtcConnecting && (
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
      />
      <DrawingOverlay channelId={channelId} ownSession={ownSession} videoRef={videoRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remote viewer - displays the WebRTC stream from the broadcaster
// ---------------------------------------------------------------------------

function RemoteViewer({ session, channelId, ownSession }: { readonly session: number; readonly channelId: number; readonly ownSession: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const remoteStream = useRemoteStream(session);
  const broadcaster = useAppStore((s) => s.users.find((u) => u.session === session));
  const activeServerId = useAppStore((s) => s.activeServerId);
  const { t } = useTranslation("chat");

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
      />
      {remoteStream && (
        <StreamControls
          videoRef={videoRef}
          containerRef={containerRef}
          drawChannelId={channelId}
          onPopout={handlePopout}
        />
      )}
      <DrawingOverlay channelId={channelId} ownSession={ownSession} videoRef={videoRef} />
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
}

export default function ScreenShareViewer({
  isOwnBroadcast,
  localStream,
  session,
  channelId = 0,
  ownSession = 0,
}: ScreenShareViewerProps) {
  return (
    <div className={styles.broadcastArea}>
      {isOwnBroadcast && localStream
        ? <OwnBroadcastPreview stream={localStream} channelId={channelId} ownSession={ownSession} />
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
  const { t } = useTranslation("chat");
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

/**
 * Notification bar shown above the chat when another user is sharing their
 * screen. Provides a "Watch" button to join the broadcast.
 * When the server has no SFU the banner is shown in amber to indicate
 * that the share is peer-to-peer rather than server-relayed.
 */
export function BroadcastBanner({ broadcasters, onWatch, sfuAvailable = true }: BroadcastBannerProps) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const { t } = useTranslation("chat");

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
        >
          <span className={`${styles.broadcastBannerDot} ${!sfuAvailable ? styles.broadcastBannerDotP2P : ""}`} />
          <span className={styles.broadcastBannerText}>
            <span className={styles.broadcastBannerName}>{b.name}</span> {t("screenShare.banner.isSharingScreen")}
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
          >
            <ScreenShareIcon width={12} height={12} />
            {t("screenShare.banner.watch")}
          </button>
          <button
            type="button"
            className={styles.broadcastBannerDismiss}
            onClick={() => handleDismiss(b.session)}
            title={t("screenShare.dismiss")}
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
  const { t } = useTranslation("chat");
  return (
    <div className={styles.broadcastBanner} role="alert">
      <ErrorCircleIcon className={styles.broadcastBannerErrorIcon} width={14} height={14} />
      <span className={styles.broadcastBannerText}>{message}</span>
      <button
        type="button"
        className={styles.broadcastBannerDismiss}
        onClick={onDismiss}
        title={t("screenShare.dismiss")}
        aria-label={t("screenShare.dismiss")}
      >
        <CloseIcon width={14} height={14} />
      </button>
    </div>
  );
}
