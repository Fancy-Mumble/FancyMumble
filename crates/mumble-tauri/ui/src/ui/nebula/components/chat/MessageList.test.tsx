import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { MessageList } from "./MessageList";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatars: () => new Map() }));

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
});
