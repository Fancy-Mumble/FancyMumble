import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MessageOffloadManager,
  type MessageContentProvider,
  type MessageScope,
} from "../../messageOffload";
import type { ChatMessage } from "../../types";
import { offloadQueueSnapshot } from "./offloadQueue";

const SCOPE: MessageScope = { scope: "channel", scopeId: "3" };

/** A provider that stores nothing and can be made to hang on a read. */
function stubProvider(): MessageContentProvider & { hang: boolean } {
  const provider = {
    hang: false,
    async store() {},
    async retrieve() {
      return null;
    },
    async retrieveMany() {
      if (provider.hang) await new Promise(() => {});
      return {};
    },
    async release() {},
    async dispose() {},
  };
  return provider;
}

function message(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    message_id: "m1",
    channel_id: 3,
    sender_session: 7,
    sender_name: "Lorelando",
    body: "hello",
    is_own: false,
    timestamp: 1_700_000_000_000,
    ...partial,
  } as ChatMessage;
}

/** A body big enough, and inline enough, to be worth putting away. */
function heavy(id: string): ChatMessage {
  return message({ message_id: id, body: `<img src="data:image/png;base64,${"A".repeat(5000)}">` });
}

/** One already put away, with the size the original ran to. */
function cold(id: string, bytes: number): ChatMessage {
  return message({ message_id: id, body: `<!-- OFFLOADED:${id}:${bytes} -->` });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("offloadQueueSnapshot", () => {
  it("counts heavy bodies whether they are here or away", () => {
    const manager = new MessageOffloadManager(stubProvider());

    const snapshot = offloadQueueSnapshot([message(), heavy("h1"), cold("c1", 200_000)], manager);

    // A line of text is neither: it costs less than the write would.
    expect(snapshot.heavy).toBe(2);
    expect(snapshot.offloaded).toBe(1);
  });

  it("reports the heap freed and the heap still held", () => {
    const manager = new MessageOffloadManager(stubProvider());

    const snapshot = offloadQueueSnapshot([heavy("h1"), cold("c1", 200_000)], manager);

    // The placeholder is the only record of what the original weighed.
    expect(snapshot.storedBytes).toBe(200_000);
    expect(snapshot.liveBytes).toBeGreaterThan(5000);
  });

  it("counts a body waiting out its grace period as queued, not yet away", () => {
    vi.useFakeTimers();
    const manager = new MessageOffloadManager(stubProvider());
    manager.scheduleOffload("h1", SCOPE, () => {});

    const snapshot = offloadQueueSnapshot([heavy("h1")], manager);

    expect(snapshot.queued).toBe(1);
    // Still in memory: scrolling back to it cancels the write.
    expect(snapshot.offloaded).toBe(0);
    expect(snapshot.liveBytes).toBeGreaterThan(0);
  });

  it("counts a read in flight as restoring", async () => {
    const provider = stubProvider();
    const manager = new MessageOffloadManager(provider);
    // Put it away first, or there is nothing to ask back for.
    vi.useFakeTimers();
    manager.scheduleOffload("c1", SCOPE, () => {});
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();

    provider.hang = true;
    void manager.restoreMany(["c1"], SCOPE);

    expect(offloadQueueSnapshot([cold("c1", 1000)], manager).restoring).toBe(1);
  });

  it("carries the manager's whole-client figures alongside the channel's", () => {
    vi.useFakeTimers();
    const manager = new MessageOffloadManager(stubProvider());
    // Queued in another conversation entirely - the manager keys by message
    // id, so its totals are the client's, not this channel's.
    manager.scheduleOffload("elsewhere", { scope: "dm", scopeId: "9" }, () => {});

    const snapshot = offloadQueueSnapshot([message()], manager);

    expect(snapshot.queued).toBe(0);
    expect(snapshot.appWide.queued).toBe(1);
  });

  it("ignores a message with no id, which could never be asked back for", () => {
    const manager = new MessageOffloadManager(stubProvider());
    const anonymous = message({ message_id: undefined, body: heavy("x").body });

    const snapshot = offloadQueueSnapshot([anonymous], manager);

    // Still heavy - it is what it is - but never queued against a key that
    // does not exist.
    expect(snapshot.heavy).toBe(1);
    expect(snapshot.queued).toBe(0);
  });
});
