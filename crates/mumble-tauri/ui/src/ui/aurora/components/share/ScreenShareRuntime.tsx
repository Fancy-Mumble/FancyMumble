import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import { useRemoteStreams, useScreenShare } from "@ui/standard/components/chat/stream/useScreenShare";
import DrawingOverlay from "@ui/standard/components/chat/drawing/DrawingOverlay";
import { CloseIcon, MonitorIcon, SparklesIcon } from "@ui/icons";
import { Button, IconButton } from "../primitives";
import ScreenSharePanel, { type ScreenShareController } from "./ScreenSharePanel";
import styles from "./ScreenShareRuntime.module.css";

function attachStream(element: HTMLVideoElement | null, stream: MediaStream | null) {
  if (element && element.srcObject !== stream) element.srcObject = stream;
}

function useTelemetry(video: RefObject<HTMLVideoElement | null>) {
  const [telemetry, setTelemetry] = useState({ width: 0, height: 0, fps: 0 });
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let frameHandle = 0;
    const element = video.current;
    if (!element) return;
    const frame = () => {
      frames += 1;
      frameHandle = element.requestVideoFrameCallback(frame);
    };
    if ("requestVideoFrameCallback" in element) frameHandle = element.requestVideoFrameCallback(frame);
    const interval = globalThis.setInterval(() => {
      const now = performance.now();
      setTelemetry({
        width: element.videoWidth,
        height: element.videoHeight,
        fps: Math.round((frames * 1000) / Math.max(1, now - last)),
      });
      frames = 0;
      last = now;
    }, 1000);
    return () => {
      globalThis.clearInterval(interval);
      if (frameHandle && "cancelVideoFrameCallback" in element) element.cancelVideoFrameCallback(frameHandle);
    };
  }, [video]);
  return telemetry;
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
  const telemetry = useTelemetry(mainVideo);
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
          <aside className={styles.stats}>
            <strong>Stream statistics</strong>
            <span>
              Resolution{" "}
              <b>
                {telemetry.width && telemetry.height ? `${telemetry.width} × ${telemetry.height}` : "Waiting"}
              </b>
            </span>
            <span>
              Rendered frame rate <b>{telemetry.fps} FPS</b>
            </span>
            <span>
              Video tracks <b>{[primary, camera].filter(Boolean).length}</b>
            </span>
            <span>
              Transport <b>WebRTC · SFU</b>
            </span>
          </aside>
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
        <Button variant="danger" onClick={onStop}>
          Stop sharing
        </Button>
      </header>
      <div className={styles.viewport}>
        <StreamVideo stream={stream} muted />
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
