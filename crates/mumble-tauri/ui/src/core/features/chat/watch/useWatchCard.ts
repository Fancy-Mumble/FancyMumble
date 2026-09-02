/**
 * `useWatchCard` - everything a watch-together surface does except draw.
 *
 * Claiming the single player mount, joining and leaving, building the adapter,
 * auto-starting for the host, and the sync loop all live here so that a second
 * design can offer the session without a second copy of the behaviour. Standard
 * renders it inline in the message; Nebula floats it over the conversation.
 * They differ only in chrome.
 *
 * Every failure the surfaces have to draw is reported rather than thrown: the
 * session may be unknown, another mount may own the player, the reader may have
 * left, or the adapter may refuse to build (a YouTube source with external
 * embeds off). The caller decides what each of those looks like.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { useAppStore } from "../../../store";
import { createPlayerAdapter } from "./createPlayerAdapter";
import type { PlayerAdapter } from "./PlayerAdapter";
import { useWatchSend } from "./useWatchSend";
import { useWatchSync } from "./useWatchSync";
import { applyWatchSyncEvent } from "./watchStore";
import { consumePendingAutoStart } from "./watchAutoStart";
import { claimWatchMount, releaseWatchMount, useOwnsWatchMount } from "./watchMountClaim";
import type { WatchSession } from "./watchTypes";

/** How often the position is read while a surface is drawing progress. */
const PROGRESS_POLL_MS = 250;

export interface WatchCardOptions {
  /**
   * Stable identifier for the mount instance. When omitted a unique id is
   * generated. The first surface to render for a given session claims the
   * player; later ones are told they do not own it and draw a placeholder.
   */
  readonly mountKey?: string;
  /**
   * Poll the adapter for position and length. Off by default - a surface with
   * no progress bar should not wake up four times a second to fill one in.
   */
  readonly trackProgress?: boolean;
  /**
   * Let the player draw its own transport controls. Default true. A surface
   * drawing its own bar passes false and drives playback through `play`,
   * `pause` and `seek` instead.
   */
  readonly nativeControls?: boolean;
}

/** Everything the transport reads off the player, refreshed by one poll. */
export interface WatchPlayback {
  readonly current: number;
  readonly total: number;
  /** Seconds buffered from the start - drawn behind the played part. */
  readonly buffered: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly rate: number;
  readonly quality: string | null;
}

const IDLE_PLAYBACK: WatchPlayback = {
  current: 0,
  total: 0,
  buffered: 0,
  volume: 1,
  muted: false,
  rate: 1,
  quality: null,
};

export interface WatchCardView {
  /** Undefined once the session has ended, or before it is known here. */
  readonly session: WatchSession | undefined;
  /** False when another surface holds the player for this session. */
  readonly owns: boolean;
  /** True after this reader pressed Leave, until they rejoin. */
  readonly explicitlyLeft: boolean;
  /**
   * Ref for the element the adapter mounts its video or iframe into.
   *
   * A callback ref, not an object one, and deliberately: the surface holding
   * it can appear a render after the mount claim is granted, and an effect
   * keyed only on the claim would have already run against a null node and
   * never run again - leaving a session with no player at all.
   */
  readonly containerRef: (node: HTMLDivElement | null) => void;
  readonly adapterError: string | null;
  readonly outOfSync: boolean;
  readonly isHost: boolean;
  /** The host's name, or their session number where it is not known. */
  readonly hostName: string | null;
  /** What the player reports; idle values unless `trackProgress` is on. */
  readonly playback: WatchPlayback;
  /**
   * True where this reader can resume playback: the host, with a player
   * mounted. Everyone else follows the host, so offering them a control that
   * the next sync would undo would be a lie.
   */
  readonly canPlay: boolean;
  /** Resume as host, and tell the channel, the way an auto-start does. */
  readonly play: () => Promise<void>;
  /** Pause as host, and tell the channel. */
  readonly pause: () => Promise<void>;
  /** Seek as host, keeping whatever play state the session is in. */
  readonly seek: (seconds: number) => Promise<void>;
  /** Seek by a delta from where the player is now - the ten-second skips. */
  readonly nudge: (seconds: number) => Promise<void>;
  /** Volume and mute are this viewer's own; neither is broadcast. */
  readonly setVolume: (value: number) => void;
  readonly toggleMute: () => void;
  /** Playback speed, also local - the host's heartbeat pulls a guest back. */
  readonly setRate: (value: number) => void;
  /**
   * Whether this viewer still follows the host's playback.
   *
   * Turning it off stops inbound state reaching the player, so somebody can
   * pause to read something without dragging the room with them.
   */
  readonly followHost: boolean;
  readonly toggleFollowHost: () => void;
  readonly requestState: () => Promise<void>;
  readonly leave: () => Promise<void>;
  readonly rejoin: () => void;
  readonly end: () => Promise<void>;
}

export function useWatchCard(sessionId: string, options: WatchCardOptions = {}): WatchCardView {
  const { mountKey, trackProgress = false, nativeControls = true } = options;
  const session = useAppStore((s) => s.watchSessions.get(sessionId));
  const ownSession = useAppStore((s) => s.ownSession);
  const enableExternalEmbeds = useAppStore((s) => s.enableExternalEmbeds);
  const users = useAppStore((s) => s.users);
  const { sendJoin, sendState } = useWatchSend();

  const generatedKey = useId();
  const effectiveMountKey = mountKey ?? generatedKey;
  const owns = useOwnsWatchMount(sessionId, effectiveMountKey);
  // Try to claim the slot every render; `claimWatchMount` no-ops when
  // already held by us or by another mount key.  Release on unmount
  // so a sibling card can take over.
  useEffect(() => {
    claimWatchMount(sessionId, effectiveMountKey);
    return () => releaseWatchMount(sessionId, effectiveMountKey);
  }, [sessionId, effectiveMountKey]);

  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => setContainer(node), []);
  // Tracks the sessionId for which we already sent an optimistic join.
  // Using a ref (not state) prevents feeding back into the effect's
  // dependency array and breaking the update cycle in React 19.
  const joinSentRef = useRef<string | null>(null);
  const [adapter, setAdapter] = useState<PlayerAdapter | null>(null);
  const [adapterError, setAdapterError] = useState<string | null>(null);
  // Tracks an explicit user-initiated `leave`.  Without this the
  // auto-join effect below would immediately rejoin the session,
  // making the Leave button visually a no-op.  Reset whenever the
  // session ID changes so opening a different session works.
  const [explicitlyLeft, setExplicitlyLeft] = useState(false);
  useEffect(() => {
    setExplicitlyLeft(false);
  }, [sessionId]);
  const sourceKind = session?.sourceKind;
  const sourceUrl = session?.sourceUrl;

  // Mount the player whenever the source changes.  Skip mounting
  // entirely once the user has left so we stop pulling state and
  // free the embed.  Also skip when another card owns the mount
  // claim for this session.
  useEffect(() => {
    if (!sourceKind || !sourceUrl || explicitlyLeft || !owns || !container) return;
    let next: PlayerAdapter | null = null;
    try {
      next = createPlayerAdapter(
        sourceKind,
        { container, sourceUrl, controls: nativeControls },
        enableExternalEmbeds,
      );
      setAdapter(next);
      setAdapterError(null);
    } catch (err) {
      setAdapter(null);
      setAdapterError(err instanceof Error ? err.message : String(err));
    }
    return () => {
      next?.destroy();
      setAdapter(null);
    };
  }, [sourceKind, sourceUrl, enableExternalEmbeds, explicitlyLeft, owns, nativeControls, container]);

  // Send a `join` event the first time we render for a session we are
  // not already part of.  Suppressed while `explicitlyLeft` so the
  // Leave button is sticky.  Only the owning mount sends the join so
  // we don't double up when both banner and chat marker render.
  useEffect(() => {
    if (!session || ownSession == null) return;
    if (explicitlyLeft || !owns) return;
    if (session.participants.has(ownSession)) return;
    // Guard with a ref so that the optimistic `applyWatchSyncEvent`
    // call below (which mutates the store and therefore changes the
    // `session` reference) does not cause this effect to fire a
    // second time before React finishes the flush.
    if (joinSentRef.current === sessionId) return;
    joinSentRef.current = sessionId;
    void sendJoin(sessionId, ownSession);
    // Optimistic local apply: server does not echo events back to the
    // sender, so without this our own participant count would lag
    // until the next remote event.
    applyWatchSyncEvent({
      sessionId,
      actor: ownSession,
      event: { type: "join", session: ownSession },
    });
  }, [session, sessionId, ownSession, sendJoin, explicitlyLeft, owns]);

  // useWatchSync is always called (even when session is undefined) to
  // keep hook order stable; it returns no-op handlers in that case.
  const safeSession: WatchSession = session ?? {
    sessionId,
    channelId: -1,
    hostSession: -1,
    sourceUrl: "",
    sourceKind: "directMedia" as const,
    participants: new Set<number>(),
    state: "paused" as const,
    currentTime: 0,
    updatedAtMs: 0,
  };
  const [followHost, setFollowHost] = useState(true);
  const { isHost, outOfSync, requestState, leave, end } = useWatchSync({
    adapter,
    session: safeSession,
    ownSession,
    follow: followHost,
  });
  // Following again should not leave the player wherever it drifted to, so
  // rejoining the host's timeline asks where everyone actually is.
  const toggleFollowHost = useCallback(() => {
    setFollowHost((was) => {
      if (!was) void requestState();
      return !was;
    });
  }, [requestState]);

  // Auto-start playback for the originator: when this user just
  // started the session and the adapter has finished mounting, kick
  // off `play(0)` and broadcast `state: playing` so non-hosts seek
  // and play in lockstep.  We have to send the state explicitly
  // because `adapter.play` suppresses local events to prevent loops.
  useEffect(() => {
    if (!adapter || !isHost || !owns) return;
    if (ownSession == null) return;
    if (!consumePendingAutoStart(sessionId)) return;
    void (async () => {
      await adapter.play(0);
      await sendState(sessionId, {
        type: "state",
        state: "playing",
        currentTime: 0,
        updatedAtMs: Date.now(),
        hostSession: ownSession,
      });
    })();
  }, [adapter, isHost, owns, sessionId, ownSession, sendState]);

  // Everything the transport draws, polled rather than pushed: neither adapter
  // reports a time-update, and the host's broadcasts are far too coarse to move
  // a bar smoothly. One poll for all of it - volume and rate can change from
  // the player's own UI too, so reading them back keeps the chrome honest.
  const [playback, setPlayback] = useState<WatchPlayback>(IDLE_PLAYBACK);
  useEffect(() => {
    if (!adapter || !trackProgress) return;
    const read = () =>
      setPlayback({
        current: adapter.currentTime(),
        total: adapter.duration(),
        buffered: adapter.buffered(),
        volume: adapter.volume(),
        muted: adapter.muted(),
        rate: adapter.rate(),
        quality: adapter.quality(),
      });
    read();
    const timer = setInterval(read, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [adapter, trackProgress]);

  // Applied straight away as well as polled: a volume slider that waits a
  // quarter second to move under the pointer feels broken.
  const setVolume = useCallback(
    (value: number) => {
      if (!adapter) return;
      const clamped = Math.min(1, Math.max(0, value));
      adapter.setVolume(clamped);
      // Dragging away from silence is a request to hear it, not to stay muted.
      if (clamped > 0 && adapter.muted()) adapter.setMuted(false);
      setPlayback((p) => ({ ...p, volume: clamped, muted: clamped > 0 ? false : p.muted }));
    },
    [adapter],
  );

  const toggleMute = useCallback(() => {
    if (!adapter) return;
    const next = !adapter.muted();
    adapter.setMuted(next);
    setPlayback((p) => ({ ...p, muted: next }));
  }, [adapter]);

  const setRate = useCallback(
    (value: number) => {
      if (!adapter) return;
      adapter.setRate(value);
      setPlayback((p) => ({ ...p, rate: value }));
    },
    [adapter],
  );

  /**
   * Drive the player as host and tell the channel what happened.
   *
   * The adapter suppresses the local event for anything we ask it to do, so
   * that a command does not bounce back around the loop - which means the
   * broadcast is ours to send. The auto-start does the same thing for the same
   * reason. A seek keeps whatever play state the session is already in.
   */
  const control = useCallback(
    async (action: "play" | "pause" | "seek", at?: number) => {
      if (!adapter || !isHost || ownSession == null) return;
      // From where the player actually is unless told otherwise: the host may
      // have moved it since the last broadcast.
      const target = at ?? adapter.currentTime();
      if (action === "play") await adapter.play(target);
      else if (action === "pause") await adapter.pause(target);
      else await adapter.seek(target);
      const state =
        action === "play" ? "playing" : action === "pause" ? "paused" : (session?.state ?? "paused");
      const event = {
        type: "state" as const,
        state,
        currentTime: target,
        updatedAtMs: Date.now(),
        hostSession: ownSession,
      };
      // Apply locally first. The server does not echo an event back to whoever
      // sent it, so without this the host's own store would never learn the
      // session is playing - and every surface reading `session.state` would
      // go on drawing a paused one under a running video.
      // `useWatchSync` ignores inbound state while we are the host, so this
      // cannot turn into the adapter fighting itself.
      applyWatchSyncEvent({ sessionId, actor: ownSession, event });
      await sendState(sessionId, event);
    },
    [adapter, isHost, ownSession, sendState, sessionId, session?.state],
  );

  const play = useCallback(() => control("play"), [control]);
  const pause = useCallback(() => control("pause"), [control]);
  const seek = useCallback((seconds: number) => control("seek", seconds), [control]);
  const nudge = useCallback(
    (seconds: number) => {
      const from = adapter?.currentTime() ?? 0;
      const total = adapter?.duration() ?? 0;
      const target = total > 0 ? Math.min(total, from + seconds) : from + seconds;
      return control("seek", Math.max(0, target));
    },
    [adapter, control],
  );

  const handleLeave = useCallback(async () => {
    setExplicitlyLeft(true);
    if (ownSession != null) {
      // Optimistic local apply: server does not echo to sender, so
      // without this the participant count would not drop until the
      // next remote event arrives.
      applyWatchSyncEvent({
        sessionId,
        actor: ownSession,
        event: { type: "leave", session: ownSession },
      });
    }
    await leave();
  }, [leave, ownSession, sessionId]);

  const handleRejoin = useCallback(() => {
    joinSentRef.current = null;
    setExplicitlyLeft(false);
  }, []);

  const handleEnd = useCallback(async () => {
    if (ownSession != null) {
      // Optimistic local apply: removes the session from our store
      // so our card stops rendering as if the session were live.
      applyWatchSyncEvent({
        sessionId,
        actor: ownSession,
        event: { type: "end" },
      });
    }
    await end();
  }, [end, ownSession, sessionId]);

  const hostName = useMemo(() => {
    if (!session) return null;
    return users.find((u) => u.session === session.hostSession)?.name ?? `#${session.hostSession}`;
  }, [users, session]);

  return {
    session,
    owns,
    explicitlyLeft,
    containerRef,
    adapterError,
    outOfSync,
    isHost,
    hostName,
    playback,
    canPlay: isHost && adapter !== null,
    play,
    pause,
    seek,
    nudge,
    setVolume,
    toggleMute,
    setRate,
    followHost,
    toggleFollowHost,
    requestState,
    leave: handleLeave,
    rejoin: handleRejoin,
    end: handleEnd,
  };
}
