import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import { useRemoteStreams, useScreenShare } from "@ui/standard/components/chat/stream/useScreenShare";
import {
  activeStreamViewerStrategy,
  StreamViewerStrategyId,
} from "@ui/standard/components/chat/stream/viewerStrategy";
import { getTrackContentMap } from "@ui/standard/components/chat/stream/trackContent";
import { useCaptureExclusion } from "@ui/standard/components/chat/stream/useCaptureExclusion";
import { isLinux } from "@core/utils/platform";
import DrawingOverlay from "@ui/standard/components/chat/drawing/DrawingOverlay";
import { CloseIcon, MonitorIcon, SparklesIcon } from "@ui/icons";
import { Button, IconButton } from "../primitives";
import ScreenSharePanel, { type ScreenShareController } from "./ScreenSharePanel";
import styles from "./ScreenShareRuntime.module.css";

// The same "Stats for Nerds" overlay the standard UI and Nebula use: the
// numbers come from the viewer strategy's sampler (encoder, bitrate, loss,
// jitter, RTT), not from what the <video> element happens to render. Lazy
// because it pulls in the history charts and is off screen at rest.
const StreamStatsPanel = lazy(() => import("@ui/standard/components/chat/stream/StreamStatsPanel"));

/** Whether the active strategy paints onto a canvas (the native Rust viewer)
 *  instead of a <video> element, in which case the panel has no element to
 *  read viewport size and volume from. Latched per page load. */
function usesNativeSurface(): boolean {
  return activeStreamViewerStrategy().id === StreamViewerStrategyId.Native;
}

function attachStream(element: HTMLVideoElement | null, stream: MediaStream | null) {
  if (element && element.srcObject !== stream) element.srcObject = stream;
}

function StreamVideo({
  stream,
  muted,
  className,
}: {
  stream: MediaStream | null;
  muted: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => attachStream(ref.current, stream), [stream]);
  return stream ? (
    <video ref={ref} className={className} autoPlay playsInline muted={muted} />
  ) : (
    <div className={styles.connecting}>
      <span />
      <strong>Connecting to stream…</strong>
    </div>
  );
}

function RemoteStage({
  session,
  onClose,
  onWatch,
}: {
  session: number;
  onClose: () => void;
  onWatch: (session: number) => void;
}) {
  const { primary, camera } = useRemoteStreams(session);
  const users = useAppStore((state) => state.users);
  const broadcasters = useAppStore((state) => state.broadcastingSessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const ownSession = useAppStore((state) => state.ownSession);
  const currentChannel = useAppStore((state) => state.currentChannel);
  const drawingActive = useAppStore(
    (state) => currentChannel != null && state.drawingActiveChannels.has(currentChannel),
  );
  const mainVideo = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const statsSampler = useMemo(() => activeStreamViewerStrategy().createStatsSampler(session), [session]);
  const broadcaster = users.find((user) => user.session === session);
  const toggleDrawing = () => {
    if (currentChannel == null) return;
    const channels = new Set(useAppStore.getState().drawingActiveChannels);
    if (channels.has(currentChannel)) channels.delete(currentChannel);
    else channels.add(currentChannel);
    useAppStore.setState({ drawingActiveChannels: channels });
  };
  useEffect(() => attachStream(mainVideo.current, primary), [primary]);
  const popout = async () => {
    if (!activeServerId || ownSession == null || currentChannel == null) return;
    await invoke("open_stream_popout", {
      payload: {
        broadcasterSession: session,
        broadcasterName: broadcaster?.name ?? "Live stream",
        broadcasterAvatar: null,
        ownSession,
        serverId: activeServerId,
        channelId: currentChannel,
      },
    });
    useAppStore.setState((state) => ({
      poppedOutStreamSessions: new Set([...state.poppedOutStreamSessions, session]),
    }));
    onClose();
  };
  return (
    <section className={styles.stage} aria-label={`${broadcaster?.name ?? "Member"} live stream`}>
      <header>
        <span className={styles.live}>
          <i />
          LIVE
        </span>
        <div>
          <strong>{broadcaster?.name ?? "Member"}</strong>
          <small>{camera ? "Screen and camera" : "Screen share"}</small>
        </div>
        <Button variant={drawingActive ? "secondary" : "bare"} onClick={toggleDrawing}>
          Annotate
        </Button>
        <Button variant="bare" onClick={() => setShowStats((value) => !value)}>
          Stats
        </Button>
        <Button variant="bare" onClick={() => setMuted((value) => !value)}>
          {muted ? "Unmute" : "Mute"}
        </Button>
        <Button variant="bare" onClick={() => void mainVideo.current?.parentElement?.requestFullscreen()}>
          Fullscreen
        </Button>
        <Button variant="bare" onClick={() => void popout()}>
          Pop out
        </Button>
        <IconButton icon={<CloseIcon />} label="Close stream" onClick={onClose} />
      </header>
      <div className={styles.viewport}>
        {primary ? (
          <video ref={mainVideo} autoPlay playsInline muted={muted} />
        ) : (
          <div className={styles.connecting}>
            <span />
            <strong>Negotiating secure stream…</strong>
          </div>
        )}
        {primary && currentChannel != null && ownSession != null && (
          <DrawingOverlay channelId={currentChannel} ownSession={ownSession} videoRef={mainVideo} />
        )}
        {camera && <StreamVideo stream={camera} muted={muted} className={styles.cameraPip} />}
        {showStats && (
          <Suspense fallback={null}>
            <StreamStatsPanel
              sampler={statsSampler}
              videoRef={usesNativeSurface() ? undefined : mainVideo}
              contentByMid={getTrackContentMap(session)}
              onClose={() => setShowStats(false)}
            />
          </Suspense>
        )}
      </div>
      {broadcasters.size > 1 && (
        <footer>
          {[...broadcasters]
            .filter((id) => id !== session)
            .map((id) => (
              <Button variant="bare" key={id} onClick={() => onWatch(id)}>
                <MonitorIcon />
                {users.find((user) => user.session === id)?.name ?? `User ${id}`}
              </Button>
            ))}
        </footer>
      )}
    </section>
  );
}

function OwnStage({ stream, onStop }: { stream: MediaStream | null; onStop: () => void }) {
  const connecting = useAppStore((state) => state.webrtcConnecting);
  const stalled = useAppStore((state) => state.captureStalled);
  const ownSession = useAppStore((state) => state.ownSession);
  const [showStats, setShowStats] = useState(false);
  const capture = useCaptureExclusion();
  // Our own broadcast comes back off the SFU like anyone else's, so the same
  // per-session sampler reports what we are actually sending.
  const statsSampler = useMemo(
    () => activeStreamViewerStrategy().createStatsSampler(ownSession ?? 0),
    [ownSession],
  );
  return (
    <section className={styles.stage}>
      <header>
        <span className={styles.live}>
          <i />
          YOU ARE LIVE
        </span>
        <div>
          <strong>Your shared content</strong>
          <small>
            {connecting
              ? "Setting up relay"
              : stalled
                ? "Capture paused by the compositor"
                : "Broadcasting through the server"}
          </small>
        </div>
        {ownSession != null && (
          <Button variant="bare" onClick={() => setShowStats((value) => !value)}>
            Stats
          </Button>
        )}
        {/* While a screen is shared our windows hide from every capture API,
            which also blocks the user's own screenshots. X11 has no such
            mechanism, so there is nothing to offer there. */}
        {!isLinux && (
          <Button
            variant="bare"
            onClick={() => capture.setHidden(!capture.hidden)}
            title={
              capture.hidden
                ? "This app is invisible to screenshots and recorders while you share a screen"
                : "This app is visible to screenshots again - your live preview may mirror itself"
            }
          >
            {capture.hidden ? "Allow screenshots" : "Hide from capture"}
          </Button>
        )}
        <Button variant="danger" onClick={onStop}>
          Stop sharing
        </Button>
      </header>
      <div className={styles.viewport}>
        <StreamVideo stream={stream} muted />
        {showStats && ownSession != null && (
          <Suspense fallback={null}>
            <StreamStatsPanel
              sampler={statsSampler}
              contentByMid={getTrackContentMap(ownSession)}
              onClose={() => setShowStats(false)}
            />
          </Suspense>
        )}
        {stalled && (
          <div className={styles.warning}>
            The display stopped producing frames. Sharing the application window usually avoids fullscreen
            direct-scanout stalls.
          </div>
        )}
      </div>
    </section>
  );
}

export function ScreenShareRuntime({
  pickerRequested,
  onClosePicker,
}: {
  pickerRequested: boolean;
  onClosePicker: () => void;
}) {
  const share = useScreenShare();
  const users = useAppStore((state) => state.users);
  const currentChannel = useAppStore((state) => state.currentChannel);
  const ownSession = useAppStore((state) => state.ownSession);
  const error = useAppStore((state) => state.webrtcError);
  const broadcasters = useMemo(
    () =>
      [...share.broadcastingSessions].filter(
        (session) =>
          session !== ownSession &&
          users.some((user) => user.session === session && user.channel_id === currentChannel),
      ),
    [currentChannel, ownSession, share.broadcastingSessions, users],
  );
  const controller: ScreenShareController = {
    settings: share.settings,
    confirmSource: share.confirmSource,
    stopSharing: share.stopSharing,
  };
  return (
    <>
      {error && (
        <div className={styles.error}>
          <span>{error}</span>
          <Button variant="bare" onClick={() => useAppStore.setState({ webrtcError: null })}>
            Dismiss
          </Button>
        </div>
      )}
      {!share.watchingSession && !share.isBroadcasting && broadcasters.length > 0 && (
        <div className={styles.broadcasts}>
          {broadcasters.map((session) => (
            <div key={session}>
              <span>
                <SparklesIcon />
              </span>
              <div>
                <strong>{users.find((user) => user.session === session)?.name ?? "A member"} is live</strong>
                <small>Watch their screen or camera without leaving the channel.</small>
              </div>
              <Button variant="primary" onClick={() => share.watchBroadcast(session)}>
                Watch
              </Button>
            </div>
          ))}
        </div>
      )}
      {share.watchingSession != null && (
        <RemoteStage
          session={share.watchingSession}
          onClose={share.stopWatching}
          onWatch={share.watchBroadcast}
        />
      )}
      {share.isBroadcasting && share.watchingSession == null && (
        <OwnStage stream={share.localStream} onStop={share.stopSharing} />
      )}
      {pickerRequested && <ScreenSharePanel onClose={onClosePicker} controller={controller} />}
    </>
  );
}
