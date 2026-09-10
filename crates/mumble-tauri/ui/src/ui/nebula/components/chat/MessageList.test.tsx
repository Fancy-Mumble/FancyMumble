import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { SETTLE_SHRINK_MS } from "@core/features/chat/chatWindowing";
import type { ChatMessage } from "@core/types";
import { formatTime } from "../../selectors";
import { withNebulaTheme } from "../../testTheme";
import { MessageList } from "./MessageList";
import { DEFAULT_CHAT_DISPLAY } from "../../useChatDisplay";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatars: () => new Map() }));

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

/** A body big enough, and inline enough, to be worth putting away. */
const HEAVY_BODY = `<img src="data:image/png;base64,${"A".repeat(70_000)}">`;

/**
 * An `IntersectionObserver` the test drives itself.
 *
 * jsdom lays nothing out, so nothing is ever really in or out of view; the
 * setup file's inert stub is what keeps that from throwing. Offloading is
 * *entirely* a question of what is in view, so testing it at all means saying
 * so by hand.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.targets.add(element);
  }
  unobserve(element: Element): void {
    this.targets.delete(element);
  }
  disconnect(): void {
    this.targets.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Report a row as having left the viewport, or arrived in it. */
  fire(element: Element, isIntersecting: boolean): void {
    this.callback(
      [{ target: element, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function message(id: string, timestamp = 1_700_000_000_000): ChatMessage {
  return {
    sender_session: 7,
    sender_name: "Lorelando",
    body: id,
    channel_id: 1,
    is_own: false,
    message_id: id,
    timestamp,
  };
}

function draw(props: Partial<React.ComponentProps<typeof MessageList>> = {}) {
  return render(
    withNebulaTheme(
      <MessageList
        messages={[message("a"), message("b")]}
        users={[]}
        renderMessage={(m) => <span>{m.body}</span>}
        {...props}
      />,
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MessageList", () => {
  it("draws the header above the oldest message, inside the scroller", () => {
    const { container } = draw({ header: <div data-testid="banner">persistence</div> });
    const scroller = container.firstElementChild!;
    const banner = screen.getByTestId("banner");

    // Inside, because the banner carries the pagination sentinel: an observer
    // watching an element in fixed chrome is permanently intersecting.
    expect(scroller.contains(banner)).toBe(true);
    // Before the first message, so it reads as the top of the history.
    expect(banner.compareDocumentPosition(screen.getByText("a"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("marks each row with its id so a quote can be followed to it", () => {
    const { container } = draw();
    expect(container.querySelector('[data-message-id="b"]')).toBeTruthy();
  });

  it("tells each row whether the block ends with it", () => {
    // The row draws the timestamp off this: only the last of a run carries
    // one, and the list is the only thing that can see what comes next.
    const ends: Array<[string, boolean]> = [];
    const minute = 60_000;
    draw({
      // "c" is a quarter of an hour later, so it starts a block of its own -
      // which makes "b" the end of the first one and "c" the end of its own.
      messages: [message("a"), message("b", 1_700_000_000_000 + minute), message("c", 1_700_000_900_000)],
      renderMessage: (m, _avatar, _grouped, _restoring, endsGroup) => {
        ends.push([m.body, endsGroup]);
        return <span>{m.body}</span>;
      },
    });

    expect(ends).toEqual([
      ["a", false],
      ["b", true],
      ["c", true],
    ]);
  });

  it("closes up the air inside a block and keeps it between blocks", () => {
    const minute = 60_000;
    const { container } = draw({
      messages: [message("a"), message("b", 1_700_000_000_000 + minute), message("c", 1_700_000_900_000)],
    });
    const top = (id: string) => container.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
    // The air above a block is the block's own rather than its first row's:
    // the sticky picture is measured against the block, and a margin inside
    // would leave it resting a row-gap above the message it heads.
    const block = (id: string) => top(id).parentElement!;

    // Spacing is the only thing left saying that two messages are one person
    // talking, once the repeated name and clock have gone.
    const inside = getComputedStyle(top("b")).marginTop;
    const between = getComputedStyle(block("c")).marginTop;
    expect(parseFloat(inside)).toBeLessThan(parseFloat(between));
    // And the row that opens a block adds nothing on top of it.
    expect(parseFloat(getComputedStyle(top("c")).marginTop)).toBe(0);
  });

  describe("the hoisted avatar", () => {
    const minute = 60_000;
    /** A speaker, so a day can be cut into runs of one person talking. */
    const from = (session: number, id: string, timestamp: number): ChatMessage => ({
      ...message(id, timestamp),
      sender_session: session,
      sender_name: `user-${session}`,
    });
    const drawSticky = (messages: ChatMessage[]) =>
      draw({ messages, renderAvatar: (m) => <span>avatar-{m.body}</span> });
    const sticky = (container: HTMLElement) => [
      ...container.querySelectorAll<HTMLElement>("[data-sticky-avatar]"),
    ];
    /** Whose picture each hoisted column is drawing, in order down the day. */
    const drawn = (container: HTMLElement) =>
      sticky(container).map((node) => node.querySelector("span")?.textContent);
    /** What each of those columns has its travelling clock reading. */
    const clocks = (container: HTMLElement) =>
      sticky(container).map((node) => node.querySelector("[data-avatar-stamp]")?.textContent);

    it("gives a run of messages one picture, spanning the whole run", () => {
      const { container } = drawSticky([
        from(7, "a", 1_700_000_000_000),
        from(7, "b", 1_700_000_000_000 + minute),
        from(7, "c", 1_700_000_000_000 + 2 * minute),
      ]);

      // One picture for the three, drawn from the message that opens the run.
      const pictures = sticky(container);
      expect(pictures).toHaveLength(1);
      expect(drawn(container)).toEqual(["avatar-a"]);
      // It travels with the reader rather than scrolling away at the top of
      // the run - and stops at the foot of the block, which is the last
      // message of the run and nothing below it.
      const column = pictures[0]!.parentElement!;
      const block = column.parentElement!;
      expect(getComputedStyle(pictures[0]!).position).toBe("sticky");
      expect(getComputedStyle(column).position).toBe("absolute");
      expect(block.contains(container.querySelector('[data-message-id="c"]'))).toBe(true);
    });

    it("starts a new picture where someone else has interrupted", () => {
      const { container } = drawSticky([
        from(7, "a", 1_700_000_000_000),
        from(9, "b", 1_700_000_000_000 + minute),
        from(7, "c", 1_700_000_000_000 + 2 * minute),
        from(7, "d", 1_700_000_000_000 + 3 * minute),
      ]);

      // The first speaker's picture must not travel past the interruption
      // into the run they came back with: that is two runs, two pictures.
      expect(drawn(container)).toEqual(["avatar-a", "avatar-b", "avatar-c"]);
      const second = sticky(container)[2]!.parentElement!.parentElement!;
      expect(second.contains(container.querySelector('[data-message-id="d"]'))).toBe(true);
      expect(second.contains(container.querySelector('[data-message-id="a"]'))).toBe(false);
    });

    it("opens its clock on the message the picture starts beside", () => {
      const { container } = drawSticky([
        from(7, "a", 1_700_000_000_000),
        from(7, "b", 1_700_000_000_000 + minute),
      ]);

      // At rest the picture is beside the message that opens the run, so the
      // clock says what the block's own header says.
      expect(clocks(container)).toEqual([formatTime(1_700_000_000_000)]);
    });

    it("moves the clock to the message the picture has travelled to", () => {
      const base = 1_700_000_000_000;
      const { container } = drawSticky([
        from(7, "a", base),
        from(7, "b", base + minute),
        from(7, "c", base + 2 * minute),
      ]);
      const scroller = container.firstElementChild as HTMLElement;
      const block = container.querySelector<HTMLElement>("[data-avatar-block]")!;
      const rows = [...block.querySelectorAll<HTMLElement>(":scope > [data-message-id]")];

      // jsdom lays nothing out, and the reading is entirely a question of
      // where things are - so a block scrolled half out of the top of the
      // pane, with three rows of 200px in it, is stated rather than measured.
      vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
        top: 0,
        bottom: 800,
        height: 800,
      } as DOMRect);
      vi.spyOn(block, "getBoundingClientRect").mockReturnValue({
        top: -500,
        bottom: 300,
        height: 800,
      } as DOMRect);
      rows.forEach((row, index) => {
        Object.defineProperty(row, "offsetTop", { value: index * 200, configurable: true });
        Object.defineProperty(row, "offsetHeight", { value: 200, configurable: true });
      });
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

      fireEvent.scroll(scroller);

      // Held at the top of the pane, the picture is 527px into the block -
      // which is the third message, and so the third message's time.
      expect(clocks(container)).toEqual([formatTime(base + 2 * minute)]);
    });

    it("keeps its clock on a server that mints no message ids", () => {
      const base = 1_700_000_000_000;
      // A legacy server sends neither an id nor a persistence handle; the
      // clock is the one thing it does send, and the picture has to carry it.
      const legacy = (id: string, timestamp: number): ChatMessage => ({
        ...from(7, id, timestamp),
        message_id: null,
      });
      const { container } = drawSticky([legacy("a", base), legacy("b", base + minute)]);
      const scroller = container.firstElementChild as HTMLElement;
      const block = container.querySelector<HTMLElement>("[data-avatar-block]")!;
      vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
        top: 0,
        bottom: 800,
        height: 800,
      } as DOMRect);
      vi.spyOn(block, "getBoundingClientRect").mockReturnValue({
        top: -300,
        bottom: 200,
        height: 500,
      } as DOMRect);
      const rows = [...block.querySelectorAll<HTMLElement>(":scope > [data-msg-time]")];
      rows.forEach((row, index) => {
        Object.defineProperty(row, "offsetTop", { value: index * 250, configurable: true });
        Object.defineProperty(row, "offsetHeight", { value: 250, configurable: true });
      });
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

      fireEvent.scroll(scroller);

      // 327px into the block, which is the second message - and emphatically
      // not blank, which is what looking the rows up by id used to leave.
      expect(clocks(container)).toEqual([formatTime(base + minute)]);
    });

    it("draws no column where the rows have no gutter", () => {
      const messages = [from(7, "a", 1_700_000_000_000)];
      // Compact drops the avatar column outright, so there is nothing to
      // hoist and a picture laid over the text is all a column would be.
      const { container } = draw({
        messages,
        display: { ...DEFAULT_CHAT_DISPLAY, compact: true },
        renderAvatar: (m) => <span>avatar-{m.body}</span>,
      });
      expect(sticky(container)).toHaveLength(0);
    });

    it("draws no column for your own bubbles, which have no gutter either", () => {
      const { container } = draw({
        messages: [{ ...message("a"), is_own: true }],
        display: { ...DEFAULT_CHAT_DISPLAY, bubbleStyle: "bubbles" },
        renderAvatar: (m) => <span>avatar-{m.body}</span>,
      });
      expect(sticky(container)).toHaveLength(0);
    });
  });

  it("draws the unread rule above the message it is given", () => {
    draw({ firstUnreadId: "b" });
    const rule = screen.getByText("NEW");
    expect(rule.compareDocumentPosition(screen.getByText("b"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("scrolls to a jump target and flashes it", () => {
    const scrollIntoView = vi.fn();
    const animate = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    // jsdom has no Web Animations, so the flash is stubbed rather than skipped:
    // the row is expected to be asked to flash, not merely to be scrolled to.
    Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });

    draw({ jumpTo: { messageId: "a", nonce: 1 } });

    expect(scrollIntoView).toHaveBeenCalled();
    expect(animate).toHaveBeenCalled();
    Element.prototype.scrollIntoView = original;
  });

  it("does nothing for a jump target that is not mounted", () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    draw({ jumpTo: { messageId: "not-here", nonce: 1 } });

    expect(scrollIntoView).not.toHaveBeenCalled();
    Element.prototype.scrollIntoView = original;
  });

  it("mounts only the newest window of a long conversation", () => {
    const many = Array.from({ length: 260 }, (_, index) => message(`m${index}`));
    const { container } = draw({ messages: many });
    const rows = container.querySelectorAll("[data-message-id]");
    // The tail window, not all 260 - every row carries an avatar, a sanitiser
    // and a reaction subscription behind it.
    expect(rows.length).toBeLessThan(many.length);
    expect(rows.length).toBe(100);
    // Anchored to the end: the newest message is mounted, the oldest is not.
    expect(container.querySelector('[data-message-id="m259"]')).toBeTruthy();
    expect(container.querySelector('[data-message-id="m0"]')).toBeNull();
  });

  it("lets the history go once the reader has settled back at the bottom", async () => {
    vi.useFakeTimers();
    const many = Array.from({ length: 400 }, (_, index) => message(`m${index}`));
    const { container } = draw({ messages: many });
    const scroller = container.firstElementChild as HTMLElement;
    const rows = () => container.querySelectorAll("[data-message-id]").length;

    // Climb towards the top: the window grows a chunk at a time.
    Object.defineProperty(scroller, "scrollHeight", { value: 9000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 600, configurable: true });
    scroller.scrollTop = 0;
    await act(async () => {
      fireEvent.scroll(scroller);
    });
    expect(rows()).toBeGreaterThan(100);

    // Back to the bottom, and stay there.
    scroller.scrollTop = 8400;
    await act(async () => {
      fireEvent.scroll(scroller);
      await vi.advanceTimersByTimeAsync(SETTLE_SHRINK_MS + 100);
    });
    expect(rows()).toBe(100);
    // Still the newest ones - what was released is all above the viewport.
    expect(container.querySelector('[data-message-id="m399"]')).toBeTruthy();

    vi.useRealTimers();
  });

  it("keeps the history mounted while the reader is still up in it", async () => {
    vi.useFakeTimers();
    const many = Array.from({ length: 400 }, (_, index) => message(`m${index}`));
    const { container } = draw({ messages: many });
    const scroller = container.firstElementChild as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { value: 9000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 600, configurable: true });

    scroller.scrollTop = 0;
    await act(async () => {
      fireEvent.scroll(scroller);
      await vi.advanceTimersByTimeAsync(SETTLE_SHRINK_MS + 100);
    });

    // Nowhere near the bottom: the rows they climbed through stay.
    expect(container.querySelectorAll("[data-message-id]").length).toBeGreaterThan(100);

    vi.useRealTimers();
  });

  it("widens the window to reach a jump target that is not mounted", () => {
    const many = Array.from({ length: 260 }, (_, index) => message(`m${index}`));
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    draw({ messages: many, jumpTo: { messageId: "m5", nonce: 1 } });

    expect(scrollIntoView).toHaveBeenCalled();
    Element.prototype.scrollIntoView = original;
  });

  it("marks a heavy body for the offloader and leaves a light one alone", () => {
    const { container } = draw({
      messages: [message("light"), { ...message("heavy"), body: HEAVY_BODY }],
    });

    // A pasted screenshot is worth megabytes; a line of text is worth putting
    // away only in the sense that the write costs more than it saves.
    expect(container.querySelector('[data-message-id="heavy"]')!.hasAttribute("data-msg-heavy")).toBe(true);
    expect(container.querySelector('[data-message-id="light"]')!.hasAttribute("data-msg-heavy")).toBe(false);
  });

  it("puts away the heavy bodies above the window without waiting for a row", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    FakeIntersectionObserver.instances = [];
    invokeMock.mockClear();
    useAppStore.setState({ refreshMessages: vi.fn().mockResolvedValue(undefined) });

    // 260 messages: the oldest heavy one is far above the 100-row window and
    // never gets a row; the newest heavy one is mounted and in view.
    const many = Array.from({ length: 260 }, (_, index) => message(`m${index}`));
    many[3] = { ...many[3], body: HEAVY_BODY };
    many[259] = { ...many[259], body: HEAVY_BODY };
    const { container } = draw({ messages: many, currentScope: () => ({ scope: "channel", scopeId: "7" }) });
    expect(container.querySelector('[data-message-id="m3"]')).toBeNull();

    const observer = FakeIntersectionObserver.instances.at(-1)!;
    await act(async () => {
      observer.fire(container.querySelector('[data-message-id="m259"]')!, true);
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(invokeMock).toHaveBeenCalledWith("offload_message", {
      messageId: "m3",
      scope: "channel",
      scopeId: "7",
    });
    // The one on screen stays where the reader can see it.
    expect(invokeMock).not.toHaveBeenCalledWith(
      "offload_message",
      expect.objectContaining({ messageId: "m259" }),
    );
    expect(useAppStore.getState().refreshMessages).toHaveBeenCalledWith(7);

    vi.useRealTimers();
  });

  it("hands a heavy body to cold storage once it has been out of view a while", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    FakeIntersectionObserver.instances = [];
    invokeMock.mockClear();
    useAppStore.setState({ refreshMessages: vi.fn().mockResolvedValue(undefined) });

    const { container } = draw({
      messages: [{ ...message("cold"), body: HEAVY_BODY }],
      currentScope: () => ({ scope: "channel", scopeId: "7" }),
    });

    const observer = FakeIntersectionObserver.instances.at(-1)!;
    const row = container.querySelector('[data-message-id="cold"]')!;
    // Watching the scroller rather than the window: the river scrolls inside
    // its own box, and the window never moves.
    expect(observer.options?.root).toBe(container.firstElementChild);
    expect([...observer.targets]).toContain(row);

    await act(async () => {
      observer.fire(row, false);
      // Longer than the grace period a row gets before it is written out, so
      // a flick of the wheel past a picture does not encrypt it.
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(invokeMock).toHaveBeenCalledWith("offload_message", {
      messageId: "cold",
      scope: "channel",
      scopeId: "7",
    });
    // And the conversation is re-read, or the body the backend just replaced
    // would go on being drawn from React's copy of it.
    expect(useAppStore.getState().refreshMessages).toHaveBeenCalledWith(7);

    vi.useRealTimers();
  });

  describe("the two-sided render window", () => {
    /** A thread long enough that the window cannot hold all of it. */
    function longThread(count: number): ChatMessage[] {
      return Array.from({ length: count }, (_, index) => message(`m${index}`, 1_700_000_000_000 + index));
    }

    /** The scroller the list mounts its rows inside. */
    function scroller(container: HTMLElement): HTMLElement {
      return container.firstElementChild as HTMLElement;
    }

    function mounted(container: HTMLElement): number {
      return container.querySelectorAll("[data-message-id]").length;
    }

    it("mounts a bounded slice of a long thread rather than all of it", () => {
      // The whole point of a window. 600 rows of DOM is what makes a busy
      // channel expensive to look at rather than expensive to open.
      const { container } = draw({ messages: longThread(600) });
      const rows = mounted(container);

      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThan(600);
    });

    it("releases the trailing edge once the reader has climbed far enough", () => {
      // The difference from the tail anchor: reading backwards used to keep
      // every row between the reader and the present mounted.
      const { container } = draw({ messages: longThread(600) });
      const node = scroller(container);

      const before = mounted(container);
      for (let step = 0; step < 12; step += 1) {
        act(() => {
          node.scrollTop = 0;
          fireEvent.scroll(node);
        });
      }

      // Still bounded, and the newest row is no longer among them.
      expect(mounted(container)).toBeLessThanOrEqual(Math.max(before, 300));
      expect(container.querySelector('[data-message-id="m599"]')).toBeNull();
    });

    it("announces an arrival the reader is not carried down to", async () => {
      // A window detached from the tail does not follow a new message, so
      // this pill is the only thing that says one happened. Without it the
      // message is simply invisible until the reader scrolls.
      const thread = longThread(600);
      const { container, rerender } = draw({ messages: thread });
      const node = scroller(container);

      for (let step = 0; step < 12; step += 1) {
        act(() => {
          node.scrollTop = 0;
          fireEvent.scroll(node);
        });
      }
      expect(screen.queryByTestId("chat-new-messages-pill")).toBeNull();

      await act(async () => {
        rerender(
          withNebulaTheme(
            <MessageList
              messages={[...thread, message("fresh", 1_700_000_999_999)]}
              users={[]}
              renderMessage={(m) => <span>{m.body}</span>}
            />,
          ),
        );
      });

      expect(screen.getByTestId("chat-new-messages-pill")).toBeTruthy();
    });

    it("does not announce an arrival the reader is already at the bottom for", async () => {
      // At the tail the window follows the message down, so there is nothing
      // to tell them: they can see it.
      const thread = longThread(20);
      const { rerender } = draw({ messages: thread });

      await act(async () => {
        rerender(
          withNebulaTheme(
            <MessageList
              messages={[...thread, message("fresh", 1_700_000_999_999)]}
              users={[]}
              renderMessage={(m) => <span>{m.body}</span>}
            />,
          ),
        );
      });

      expect(screen.queryByTestId("chat-new-messages-pill")).toBeNull();
    });
  });
});
