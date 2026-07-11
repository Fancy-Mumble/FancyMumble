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
 *   START         = 0  - broadcaster announces (channel broadcast)
 *   STOP          = 1  - broadcaster stops (channel broadcast)
 *   SDP_OFFER     = 2  - client sends offer to server SFU
 *   SDP_ANSWER    = 3  - server SFU replies with answer
 *   ICE_CANDIDATE = 4  - client sends ICE candidate to server
 */
import { useEffect, useCallback, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit as emitTauri, listen as listenTauri } from "@tauri-apps/api/event";
import { useAppStore, onWebRtcSignal } from "../../../store";
import {
  getPreviewPc,
  handlePreviewAnswer,
  handlePreviewIceCandidate,
  clearThumbnail,
  closePreview,
  storeLocalThumbnail,
} from "../stream/useStreamPreview";
import { clearAllStrokesInChannel, clearStrokesFromSender } from "../drawing/DrawingOverlay";
import type { CaptureSourceKind } from "./ScreenSharePickerDialog";
import { QUALITY_PRESETS, type StreamSettings } from "./streamSettings";

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

// STUN servers for the client to discover its public address.
// The server SFU uses ICE-lite and needs no STUN.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
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
function sendSignal(targetSession: number, signalType: number, payload: string, serverId: string | null): void {
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

/** The source the local broadcast is capturing, kept so the stream-config
 *  menu can restart it at new settings without re-opening the picker. */
let broadcasterSource: { kind: CaptureSourceKind; id: number } | null = null;

/** Encoder settings the local broadcast is running at (default HD). */
let broadcasterSettings: StreamSettings = QUALITY_PRESETS.hd;

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
      desktopDrawingOverlayOpen: false,
      drawingActiveChannels: drawing,
    };
  });
  broadcasterServerId = null;
  // Wipe every annotation that was drawn on this broadcast (including
  // viewers' annotations on the local cache) so the next share starts
  // with a clean canvas and stale drawings don't reappear if the user
  // shares again later.
  if (broadcasterChannelId !== null) {
    clearAllStrokesInChannel(broadcasterChannelId);
    broadcasterChannelId = null;
  }
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
  if (own !== null) closeViewer(own);
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

interface ViewerState {
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  stream: MediaStream | null;
  /** ServerId of the connection that owns this viewer PC. */
  serverId: string | null;
}

const viewerPcs = new Map<number, ViewerState>();
const remoteStreamListeners = new Map<number, Set<(stream: MediaStream | null) => void>>();

function notifyStreamListeners(session: number, stream: MediaStream | null): void {
  const listeners = remoteStreamListeners.get(session);
  if (listeners) {
    for (const cb of listeners) cb(stream);
  }
}

function flushViewerIce(session: number): void {
  const state = viewerPcs.get(session);
  if (!state) return;
  for (const c of state.pendingIce) {
    state.pc.addIceCandidate(c).catch((e) =>
      console.error("[sfu] viewer addIceCandidate error:", e),
    );
  }
  state.pendingIce = [];
}

function closeViewer(session?: number): void {
  if (session === undefined) {
    for (const [sess, state] of viewerPcs) {
      state.pc.close();
      notifyStreamListeners(sess, null);
    }
    viewerPcs.clear();
    return;
  }
  const state = viewerPcs.get(session);
  if (state) {
    state.pc.close();
    viewerPcs.delete(session);
    notifyStreamListeners(session, null);
  }
}

/** Tear down a dead viewer PC and, while its broadcast is still announced,
 *  rebuild it with a fresh offer; otherwise clear the watch state. */
function reconnectOrDropViewer(broadcasterSession: number): void {
  closeViewer(broadcasterSession);
  if (useAppStore.getState().broadcastingSessions.has(broadcasterSession)) {
    startWatching(broadcasterSession).catch((e) =>
      console.error("[sfu] viewer reconnect failed:", e),
    );
    return;
  }
  const { watchingSession } = useAppStore.getState();
  if (watchingSession === broadcasterSession) {
    useAppStore.setState({ watchingSession: null, watchingOwnSession: null });
  }
}

/** Connect to the server SFU to watch a broadcaster's stream. Returns immediately if already connected.
 *
 * Watching your OWN session is the loopback own-preview: the SFU serves our
 * broadcast back to us exactly like it serves any other viewer.
 */
async function startWatching(broadcasterSession: number): Promise<void> {
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
  const state: ViewerState = { pc, pendingIce: [], stream: null, serverId: sid };
  viewerPcs.set(broadcasterSession, state);

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  pc.ontrack = (e) => {
    const s = viewerPcs.get(broadcasterSession);
    if (!s) return;
    s.stream ??= new MediaStream();
    if (!s.stream.getTrackById(e.track.id)) {
      s.stream.addTrack(e.track);
    }
    notifyStreamListeners(broadcasterSession, s.stream);
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
  console.warn(
    "[sfu] SDP answer received but no peer is expecting one",
    {
      senderSession,
      viewerSessions: [...viewerPcs.keys()],
      answerUfrag,
      payloadLength: payload.length,
    },
  );
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

function handleSignal(senderSession: number, _targetSession: number | null, signalType: number, payload: string): void {
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
      clearThumbnail(senderSession);
      closeViewer(senderSession);
      // The broadcaster's annotations only made sense while their
      // stream was visible - drop them now that the stream is gone
      // so a future share doesn't start with leftover scribbles.
      clearStrokesFromSender(senderSession);
      // Notify popout windows so they can self-close when their
      // broadcaster stops sharing.
      emitTauri("screen-share-stopped", { session: senderSession })
        .catch((e) => console.warn("[screenshare] emit stopped failed", e));
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
   *  session). null while not broadcasting or still connecting. */
  localStream: MediaStream | null;
  /** Whether the source-picker dialog is open. */
  pickerOpen: boolean;
  /** Encoder settings the current/next broadcast uses (for the picker + menu). */
  settings: StreamSettings;
  /** Open the source picker (does not start capturing yet). Works while
   *  already broadcasting too - confirming replaces the live source. */
  startSharing: () => void;
  /** Close the source picker without sharing. */
  cancelPicker: () => void;
  /** Start (or replace) the broadcast with the picked source + settings. */
  confirmSource: (kind: CaptureSourceKind, id: number, settings: StreamSettings) => Promise<void>;
  /** Restart the live broadcast at new settings (same source). */
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
  const isBroadcasting = broadcastingOwnSession !== null
    && ownSession !== null
    && broadcastingOwnSession === ownSession;
  // True when a different tab in the same window already owns the
  // singleton broadcast state.  Only one Rust capture runs per app,
  // so attempting to share again from another tab must be blocked.
  const isBroadcastingFromOtherTab = broadcastingOwnSession !== null
    && (ownSession === null || broadcastingOwnSession !== ownSession);
  const [pickerOpen, setPickerOpen] = useState(false);

  // The own-preview: the loopback viewer's remote stream for our session.
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
    void listenTauri<{ state: string; message: string | null }>(
      "screen-broadcast-state",
      (event) => {
        const { state: bcState, message } = event.payload;
        if (bcState === "connected") {
          useAppStore.setState({ webrtcConnecting: false });
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
        }
      },
    ).then((un) => {
      if (disposed) {
        un();
      } else {
        unlisten = un;
      }
    });
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
      broadcastSignal(SIGNAL_START, "", broadcasterServerId);
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

  const startSharing = useCallback(() => {
    // Opening the picker while already broadcasting is allowed: confirming
    // replaces the live source ("Change Stream" in the stream-config menu).
    const { serverConfig } = useAppStore.getState();
    if (serverConfig.webrtc_sfu_available) {
      console.info("[screen-share] server has WebRTC SFU - media will be relayed via server");
    } else {
      console.warn("[screen-share] server does NOT have WebRTC SFU - screen sharing may not work");
      showWebRtcError("This server does not have a WebRTC relay configured. Screen sharing is unlikely to work.");
    }

    setPickerOpen(true);
  }, []);

  const cancelPicker = useCallback(() => setPickerOpen(false), []);

  const confirmSource = useCallback(
    async (kind: CaptureSourceKind, id: number, settings: StreamSettings) => {
      setPickerOpen(false);
      if (ownSession === null) {
        console.warn("[screenshare] confirmSource ignored: no ownSession");
        return;
      }
      // Replacing an already-running broadcast (Change Stream / Change
      // Quality): the Rust broadcaster swaps its capture+peer in place and
      // the SFU keeps forwarding to existing viewers, so we skip the START
      // announce and keep the loopback viewer we already have.
      const isReplace = useAppStore.getState().broadcastingOwnSession === ownSession;

      const { activeServerId, sendWebRtcSignal } = useAppStore.getState();
      broadcasterServerId = activeServerId;
      // Pin the broadcast to the channel the user was in when they
      // started sharing.  When the broadcast ends, every annotation in
      // that channel - drawn by the broadcaster OR any viewer - is
      // wiped (see `stopBroadcasting()`).
      broadcasterChannelId = useAppStore.getState().currentChannel;
      broadcasterSource = { kind, id };
      broadcasterSettings = settings;
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
      // in turn must precede our loopback-viewer offer.
      if (!isReplace) {
        await sendWebRtcSignal(0, SIGNAL_START, "", activeServerId);
      }
      try {
        await invoke("start_screen_broadcast", {
          kind,
          id,
          serverId: activeServerId,
          maxDimension: settings.maxDimension,
          maxFps: settings.maxFps,
        });
      } catch (e) {
        console.error("[screenshare] start_screen_broadcast failed:", e);
        endOwnBroadcast("start_screen_broadcast rejected");
        showWebRtcError(`Screen sharing failed to start: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      // Loopback own-preview: watch our own SFU session so the preview
      // <video> decodes the frames that are actually being transmitted
      // (capture and encoding live in Rust; there is no local MediaStream).
      // No-op when replacing (the viewer already exists).
      console.info("[screenshare] broadcast started; opening loopback preview");
      startWatching(ownSession).catch((e) =>
        console.error("[screenshare] loopback preview failed:", e),
      );
    },
    [ownSession],
  );

  const changeSettings = useCallback((settings: StreamSettings) => {
    if (!broadcasterSource) return;
    if (
      settings.maxDimension === broadcasterSettings.maxDimension &&
      settings.maxFps === broadcasterSettings.maxFps
    ) {
      return;
    }
    void confirmSource(broadcasterSource.kind, broadcasterSource.id, settings);
  }, [confirmSource]);

  const stopSharingCb = useCallback(() => {
    broadcasterSource = null;
    endOwnBroadcast("user stopped");
  }, []);

  // Auto-connect to all active broadcasters in our channel so streams are
  // ready before the user clicks into focus view, and disconnect from
  // sessions that stopped broadcasting.
  useEffect(() => {
    if (!ownSession) return;
    for (const session of broadcastingSessions) {
      if (session !== ownSession && !viewerPcs.has(session)) {
        startWatching(session).catch((e) =>
          console.error("[screenshare] auto-connect failed for session", session, e),
        );
      }
    }
    for (const [session] of viewerPcs) {
      if (!broadcastingSessions.has(session)) {
        closeViewer(session);
      }
    }
  }, [broadcastingSessions, ownSession]);

  const watchBroadcast = useCallback((session: number) => {
    useAppStore.setState({
      watchingSession: session,
      watchingOwnSession: ownSession ?? null,
    });
    // startWatching is a no-op if already connected (auto-connect effect above).
    startWatching(session).catch((e) =>
      console.error("[screenshare] startWatching failed:", e),
    );
  }, [ownSession]);

  const stopWatchingCb = useCallback(() => {
    useAppStore.setState({ watchingSession: null, watchingOwnSession: null });
  }, []);

  // Only treat the watch state as belonging to *this* tab when its
  // `ownSession` matches the one that initiated the watch.  Without this
  // guard the broadcaster's tab would mistake the viewer tab's watch
  // state for its own and render a RemoteViewer for its own session,
  // hanging on "Connecting...".
  const watchingSession = (watchingOwnSession !== null
    && ownSession !== null
    && watchingOwnSession === ownSession)
    ? watchingSessionRaw
    : null;

  return {
    isBroadcasting,
    isBroadcastingFromOtherTab,
    broadcastingSessions,
    watchingSession,
    // Only expose the loopback stream to the tab that owns the broadcast.
    // Other tabs in the same window must never see it - otherwise their
    // ChatView would render an `OwnBroadcastPreview` over a stream that
    // belongs to a different connection.
    localStream: isBroadcasting ? loopbackStream : null,
    pickerOpen,
    settings: broadcasterSettings,
    startSharing,
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
 * Subscribe to the remote MediaStream for a specific broadcaster.
 * Returns the current stream for that session (or null while connecting).
 */
export function useRemoteStream(session: number): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(
    () => viewerPcs.get(session)?.stream ?? null,
  );

  useEffect(() => {
    const handler = (s: MediaStream | null) => setStream(s);
    let listeners = remoteStreamListeners.get(session);
    if (!listeners) {
      listeners = new Set();
      remoteStreamListeners.set(session, listeners);
    }
    listeners.add(handler);
    // Sync in case the stream arrived before we subscribed.
    setStream(viewerPcs.get(session)?.stream ?? null);
    return () => {
      const ls = remoteStreamListeners.get(session);
      if (ls) {
        ls.delete(handler);
        if (ls.size === 0) remoteStreamListeners.delete(session);
      }
    };
  }, [session]);

  return stream;
}
