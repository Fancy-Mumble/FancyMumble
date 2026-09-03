import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { SETTLE_SHRINK_MS } from "@core/features/chat/chatWindowing";
import type { ChatMessage } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { MessageList } from "./MessageList";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatars: () => new Map() }));

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

/** A body big enough, and inline enough, to be worth putting away. */
const HEAVY_BODY = `<img src="data:image/png;base64,${"A".repeat(5000)}">`;

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

    // Spacing is the only thing left saying that two messages are one person
    // talking, once the repeated name and clock have gone.
    const inside = getComputedStyle(top("b")).marginTop;
    const between = getComputedStyle(top("c")).marginTop;
    expect(parseFloat(inside)).toBeLessThan(parseFloat(between));
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
    expect(invokeMock).not.toHaveBeenCalledWith("offload_message", expect.objectContaining({ messageId: "m259" }));
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
});
