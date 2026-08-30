import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { registerPoll } from "@core/features/chat/poll/model";
import { encodeFileAttachmentMarker } from "@core/features/chat/fileAttachments";
import type { ChatMessage } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { MessageRow } from "./MessageRow";

const openUrlMock = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrlMock(url) }));

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

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
    invokeMock.mockClear();
    useAppStore.setState({
      ownSession: 1,
      users: [],
      polls: new Map(),
      linkEmbeds: new Map(),
      disableLinkPreviews: false,
    });
  });

  it("asks the server for a preview of a link in the body and draws what comes back", async () => {
    const url = "https://www.youtube.com/watch?v=Z_mrUkY41ts";
    const { rerender } = draw(message({ message_id: "preview-1", body: `<a href="${url}">${url}</a>` }));

    expect(invokeMock).toHaveBeenCalledWith("request_link_preview", {
      urls: [url],
      requestId: "preview-1",
    });

    // The embed arrives on its own event well after the row first mounted.
    useAppStore.setState({
      linkEmbeds: new Map([
        ["preview-1", [{ url, type: "video", title: "Landing at Warsaw", site_name: "YouTube" }]],
      ]),
    });
    rerender(
      withNebulaTheme(
        <MessageRow
          message={message({ message_id: "preview-1", body: `<a href="${url}">${url}</a>` })}
          grouped={false}
          onOpenProfile={() => {}}
        />,
      ),
    );

    expect(await screen.findByText("Landing at Warsaw")).toBeTruthy();
  });

  it("draws the picture the server fetched, from the bytes it sent", () => {
    // The server sends the image itself rather than a URL, precisely so no
    // viewer contacts the origin to see it - so the card has to render from
    // `preview.data_url`, and an ordinary link (type `"link"`, which is every
    // page) has to get a picture at all.
    const url = "https://en.wikipedia.org/wiki/Jean-Baptiste_Auriol";
    const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    useAppStore.setState({
      linkEmbeds: new Map([
        [
          "preview-3",
          [
            {
              url,
              type: "link" as const,
              title: "Jean-Baptiste Auriol",
              description: "A French acrobat and tightrope walker.",
              image: { url: "", preview: { data_url: dataUrl, mime: "image/jpeg" } },
            },
          ],
        ],
      ]),
    });

    draw(message({ message_id: "preview-3", body: `<a href="${url}">${url}</a>` }));

    expect(screen.getByText("A French acrobat and tightrope walker.")).toBeTruthy();
    const picture = document.querySelector(`img[src="${dataUrl}"]`);
    expect(picture).toBeTruthy();
  });

  it("asks for nothing when previews are switched off", () => {
    useAppStore.setState({ disableLinkPreviews: true });

    draw(message({ message_id: "preview-2", body: '<a href="https://example.com">https://example.com</a>' }));

    expect(invokeMock).not.toHaveBeenCalledWith("request_link_preview", expect.anything());
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

    // Editing is controlled by the shell - the message menu starts one too -
    // so the test owns the flag the way NebulaClientApp does.
    function Controlled() {
      const [editing, setEditing] = useState(false);
      return (
        <MessageRow
          message={message({ is_own: true, body: "typo" })}
          grouped={false}
          onOpenProfile={() => {}}
          editing={editing}
          onEditingChange={setEditing}
        />
      );
    }
    const { container } = render(withNebulaTheme(<Controlled />));
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

  it("hands a link in a message to the browser instead of the window", () => {
    openUrlMock.mockClear();
    const { container } = draw(message({ body: '<a href="https://example.org/docs">docs</a>' }));

    const link = container.querySelector("a")!;
    // Standard's renderer marks anchors for the guard; nebula's has to as well,
    // or the guard has nothing to intercept.
    expect(link.dataset["external"]).toBe("true");

    const navigated = fireEvent.click(link);
    // A live anchor would navigate the app's own window; the guard asks first,
    // on nebula's own dialog rather than standard's.
    expect(navigated).toBe(false);
    expect(screen.getByText("Leaving Fancy Mumble")).toBeTruthy();
    // The host is drawn apart from the path: it is what the warning is about.
    expect(screen.getByText("example.org")).toBeTruthy();
    expect(screen.getByText("HTTPS")).toBeTruthy();

    fireEvent.click(screen.getByText("Open link"));
    expect(openUrlMock).toHaveBeenCalledWith("https://example.org/docs");
  });

  it("hangs the hover pill above the row, clear of the message body", () => {
    const { container } = draw(message({ body: '<a href="https://example.org/docs">example.org</a>' }));
    fireEvent.mouseEnter(container.firstElementChild!);

    const pill = screen.getByLabelText("Copy message").closest("div")!;
    const style = getComputedStyle(pill);
    // Half over the row is where it used to sit, and there it lay on the first
    // line - a link printed there could not be clicked at all. Now it stands
    // off the top edge: a fixed gap above the row, never a step back into it.
    expect(style.bottom.startsWith("calc(100% + ")).toBe(true);
    expect(style.top.startsWith("-")).toBe(false);
  });

  it("can react to a message that has no reactions yet", () => {
    const { container } = draw(message());
    fireEvent.mouseEnter(container.firstElementChild!);
    // The reaction bar only draws once a reaction exists, so its own "+" can
    // never place the first one - the row has to offer it.
    fireEvent.click(screen.getByLabelText("Add reaction"));
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});
