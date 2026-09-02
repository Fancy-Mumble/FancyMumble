import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@core/types";
import { withNebulaTheme } from "../../../testTheme";
import { DEFAULT_TIME_DISPLAY } from "../../../selectors";
import { PinnedPanel } from "./PinnedPanel";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null }));

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_session: 1,
    sender_name: "Sebi",
    body: "Rotation nights are Tuesday and Friday, 20:00 CET.",
    channel_id: 4,
    is_own: false,
    message_id: "m1",
    timestamp: Date.now(),
    pinned: true,
    ...overrides,
  };
}

function show(overrides: Partial<Parameters<typeof PinnedPanel>[0]> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onJump: vi.fn(),
    onMarkRead: vi.fn(),
    onUnpin: vi.fn(),
  };
  render(
    withNebulaTheme(
      <PinnedPanel
        messages={[message()]}
        unseenIds={new Set()}
        time={DEFAULT_TIME_DISPLAY}
        {...handlers}
        {...overrides}
      />,
    ),
  );
  return handlers;
}

describe("PinnedPanel", () => {
  afterEach(cleanup);

  it("heads the panel with the pin count and says what a row is for", () => {
    show({ messages: [message(), message({ message_id: "m2" })] });
    const panel = screen.getByRole("dialog", { name: "Pinned" });
    expect(within(panel).getByText("2")).toBeTruthy();
    expect(within(panel).getByText(/Click a pin to jump/)).toBeTruthy();
  });

  it("names the author and quotes the message", () => {
    show();
    expect(screen.getByText("Sebi")).toBeTruthy();
    expect(screen.getByText(/Rotation nights are Tuesday/)).toBeTruthy();
  });

  it("jumps to the message the row is about", () => {
    const handlers = show();
    fireEvent.click(screen.getByRole("button", { name: /Rotation nights/ }));
    expect(handlers.onJump).toHaveBeenCalledWith("m1");
  });

  it("marks only the pins that arrived since the last look", () => {
    show({
      messages: [message(), message({ message_id: "m2", sender_name: "Jonas", body: "Older" })],
      unseenIds: new Set(["m1"]),
    });
    expect(screen.getAllByText("New")).toHaveLength(1);
  });

  it("offers Mark read only while something is still marked", () => {
    const handlers = show({ unseenIds: new Set(["m1"]) });
    fireEvent.click(screen.getByText("Mark read"));
    expect(handlers.onMarkRead).toHaveBeenCalled();
    cleanup();

    show();
    expect(screen.queryByText("Mark read")).toBeNull();
  });

  it("unpins without jumping to the message first", () => {
    const handlers = show();
    fireEvent.click(screen.getByLabelText("Unpin message"));
    expect(handlers.onUnpin).toHaveBeenCalled();
    expect(handlers.onJump).not.toHaveBeenCalled();
  });

  it("closes on the ×, on a click outside, and on Escape", () => {
    const handlers = show();
    fireEvent.click(screen.getByLabelText("Close pinned messages"));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
  });

  it("says how to fill an empty panel rather than only that it is empty", () => {
    show({ messages: [message({ pinned: false })] });
    expect(screen.getByText("No pinned messages in this channel.")).toBeTruthy();
    expect(screen.getByText(/Right-click any message/)).toBeTruthy();
  });

  it("labels a message that is only an attachment", () => {
    show({ messages: [message({ body: "<!-- FANCY_FILE:QUJD -->" })] });
    expect(screen.getByText("Attachment")).toBeTruthy();
  });

  it("names the pinner only when it was not the author", () => {
    show({ messages: [message({ pinned_by: "Sebi" })] });
    expect(screen.queryByText(/pinned by/)).toBeNull();
    cleanup();

    show({ messages: [message({ pinned_by: "Jonas" })] });
    expect(screen.getByText(/pinned by Jonas/)).toBeTruthy();
  });
});
