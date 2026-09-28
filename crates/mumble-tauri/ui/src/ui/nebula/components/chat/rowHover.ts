import { useEffect, useRef, useState } from "react";

/**
 * How long a row holds its hover once the pointer has stopped somewhere else.
 *
 * Only ever counted from the last movement: a pointer still travelling through
 * the strip's corridor keeps the row, however slowly it goes, and this is what
 * happens when it stops there instead. Long enough not to snatch the strip away
 * from a hand pausing mid-reach, short enough that a message settled on gets
 * its own strip without a wait worth noticing.
 */
const GRACE_MS = 350;

/**
 * How far above a row its own strip can be, in px.
 *
 * The band the strip is drawn in belongs, on screen, to the message above -
 * which is the whole difficulty: crossing it to reach the strip means crossing
 * another message, and that message would otherwise take the hover on the way
 * past. The pill is 34px and stands 4px clear, and the few px on top are for a
 * pointer that arrives just over it.
 */
const REACH_UP = 42;

/** One row's side of this, held for as long as the row is mounted. */
interface Claim {
  /** Take the strip off it. */
  drop: () => void;
  /** Put the strip up, for a row that was waiting its turn. */
  raise: () => void;
  /** Where the row is now, or null if it is not on screen. */
  box: () => DOMRect | null;
}

/**
 * Which row owns the strip, which one is waiting for it, and the timer between.
 *
 * One row at a time, module-wide: the grace is what lets the pointer travel to
 * a floating strip, and without a single owner it would also let two rows keep
 * their strips up at once - the one being left and the one being entered, each
 * hanging over the other.
 */
let owner: Claim | null = null;
let waiting: Claim | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
let watching = false;

/** Whether a point is in the corridor between a row and its own strip. */
function withinReach(claim: Claim, point: { x: number; y: number }) {
  const box = claim.box();
  // A row with no box is one nothing can be measured against - which in a test
  // renderer is every row, and there the corridor must swallow nothing.
  if (!box || (box.width === 0 && box.height === 0)) return false;
  return (
    point.x >= box.left && point.x <= box.right && point.y >= box.top - REACH_UP && point.y <= box.bottom
  );
}

/**
 * Follow the pointer while it is off the owning row.
 *
 * Enter and leave alone cannot tell "on the way to the strip" from "gone": both
 * look like one event and then silence. Watching the pointer between them is
 * what makes a slow reach work - every move through the corridor puts the clock
 * back to the start, and the first move out of it ends the row's turn there and
 * then, rather than leaving a pill behind for a third of a second.
 */
function onMove(event: MouseEvent) {
  if (!owner || pending === null) {
    unwatch();
    return;
  }
  if (withinReach(owner, { x: event.clientX, y: event.clientY })) {
    arm();
    return;
  }
  expire();
}

function watch() {
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener("mousemove", onMove, true);
}

function unwatch() {
  if (!watching) return;
  watching = false;
  document.removeEventListener("mousemove", onMove, true);
}

function cancelPending() {
  if (pending !== null) clearTimeout(pending);
  pending = null;
  unwatch();
}

/** Start, or restart, the wait before the strip changes hands. */
function arm() {
  if (pending !== null) clearTimeout(pending);
  pending = setTimeout(expire, GRACE_MS);
  watch();
}

/** The wait is over: the strip goes, and to the row held back for it, if any. */
function expire() {
  cancelPending();
  const next = waiting;
  waiting = null;
  owner?.drop();
  owner = next;
  owner?.raise();
}

/**
 * The pointer has arrived on this row. It gets the strip unless the pointer is
 * still inside the corridor of the row that has it - crossing the message above
 * is how you reach a strip that hangs over it, and a message that takes the
 * hover from under a reader mid-reach is the whole bug.
 *
 * The refused row is not turned away, only held: if the pointer settles there
 * rather than carrying on to the strip, it gets the strip when the wait ends.
 */
function take(claim: Claim, point: { x: number; y: number }): boolean {
  if (owner === claim) {
    cancelPending();
    waiting = null;
    return true;
  }
  if (owner && pending !== null && withinReach(owner, point)) {
    waiting = claim;
    return false;
  }
  cancelPending();
  waiting = null;
  if (owner && owner !== claim) owner.drop();
  owner = claim;
  return true;
}

/** The pointer has left; the row holds on in case it is on its way round. */
function releaseSoon(claim: Claim) {
  // A row that was waiting its turn and has now been left as well is simply
  // not where the pointer went.
  if (waiting === claim) waiting = null;
  if (owner !== claim) return;
  arm();
}

/** A row that goes away takes any claim on the strip with it. */
function forget(claim: Claim) {
  if (waiting === claim) waiting = null;
  if (owner !== claim) return;
  cancelPending();
  owner = null;
}

/**
 * Whether the pointer is on this row, for the sake of what hangs off it.
 *
 * Plain `onMouseLeave` answers a question the strip does not ask: the pointer
 * being off the row's box is not the same as the reader having moved on, and
 * treating the two as one is what made the strip so hard to catch. The handlers
 * go on the row root, and anything absolutely positioned inside it - the strip,
 * the bridge under it - counts as the row, because leaving for a descendant is
 * not leaving at all.
 */
export function useRowHover() {
  const [hovered, setHovered] = useState(false);
  const node = useRef<HTMLDivElement | null>(null);
  // One claim per row for the whole of its life: it is the row's identity in
  // the module above, so a new one each render would hand the strip over to a
  // stranger that happens to be the same row.
  const claim = useRef<Claim | null>(null);
  claim.current ??= {
    drop: () => setHovered(false),
    raise: () => setHovered(true),
    box: () => node.current?.getBoundingClientRect() ?? null,
  };
  useEffect(() => {
    const mine = claim.current!;
    return () => forget(mine);
  }, []);

  return {
    hovered,
    ref: node,
    onMouseEnter: (event: React.MouseEvent) => {
      if (take(claim.current!, { x: event.clientX, y: event.clientY })) setHovered(true);
    },
    onMouseLeave: () => releaseSoon(claim.current!),
  };
}
