import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import type { ChannelEntry, ChatMessage } from "@core/types";
import { PERM_DELETE_MESSAGE } from "@core/utils/permissions";
import { withNebulaTheme } from "../../testTheme";
import { MessageMenu } from "./MessageMenu";

function channel(partial: Partial<ChannelEntry> = {}): ChannelEntry {
  return {
    id: 1,
    parent_id: 0,
    name: "Gaming",
    permissions: 0,
    pchat_protocol: "fancy_v1_full_archive",
    ...partial,
  } as unknown as ChannelEntry;
}

function message(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_session: 7,
    sender_name: "Lorelando",
    body: "hello",
    channel_id: 1,
    is_own: false,
    message_id: "m1",
    ...partial,
  };
}

function open(msg: ChatMessage = message(), editable = true) {
  const handlers = {
    onClose: vi.fn(),
    onReact: vi.fn(),
    onQuickReact: vi.fn(),
    onQuote: vi.fn(),
    onEdit: vi.fn(),
    onSelect: vi.fn(),
  };
  render(withNebulaTheme(<MessageMenu target={{ message: msg, x: 10, y: 20, editable }} {...handlers} />));
  return handlers;
}

describe("MessageMenu", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({ channels: [channel()] });
  });

  it("draws nothing until a message is right-clicked", () => {
    render(
      withNebulaTheme(
        <MessageMenu
          target={null}
          onClose={vi.fn()}
          onReact={vi.fn()}
          onQuickReact={vi.fn()}
          onQuote={vi.fn()}
          onEdit={vi.fn()}
          onSelect={vi.fn()}
        />,
      ),
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers reacting and replying on anyone's message", () => {
    const handlers = open();
    fireEvent.click(screen.getByRole("button", { name: "More reactions" }));
    expect(handlers.onReact).toHaveBeenCalledWith(expect.objectContaining({ message_id: "m1" }), {
      x: 10,
      y: 20,
    });
  });

  it("offers editing only on your own plain-text message", () => {
    open(message({ is_own: false }));
    expect(screen.queryByText("Edit")).toBeNull();

    cleanup();
    // A body carrying a poll or file marker is not text the author typed, so
    // rewriting it would strip the card.
    open(message({ is_own: true }), false);
    expect(screen.queryByText("Edit")).toBeNull();

    cleanup();
    open(message({ is_own: true }), true);
    expect(screen.getByText("Edit")).toBeTruthy();
  });

  it("lets you delete your own message without the moderation bit", () => {
    open(message({ is_own: true }));
    expect(screen.getByText("Delete message")).toBeTruthy();
    // Bulk selection is moderation, and this user has none.
    expect(screen.queryByText("Select messages…")).toBeNull();
  });

  it("withholds deletion of someone else's message without the bit", () => {
    open(message({ is_own: false }));
    expect(screen.queryByText("Delete")).toBeNull();
  });

  it("offers bulk selection where the server grants DeleteMessage", () => {
    useAppStore.setState({ channels: [channel({ permissions: PERM_DELETE_MESSAGE })] });
    const handlers = open(message({ is_own: false }));
    expect(screen.getByText("Delete message")).toBeTruthy();
    fireEvent.click(screen.getByText("Select messages…"));
    expect(handlers.onSelect).toHaveBeenCalledWith("m1");
  });

  it("withholds deletion on a channel that stores nothing", () => {
    useAppStore.setState({
      channels: [channel({ permissions: PERM_DELETE_MESSAGE, pchat_protocol: "none" })],
    });
    open(message({ is_own: false }));
    expect(screen.queryByText("Delete")).toBeNull();
  });
});
