/**
 * Carrying a user from one channel to another, for whichever skin draws it.
 *
 * Pointer events and a floating clone rather than HTML5 drag-and-drop, which
 * is unreliable in Tauri's webview: the ghost is suppressed, and
 * `data-tauri-drag-region` swallows the events. Channels register themselves
 * as drop targets; on `pointerup` the pointer is hit-tested against every
 * registered one and the move is sent if it landed on a channel.
 *
 * What the skins keep for themselves is the picture: this moves an element
 * they hand it, and says which channel is under the pointer and how far each
 * member of it has to step aside. Standard draws a translucent clone, Nebula
 * the row itself; neither difference belongs in here.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import { makeRoomFor, measureSlots, type DragSlot } from "./dragOrder";

/** How far the pointer travels before a press becomes a carry. */
const DRAG_THRESHOLD_PX = 4;

// -- Drop-target registry -----------------------------------------

interface DropRegistration {
  channelId: number;
  el: HTMLElement;
  setActive: (active: boolean) => void;
}

const registry = new Set<DropRegistration>();

function registerDropTarget(reg: DropRegistration): () => void {
  registry.add(reg);
  return () => {
    registry.delete(reg);
  };
}

function hitTest(clientX: number, clientY: number): DropRegistration | null {
  for (const reg of registry) {
    const rect = reg.el.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return reg;
    }
  }
  return null;
}

function clearAllActive(): void {
  for (const reg of registry) {
    reg.setActive(false);
  }
}

function setActiveOnly(target: DropRegistration | null): void {
  for (const reg of registry) {
    reg.setActive(reg === target);
  }
}

/**
 * Register a channel as somewhere a carried user can be dropped.
 *
 * Returns the `ref` for the element that answers for the channel, and whether
 * a carry is currently over it.
 */
export function useChannelDropTarget(channelId: number) {
  const [active, setActive] = useState(false);
  const unregisterRef = useRef<(() => void) | null>(null);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      // Tear down any previous registration first.
      unregisterRef.current?.();
      unregisterRef.current = null;
      if (el) {
        unregisterRef.current = registerDropTarget({ channelId, el, setActive });
      }
    },
    [channelId],
  );

  useEffect(
    () => () => {
      unregisterRef.current?.();
      unregisterRef.current = null;
    },
    [],
  );

  return { ref, active };
}

// -- What is being carried ----------------------------------------

/**
 * The carried user, published so a channel's member list can open the slot
 * they would land in.
 *
 * A module-level store rather than context: the gesture runs from one row's
 * pointer handlers, the gap is drawn by a list several channels away, and the
 * two have no common ancestor short of the sidebar itself.
 */
export interface UserCarry {
  session: number;
  /** The row's height, for a list too short to have a rhythm of its own. */
  height: number;
  /** The channel under the pointer, or null while it is over none. */
  overChannel: number | null;
}

let carry: UserCarry | null = null;
const carryListeners = new Set<() => void>();

export function subscribeUserCarry(listener: () => void): () => void {
  carryListeners.add(listener);
  return () => {
    carryListeners.delete(listener);
  };
}

export function getUserCarry(): UserCarry | null {
  return carry;
}

/** Replaces the published carry, and only ever with a different one. */
function publishCarry(next: UserCarry | null): void {
  if (carry === next) return;
  if (
    carry &&
    next &&
    carry.session === next.session &&
    carry.height === next.height &&
    carry.overChannel === next.overChannel
  ) {
    // Every pointer frame ends here; only a real change is worth a render.
    return;
  }
  carry = next;
  for (const listener of carryListeners) listener();
}

// -- The gesture --------------------------------------------------

interface GestureState {
  pointerId: number;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  width: number;
  height: number;
  initialLeft: number;
  started: boolean;
  rafId: number | null;
  pendingX: number;
  pendingY: number;
}

/** Where the ghost starts, and how big it is: the row it was picked up from. */
export interface CarriedGhost {
  width: number;
  height: number;
  left: number;
  top: number;
}

export interface UserCarryResult {
  /** Spread on the row that can be picked up. */
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onClickCapture: (e: React.MouseEvent) => void;
    style: React.CSSProperties;
  };
  /** The ghost's starting box, or null while nothing is being carried. */
  ghost: CarriedGhost | null;
  /** Put on the ghost element; the gesture moves it from here. */
  ghostRef: React.MutableRefObject<HTMLElement | null>;
  isDragging: boolean;
}

/**
 * Make a row a user can be picked up by. Disabled, it hands back inert
 * handlers and never starts anything - for your own row on a skin that
 * forbids it, for a user you have no permission to move, for touch.
 */
export function useCarryUser(session: number, disabled: boolean): UserCarryResult {
  const stateRef = useRef<GestureState | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const justDraggedRef = useRef(false);
  const [ghost, setGhost] = useState<CarriedGhost | null>(null);

  const flush = useCallback(() => {
    const st = stateRef.current;
    if (!st) return;
    st.rafId = null;
    const el = ghostRef.current;
    if (el) {
      // X is locked to the row's own left edge: users are stacked vertically,
      // and a ghost wandering sideways only says the pointer moved.
      const y = st.pendingY - st.grabOffsetY;
      el.style.transform = `translate(${st.initialLeft}px, ${y}px)`;
    }
    const target = hitTest(st.pendingX, st.pendingY);
    setActiveOnly(target);
    if (carry) publishCarry({ ...carry, overChannel: target?.channelId ?? null });
  }, []);

  const cleanup = useCallback(() => {
    const st = stateRef.current;
    if (st?.rafId != null) cancelAnimationFrame(st.rafId);
    stateRef.current = null;
    clearAllActive();
    publishCarry(null);
    setGhost(null);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0) return;
      // Nested controls - a volume slider, a menu button - claim their own
      // pointer events.
      const targetEl = e.target as HTMLElement;
      if (targetEl.closest("input, [data-no-drag='true']")) return;

      const rect = e.currentTarget.getBoundingClientRect();
      stateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        grabOffsetX: e.clientX - rect.left,
        grabOffsetY: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        initialLeft: rect.left,
        started: false,
        rafId: null,
        pendingX: e.clientX,
        pendingY: e.clientY,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Some webviews reject capture on disabled elements; ignore.
      }
    },
    [disabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const st = stateRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      st.pendingX = e.clientX;
      st.pendingY = e.clientY;
      if (!st.started) {
        const dx = e.clientX - st.startX;
        const dy = e.clientY - st.startY;
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        st.started = true;
        publishCarry({ session, height: st.height, overChannel: null });
        setGhost({
          width: st.width,
          height: st.height,
          left: st.initialLeft,
          top: e.clientY - st.grabOffsetY,
        });
      }
      if (st.rafId == null) {
        st.rafId = requestAnimationFrame(flush);
      }
    },
    [flush, session],
  );

  const commitDrop = useCallback(
    (clientX: number, clientY: number) => {
      const target = hitTest(clientX, clientY);
      if (!target) return;
      // Moving yourself goes through join_channel - a UserState with no
      // explicit session, which the server reads as a self-join and so does
      // not check PERM_MOVE for. Moving anyone else does need it.
      const ownSession = useAppStore.getState().ownSession;
      const cmd =
        ownSession === session
          ? invoke("join_channel", { channelId: target.channelId })
          : invoke("move_user_to_channel", { session, channelId: target.channelId });
      cmd.catch((err: unknown) => console.error("channel move failed:", err));
    },
    [session],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const st = stateRef.current;
      if (!st || st.pointerId !== e.pointerId) {
        cleanup();
        return;
      }
      const wasDragging = st.started;
      try {
        if (e.currentTarget.hasPointerCapture(st.pointerId)) {
          e.currentTarget.releasePointerCapture(st.pointerId);
        }
      } catch {
        // Capture may have already been released.
      }
      if (wasDragging) {
        commitDrop(e.clientX, e.clientY);
        // Suppress the click that follows a pointerup, or the drop would also
        // select the row it landed on.
        justDraggedRef.current = true;
      }
      cleanup();
    },
    [cleanup, commitDrop],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const st = stateRef.current;
      if (st) {
        try {
          if (e.currentTarget.hasPointerCapture(st.pointerId)) {
            e.currentTarget.releasePointerCapture(st.pointerId);
          }
        } catch {
          // Capture may have already been released.
        }
      }
      cleanup();
    },
    [cleanup],
  );

  // A row that goes away mid-carry - its channel collapses, the user leaves -
  // takes the gesture with it. Without this every list would be left holding a
  // gap open for something that can no longer be finished.
  useEffect(
    () => () => {
      if (stateRef.current) {
        stateRef.current = null;
        clearAllActive();
        publishCarry(null);
      }
    },
    [],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
      // The ghost stands in for the row while it is in the air; the row keeps
      // its place in the list, which is what the gap is measured against.
      style: ghost ? { visibility: "hidden" } : {},
    },
    ghost,
    ghostRef,
    isDragging: ghost != null,
  };
}

// -- Making room for the arriving row -----------------------------

/**
 * Where a carried user lands among members already in a channel.
 *
 * Every list draws a channel's members in the order they stand in the client's
 * user list, and a move changes only which channel a user is in - not where
 * they sit in that list - so the arriving row goes in front of the first
 * member that ranks below them.
 */
export function insertionIndex(
  members: readonly number[],
  ranks: ReadonlyMap<number, number>,
  session: number,
): number {
  const rank = ranks.get(session);
  if (rank == null) return members.length;
  const at = members.findIndex((member) => (ranks.get(member) ?? Infinity) > rank);
  return at === -1 ? members.length : at;
}

export interface CarryRoom {
  /** Per session, how far that row has stepped aside. */
  offsets: ReadonlyMap<number, number>;
  /** The size of the seat, which the list has to grow by to hold it. */
  step: number;
}

/**
 * The seat a channel opens for a user being carried to it.
 *
 * The rows are measured once, when the carry starts, and the gap after that is
 * drawn with transforms rather than laid out: nothing the drop is judged
 * against moves, so the channel the pointer is over cannot change because of
 * the gap that being over it opened.
 */
export function useCarryRoom(
  channelId: number,
  members: readonly { session: number }[],
  order: readonly { session: number }[],
): { room: CarryRoom | null; carrying: boolean; registerRow: (session: number, el: HTMLElement | null) => void } {
  const current = useSyncExternalStore(subscribeUserCarry, getUserCarry, getUserCarry);
  const rows = useRef(new Map<string, HTMLElement>());
  const [slots, setSlots] = useState<DragSlot[] | null>(null);
  const carried = current?.session ?? null;

  useEffect(() => {
    setSlots(carried === null ? null : measureSlots(rows.current));
  }, [carried]);

  const ranks = useMemo(() => new Map(order.map((user, index) => [user.session, index])), [order]);

  const registerRow = useCallback((session: number, el: HTMLElement | null) => {
    if (el) rows.current.set(String(session), el);
    else rows.current.delete(String(session));
  }, []);

  // A channel already holding the carried user has nothing to make room for -
  // including the one they were picked up from, which keeps their seat warm
  // rather than closing over it while the pointer is still deciding.
  const room = useMemo(() => {
    if (!current || !slots) return null;
    if (current.overChannel !== channelId) return null;
    if (members.some((member) => member.session === current.session)) return null;
    const sessions = members.map((member) => member.session);
    const opened = makeRoomFor(slots, insertionIndex(sessions, ranks, current.session), current.height);
    return {
      offsets: new Map([...opened.offsets].map(([key, offset]) => [Number(key), offset])),
      step: opened.step,
    };
  }, [current, slots, channelId, members, ranks]);

  return { room, carrying: current != null, registerRow };
}
