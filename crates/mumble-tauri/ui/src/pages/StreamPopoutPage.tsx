/**
 * StreamPopoutPage - dedicated route rendered inside a frameless,
 * always-on-top webview window spawned by `open_stream_popout`.
 *
 * Mirrors {@link PopoutPage} but for a live screen share: instead of an
 * `<img>`, it renders a `<video>` fed by an independent WebRTC viewer
 * subscription to the server SFU.  Reuses {@link PopoutShell} for all
 * window chrome (drag handle, info bar, scroll-to-dim, context menu,
 * server-disconnect close, transparent body).
 *
 * Adds two responsibilities on top of the shell:
 *  - WebRTC viewer (own peer connection - `MediaStream` cannot cross
 *    window boundaries so the in-chat viewer's PC is not reusable here).
 *  - {@link DrawingOverlay} so collaborative annotations made on the
 *    broadcaster's stream are visible inside the popout, too.
 *  - Emits `stream-popout-state` so the main window can suppress its
 *    redundant in-chat viewer / "Watch" banner for the broadcaster
 *    we are already showing here.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import styles from "./PopoutPage.module.css";
import PopoutShell from "./PopoutShell";
import DrawingOverlay from "../components/chat/drawing/DrawingOverlay";

// SignalType enum values from Mumble.proto WebRtcSignal.
const SIGNAL_SDP_OFFER = 2;
const SIGNAL_SDP_ANSWER = 3;
const SIGNAL_ICE_CANDIDATE = 4;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

interface StreamPayload {
  broadcaster_session: number;
  broadcaster_name?: string | null;
  broadcaster_avatar?: string | null;
  own_session: number;
  server_id: string;
  channel_id: number;
}

interface WebRtcSignalEvent {
  sender_session: number | null;
  target_session: number | null;
  signal_type: number;
  payload: string;
}

function popoutIdFromLabel(): string | null {
  try {
    const label = getCurrentWindow().label;
    if (label.startsWith("popout-stream-")) return label.slice("popout-stream-".length);
  } catch {
    // not running inside a Tauri window (dev mode)
  }
  return new URLSearchParams(globalThis.location.search).get("stream-popout");
}

function flushPendingIce(pc: RTCPeerConnection, queue: RTCIceCandidateInit[]) {
  for (const c of queue) {
    pc.addIceCandidate(c).catch((e) => console.error("[stream-popout] addIceCandidate", e));
  }
}

function applyAnswer(pc: RTCPeerConnection, sdp: string, queue: RTCIceCandidateInit[]) {
  pc.setRemoteDescription({ type: "answer", sdp })
    .then(() => {
      flushPendingIce(pc, queue);
      queue.length = 0;
    })
    .catch((e) => console.error("[stream-popout] setRemoteDescription failed", e));
}

function applyIceCandidate(
  pc: RTCPeerConnection,
  data: string,
  queue: RTCIceCandidateInit[],
) {
  let cand: RTCIceCandidateInit | null = null;
  try { cand = JSON.parse(data) as RTCIceCandidateInit; } catch { return; }
  if (!cand) return;
  if (pc.remoteDescription) {
    pc.addIceCandidate(cand).catch((e) => console.error("[stream-popout] addIceCandidate", e));
  } else {
    queue.push(cand);
  }
}

async function setupViewerPeer(
  payload: StreamPayload,
  onStream: (s: MediaStream) => void,
  onError: (msg: string) => void,
  connectionLostMsg: string,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const ms = new MediaStream();
  pc.ontrack = (e) => {
    if (!ms.getTrackById(e.track.id)) ms.addTrack(e.track);
    onStream(ms);
  };
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    invoke("send_webrtc_signal", {
      targetSession: payload.broadcaster_session,
      signalType: SIGNAL_ICE_CANDIDATE,
      payload: JSON.stringify(e.candidate.toJSON()),
      serverId: payload.server_id,
    }).catch((err) => console.error("[stream-popout] ICE send failed", err));
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      onError(connectionLostMsg);
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await invoke("send_webrtc_signal", {
    targetSession: payload.broadcaster_session,
    signalType: SIGNAL_SDP_OFFER,
    payload: offer.sdp ?? "",
    serverId: payload.server_id,
  });
  return pc;
}

export default function StreamPopoutPage() {
  const [payload, setPayload] = useState<StreamPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const { t } = useTranslation("common");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const id = popoutIdFromLabel();
      if (!id) { setError(t("pages.streamPopout.missingId")); return; }
      const p = await invoke<StreamPayload | null>("take_popout_stream", { id });
      if (!p) { setError(t("pages.streamPopout.contextUnavailable")); return; }
      setPayload(p);
      pcRef.current = await setupViewerPeer(p, setStream, setError, t("pages.streamPopout.connectionLost"));
    })().catch((e) => setError(String(e)));

    return () => {
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, []);

  // Route incoming WebRTC signals to our peer connection.
  useEffect(() => {
    if (!payload) return;
    let unlisten: (() => void) | undefined;
    listen<WebRtcSignalEvent>("webrtc-signal", (event) => {
      const pc = pcRef.current;
      if (!pc) return;
      const { sender_session, target_session, signal_type, payload: data } = event.payload;
      if (sender_session !== payload.broadcaster_session) return;
      if (target_session !== payload.own_session) return;
      if (signal_type === SIGNAL_SDP_ANSWER) {
        applyAnswer(pc, data, pendingIceRef.current);
      } else if (signal_type === SIGNAL_ICE_CANDIDATE) {
        applyIceCandidate(pc, data, pendingIceRef.current);
      }
    }).then((u) => { unlisten = u; }).catch(() => {});
    return () => { unlisten?.(); };
  }, [payload]);

  // Bind stream to the video element.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => {});
    return () => { v.srcObject = null; };
  }, [stream]);

  // Announce popout state to other windows so the main window can hide
  // its redundant in-chat viewer / "Watch" banner for this broadcaster.
  // We only emit `opened: true` here - the matching `opened: false` is
  // emitted from native code (popout.rs `on_window_event`) when the
  // window is destroyed.  Doing it natively makes the cleanup robust to
  // every close path (Alt+F4, X button, taskbar close, programmatic
  // close from the context menu) without us intercepting close events
  // in JS, which previously prevented the window from closing at all.
  useEffect(() => {
    if (!payload) return;
    emit("stream-popout-state", { session: payload.broadcaster_session, opened: true })
      .catch((e) => console.error("[stream-popout] announce failed", e));
  }, [payload]);

  // Auto-close when the broadcaster stops sharing.  The main window
  // forwards SIGNAL_STOP as a `screen-share-stopped` Tauri event; if
  // the session matches our broadcaster, we close ourselves.
  useEffect(() => {
    if (!payload) return;
    const target = payload.broadcaster_session;
    let unlisten: (() => void) | undefined;
    listen<{ session: number }>("screen-share-stopped", (event) => {
      if (event.payload.session !== target) return;
      getCurrentWindow().close().catch((e) => console.error("[stream-popout] self close failed", e));
    }).then((u) => { unlisten = u; }).catch(() => {});
    return () => { unlisten?.(); };
  }, [payload]);

  return (
    <PopoutShell
      mediaRef={videoRef}
      mediaReady={videoReady}
      mediaLabel={t("pages.streamPopout.mediaLabel")}
      aspectStorageKey="popout-stream.aspectLocked"
      error={error}
      placeholder={stream ? null : (
        <div className={styles.error} style={{ color: "rgba(255,255,255,0.7)" }}>
          {t("pages.streamPopout.connecting")}
        </div>
      )}
      infoBar={payload ? {
        name: payload.broadcaster_name ?? t("pages.streamPopout.screenshare"),
        avatar: payload.broadcaster_avatar,
        caption: t("pages.streamPopout.caption"),
      } : null}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={styles.image}
        data-tauri-drag-region
        onLoadedMetadata={() => setVideoReady(true)}
        style={{ display: stream ? "block" : "none" }}
      >
        <track kind="captions" />
      </video>
      {payload && (
        <DrawingOverlay
          channelId={payload.channel_id}
          ownSession={payload.own_session}
          videoRef={videoRef}
          hideToolbar
          viewOnly
        />
      )}
    </PopoutShell>
  );
}
