/**
 * Server-relayed screen sharing: Rust-native capture + WebRTC SFU.
 *
 * Architecture: capture and H.264 encoding happen in Rust (the
 * `fancy-screenshare` crate, driven via the `start_screen_broadcast` /
 * `stop_screen_broadcast` commands).  The Rust broadcaster sends ONE WebRTC
 * stream to the Mumble server's SFU (Selective Forwarding Unit), which
 * re-broadcasts it to each viewer via separate WebRTC connections.
 * Broadcaster upload is O(1) regardless of viewer count.
 *
 * The webview never holds a local capture MediaStream.  Instead, the
 * broadcaster's own preview is a *loopback viewer*: we watch our own SFU
 * session like any other viewer, so the preview `<video>` plays the pixels
 * that are actually transmitted (encode round-trip included).
 *
 * All signaling travels over the existing Mumble TCP connection using
 * WebRtcSignal protobuf messages (ID 120).  Media flows via WebRTC
 * UDP between each client and the server (never client-to-client).
 * The SFU's answer to the Rust broadcaster's offer is intercepted natively
 * (`try_intercept_answer`) and never reaches this dispatcher; every answer
 * seen here belongs to a webview viewer peer.
 *
 * SignalType enum (matches proto):
 *   START         = 0  - broadcaster announces (channel broadcast). The
 *                        payload (JSON, may be empty on legacy clients)
 *                        maps each video track's SDP mid to its content
 *                        ("screen" | "camera") for screen+camera shares.
 *   STOP          = 1  - broadcaster stops (channel broadcast)
 *   SDP_OFFER     = 2  - client sends offer to server SFU
 *   SDP_ANSWER    = 3  - server SFU replies with answer
 *   ICE_CANDIDATE = 4  - client sends ICE candidate to server
 */
import { useEffect, useCallback, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit as emitTauri, listen as listenTauri } from "@tauri-apps/api/event";
import { useAppStore, onWebRtcSignal } from "@core/store";
import {
  getPreviewPc,
  handlePreviewAnswer,
  handlePreviewIceCandidate,
  clearThumbnail,
  closePreview,
  storeLocalThumbnail,
} from "./useStreamPreview";
import { clearAllStrokesInChannel, clearStrokesFromSender } from "../drawing/DrawingOverlay";
import type { SourceSelection } from "./ScreenSharePickerDialog";
import { QUALITY_PRESETS, type StreamSettings } from "@core/features/chat/stream/streamSettings";
import { createPcStatsSampler } from "./StreamStatsPanel";
import { buildStartPayload, LEGACY_TRACKS, parseStartPayload, trackContentBySession } from "./trackContent";
import {
  activeStreamViewerStrategy,
  registerStreamViewerStrategy,
  StreamViewerStrategyId,
} from "./viewerStrategy";
// Side-effect import: the NATIVE viewer strategy registers at that module's
// tail, and this hook's effects (channel auto-connect) consult the registry
// before any stream viewport - the module's other consumer - has ever been
// lazy-loaded. Without this eager pull the registry held only the webview
// family, which is unavailable on Linux ("no stream viewer strategy
// registered" on fresh load). The import cycle with that module is safe:
// it reaches back only for hoisted functions, called later.
import "./nativeStreamView";

// This module holds singleton WebRTC state (viewerPcs, the broadcast pin,
// etc.).  Vite HMR would otherwise hot-swap the module while leaving stale
// closures in the store's signal-handler registry, causing SDP answers to be
// routed to a dead module instance.  Forcing a full reload on any change
// keeps dev behaviour aligned with production.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}

// Proto SignalType enum values (must match Mumble.proto).
const SIGNAL_START = 0;
const SIGNAL_STOP = 1;
const SIGNAL_SDP_OFFER = 2;
const SIGNAL_SDP_ANSWER = 3;
const SIGNAL_ICE_CANDIDATE = 4;

// ---------------------------------------------------------------------------
// Track metadata (what each broadcast video track shows)
// ---------------------------------------------------------------------------
// Lives in the leaf module trackContent.ts (nativeStreamView reads it too;
// a direct import here would close an HMR-fatal cycle). Re-exported so the
// existing consumers of this module keep their import site.

export { getTrackContentMap } from "./trackContent";
export type { TrackContent, TrackContentMap } from "./trackContent";

// STUN servers for the client to discover its public address.
// The server SFU uses ICE-lite and needs no STUN.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
};

// ---------------------------------------------------------------------------
// Signal helpers
// ---------------------------------------------------------------------------

/** Send a signaling message to a specific session (or 0 for channel broadcast).
 *
 * `serverId` MUST be the id of the connection that owns this peer
 * connection.  Without it, the backend would send the signal through
 * whichever tab is currently active - so when the user switches tabs
 * while a viewer is still gathering ICE candidates, those candidates
 * would leak through the wrong connection and the SFU handshake would
 * never complete.
 */
function sendSignal(
  targetSession: number,
  signalType: number,
  payload: string,
  serverId: string | null,
): void {
  const { sendWebRtcSignal } = useAppStore.getState();
  void sendWebRtcSignal(targetSession, signalType, payload, serverId);
}

/** Broadcast a signal to all users in our channel (target_session = 0). */
function broadcastSignal(signalType: number, payload: string, serverId: string | null): void {
  sendSignal(0, signalType, payload, serverId);
}

/** Show a WebRTC error inline banner via the Zustand store (callable from module-level callbacks). */
function showWebRtcError(message: string): void {
  useAppStore.setState({ webrtcError: message });
}

/** One-shot marker for the "no webview WebRTC" log in {@link startWatching}
 *  (the auto-connect effect calls it repeatedly). */
let warnedNoWebviewRtc = false;

/** Cached `screen_share_capabilities` answer (platform-constant, so it is
 *  fetched once per webview and shared by every hook instance). */
let portalPickerCache: boolean | null = null;

/** Whether the OS portal replaces the in-app source picker (GNOME). */
async function fetchPortalPicker(): Promise<boolean> {
  if (portalPickerCache === null) {
    try {
      const caps = await invoke<{ portalPicker: boolean }>("screen_share_capabilities");
      portalPickerCache = caps.portalPicker;
    } catch (e) {
      console.warn("[screenshare] screen_share_capabilities failed:", e);
      portalPickerCache = false;
    }
  }
  return portalPickerCache;
}

// ---------------------------------------------------------------------------
// Broadcaster state (module-level singleton - only one broadcast at a time)
//
// The capture pipeline itself lives in Rust; what remains here is the
// bookkeeping the webview owns: which connection/channel the broadcast is
// pinned to, plus the drawing-overlay lifecycle tied to it.
// ---------------------------------------------------------------------------

/** ServerId of the connection that owns the active broadcast.
 *  See {@link sendSignal} for why this is required. */
let broadcasterServerId: string | null = null;

/** Channel the local broadcaster started sharing in.  Used to wipe
 *  drawings tied to the broadcast when it ends. */
let broadcasterChannelId: number | null = null;

/** The sources the local broadcast is capturing (display first, then
 *  camera - broadcast track order), kept so the stream-config menu can
 *  restart it at new settings without re-opening the picker. */
let broadcasterSources: readonly SourceSelection[] | null = null;

/** Encoder settings the local broadcast is running at (default HD). */
let broadcasterSettings: StreamSettings = QUALITY_PRESETS.hd;

/** True while a source-change (replace) is settling. On a replace the loopback
 *  viewer's transceivers are reused, so when a track is removed its slot keeps
 *  presenting the OLD frame until the new media arrives on the (renumbered)
 *  mids. Clearing the "setting up" overlay the instant the broadcaster reports
 *  "connected" would expose that stale frame (the "screen, then camera" flash);
 *  we hold the overlay a short settle past "connected" instead. */
let broadcastReplaceSettling = false;

/** How long to keep the "setting up" overlay after a replace connects, to mask
 *  the reused transceivers swapping content. */
const REPLACE_SETTLE_MS = 600;

/** Clean up the webview-side broadcast bookkeeping (drawing overlay,
 *  annotations, connection pin).  The Rust capture/peer is stopped
 *  separately - see {@link endOwnBroadcast}. */
function stopBroadcasting(): void {
  // Closing the desktop drawing-overlay window here (rather than from a
  // React unmount effect) ensures the overlay survives tab switches and
  // is only torn down when the broadcast actually ends.
  if (useAppStore.getState().desktopDrawingOverlayOpen) {
    invoke("close_drawing_overlay").catch(() => {});
  }
  useAppStore.setState((s) => {
    const drawing = new Set(s.drawingActiveChannels);
    if (broadcasterChannelId !== null) drawing.delete(broadcasterChannelId);
    return {
      webrtcConnecting: false,
      captureStalled: false,
      desktopDrawingOverlayOpen: false,
      drawingActiveChannels: drawing,
    };
  });
  broadcasterServerId = null;
  broadcastReplaceSettling = false;
  // Wipe every annotation that was drawn on this broadcast (including
  // viewers' annotations on the local cache) so the next share starts
  // with a clean canvas and stale drawings don't reappear if the user
  // shares again later.
  if (broadcasterChannelId !== null) {
    clearAllStrokesInChannel(broadcasterChannelId);
    broadcasterChannelId = null;
  }
}

/** Stop the broadcast this window owns, from outside the hook.
 *
 *  {@link useScreenShare} owns the capture and only one component may mount
 *  it, but stopping is a plain command with no state of its own - and the
 *  controls that offer it (Nebula's voice dock among them) live elsewhere in
 *  the tree. Everything it touches is module state or the store, so it is safe
 *  to call from anywhere; {@link ScreenShareHook.stopSharing} is this. */
export function stopOwnBroadcast(): void {
  broadcasterSources = null;
  endOwnBroadcast("user stopped");
}

/** Tear down the local broadcast end-to-end: the Rust capture/peer, the
 *  loopback viewer feeding the own-preview, webview bookkeeping, store
 *  state, and the STOP announcement to the channel.  Shared by the header
 *  toggle and the Rust broadcaster's failure path. */
function endOwnBroadcast(reason: string): void {
  console.info(`[screenshare] ending own broadcast (${reason})`);
  // Capture the pinned connection BEFORE stopBroadcasting() clears it - the
  // STOP signal must travel through the connection that announced the share.
  const sid = broadcasterServerId;
  const own = useAppStore.getState().broadcastingOwnSession;
  invoke("stop_screen_broadcast").catch((e) =>
    console.warn("[screenshare] stop_screen_broadcast failed:", e),
  );
  if (own !== null) {
    closeViewer(own);
    trackContentBySession.delete(own);
  }
  stopBroadcasting();
  useAppStore.setState((s) => {
    const next = new Set(s.broadcastingSessions);
    if (own !== null) next.delete(own);
    return { isSharingOwn: false, broadcastingOwnSession: null, broadcastingSessions: next };
  });
  if (own !== null) broadcastSignal(SIGNAL_STOP, "", sid);
}

// ---------------------------------------------------------------------------
// Viewer state (module-level - one WebRTC connection per broadcaster)
// ---------------------------------------------------------------------------

/** The per-broadcaster streams handed to the UI: the primary content (the
 *  screen, or the camera when nothing else is shared) and the secondary
 *  camera (only when it accompanies a screen - rendered as a PiP tile). */
export interface RemoteStreams {
  readonly primary: MediaStream | null;
  readonly camera: MediaStream | null;
}

const NO_STREAMS: RemoteStreams = { primary: null, camera: null };

interface ViewerState {
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  /** Received video tracks keyed by their SDP mid ("0", "1", ...). */
  videoByMid: Map<string, MediaStreamTrack>;
  /** Received audio tracks (attached to the primary stream). */
  audioTracks: MediaStreamTrack[];
  /** Stable stream objects (so <video>.srcObject never needs re-attaching);
   *  tracks are swapped in/out as they arrive or metadata changes. */
  primaryStream: MediaStream;
  cameraStream: MediaStream;
  /** ServerId of the connection that owns this viewer PC. */
  serverId: string | null;
}

const viewerPcs = new Map<number, ViewerState>();
const remoteStreamListeners = new Map<number, Set<(streams: RemoteStreams) => void>>();

/** Sort mids numerically ("2" after "10" would be wrong lexically). */
function midOrder(a: string, b: string): number {
  return Number(a) - Number(b);
}

/**
 * Assemble the UI-facing streams for a broadcaster from the tracks received
 * so far plus the announced per-mid content map. Called whenever either side
 * changes (a track arrived, or a START announce updated the metadata).
 */
function computeStreams(session: number): RemoteStreams {
  const state = viewerPcs.get(session);
  if (!state) return NO_STREAMS;
  const contentByMid = trackContentBySession.get(session) ?? LEGACY_TRACKS;

  let screenTrack: MediaStreamTrack | null = null;
  let cameraTrack: MediaStreamTrack | null = null;
  for (const mid of [...state.videoByMid.keys()].sort(midOrder)) {
    const content = contentByMid[mid];
    if (content === undefined) continue; // unannounced m-line (silent slot)
    const track = state.videoByMid.get(mid)!;
    if (content === "camera") {
      cameraTrack ??= track;
    } else {
      screenTrack ??= track;
    }
  }

  const primaryTrack = screenTrack ?? cameraTrack;
  const pipTrack = screenTrack !== null ? cameraTrack : null;

  syncStreamTracks(state.primaryStream, [...(primaryTrack ? [primaryTrack] : []), ...state.audioTracks]);
  syncStreamTracks(state.cameraStream, pipTrack ? [pipTrack] : []);

  return {
    primary: primaryTrack ? state.primaryStream : null,
    camera: pipTrack ? state.cameraStream : null,
  };
}

/** Make `stream` contain exactly `tracks` (identity-preserving). */
function syncStreamTracks(stream: MediaStream, tracks: readonly MediaStreamTrack[]): void {
  for (const existing of stream.getTracks()) {
    if (!tracks.includes(existing)) stream.removeTrack(existing);
  }
  for (const track of tracks) {
    if (!stream.getTrackById(track.id)) stream.addTrack(track);
  }
}

function notifyStreamListeners(session: number, streams: RemoteStreams): void {
  const listeners = remoteStreamListeners.get(session);
  if (listeners) {
    for (const cb of listeners) cb(streams);
  }
}

/** Recompute and publish a broadcaster's streams (track or metadata change). */
function refreshStreams(session: number): void {
  notifyStreamListeners(session, computeStreams(session));
}

function flushViewerIce(session: number): void {
  const state = viewerPcs.get(session);
  if (!state) return;
  for (const c of state.pendingIce) {
    state.pc.addIceCandidate(c).catch((e) => console.error("[sfu] viewer addIceCandidate error:", e));
  }
  state.pendingIce = [];
}

function closeViewer(session?: number): void {
  if (session === undefined) {
    for (const [sess, state] of viewerPcs) {
      state.pc.close();
      notifyStreamListeners(sess, NO_STREAMS);
    }
    viewerPcs.clear();
    return;
  }
  const state = viewerPcs.get(session);
  if (state) {
    state.pc.close();
    viewerPcs.delete(session);
    notifyStreamListeners(session, NO_STREAMS);
  }
}

/** Tear down a dead viewer PC and, while its broadcast is still announced,
 *  rebuild it with a fresh offer; otherwise clear the watch state. */
function reconnectOrDropViewer(broadcasterSession: number): void {
  closeViewer(broadcasterSession);
  if (useAppStore.getState().broadcastingSessions.has(broadcasterSession)) {
    startWatching(broadcasterSession).catch((e) => console.error("[sfu] viewer reconnect failed:", e));
    return;
  }
  const { watchingSession } = useAppStore.getState();
  if (watchingSession === broadcasterSession) {
    useAppStore.setState({ watchingSession: null, watchingOwnSession: null });
  }
}

/**
 * Playout-delay policy for received screen-share video: let Chromium run its
 * own estimator at its minimum, and never floor it from here.
 *
 * There used to be an adaptive controller in this file that grew
 * `jitterBufferTarget` by 400 ms on every tick where `freezeCount` moved,
 * up to a 2 s ceiling. It was wrong twice over.
 *
 * Wrong signal: a "freeze" is Chromium scoring an inter-frame gap at
 * >= max(3x average, average + 150 ms). Those gaps are SENDER gaps - the
 * capture pipeline produced nothing. No amount of receive buffering invents a
 * frame that was never sent, so the knob cannot fix what the counter reports,
 * and the loop just kept ratcheting.
 *
 * Wrong direction: `jitterBufferTarget` is a FLOOR on playout delay
 * (Chromium plays out at max(target, its own estimate)), and the shrink path
 * required three clean ticks AND a per-tick buffer-occupancy spread under
 * 80 ms - a test that screen content, which alternates between ~30 fps active
 * and the ~11 fps idle keep-alive, essentially never passes. So the target
 * climbed to 2000 ms and stayed there: the buffer that "only ever goes up".
 *
 * The actual cause of the fake jitter was on the sender - RTP timestamps
 * lagged one frame behind the real emit cadence (see `RtpStamper` in
 * fancy-screenshare's broadcast.rs). With honest timestamps Chromium sees
 * only real network jitter, which is exactly what its estimator is built for:
 * it reacts to a late frame immediately and decays the delay back down on its
 * own. Leaving the floor at 0 is what makes the latency the lowest available,
 * and it costs no smoothness - Chromium still buffers for whatever jitter it
 * genuinely measures.
 *
 * If a future change needs depth here, drive it from arrival-vs-timestamp
 * lateness, never from `freezeCount`.
 */
const JB_TARGET_MS = 0;

/** Set the jitter-buffer target on a viewer PC's video receivers. Best-effort:
 *  the property is recent (Chromium/WebView2), with `playoutDelayHint` as an
 *  older fallback; failure just leaves the UA's adaptive default. */
function applyVideoJitterBufferTarget(pc: RTCPeerConnection, targetMs: number): void {
  for (const receiver of pc.getReceivers()) {
    // Right after addTransceiver the track is not yet attached (kind unknown);
    // skip only receivers already known to be audio. Screen shares carry no
    // audio here, so setting it on a not-yet-typed receiver is harmless.
    if (receiver.track?.kind === "audio") continue;
    const r = receiver as RTCRtpReceiver & {
      jitterBufferTarget?: number | null;
      playoutDelayHint?: number;
    };
    try {
      if ("jitterBufferTarget" in receiver) {
        r.jitterBufferTarget = targetMs;
      } else if ("playoutDelayHint" in receiver) {
        r.playoutDelayHint = targetMs / 1000;
      }
    } catch (e) {
      console.warn("[sfu] could not set video jitter buffer target:", e);
    }
  }
}

/** Connect to the server SFU to watch a broadcaster's stream. Returns immediately if already connected.
 *
 * Watching your OWN session is the loopback own-preview: the SFU serves our
 * broadcast back to us exactly like it serves any other viewer.
 */
async function startWatching(broadcasterSession: number): Promise<void> {
  // Linux: distro WebKitGTK builds ship without WebRTC compiled in (Ubuntu's
  // does), so the webview simply has no RTCPeerConnection and webview viewer
  // PCs cannot exist. Viewing runs through the NATIVE Rust viewer instead
  // (NativeStreamView -> start_native_stream_view), driven by the viewer
  // components on mount - so this whole function is a no-op there.
  if (typeof RTCPeerConnection === "undefined") {
    if (!warnedNoWebviewRtc) {
      warnedNoWebviewRtc = true;
      console.info(
        "[sfu] webview has no RTCPeerConnection (WebKit built without WebRTC); stream viewing uses the native Rust viewer",
      );
    }
    return;
  }
  if (viewerPcs.has(broadcasterSession)) {
    console.info(`[sfu] viewer for ${broadcasterSession} already open`);
    return;
  }

  console.info(`[sfu] opening viewer for session ${broadcasterSession}`);
  closePreview();

  // Pin this viewer to the connection that is active *now* so that
  // trickling ICE candidates and SDP offers always travel through the
  // connection that owns the peer connection - even after the user
  // switches to another server tab.
  const sid = useAppStore.getState().activeServerId;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const state: ViewerState = {
    pc,
    pendingIce: [],
    videoByMid: new Map(),
    audioTracks: [],
    primaryStream: new MediaStream(),
    cameraStream: new MediaStream(),
    serverId: sid,
  };
  viewerPcs.set(broadcasterSession, state);

  // TWO video slots: broadcasts may carry screen + camera as separate
  // tracks (mids "0"/"1"). Against a single-track broadcaster the second
  // m-line simply stays silent - no renegotiation is ever needed when the
  // broadcaster adds/removes its camera mid-share.
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  applyVideoJitterBufferTarget(pc, JB_TARGET_MS);

  pc.ontrack = (e) => {
    const s = viewerPcs.get(broadcasterSession);
    if (!s) return;
    if (e.track.kind === "video") {
      // The mid identifies the broadcast track; the START announce says
      // whether it carries the screen or the camera.
      const mid = e.transceiver.mid;
      if (mid !== null) s.videoByMid.set(mid, e.track);
    } else if (!s.audioTracks.some((t) => t.id === e.track.id)) {
      s.audioTracks.push(e.track);
    }
    refreshStreams(broadcasterSession);
  };

  // Send our ICE candidates to the server (routed via broadcaster session).
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    // With the server SFU active, client ICE candidates are ignored
    // server-side (ICE-lite: it learns our address from the STUN binding
    // requests; its own candidate rides in the SDP answer). Worse, every
    // candidate is its own invoke that RACES the SDP-offer invoke into
    // murmur's shared leaky bucket (1 msg/s, burst 5) - when the trickle
    // wins, the offer itself is silently rate-dropped and the stream
    // never starts. Only the SFU-less peer-to-peer fallback needs them.
    if (useAppStore.getState().serverConfig.webrtc_sfu_available) return;
    sendSignal(broadcasterSession, SIGNAL_ICE_CANDIDATE, JSON.stringify(e.candidate.toJSON()), sid);
  };

  pc.onconnectionstatechange = () => {
    if (viewerPcs.get(broadcasterSession)?.pc !== pc) return; // stale closure
    if (pc.connectionState === "disconnected") {
      // Usually transient (a missed ICE consent check under load) and
      // Chromium recovers to "connected" on its own. Give it a grace
      // period; only rebuild the viewer if it never comes back.
      console.warn(`[sfu] viewer PC for ${broadcasterSession} disconnected - awaiting recovery`);
      setTimeout(() => {
        if (viewerPcs.get(broadcasterSession)?.pc !== pc) return;
        if (pc.connectionState === "connected") return; // recovered
        console.warn(`[sfu] viewer PC for ${broadcasterSession} did not recover`);
        reconnectOrDropViewer(broadcasterSession);
      }, 5000);
      return;
    }
    if (pc.connectionState === "failed") {
      console.warn(`[sfu] viewer PC for ${broadcasterSession} failed`);
      reconnectOrDropViewer(broadcasterSession);
    }
  };

  const offer = await pc.createOffer();
  if (viewerPcs.get(broadcasterSession)?.pc !== pc) {
    console.warn(`[sfu] viewer for ${broadcasterSession} replaced during createOffer`);
    return;
  }
  await pc.setLocalDescription(offer);
  if (viewerPcs.get(broadcasterSession)?.pc !== pc) {
    console.warn(`[sfu] viewer for ${broadcasterSession} replaced during setLocalDescription`);
    return;
  }

  // Send offer to server, targeting the broadcaster session.
  // The server intercepts this and creates an SFU outbound peer.
  const offerSdp = offer.sdp!;
  sendSignal(broadcasterSession, SIGNAL_SDP_OFFER, offerSdp, sid);
  console.info(`[sfu] viewer offer sent for session ${broadcasterSession}`);

  // The Mumble control channel silently rate-limits (leaky bucket, ~1 msg/s
  // with a small burst, shared with everything else this client sends), and
  // a broadcast start emits several signals back-to-back - this offer can be
  // dropped without any trace. Re-send it until the SFU's answer arrives
  // (extra answers to the same offer are ignored by the have-local-offer
  // check in the dispatcher).
  let attempts = 1;
  const retry = setInterval(() => {
    const s = viewerPcs.get(broadcasterSession);
    if (!s || s.pc !== pc || pc.signalingState !== "have-local-offer" || attempts >= 5) {
      clearInterval(retry);
      return;
    }
    attempts += 1;
    console.info(`[sfu] re-sending viewer offer for ${broadcasterSession} (attempt ${attempts})`);
    sendSignal(broadcasterSession, SIGNAL_SDP_OFFER, offerSdp, s.serverId);
  }, 1500);
}

/** Handle an SDP answer from the server SFU. */
async function handleServerAnswer(pc: RTCPeerConnection, sdp: string): Promise<void> {
  await pc.setRemoteDescription({ type: "answer", sdp });
}

// ---------------------------------------------------------------------------
// Incoming signal dispatcher
// ---------------------------------------------------------------------------

/** Route an SDP answer to the viewer peer that is waiting for one.
 *
 * The answer to the Rust broadcaster's offer never arrives here - it is
 * claimed natively before the `webrtc-signal` event is emitted (see
 * `try_intercept_answer` in `commands/screenshare.rs`).
 */
function routeSdpAnswer(senderSession: number, payload: string): void {
  // Viewer PCs are keyed by the broadcaster's session, so if we are
  // watching `senderSession` the answer is for that viewer PC.  The
  // loopback own-preview is keyed by our own session and matches the
  // same way (the SFU addresses its answer to us).
  const viewerState = viewerPcs.get(senderSession);
  if (viewerState?.pc.signalingState === "have-local-offer") {
    handleServerAnswer(viewerState.pc, payload)
      .then(() => flushViewerIce(senderSession))
      .catch((e) => console.error("[sfu] viewer setRemoteDescription error:", e));
    return;
  }

  if (getPreviewPc()?.signalingState === "have-local-offer") {
    handlePreviewAnswer(payload);
    return;
  }

  const answerUfrag = /a=ice-ufrag:([^\r\n]+)/.exec(payload)?.[1] ?? "?";
  console.warn("[sfu] SDP answer received but no peer is expecting one", {
    senderSession,
    viewerSessions: [...viewerPcs.keys()],
    answerUfrag,
    payloadLength: payload.length,
  });
}

/** Route an ICE candidate to the correct peer (viewer by sender session > preview).
 *
 * With the SFU active the server never trickles candidates (they ride in
 * its ICE-lite SDP answer), so in practice this only serves legacy paths.
 */
function routeIceCandidate(senderSession: number, payload: string): void {
  let candidate: RTCIceCandidateInit | null = null;
  try {
    candidate = JSON.parse(payload) as RTCIceCandidateInit;
  } catch {
    return;
  }
  if (!candidate) return;

  const viewerState = viewerPcs.get(senderSession);
  if (viewerState) {
    if (viewerState.pc.remoteDescription) {
      viewerState.pc.addIceCandidate(candidate).catch(console.error);
    } else {
      viewerState.pendingIce.push(candidate);
    }
    return;
  }

  if (getPreviewPc()) {
    handlePreviewIceCandidate(candidate);
  }
}

function handleSignal(
  senderSession: number,
  _targetSession: number | null,
  signalType: number,
  payload: string,
): void {
  // The Mumble server only forwards PluginData to the explicit
  // `receiver_sessions` list, so any signal we receive is already
  // intended for one of *our* connections.  We must NOT filter by
  // the active tab's `ownSession` here: this hook runs in a single
  // JS realm shared by every server tab, so the active tab's
  // session ID is unrelated to the connection that delivered this
  // signal.  Filtering by it would drop signals destined for
  // background-tab connections (e.g. a viewer's SDP_ANSWER arriving
  // while the broadcaster's tab is foreground).

  switch (signalType) {
    case SIGNAL_START:
      // The payload announces what each broadcast track (mid) carries; a
      // re-announce mid-broadcast updates it (e.g. camera added/removed on
      // a source change). Empty payloads come from legacy broadcasters.
      trackContentBySession.set(senderSession, parseStartPayload(payload));
      refreshStreams(senderSession);
      useAppStore.setState((s) => {
        const next = new Set(s.broadcastingSessions);
        next.add(senderSession);
        return { broadcastingSessions: next };
      });
      break;

    case SIGNAL_STOP:
      useAppStore.setState((s) => {
        const next = new Set(s.broadcastingSessions);
        next.delete(senderSession);
        const watchingCleared = s.watchingSession === senderSession;
        return {
          broadcastingSessions: next,
          watchingSession: watchingCleared ? null : s.watchingSession,
          watchingOwnSession: watchingCleared ? null : s.watchingOwnSession,
        };
      });
      trackContentBySession.delete(senderSession);
      clearThumbnail(senderSession);
      closeViewer(senderSession);
      // The broadcaster's annotations only made sense while their
      // stream was visible - drop them now that the stream is gone
      // so a future share doesn't start with leftover scribbles.
      clearStrokesFromSender(senderSession);
      // Notify popout windows so they can self-close when their
      // broadcaster stops sharing.
      emitTauri("screen-share-stopped", { session: senderSession }).catch((e) =>
        console.warn("[screenshare] emit stopped failed", e),
      );
      break;

    case SIGNAL_SDP_ANSWER:
      routeSdpAnswer(senderSession, payload);
      break;

    case SIGNAL_ICE_CANDIDATE:
      routeIceCandidate(senderSession, payload);
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export interface ScreenShareHook {
  /** Whether we are currently broadcasting our screen. */
  isBroadcasting: boolean;
  /** Whether *another* tab in the same window is currently broadcasting.
   *  Only one capture can run at a time, so the share button on every
   *  other tab must be disabled while this is true. */
  isBroadcastingFromOtherTab: boolean;
  /** Session IDs of other users currently broadcasting. */
  broadcastingSessions: Set<number>;
  /** Session we are currently watching (null if not watching). */
  watchingSession: number | null;
  /** The own-preview MediaStream (the loopback view of our own SFU
   *  session). null while not broadcasting or still connecting. The camera
   *  PiP companion is fetched by the viewer components themselves via
   *  {@link useRemoteStreams}. */
  localStream: MediaStream | null;
  /** Whether the source-picker dialog is open. */
  pickerOpen: boolean;
  /** GNOME: the compositor's portal dialog replaces the in-app screen/window
   *  picker. {@link startSharing} portals directly (no dialog here), cameras
   *  get their own button ({@link startCameraSharing}), and the picker only
   *  ever opens in camera-only mode ({@link pickerDeviceOnly}). */
  portalPicker: boolean;
  /** The open picker is in camera-only mode (portal flow): screen/window
   *  tabs hidden, the live display source carried through untouched. */
  pickerDeviceOnly: boolean;
  /** Encoder settings the current/next broadcast uses (for the picker + menu). */
  settings: StreamSettings;
  /** Sources of the ACTIVE broadcast (display first, then camera), or null
   *  when not broadcasting. Lets the picker seed its selection so confirming
   *  ADDS to the live share instead of replacing it wholesale, and lets the
   *  viewer offer an "add the missing kind" shortcut. */
  activeSources: readonly SourceSelection[] | null;
  /** Open the source picker (does not start capturing yet). Works while
   *  already broadcasting too - confirming replaces the live sources. On
   *  GNOME ({@link portalPicker}) this skips the in-app picker and raises
   *  the compositor's own source dialog instead. */
  startSharing: () => void;
  /** Share (or re-pick) a camera: runs the system camera consent when the
   *  platform has one, then opens the picker in camera-only mode. */
  startCameraSharing: () => void;
  /** Close the source picker without sharing. */
  cancelPicker: () => void;
  /** Start (or replace) the broadcast with the picked sources + settings.
   *  Order matters: display source first, then camera (track/mid order).
   *  `opts.reuseDisplay` marks a replace that keeps the display source, so
   *  the Linux portal restores the previous pick without re-prompting. */
  confirmSource: (
    sources: readonly SourceSelection[],
    settings: StreamSettings,
    opts?: { readonly reuseDisplay?: boolean },
  ) => Promise<void>;
  /** Restart the live broadcast at new settings (same sources). */
  changeSettings: (settings: StreamSettings) => void;
  /** Stop sharing our screen. */
  stopSharing: () => void;
  /** Start watching another user's broadcast. */
  watchBroadcast: (session: number) => void;
  /** Stop watching. */
  stopWatching: () => void;
}

export function useScreenShare(): ScreenShareHook {
  const ownSession = useAppStore((s) => s.ownSession);
  const users = useAppStore((s) => s.users);
  const currentChannel = useAppStore((s) => s.currentChannel);
  const broadcastingSessions = useAppStore((s) => s.broadcastingSessions);
  const watchingSessionRaw = useAppStore((s) => s.watchingSession);
  const watchingOwnSession = useAppStore((s) => s.watchingOwnSession);
  const broadcastingOwnSession = useAppStore((s) => s.broadcastingOwnSession);
  // Only treat *this* tab as the broadcaster when its `ownSession`
  // matches the one that started the capture.  Without this guard a
  // second server tab in the same window would inherit the global
  // `isSharingOwn` flag, causing the desktop-overlay button and a
  // phantom local preview to appear on the wrong tab.
  const isBroadcasting =
    broadcastingOwnSession !== null && ownSession !== null && broadcastingOwnSession === ownSession;
  // True when a different tab in the same window already owns the
  // singleton broadcast state.  Only one Rust capture runs per app,
  // so attempting to share again from another tab must be blocked.
  const isBroadcastingFromOtherTab =
    broadcastingOwnSession !== null && (ownSession === null || broadcastingOwnSession !== ownSession);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDeviceOnly, setPickerDeviceOnly] = useState(false);
  const [portalPicker, setPortalPicker] = useState(portalPickerCache ?? false);

  // Platform-constant; resolves from cache instantly after the first fetch.
  useEffect(() => {
    void fetchPortalPicker().then(setPortalPicker);
  }, []);

  // The own-preview: the loopback viewer's primary remote stream for our
  // session (the camera PiP is picked up by the viewer components).
  const loopbackStream = useRemoteStream(ownSession ?? -1);

  // Track channel members so we can re-announce to late joiners.
  const prevChannelSessionsRef = useRef<Set<number>>(new Set());

  // Register the WebRTC signal handler for screen share signaling.
  useEffect(() => {
    const unregister = onWebRtcSignal((senderSession, targetSession, signalType, payload) => {
      if (senderSession === null) return;
      handleSignal(senderSession, targetSession, signalType, payload);
    });
    return unregister;
  }, []);

  // React to the Rust broadcaster's lifecycle (fancy-screenshare): clear the
  // "setting up" state once media flows, and tear everything down when the
  // capture dies (shared window closed, ICE failed, ...).
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void Promise.resolve()
      .then(() =>
        listenTauri<{ state: string; message: string | null }>("screen-broadcast-state", (event) => {
          const { state: bcState, message } = event.payload;
          if (bcState === "connected") {
            // On a replace, hold the "setting up" overlay a short settle past
            // "connected" so the reused transceivers finish swapping content
            // (removing a track otherwise flashes the old frame briefly).
            if (broadcastReplaceSettling) {
              broadcastReplaceSettling = false;
              setTimeout(() => useAppStore.setState({ webrtcConnecting: false }), REPLACE_SETTLE_MS);
            } else {
              useAppStore.setState({ webrtcConnecting: false });
            }
          } else if (bcState === "failed") {
            console.error("[screenshare] Rust broadcaster failed:", message);
            // Guard: popout webviews register this listener too, but only
            // the realm that owns the broadcast state may react.
            if (useAppStore.getState().broadcastingOwnSession === null) return;
            endOwnBroadcast(`broadcaster failed: ${message ?? "unknown"}`);
            showWebRtcError(
              message !== null && message !== ""
                ? `Screen sharing failed: ${message}`
                : "Screen sharing failed.",
            );
          } else if (bcState === "captureStalled" || bcState === "captureResumed") {
            // Advisory hint for the GNOME/NVIDIA fullscreen direct-scanout
            // capture stall (Linux monitor shares only; see fancy-screenshare
            // StallWatch). The broadcast keeps running - just flag it so the
            // own-preview can suggest sharing the window instead.
            if (useAppStore.getState().broadcastingOwnSession === null) return;
            useAppStore.setState({ captureStalled: bcState === "captureStalled" });
          }
        }),
      )
      .then((un) => {
        if (disposed) {
          un();
        } else {
          unlisten = un;
        }
      })
      .catch((reason) => console.debug("[screenshare] broadcast lifecycle listener unavailable:", reason));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Re-announce broadcast when new users join our channel (late-joiner fix).
  useEffect(() => {
    if (!isBroadcasting || !ownSession || currentChannel === null) return;
    const currentSessions = new Set(
      users.filter((u) => u.channel_id === currentChannel).map((u) => u.session),
    );
    const prev = prevChannelSessionsRef.current;
    // Check if any sessions are new (not in previous set).
    const hasNewMembers = [...currentSessions].some((s) => s !== ownSession && !prev.has(s));
    if (hasNewMembers) {
      // Send via the broadcaster's connection so the announcement
      // reaches the right channel even when the user has switched tabs.
      // Re-announces MUST carry the same track payload as the original
      // START: every channel member re-parses it, and an empty payload
      // would downgrade their metadata to "single screen track".
      broadcastSignal(
        SIGNAL_START,
        broadcasterSources ? buildStartPayload(broadcasterSources) : "",
        broadcasterServerId,
      );
    }
    prevChannelSessionsRef.current = currentSessions;
  }, [users, currentChannel, ownSession, isBroadcasting]);

  // Clean up when the user disconnects.
  useEffect(() => {
    if (!ownSession) {
      if (useAppStore.getState().broadcastingOwnSession !== null) {
        invoke("stop_screen_broadcast").catch(() => {});
      }
      stopBroadcasting();
      closeViewer();
      setPickerOpen(false);
    }
  }, [ownSession]);

  // Maintain a live thumbnail of the own stream so it can appear as a
  // secondary panel in StreamFocusView while watching another broadcaster.
  // Refreshes every 55 s (well within the 60 s TTL) to prevent stale cache.
  useEffect(() => {
    if (!isBroadcasting || !loopbackStream || !ownSession) return;
    storeLocalThumbnail(ownSession, loopbackStream).catch(console.error);
    const interval = setInterval(() => {
      storeLocalThumbnail(ownSession, loopbackStream).catch(console.error);
    }, 55_000);
    return () => {
      clearInterval(interval);
      clearThumbnail(ownSession);
    };
  }, [isBroadcasting, loopbackStream, ownSession]);

  /** Shared preflight of every share entry point: surface a missing SFU. */
  const warnWhenNoSfu = () => {
    const { serverConfig } = useAppStore.getState();
    if (serverConfig.webrtc_sfu_available) {
      console.info("[screen-share] server has WebRTC SFU - media will be relayed via server");
    } else {
      console.warn("[screen-share] server does NOT have WebRTC SFU - screen sharing may not work");
      showWebRtcError(
        "This server does not have a WebRTC relay configured. Screen sharing is unlikely to work.",
      );
    }
  };

  const cancelPicker = useCallback(() => setPickerOpen(false), []);

  const confirmSource = useCallback(
    async (
      sources: readonly SourceSelection[],
      settings: StreamSettings,
      opts?: { readonly reuseDisplay?: boolean },
    ) => {
      setPickerOpen(false);
      if (ownSession === null) {
        console.warn("[screenshare] confirmSource ignored: no ownSession");
        return;
      }
      if (sources.length === 0) {
        console.warn("[screenshare] confirmSource ignored: no sources");
        return;
      }
      // Replacing an already-running broadcast (Change Stream / Change
      // Quality): the Rust broadcaster swaps its capture+peer in place and
      // the SFU keeps forwarding to existing viewers, so we keep the
      // loopback viewer we already have.
      const isReplace = useAppStore.getState().broadcastingOwnSession === ownSession;
      // Mask the reused-transceiver content swap until the new media settles.
      broadcastReplaceSettling = isReplace;

      const { activeServerId, sendWebRtcSignal } = useAppStore.getState();
      broadcasterServerId = activeServerId;
      // Pin the broadcast to the channel the user was in when they
      // started sharing.  When the broadcast ends, every annotation in
      // that channel - drawn by the broadcaster OR any viewer - is
      // wiped (see `stopBroadcasting()`).
      broadcasterChannelId = useAppStore.getState().currentChannel;
      broadcasterSources = sources;
      broadcasterSettings = settings;
      // Label our own tracks locally (the server does not echo our START
      // back to us), so the loopback preview can split screen vs camera.
      trackContentBySession.set(ownSession, parseStartPayload(buildStartPayload(sources)));
      refreshStreams(ownSession);
      useAppStore.setState((s) => {
        const next = new Set(s.broadcastingSessions);
        next.add(ownSession);
        return {
          isSharingOwn: true,
          broadcastingOwnSession: ownSession,
          broadcastingSessions: next,
          webrtcConnecting: true,
          // Starting a fresh share moves focus to the OWN broadcast; a
          // replace keeps whatever the user was already viewing.
          watchingSession: isReplace ? s.watchingSession : null,
          watchingOwnSession: isReplace ? s.watchingOwnSession : null,
        };
      });

      // Ordering matters and all of it rides the same Mumble TCP connection:
      // the SFU creates the broadcast session when it sees START, so START
      // must be on the wire before the Rust broadcaster's SDP offer, which
      // in turn must precede our loopback-viewer offer. The payload tells
      // viewers what each track (mid) carries; on a replace it is sent
      // again purely as a metadata update (the SFU's createSession is
      // idempotent and legacy clients treat a repeat START as a no-op).
      await sendWebRtcSignal(0, SIGNAL_START, buildStartPayload(sources), activeServerId);
      try {
        await invoke("start_screen_broadcast", {
          sources: sources.map((s) => ({ kind: s.kind, id: s.id })),
          serverId: activeServerId,
          maxDimension: settings.maxDimension,
          maxFps: settings.maxFps,
          shareAudio: settings.shareAudio === true,
          reusePortalSource: opts?.reuseDisplay === true,
        });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        endOwnBroadcast("start_screen_broadcast rejected");
        // Dismissing the compositor's portal dialog surfaces as "cancelled":
        // the user changed their mind, which deserves no error banner.
        if (/cancelled/i.test(detail)) {
          console.info("[screenshare] source selection cancelled");
          return;
        }
        console.error("[screenshare] start_screen_broadcast failed:", e);
        showWebRtcError(`Screen sharing failed to start: ${detail}`);
        return;
      }
      // Loopback own-preview: watch our own SFU session so the preview
      // decodes the frames that are actually being transmitted (capture and
      // encoding live in Rust; there is no local MediaStream). No-op when
      // replacing (viewer already exists) and under the native strategy
      // (its viewport owns the receive path).
      console.info("[screenshare] broadcast started; opening loopback preview");
      activeStreamViewerStrategy()
        .createReceiveTransport(ownSession)
        .open()
        .catch((e) => console.error("[screenshare] loopback preview failed:", e));
    },
    [ownSession],
  );

  const changeSettings = useCallback(
    (settings: StreamSettings) => {
      if (!broadcasterSources) return;
      if (
        settings.maxDimension === broadcasterSettings.maxDimension &&
        settings.maxFps === broadcasterSettings.maxFps &&
        settings.shareAudio === broadcasterSettings.shareAudio
      ) {
        return;
      }
      // Same sources, new settings: let the portal restore the picked source
      // silently instead of re-raising its dialog for a quality change.
      void confirmSource(broadcasterSources, settings, { reuseDisplay: true });
    },
    [confirmSource],
  );

  const startSharing = useCallback(() => {
    // Sharing while already broadcasting is allowed: the new pick replaces
    // the live display source ("Change Stream" in the stream-config menu).
    warnWhenNoSfu();
    if (portalPicker) {
      // GNOME: the compositor's portal dialog IS the source picker. Share a
      // synthetic display source (advisory id 0; the portal chooses the real
      // one and offers its own screen-vs-window tabs) and carry a running
      // camera track across the re-pick.
      const camera = (isBroadcasting ? broadcasterSources : null)?.filter((s) => s.kind === "device") ?? [];
      void confirmSource([{ kind: "screen", id: 0 }, ...camera], broadcasterSettings);
      return;
    }
    setPickerDeviceOnly(false);
    setPickerOpen(true);
  }, [portalPicker, isBroadcasting, confirmSource]);

  const startCameraSharing = useCallback(() => {
    void (async () => {
      warnWhenNoSfu();
      try {
        // GNOME's native camera consent dialog (stored after the first
        // grant). Only an explicit denial blocks; a missing/broken portal
        // must not disable cameras that plain V4L2 can open anyway.
        const granted = await invoke<boolean>("request_camera_access");
        if (!granted) {
          showWebRtcError("Camera access was denied in the system dialog.");
          return;
        }
      } catch (e) {
        console.warn("[screenshare] request_camera_access failed:", e);
      }
      setPickerDeviceOnly(true);
      setPickerOpen(true);
    })();
  }, []);

  const stopSharingCb = useCallback(() => stopOwnBroadcast(), []);

  // Auto-connect to all active broadcasters in our channel so streams are
  // ready before the user clicks into focus view, and disconnect from
  // sessions that stopped broadcasting. Routed through the active viewer
  // strategy: the webview family pre-opens PCs, the native family no-ops
  // (its viewports open the receive path on mount).
  useEffect(() => {
    if (!ownSession) return;
    const strategy = activeStreamViewerStrategy();
    for (const session of broadcastingSessions) {
      if (session === ownSession) continue;
      const transport = strategy.createReceiveTransport(session);
      if (!transport.isOpen()) {
        transport
          .open()
          .catch((e) => console.error("[screenshare] auto-connect failed for session", session, e));
      }
    }
    // Enumerating stale sessions needs the webview family's internal map;
    // fine here (same module as that concrete factory), and empty under the
    // native strategy, whose viewports own their receive paths.
    for (const [session] of viewerPcs) {
      if (!broadcastingSessions.has(session)) {
        strategy.createReceiveTransport(session).close();
      }
    }
  }, [broadcastingSessions, ownSession]);

  const watchBroadcast = useCallback(
    (session: number) => {
      useAppStore.setState({
        watchingSession: session,
        watchingOwnSession: ownSession ?? null,
      });
      // A no-op if already connected (auto-connect above) or under the
      // native strategy (viewport-owned).
      activeStreamViewerStrategy()
        .createReceiveTransport(session)
        .open()
        .catch((e) => console.error("[screenshare] startWatching failed:", e));
    },
    [ownSession],
  );

  const stopWatchingCb = useCallback(() => {
    useAppStore.setState({ watchingSession: null, watchingOwnSession: null });
  }, []);

  // Only treat the watch state as belonging to *this* tab when its
  // `ownSession` matches the one that initiated the watch.  Without this
  // guard the broadcaster's tab would mistake the viewer tab's watch
  // state for its own and render a RemoteViewer for its own session,
  // hanging on "Connecting...".
  const watchingSession =
    watchingOwnSession !== null && ownSession !== null && watchingOwnSession === ownSession
      ? watchingSessionRaw
      : null;

  return {
    isBroadcasting,
    isBroadcastingFromOtherTab,
    broadcastingSessions,
    watchingSession,
    // Only expose the loopback streams to the tab that owns the broadcast.
    // Other tabs in the same window must never see them - otherwise their
    // ChatView would render an `OwnBroadcastPreview` over a stream that
    // belongs to a different connection.
    localStream: isBroadcasting ? loopbackStream : null,
    pickerOpen,
    portalPicker,
    pickerDeviceOnly,
    settings: broadcasterSettings,
    activeSources: isBroadcasting ? broadcasterSources : null,
    startSharing,
    startCameraSharing,
    cancelPicker,
    confirmSource,
    changeSettings,
    stopSharing: stopSharingCb,
    watchBroadcast,
    stopWatching: stopWatchingCb,
  };
}

// ---------------------------------------------------------------------------
// Remote stream hook for the viewer component
// ---------------------------------------------------------------------------

/**
 * Current viewer RTCPeerConnection for a broadcaster session, or null
 * when not watching. Callers must re-read on every use (never cache the
 * returned PC) - it is replaced when a viewer reconnects. Used by the
 * "Stats for Nerds" panel to poll `getStats()`.
 */
export function getViewerPc(session: number): RTCPeerConnection | null {
  return viewerPcs.get(session)?.pc ?? null;
}

/**
 * What a broadcaster announced they are sharing (from the START payload) -
 * for labels like the "is sharing" banner. Metadata always arrives with (or
 * before) the broadcast becoming visible, so a plain read is sufficient.
 */
export function getBroadcastContent(session: number): "screen" | "camera" | "both" {
  const contents = Object.values(trackContentBySession.get(session) ?? LEGACY_TRACKS);
  const hasScreen = contents.includes("screen");
  const hasCamera = contents.includes("camera");
  if (hasScreen && hasCamera) return "both";
  return hasCamera ? "camera" : "screen";
}

/**
 * Per-mid content map for a broadcaster ("0" -> "screen", "1" -> "camera"),
 * so the stats panel can label each inbound video track by what it shows.
 */

/**
 * Subscribe to the remote streams for a specific broadcaster: the primary
 * content plus the camera PiP when the broadcaster shares both. Streams are
 * null while connecting.
 */
export function useRemoteStreams(session: number): RemoteStreams {
  const [streams, setStreams] = useState<RemoteStreams>(() => computeStreams(session));

  useEffect(() => {
    const handler = (s: RemoteStreams) => setStreams(s);
    let listeners = remoteStreamListeners.get(session);
    if (!listeners) {
      listeners = new Set();
      remoteStreamListeners.set(session, listeners);
    }
    listeners.add(handler);
    // Sync in case tracks arrived before we subscribed.
    setStreams(computeStreams(session));
    return () => {
      const ls = remoteStreamListeners.get(session);
      if (ls) {
        ls.delete(handler);
        if (ls.size === 0) remoteStreamListeners.delete(session);
      }
    };
  }, [session]);

  return streams;
}

/**
 * Subscribe to a broadcaster's primary remote MediaStream (the screen, or
 * the camera on a camera-only share); null while connecting. Thumbnails and
 * single-video consumers use this; the focus viewer uses
 * {@link useRemoteStreams} to also render the camera PiP.
 */
export function useRemoteStream(session: number): MediaStream | null {
  return useRemoteStreams(session).primary;
}

// ---------------------------------------------------------------------------
// Viewer-strategy registration (webview family)
// ---------------------------------------------------------------------------

// The shipped webview family: RTCPeerConnection viewers decoding in the
// webview (browser signaling; the Windows/WebView2 default). Preferred
// whenever the webview has WebRTC; the Settings -> Advanced backend switch
// (persisted via viewerStrategy.ts) can override. Concrete factory: its
// per-session products are thin facades over this module's session-keyed
// viewer state, so transports created for the same session always agree.
registerStreamViewerStrategy({
  id: StreamViewerStrategyId.Webview,
  isAvailable: () => typeof RTCPeerConnection !== "undefined",
  createReceiveTransport: (session) => ({
    open: () => startWatching(session),
    isOpen: () => viewerPcs.has(session),
    close: () => closeViewer(session),
  }),
  createStatsSampler: (session) => createPcStatsSampler(() => getViewerPc(session)),
});
