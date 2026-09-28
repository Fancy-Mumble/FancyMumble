import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  publishOwnRoles,
  resetSelfMentionNotifications,
  useSelfMention,
  type SelfMentionMessage,
} from "./selfMention";

/** A mention chip aimed at session 42, as `applyMentionsToHtml` writes one. */
const AT_42 = '<span class="mention" data-mention-session="42">@Ada</span> hi';

function msg(partial: Partial<SelfMentionMessage> = {}): SelfMentionMessage {
  return {
    body: AT_42,
    is_own: false,
    channel_id: 1,
    message_id: "m1",
    sender_session: 7,
    timestamp: Date.now(),
    ...partial,
  };
}

/** How many times the mention ping fired while `run` was mounting rows. */
function pings(run: () => void): number {
  let count = 0;
  const listen = () => {
    count += 1;
  };
  globalThis.addEventListener("fancy:self-mention", listen);
  run();
  globalThis.removeEventListener("fancy:self-mention", listen);
  return count;
}

const show = (m: SelfMentionMessage, ownSession: number | null = 42, currentChannel: number | null = 1) =>
  renderHook(() => useSelfMention(m, { ownSession, currentChannel }));

beforeEach(() => resetSelfMentionNotifications());
afterEach(() => vi.useRealTimers());

describe("useSelfMention", () => {
  it("is true when a chip points at you", () => {
    expect(show(msg()).result.current).toBe(true);
  });

  it("is false for someone else's mention", () => {
    expect(show(msg(), 7).result.current).toBe(false);
  });

  it("never counts your own message", () => {
    expect(show(msg({ is_own: true })).result.current).toBe(false);
  });

  it("is false before a session id is known", () => {
    expect(show(msg(), null).result.current).toBe(false);
  });

  it("takes @here only in the channel it was said in", () => {
    const here = msg({ body: '<span data-mention-here="1">@here</span>' });
    expect(show(here, 42, 1).result.current).toBe(true);
    expect(show(here, 42, 2).result.current).toBe(false);
  });
});

describe("the mention ping", () => {
  it("fires once, however often the row re-renders", () => {
    expect(
      pings(() => {
        const { unmount } = show(msg());
        unmount();
        // The same message scrolling back into view must not ring again.
        show(msg()).unmount();
      }),
    ).toBe(1);
  });

  it("does not fire for a message that is not about you", () => {
    expect(pings(() => show(msg(), 7))).toBe(0);
  });

  it("stays silent for history, so scrolling back does not replay a day of pings", () => {
    expect(pings(() => show(msg({ timestamp: Date.now() - 120_000 })))).toBe(0);
  });

  it("still fires for a message with no timestamp at all", () => {
    expect(pings(() => show(msg({ timestamp: null })))).toBe(1);
  });

  it("tells two different messages apart", () => {
    expect(
      pings(() => {
        show(msg({ message_id: "a" }));
        show(msg({ message_id: "b" }));
      }),
    ).toBe(2);
  });
});

describe("role mentions", () => {
  /** A chip aimed at the "R&D" group, as `applyMentionsToHtml` writes one. */
  const AT_RND = '<span class="mention" data-mention-role="R&amp;D">@R&amp;D</span> standup?';

  /** Render with the roles a pack would have published for the client. */
  const withRoles = (roles: string[], m: SelfMentionMessage) => {
    publishOwnRoles(new Set(roles));
    return renderHook(() => useSelfMention(m, { ownSession: 42, currentChannel: 1 }));
  };

  it("reaches a member of the group that was mentioned", () => {
    expect(withRoles(["R&D", "Staff"], msg({ body: AT_RND })).result.current).toBe(true);
  });

  it("leaves everyone else alone", () => {
    expect(withRoles(["Support"], msg({ body: AT_RND })).result.current).toBe(false);
  });

  it("is silent with no roles published, which is the ordinary account", () => {
    // Reading the root ACL needs Write on it, so most clients cannot know
    // their own roles and the context stays empty. That must not throw or
    // guess - it must simply not notify.
    expect(show(msg({ body: AT_RND })).result.current).toBe(false);
  });
});

