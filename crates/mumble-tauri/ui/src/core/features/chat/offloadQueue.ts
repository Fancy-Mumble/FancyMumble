/**
 * What cold storage is doing to one conversation, for developer mode.
 *
 * The offload manager keys by message id rather than by conversation, so it
 * can say how much it is holding but not whose it is. The per-conversation
 * half of the answer is read off the messages themselves: a body that has been
 * put away *is* its own placeholder, and the placeholder carries the size the
 * original ran to - which is the only record of what the heap got back.
 *
 * Counted rather than tracked. Nothing accumulates here, so the numbers cannot
 * drift out of step with the bodies they describe, and a readout that is only
 * ever open in developer mode costs nothing while it is closed.
 */

import { useEffect, useState } from "react";
import {
  extractOffloadInfo,
  isHeavyContent,
  offloadManager,
  type MessageOffloadManager,
  type OffloadManagerStats,
} from "../../messageOffload";
import type { ChatMessage } from "../../types";

/**
 * How often the readout re-reads the manager.
 *
 * Faster than the 5s grace period a body gets before it is written out, so the
 * queue is visibly a queue - draining, rather than jumping between two states.
 */
const POLL_MS = 1000;

export interface OffloadQueueSnapshot {
  /** Bodies in this conversation worth putting away, wherever they are now. */
  heavy: number;
  /** Of those, the ones currently in cold storage. */
  offloaded: number;
  /** Of those, the ones waiting out the grace period before being written. */
  queued: number;
  /** Of those, the ones being read back right now. */
  restoring: number;
  /** Bytes the heap got back, as recorded in the placeholders. */
  storedBytes: number;
  /** Bytes still held inline by heavy bodies that have not been put away. */
  liveBytes: number;
  /** What the manager is holding across every conversation, not just this one. */
  appWide: OffloadManagerStats;
}

/**
 * Count what cold storage is doing to `messages`.
 *
 * Pure, so a readout can be tested without a viewport, a timer or a disk.
 */
export function offloadQueueSnapshot(
  messages: readonly ChatMessage[],
  manager: MessageOffloadManager = offloadManager,
): OffloadQueueSnapshot {
  let heavy = 0;
  let offloaded = 0;
  let queued = 0;
  let restoring = 0;
  let storedBytes = 0;
  let liveBytes = 0;

  for (const message of messages) {
    const id = message.message_id;
    const away = extractOffloadInfo(message.body);

    if (away) {
      // It was heavy by definition - that is why it went away - and the
      // placeholder is the only thing left that knows how heavy.
      heavy++;
      offloaded++;
      storedBytes += away.contentLength;
    } else if (isHeavyContent(message.body)) {
      heavy++;
      liveBytes += message.body.length;
    }

    if (!id) continue;
    if (manager.isQueued(id)) queued++;
    if (manager.isLoading(id)) restoring++;
  }

  return { heavy, offloaded, queued, restoring, storedBytes, liveBytes, appWide: manager.stats() };
}

/**
 * The snapshot, kept current while `enabled`.
 *
 * Polled rather than subscribed to: the manager's queue is a set of pending
 * timers with nothing to listen to, and a readout nobody has open should not
 * be a reason for it to start publishing.
 */
export function useOffloadQueue(
  messages: readonly ChatMessage[],
  enabled: boolean,
  manager: MessageOffloadManager = offloadManager,
): OffloadQueueSnapshot {
  const [snapshot, setSnapshot] = useState<OffloadQueueSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }
    // Immediately as well as on the interval, so opening the panel answers
    // rather than waiting a second to.
    const read = () => setSnapshot(offloadQueueSnapshot(messages, manager));
    read();
    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, [messages, enabled, manager]);

  return snapshot;
}

/** What a closed readout reports, and what an empty conversation counts to. */
const EMPTY_SNAPSHOT: OffloadQueueSnapshot = {
  heavy: 0,
  offloaded: 0,
  queued: 0,
  restoring: 0,
  storedBytes: 0,
  liveBytes: 0,
  appWide: { offloaded: 0, queued: 0, loading: 0 },
};
