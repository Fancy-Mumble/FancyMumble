import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { registerPoll } from "@core/features/chat/poll/model";
import { encodeFileAttachmentMarker } from "@core/features/chat/fileAttachments";
import type { ChatMessage } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { MessageRow } from "./MessageRow";

function message(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_session: 7,
    sender_name: "Lorelando",
    body: "hello",
    channel_id: 1,
    is_own: false,
    message_id: "m1",
    timestamp: 1_700_000_000_000,
    ...partial,
  };
}

function draw(msg: ChatMessage, props: Partial<Parameters<typeof MessageRow>[0]> = {}) {
  return render(
    withNebulaTheme(<MessageRow message={msg} grouped={false} onOpenProfile={() => {}} {...props} />),
  );
}

describe("MessageRow", () => {
  beforeEach(() => {
    useAppStore.setState({ ownSession: 1, users: [], polls: new Map() });
  });

  it("draws a poll rather than printing its marker", () => {
    registerPoll({
      type: "poll",
      id: "p1",
      question: "Which build?",
      options: ["MinGW", "MSVC"],
      multiple: false,
      creator: 7,
      creatorName: "Lorelando",
      createdAt: new Date(1_700_000_000_000).toISOString(),
      channelId: 1,
    });

    draw(message({ body: "<!-- FANCY_POLL:p1 -->" }));

    expect(screen.getByText("Which build?")).toBeTruthy();
    expect(screen.getByText("MinGW")).toBeTruthy();
    expect(document.body.textContent).not.toContain("FANCY_POLL");
  });

  it("draws an attachment card and keeps the caption above it", () => {
    const marker = encodeFileAttachmentMarker({
      url: "https://files.example/report.pdf",
      filename: "report.pdf",
      sizeBytes: 2048,
      mode: "public",
    });

    draw(message({ body: `here it is ${marker}` }));

    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.getByText("here it is")).toBeTruthy();
    expect(document.body.textContent).not.toContain("FANCY_FILE");
  });

  it("opens the lightbox on an image in the body", () => {
    const onOpenImage = vi.fn();
    draw(message({ body: '<img src="https://example/cat.png" alt="cat">' }), { onOpenImage });

    fireEvent.click(screen.getByAltText("cat"));
    expect(onOpenImage).toHaveBeenCalledWith("https://example/cat.png");
  });

  it("offers editing on your own text and sends the re-encoded body", () => {
    const editMessage = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ editMessage });

    const { container } = draw(message({ is_own: true, body: "typo" }));
    fireEvent.mouseEnter(container.firstElementChild!);
    fireEvent.click(screen.getByLabelText("Edit message"));

    const field = screen.getByLabelText("Edit message") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "fixed & done" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(editMessage).toHaveBeenCalledWith(1, "m1", "fixed &amp; done");
  });

  it("does not offer editing on a message carrying a card", () => {
    const { container } = draw(message({ is_own: true, body: "<!-- FANCY_POLL:p1 -->" }));
    fireEvent.mouseEnter(container.firstElementChild!);
    expect(screen.queryByLabelText("Edit message")).toBeNull();
  });

  it("does not offer editing on someone else's message", () => {
    const { container } = draw(message({ is_own: false }));
    fireEvent.mouseEnter(container.firstElementChild!);
    expect(screen.queryByLabelText("Edit message")).toBeNull();
  });

  it("offers a reply on anyone's message and hands the caller the target", () => {
    const onQuote = vi.fn();
    const { container } = draw(message({ is_own: false }), { onQuote });
    fireEvent.mouseEnter(container.firstElementChild!);
    fireEvent.click(screen.getByLabelText("Reply to message"));
    expect(onQuote).toHaveBeenCalledWith(expect.objectContaining({ message_id: "m1" }));
  });

  it("draws a quoted message rather than printing its marker", () => {
    useAppStore.setState({
      messages: [message({ message_id: "m0", sender_name: "Lorelando", body: "the original" })],
    });
    draw(message({ body: "<!-- FANCY_QUOTE:m0 -->agreed" }));

    expect(screen.getByText("agreed")).toBeTruthy();
    expect(screen.getByText("the original")).toBeTruthy();
    expect(document.body.textContent).not.toContain("FANCY_QUOTE");
  });
});
