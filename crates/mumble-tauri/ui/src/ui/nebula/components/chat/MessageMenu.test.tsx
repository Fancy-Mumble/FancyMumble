import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import type { ChannelEntry, ChatMessage, UserEntry } from "@core/types";
import { PERM_DELETE_MESSAGE } from "@core/utils/permissions";
import { applyReadStates, clearReadReceipts } from "@core/features/chat/readreceipt/readReceiptStore";
import { resetPrivateBrowsingCache } from "@core/features/elements/privateBrowsing";
import { withNebulaTheme } from "../../testTheme";
import { MessageMenu, type MenuImage } from "./MessageMenu";
import { popupActions, closeAllPopups } from "../../clientState";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

function user(session: number, name: string, hash: string): UserEntry {
  return { session, name, hash, channel_id: 1, texture_size: null } as UserEntry;
}

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

function open(
  msg: ChatMessage = message(),
  editable = true,
  allMessageIds?: readonly string[],
  selection = "",
  image: MenuImage | null = null,
  link: string | null = null,
) {
  popupActions.openMessageMenu(msg, { x: 10, y: 20 }, { editable, selection, image, link });
  const handlers = {
    onReact: vi.fn(),
    onQuickReact: vi.fn(),
    onQuote: vi.fn(),
    onEdit: vi.fn(),
    onSelect: vi.fn(),
  };
  render(
    withNebulaTheme(
      <MessageMenu allMessageIds={allMessageIds} {...handlers} />,
    ),
  );
  return handlers;
}

describe("MessageMenu", () => {
  beforeEach(() => {
    cleanup();
    closeAllPopups();
    clearReadReceipts();
    invokeMock.mockClear();
    // The private-window answer is cached for the session, so a test that
    // leaves it resolved would decide the next test's menu for it.
    resetPrivateBrowsingCache();
    useAppStore.setState({
      channels: [channel()],
      users: [],
      ownSession: 1,
      readReceiptVersion: 0,
      watchSessions: new Map(),
      watchSessionsVersion: 0,
    });
  });

  it("draws nothing until a message is right-clicked", () => {
    render(
      withNebulaTheme(
        <MessageMenu
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

  it("pops an image in the message out into its own window", () => {
    open(message({ body: 'look <img src="https://example/cat.png">' }));

    fireEvent.click(screen.getByText("Pop out image"));
    expect(invokeMock).toHaveBeenCalledWith("open_image_popout", {
      payload: expect.objectContaining({
        src: "https://example/cat.png",
        sender_name: "Lorelando",
        // The words around the picture caption it; the tag itself is not text.
        caption: "look",
      }),
    });
  });

  it("offers no popout on a message carrying no picture", () => {
    open(message({ body: "just words" }));
    expect(screen.queryByText("Pop out image")).toBeNull();
  });

  it("starts a watch-together session from a message carrying a video", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ sendMessage });
    open(message({ body: "film night https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));

    await act(async () => {
      fireEvent.click(screen.getByText("Watch together"));
    });

    // The session goes into the store before the wire, because the server does
    // not echo the event back to whoever sent it - the card Nebula already
    // draws reads it from there.
    expect(useAppStore.getState().watchSessions.size).toBe(1);
    expect(invokeMock).toHaveBeenCalledWith(
      "send_watch_sync",
      expect.objectContaining({
        event: expect.objectContaining({ type: "start", sourceKind: "youtube", hostSession: 1 }),
      }),
    );
    // The marker is what puts the card in everyone else's conversation.
    expect(sendMessage.mock.calls[0]?.[1]).toMatch(/<!-- FANCY_WATCH:[0-9a-f-]+ -->/);
  });

  it("finds the video in the anchor the server actually sends", async () => {
    useAppStore.setState({ sendMessage: vi.fn().mockResolvedValue(undefined) });
    // What arrives on the wire is the serialized HTML, not the text typed: the
    // URL sits in an href with its query escaped, and a playlist link carries
    // parameters after the id.
    const url = "https://www.youtube.com/watch?v=eKqZWVcYs7E&amp;list=RDfr0Kca_jWsw&amp;index=2";
    open(message({ body: `<a href="${url}">${url}</a>` }));

    await act(async () => {
      fireEvent.click(screen.getByText("Watch together"));
    });

    const session = Array.from(useAppStore.getState().watchSessions.values())[0];
    expect(session.sourceKind).toBe("youtube");
    // The canonical watch URL, with the playlist parameters dropped.
    expect(session.sourceUrl).toBe("https://www.youtube.com/watch?v=eKqZWVcYs7E");
  });

  it("offers no watch-together on a message with no video in it", () => {
    open(message({ body: "just words" }));
    expect(screen.queryByText("Watch together")).toBeNull();
  });

  it("names who has read your own message", () => {
    useAppStore.setState({ users: [user(1, "Zewi", "own-hash"), user(2, "Lorelando", "hash-l")] });
    applyReadStates(1, [
      { cert_hash: "hash-l", name: "Lorelando", is_online: true, last_read_message_id: "m2", timestamp: 1 },
      { cert_hash: "own-hash", name: "Zewi", is_online: true, last_read_message_id: "m2", timestamp: 1 },
    ]);

    open(message({ is_own: true, message_id: "m1" }), true, ["m1", "m2"]);

    expect(screen.getByText("Read by")).toBeTruthy();
    expect(screen.getByText("Lorelando")).toBeTruthy();
    // Having read what you sent is not news.
    expect(screen.queryByText("Zewi")).toBeNull();
  });

  it("says nobody has read it yet rather than hiding the question", () => {
    open(message({ is_own: true, message_id: "m1" }), true, ["m1"]);
    expect(screen.getByText("No one yet")).toBeTruthy();
  });

  it("keeps the reader list off someone else's message", () => {
    applyReadStates(1, [
      { cert_hash: "hash-l", name: "Lorelando", is_online: true, last_read_message_id: "m1", timestamp: 1 },
    ]);
    open(message({ is_own: false, message_id: "m1" }), true, ["m1"]);
    // Who has read *them* is not the reader's business.
    expect(screen.queryByText("Read by")).toBeNull();
  });

  it("withholds deletion on a channel that stores nothing", () => {
    useAppStore.setState({
      channels: [channel({ permissions: PERM_DELETE_MESSAGE, pchat_protocol: "none" })],
    });
    open(message({ is_own: false }));
    expect(screen.queryByText("Delete")).toBeNull();
  });
});

describe("MessageMenu copy", () => {
  /** The clipboard, swapped for something that remembers. */
  function stubClipboard() {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    return writeText;
  }

  it("copies the lines the reader saw, not one welded-together word", () => {
    const writeText = stubClipboard();
    open(message({ body: "<p>Hello</p><p>World</p>" }));
    fireEvent.click(screen.getByText("Copy text"));
    expect(writeText).toHaveBeenCalledWith("Hello\n\nWorld");
  });

  it("keeps a line break as a line break", () => {
    const writeText = stubClipboard();
    open(message({ body: "Hello<br>World" }));
    fireEvent.click(screen.getByText("Copy text"));
    expect(writeText).toHaveBeenCalledWith("Hello\nWorld");
  });

  it("offers the highlighted words, and copies those rather than the message", () => {
    // Right-clicking a sentence you have just picked out of a message and
    // being offered only the whole message is the complaint this answers.
    const writeText = stubClipboard();
    open(message({ body: "<p>one sentence, then another</p>" }), true, undefined, "one sentence");
    fireEvent.click(screen.getByText("Copy selection"));
    expect(writeText).toHaveBeenCalledWith("one sentence");
  });

  it("says nothing about a selection where there is none", () => {
    open(message({ body: "<p>Hello</p>" }));
    expect(screen.queryByText("Copy selection")).toBeNull();
  });

  it("pastes entities as the characters they stand for", () => {
    const writeText = stubClipboard();
    open(message({ body: "<p>a &amp; b &quot;c&quot;</p>" }));
    fireEvent.click(screen.getByText("Copy text"));
    expect(writeText).toHaveBeenCalledWith('a & b "c"');
  });

  it("says nothing about pictures on a message that was not right-clicked on one", () => {
    open(message({ body: "<p>Hello</p>" }));
    expect(screen.queryByText("Copy image")).toBeNull();
    expect(screen.queryByText("Save image…")).toBeNull();
  });

  it("puts the picture's own actions above the message's when one was aimed at", () => {
    // The complaint this answers: right-clicking a photograph offered Reply,
    // Pin and Delete, and nothing at all about the photograph.
    open(message({ body: "" }), true, undefined, "", {
      src: "data:image/png;base64,iVBORw0KGgo=",
      alt: "cat",
    });
    expect(screen.getByText("Copy image")).toBeTruthy();
    expect(screen.getByText("Save image…")).toBeTruthy();
    expect(screen.getByText("Pop out image")).toBeTruthy();
    // A pasted picture is carried in the message: there is no address to copy
    // and no page to open it at.
    expect(screen.queryByText("Copy image link")).toBeNull();
    expect(screen.queryByText("Open in browser")).toBeNull();
    // ...and the message's own rows are still all there underneath.
    expect(screen.getByText("Reply")).toBeTruthy();
  });

  it("offers the link rows for a picture that has an address", () => {
    open(message(), true, undefined, "", { src: "https://files.example.com/7/cat.png", alt: "cat" });
    expect(screen.getByText("Copy image link")).toBeTruthy();
    expect(screen.getByText("Open in browser")).toBeTruthy();
  });

  it("copies the link a public file arrived as, not the local copy on screen", () => {
    // A public or password-protected file is drawn from a downloaded copy, so
    // the `src` on screen is a path off this machine's disk.
    const writeText = stubClipboard();
    open(message(), true, undefined, "", {
      src: "asset://localhost/C:/Users/me/cat.png",
      alt: "cat",
      link: "https://files.example.com/7/cat.png",
    });
    fireEvent.click(screen.getByText("Copy image link"));
    expect(writeText).toHaveBeenCalledWith("https://files.example.com/7/cat.png");
  });

  it("says on the row that the link went to the clipboard", async () => {
    stubClipboard();
    open(message(), true, undefined, "", { src: "https://files.example.com/7/cat.png", alt: "cat" });
    fireEvent.click(screen.getByText("Copy image link"));
    await screen.findByText("Copied");
  });

  it("offers no Copy text on a message that is nothing but pictures", () => {
    // An empty string on the clipboard is a row that looks like it did nothing.
    open(message({ body: "" }), true, undefined, "", {
      src: "data:image/png;base64,iVBORw0KGgo=",
      alt: "cat",
    });
    expect(screen.queryByText("Copy text")).toBeNull();
  });

  it("answers a second right-click itself instead of leaving it to the webview", () => {
    // An open menu lays a sheet over the window, so the next right-click never
    // reaches the message underneath - and what came up was the webview's own
    // Back / Refresh / Inspect menu, drawn on top of this one.
    open();
    const root = document.querySelector(".MuiModal-root");
    expect(root).toBeTruthy();

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    // Dismissing is a store write now, so the render it causes has to be
    // allowed to happen before the menu is looked for.
    act(() => {
      root!.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("MessageMenu private windows", () => {
  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    // The answer is cached for the session, so a test that leaves it resolved
    // would otherwise decide the next test's menu for it.
    resetPrivateBrowsingCache();
    useAppStore.setState({ channels: [channel()], users: [], ownSession: 1 });
  });

  /** Answer the one backend question the row is gated on. */
  function withPrivateSupport(available: boolean) {
    invokeMock.mockImplementation((cmd) =>
      Promise.resolve(cmd === "can_open_url_private" ? available : undefined),
    );
  }

  /** Let the effect's answer land before the menu is read. */
  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("offers a private window for the link that was right-clicked", async () => {
    withPrivateSupport(true);
    open(message(), true, undefined, "", null, "https://example.com/a");
    await settle();
    fireEvent.click(screen.getByText("Open link in private window"));
    expect(invokeMock).toHaveBeenCalledWith("open_url_private", { url: "https://example.com/a" });
  });

  it("says nothing where the default browser has no private mode", async () => {
    // Safari, or a browser nobody recognises: the row could only ever fail.
    withPrivateSupport(false);
    open(message(), true, undefined, "", null, "https://example.com/a");
    await settle();
    expect(screen.queryByText("Open link in private window")).toBeNull();
  });

  it("says nothing when the right-click was not on a link", async () => {
    withPrivateSupport(true);
    open();
    await settle();
    expect(screen.queryByText("Open link in private window")).toBeNull();
  });
});
