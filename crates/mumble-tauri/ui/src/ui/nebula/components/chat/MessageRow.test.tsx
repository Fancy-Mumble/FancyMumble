import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { registerPoll } from "@core/features/chat/poll/model";
import { encodeFileAttachmentMarker } from "@core/features/chat/fileAttachments";
import type { ChatMessage, UserEntry } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { MessageRow } from "./MessageRow";
import { resetSelfMentionNotifications } from "@core/features/chat/selfMention";

function user(session: number, name: string, channel_id = 1): UserEntry {
  return { session, name, channel_id, texture_size: null } as UserEntry;
}

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

function cleanupRows() {
  cleanup();
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

  it("offers starting a watch-together session on the strip, not only on right-click", async () => {
    useAppStore.setState({
      sendMessage: vi.fn().mockResolvedValue(undefined),
      watchSessions: new Map(),
      watchSessionsVersion: 0,
    });
    // The strip is the only affordance the row has, so a video that can only
    // be started from the context menu is one nobody finds.
    const url = "https://www.youtube.com/watch?v=eKqZWVcYs7E&amp;list=RDfr0Kca_jWsw";
    draw(message({ body: `<a href="${url}">${url}</a>` }), { alwaysShowActions: true });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Watch together"));
    });

    expect(useAppStore.getState().watchSessions.size).toBe(1);
  });

  it("formats a body that arrived as the markdown a bot typed", () => {
    // Five bots posting through the protocol printed their own asterisks and
    // backticks down the whole river: their bodies are markdown, because a
    // client that is not this one has no reason to send HTML.
    const { container } = draw(message({ body: "**Nice settings** _channel fox_ `code 2994` and sure" }));

    expect(container.querySelector("b")?.textContent).toBe("Nice settings");
    expect(container.querySelector("i")?.textContent).toBe("channel fox");
    expect(container.querySelector("code")?.textContent).toBe("code 2994");
    expect(container.textContent).not.toContain("**");
  });

  it("leaves a body that is markup already exactly as it came", () => {
    // The common case, and the one that must not change: reading HTML as
    // markdown escapes its tags and prints them.
    const { container } = draw(message({ body: "<b>Nice</b> and <i>fox</i>" }));

    expect(container.querySelector("b")?.textContent).toBe("Nice");
    expect(container.textContent).not.toContain("<b>");
  });

  it("keeps the strip clear of it where the message carries no video", () => {
    draw(message({ body: "just words" }), { alwaysShowActions: true });
    expect(screen.queryByLabelText("Watch together")).toBeNull();
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
        [url, { url, type: "video", title: "Landing at Warsaw", site_name: "YouTube" }],
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
          url,
          {
            url,
            type: "link" as const,
            title: "Jean-Baptiste Auriol",
            description: "A French acrobat and tightrope walker.",
            image: { url: "", preview: { data_url: dataUrl, mime: "image/jpeg" } },
          },
        ],
      ]),
    });

    draw(message({ message_id: "preview-3", body: `<a href="${url}">${url}</a>` }));

    // The title rides on the picture; a poster whose ground is a picture does
    // not also print the page's blurb, which is where the picture is.
    expect(screen.getByText("Jean-Baptiste Auriol")).toBeTruthy();
    const picture = document.querySelector(`img[src="${dataUrl}"]`);
    expect(picture).toBeTruthy();
  });

  it("draws the preview inside the message that carried the link, not as a block after it", () => {
    // A card standing under a bubble is a second block in the river, and
    // whichever message it belongs to is a guess: it has the same left edge
    // and the same width as the message below it. Inside the bubble the pair
    // is what it always was - one message, and what its link turned out to be.
    const url = "https://www.youtube.com/watch?v=zc36tWQcXY";
    const title = "Unbreakable (Arknights Soundtrack)";

    /** The nearest ancestor that is a bubble, by the padding only a plate has. */
    const plate = (node: Element | null) => {
      for (let el = node; el; el = el.parentElement) {
        if (getComputedStyle(el).paddingLeft === "14px") return el;
      }
      return null;
    };

    for (const is_own of [true, false]) {
      useAppStore.setState({
        linkEmbeds: new Map([[url, { url, type: "video" as const, title, site_name: "YouTube" }]]),
      });
      const { container, unmount } = draw(
        message({
          message_id: "preview-4",
          is_own,
          body: `listen to this <a href="${url}">${url}</a>`,
        }),
        { bubbleStyle: "bubbles" },
      );

      // A sentence, so there is a plate around it - see the test below for
      // the message that is nothing but its link, where the poster is the
      // bubble and there is no padding left to find it by.
      const bubble = plate(within(container).getByText(/listen to this/));
      expect(bubble).toBeTruthy();
      // The same plate holds both, which is the whole of "one message".
      expect(bubble!.contains(within(container).getByText(title))).toBe(true);
      unmount();
    }
  });

  it("leaves the preview a card of its own where there is no bubble to put it in", () => {
    // Flat and compact draw no plate, so there is nothing to attach to: the
    // card keeps its own ground rather than becoming loose text under the
    // message.
    const url = "https://www.youtube.com/watch?v=zc36tWQcXY";
    const title = "Unbreakable (Arknights Soundtrack)";
    useAppStore.setState({
      linkEmbeds: new Map([[url, { url, type: "video" as const, title, site_name: "YouTube" }]]),
    });

    const { container } = draw(message({ message_id: "preview-5", body: `<a href="${url}">${url}</a>` }), {
      bubbleStyle: "flat",
    });

    // Walked rather than counted: the card is a poster now, and how many
    // boxes sit between its title and its ground is the preview's business.
    // What this row cares about is that there *is* a ground between the title
    // and the message, whatever it is made of.
    let ground: HTMLElement | null = null;
    for (
      let node: HTMLElement | null = within(container).getByText(title);
      node && node !== container;
      node = node.parentElement
    ) {
      const colour = getComputedStyle(node).backgroundColor;
      if (colour && colour !== "rgba(0, 0, 0, 0)" && colour !== "transparent") {
        ground = node;
        break;
      }
    }
    expect(ground).not.toBeNull();
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

  it("draws a batch of attached pictures as one block, each with its own link", () => {
    const photos = ["ferry.jpg", "skyline.jpg", "bridge.jpg"].map((filename) =>
      encodeFileAttachmentMarker({
        url: `https://files.example/${filename}`,
        filename,
        sizeBytes: 2048,
        mode: "public",
      }),
    );

    draw(message({ body: ["the ferry ones", ...photos].join("\n") }));

    // Every picture arrives, the caption stays prose, and every tile keeps its
    // own flag - the flag is the button that copies that file's link, and the
    // links differ per file even when the reach was chosen once. On a tile the
    // flag is the button alone: the block says "public link" once above them,
    // so three copies of the words would be clutter and no information.
    expect(
      screen.getAllByRole("img").filter((img) => img.getAttribute("alt")?.endsWith(".jpg")),
    ).toHaveLength(3);
    expect(screen.getByText("the ferry ones")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Copy link" })).toHaveLength(3);
    expect(screen.queryByText("Public link")).toBeNull();
  });

  it("opens the lightbox on an image in the body", () => {
    const onOpenImage = vi.fn();
    draw(message({ body: '<img src="https://example/cat.png" alt="cat">' }), { onOpenImage });

    fireEvent.click(screen.getByAltText("cat"));
    expect(onOpenImage).toHaveBeenCalledWith("https://example/cat.png");
  });

  it("groups the pictures of one message into a single block", () => {
    const onOpenImage = vi.fn();
    draw(message({ body: '<img src="a.jpg" alt="ferry"><img src="b.jpg" alt="skyline">' }), { onOpenImage });

    // Both are drawn, and clicking the second enlarges the second - a grid
    // that reported its first tile for every click would be worse than none.
    expect(screen.getByAltText("ferry")).toBeTruthy();
    fireEvent.click(screen.getByAltText("skyline"));
    expect(onOpenImage).toHaveBeenCalledWith("b.jpg");
  });

  it("keeps a caption in its bubble and puts the picture below it", () => {
    draw(message({ body: 'the ferry ones<img src="a.jpg" alt="ferry">' }));

    expect(screen.getByText("the ferry ones")).toBeTruthy();
    expect(screen.getByAltText("ferry")).toBeTruthy();
  });

  it("hands the lightbox the src as written, not as the browser resolved it", () => {
    // The gallery is indexed by the attribute, so a src the DOM normalises -
    // here a bare host, which comes back with a slash on the end - has to be
    // reported the way it was sent or the lookup misses and nothing opens.
    const onOpenImage = vi.fn();
    draw(message({ body: '<img src="https://example" alt="cat">' }), { onOpenImage });

    fireEvent.click(screen.getByAltText("cat"));
    expect(onOpenImage).toHaveBeenCalledWith("https://example");
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

  it("drops the avatar in compact mode, and keeps the author", () => {
    const roomy = draw(message()).container;
    expect(roomy.querySelector(".MuiAvatar-root")).toBeTruthy();

    const tight = draw(message(), { compact: true }).container;
    expect(tight.querySelector(".MuiAvatar-root")).toBeNull();
    // The name is how you know who is talking; only the picture goes.
    expect(tight.textContent).toContain("Lorelando");
  });

  it("pins the action strip into the flow when it is always shown", () => {
    draw(message(), { alwaysShowActions: true });

    // Up without a hover...
    const pill = screen.getByLabelText("Copy message").closest("div")!;
    expect(getComputedStyle(pill).position).not.toBe("absolute");
    // ...and not floating over the message above, which is what the hover pill
    // does and what makes it wrong for every row at once.
    expect(getComputedStyle(pill).bottom.startsWith("calc(100% + ")).toBe(false);
  });

  it("does not draw the strip twice when a pinned row is hovered", () => {
    const { container } = draw(message(), { alwaysShowActions: true });
    fireEvent.mouseEnter(container.firstElementChild!);
    expect(screen.getAllByLabelText("Copy message")).toHaveLength(1);
  });

  it("opens the mentioned person rather than leaving their name as prose", () => {
    useAppStore.setState({ users: [user(42, "Zewi")] });
    const onOpenProfile = vi.fn();
    draw(
      message({
        body: 'hi <span class="mention mention-user" data-mention-session="42">@Zewi</span>',
      }),
      { onOpenProfile },
    );

    fireEvent.click(screen.getByText("@Zewi"));
    expect(onOpenProfile).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ currentTarget: expect.anything() }),
    );
  });

  it("lists who an @everyone reaches, scoped to the channel it was said in", () => {
    useAppStore.setState({
      selectedChannel: 1,
      users: [user(1, "Zewi"), user(2, "Kayo"), user(3, "Elsewhere", 2)],
    });
    draw(
      message({
        body: '<span class="mention mention-everyone" data-mention-everyone="1">@everyone</span>',
      }),
    );

    fireEvent.click(screen.getByText("@everyone"));
    expect(screen.getByText("Zewi")).toBeTruthy();
    expect(screen.getByText("Kayo")).toBeTruthy();
    // `@everyone` means everyone *here*, which is the scope the sender's
    // renderer used - not everyone on the server.
    expect(screen.queryByText("Elsewhere")).toBeNull();
  });

  it("says so when the person a mention names has since disconnected", () => {
    useAppStore.setState({ users: [] });
    const onOpenProfile = vi.fn();
    draw(
      message({
        body: '<span class="mention mention-user" data-mention-session="42">@Zewi</span>',
      }),
      { onOpenProfile },
    );

    fireEvent.click(screen.getByText("@Zewi"));
    // A card cannot be opened on somebody who is gone, and a chip that simply
    // does nothing reads as broken rather than as empty.
    expect(onOpenProfile).not.toHaveBeenCalled();
    expect(screen.getByText("This person is no longer connected.")).toBeTruthy();
  });

  it("reads the clock the way the Language & format page was set", () => {
    // Server time, so the reading is the same on every machine this runs on:
    // 1_700_000_000_000 is 22:13 UTC.
    const at = message({ timestamp: 1_700_000_000_000 });

    const twentyFour = draw(at, {
      time: { timeFormat: "24h", localTime: false, systemUses24h: undefined },
    }).container;
    expect(twentyFour.textContent).toContain("22:13");

    const twelve = draw(at, {
      time: { timeFormat: "12h", localTime: false, systemUses24h: undefined },
    }).container;
    expect(twelve.textContent).toContain("10:13");
    expect(twelve.textContent).not.toContain("22:13");
  });

  it("gives everyone a card in the bubbles style, not only the reader", () => {
    // The setting promises "every message in a rounded card", and it used to
    // mean the sender's own: a room where one person is in bubbles and
    // everybody else is bare prose reads as a rendering fault, not a style.
    const mine = within(draw(message({ is_own: true })).container).getByText("hello");
    const theirs = within(draw(message({ is_own: false })).container).getByText("hello");

    for (const body of [mine, theirs]) {
      const style = getComputedStyle(body);
      expect(style.paddingLeft).toBe("14px");
      // What proves a card is the surface under the words, and it is no
      // longer a border: a skin may cut the bubble's corners, and a real
      // border is sliced off at the diagonal, so the edge is drawn as a
      // ground with the fill inset over it. Bare prose has no ground at
      // all, which is the difference this is here to catch.
      expect(style.backgroundColor).not.toBe("");
      expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  it("puts your own message in the river with everyone else's in the flat style", () => {
    const bubbled = draw(message({ is_own: true }), { bubbleStyle: "bubbles" }).container;
    // The right-hand column has neither: it is the reader's own message, so
    // the avatar and the name would be saying what they already know.
    expect(bubbled.querySelector(".MuiAvatar-root")).toBeNull();
    expect(bubbled.textContent).not.toContain("Lorelando");

    const flat = draw(message({ is_own: true }), { bubbleStyle: "flat" }).container;
    expect(flat.querySelector(".MuiAvatar-root")).toBeTruthy();
    expect(flat.textContent).toContain("Lorelando");
    // "One continuous river" is the chrome going, not just the alignment.
    const bare = getComputedStyle(within(flat).getByText("hello"));
    expect(bare.paddingLeft).not.toBe("14px");
    expect(bare.borderBottomStyle).not.toBe("solid");
  });

  it("keeps the receipt on your own message once the bubble under it is gone", () => {
    // The tick used to live in the bubble's footer, which the flat style does
    // not draw - so it has to move up into the header rather than disappear
    // for two of the three styles.
    const flat = draw(message({ is_own: true }), { bubbleStyle: "flat" }).container;
    expect(within(flat).getByLabelText("Sent")).toBeTruthy();
  });

  it("still lets you edit your own message outside the bubbles style", () => {
    function Controlled() {
      const [editing, setEditing] = useState(false);
      return (
        <MessageRow
          message={message({ is_own: true, body: "typo" })}
          grouped={false}
          bubbleStyle="flat"
          onOpenProfile={() => {}}
          editing={editing}
          onEditingChange={setEditing}
        />
      );
    }
    const { container } = render(withNebulaTheme(<Controlled />));
    fireEvent.mouseEnter(container.firstElementChild!);
    fireEvent.click(screen.getByLabelText("Edit message"));

    expect(screen.getByLabelText("Edit message").tagName).toBe("TEXTAREA");
  });

  it("drops the avatar and runs the name into the line in the compact style", () => {
    const { container } = draw(message(), { bubbleStyle: "compact" });

    expect(container.querySelector(".MuiAvatar-root")).toBeNull();
    expect(container.textContent).toContain("Lorelando");
    // The IRC line: name and body on one line, which only holds if the body
    // stops being a block of its own.
    expect(getComputedStyle(within(container).getByText("hello")).display).toBe("inline");
  });

  it("stands a placeholder in for a body that is in cold storage", () => {
    // What the backend leaves in the body's place once it has written the real
    // one to an encrypted temp file. Unhandled, it sanitises away to nothing
    // and the message reads as an empty row.
    const { container } = draw(message({ body: "<!-- OFFLOADED:m1:200000 -->" }), { bubbleStyle: "flat" });

    const placeholder = screen.getByRole("img", { name: "Content offloaded" });
    // Held open at the size the picture had, so the river does not jump when
    // the real one lands.
    expect(getComputedStyle(placeholder).minHeight).toBe("600px");
    expect(container.textContent).not.toContain("OFFLOADED");
  });

  it("says the body is being decrypted while the read is in flight", () => {
    // The wait is visible on a slow disk, and an unlabelled grey block there
    // reads as a message that failed rather than one on its way.
    draw(message({ body: "<!-- OFFLOADED:m1:9000 -->" }), { bubbleStyle: "flat", restoring: true });

    expect(screen.getByRole("img", { name: "Decrypting…" })).toBeTruthy();
  });

  it("does not offer editing a message whose body is away", () => {
    // The only text on hand is the placeholder, so committing an edit would
    // send that in place of the picture.
    draw(message({ is_own: true, body: "<!-- OFFLOADED:m1:9000 -->" }), {
      bubbleStyle: "flat",
      alwaysShowActions: true,
    });

    expect(screen.queryByLabelText("Edit message")).toBeNull();
  });

  it("prints the clock once for a run of own bubbles, under the last of them", () => {
    // Six messages sent inside one minute printed the same reading six times,
    // each on a line of its own: the block gets one, at its foot.
    const own = message({ is_own: true, sender_session: 1, sender_name: "You" });
    const { container, unmount } = draw(own, { grouped: true, endsGroup: false });
    expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}/);
    unmount();

    const last = draw(own, { grouped: true, endsGroup: true });
    expect(last.container.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it("keeps the refusal on a message that failed mid-run", () => {
    // The failure is about this message rather than about the run it sits in,
    // and swallowing it inside a block hides the only sign the send went
    // nowhere.
    const { container } = draw(message({ is_own: true, sender_session: 1, send_failed: true }), {
      grouped: true,
      endsGroup: false,
    });

    expect(container.textContent).toContain("failed");
  });

  it("heads another person's block with the time beside their name", () => {
    // A name with nothing next to it is a message that reads as having
    // happened at no particular moment - the left-hand column has no footer
    // to put the clock in, so the header carries it.
    const { container } = draw(message(), { grouped: false });

    const header = screen.getByText("Lorelando").parentElement!;
    expect(header.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(container.textContent).toContain("hello");
  });

  it("draws the time smaller than the name it sits beside", () => {
    draw(message(), { grouped: false });

    const name = screen.getByText("Lorelando");
    const stamp = within(name.parentElement!).getByText(/\d{1,2}:\d{2}/);
    expect(parseFloat(getComputedStyle(stamp).fontSize)).toBeLessThan(
      parseFloat(getComputedStyle(name).fontSize),
    );
  });
});

describe("MessageRow self-mention", () => {
  /** A chip aimed at whoever is session 42, the way the sender writes one. */
  const AT_ME = '<span class="mention" data-mention-session="42">@Ada</span> ready?';

  beforeEach(() => {
    resetSelfMentionNotifications();
    useAppStore.setState({
      ownSession: 42,
      currentChannel: 1,
      users: [user(42, "Ada"), user(7, "Lorelando")],
    });
  });

  /** Times the mention ping fired while `run` mounted rows. */
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

  it("rings the mention sound Nebula mounts the listener for", () => {
    // The bug: Nebula rendered the chip and never dispatched, so the sound
    // the runtime is listening for could not fire.
    expect(pings(() => draw(message({ body: AT_ME, timestamp: Date.now() })))).toBe(1);
  });

  it("stays silent when the mention is for somebody else", () => {
    useAppStore.setState({ ownSession: 7 });
    expect(pings(() => draw(message({ body: AT_ME, timestamp: Date.now() })))).toBe(0);
  });

  it("marks the row so a mention can be found by eye", () => {
    const { container } = draw(message({ body: AT_ME, timestamp: Date.now() }));
    const row = container.querySelector('[data-msg-id="m1"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row!.getAttribute("data-self-mention")).toBe("1");
  });

  it("leaves an ordinary message unmarked", () => {
    const { container } = draw(message({ body: "just talking", timestamp: Date.now() }));
    const row = container.querySelector('[data-msg-id="m1"]') as HTMLElement | null;
    expect(row!.getAttribute("data-self-mention")).toBeNull();
  });
  it("keeps the sentence when somebody wrote one around the link", () => {
    // Only a body that is *nothing but* links is the card over again. A
    // sentence with a link in it is what somebody said, and dropping it would
    // drop the message to keep the preview.
    const url = "https://www.youtube.com/watch?v=zc36tWQcXY";
    useAppStore.setState({
      linkEmbeds: new Map([
        [url, { url, type: "video" as const, title: "Unbreakable", site_name: "YouTube" }],
      ]),
    });

    const { container } = draw(
      message({ message_id: "preview-6", body: `listen to this <a href="${url}">${url}</a>` }),
      { bubbleStyle: "bubbles" },
    );

    expect(within(container).getByText(/listen to this/)).toBeTruthy();
    expect(within(container).getByText("youtube.com/watch")).toBeTruthy();
  });
  it("lets the card be the message where the message is nothing but the link", () => {
    // The card names the source, prints the title and opens the same page, so
    // a URL above it is the same fact twice - and the bubble around the pair
    // is a plate around a poster. Both go: the poster *is* the bubble.
    const url = "https://www.youtube.com/watch?v=zc36tWQcXY";
    const title = "Unbreakable (Arknights Soundtrack)";
    useAppStore.setState({
      linkEmbeds: new Map([[url, { url, type: "video" as const, title, site_name: "YouTube" }]]),
    });

    const { container } = draw(message({ message_id: "preview-7", body: `<a href="${url}">${url}</a>` }), {
      bubbleStyle: "bubbles",
    });

    expect(within(container).queryByText("youtube.com/watch")).toBeNull();
    expect(within(container).getByText(title)).toBeTruthy();
    // Nothing between the poster and the bubble's edge.
    for (let node = document.querySelector("[data-preview-shape]")?.parentElement; node;) {
      const pad = getComputedStyle(node).paddingLeft;
      expect(pad === "" || pad === "0px").toBe(true);
      node = node === container ? null : node.parentElement;
    }
  });
  it("leaves the body's text nodes alone when the pointer crosses the row", () => {
    // The bug this pins: `dangerouslySetInnerHTML={{ __html: body }}` builds a
    // new object every render, React compares that prop by reference, and so it
    // re-assigned `innerHTML` whenever anything re-rendered the row - hovering
    // it, for one. The rebuilt text nodes took the reader's selection with
    // them, which is why chat text could not be copied: moving the pointer off
    // the words you had just highlighted wiped the highlight.
    const { container } = draw(message({ message_id: "sel-1", body: "a line worth copying" }));
    const row = container.querySelector("[data-msg-id]")!;
    const before = within(container).getByText("a line worth copying").firstChild;

    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);

    expect(within(container).getByText("a line worth copying").firstChild).toBe(before);
  });

  it("hands the right-click menu whatever the reader had highlighted", () => {
    // "Copy" that can only mean the whole message is no use to somebody who
    // picked out one sentence of it.
    const onContextMenu = vi.fn();
    const { container } = draw(message({ message_id: "sel-2", body: "one sentence, then another" }), {
      onContextMenu,
    });
    const row = container.querySelector("[data-msg-id]") as HTMLElement;
    const text = within(container).getByText("one sentence, then another").firstChild!;

    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 12);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.contextMenu(row);

    expect(onContextMenu).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ editable: true, selection: "one sentence" }),
    );
  });

  it("offers no selection where the reader has highlighted something else", () => {
    const onContextMenu = vi.fn();
    const { container } = draw(message({ message_id: "sel-3", body: "nothing highlighted here" }), {
      onContextMenu,
    });
    const outside = document.createElement("p");
    outside.textContent = "somewhere else entirely";
    document.body.append(outside);

    const range = document.createRange();
    range.selectNodeContents(outside);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.contextMenu(container.querySelector("[data-msg-id]") as HTMLElement);

    expect(onContextMenu).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ editable: true, selection: "" }),
    );
    outside.remove();
  });

  it("reports which picture the right-click landed on", () => {
    // The menu offers "copy this picture", and a block of two has two answers
    // to that - so which tile was aimed at is read off the event, here.
    const onContextMenu = vi.fn();
    draw(message({ body: '<img src="a.jpg" alt="ferry"><img src="b.jpg" alt="skyline">' }), {
      onContextMenu,
    });

    fireEvent.contextMenu(screen.getByAltText("skyline"));

    expect(onContextMenu).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ image: { src: "b.jpg", alt: "skyline", link: null } }),
    );
  });

  it("reports no picture for a right-click that missed one", () => {
    const onContextMenu = vi.fn();
    const { container } = draw(message({ body: "just words" }), { onContextMenu });

    fireEvent.contextMenu(container.querySelector("[data-msg-id]") as HTMLElement);

    expect(onContextMenu).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ image: null }),
    );
  });
  it("marks a message from a client without the channel's encryption", () => {
    const { container } = draw(message({ is_legacy: true }));
    expect(container.querySelector("[data-legacy-badge]")?.textContent).toBe("legacy");
    cleanupRows();
    const plain = draw(message());
    expect(plain.container.querySelector("[data-legacy-badge]")).toBeNull();
  });

  it("opens the message menu where a finger is held on the message", () => {
    vi.useFakeTimers();
    try {
      const onContextMenu = vi.fn();
      const { container } = draw(message(), { onContextMenu });
      const row = container.querySelector('[data-msg-id="m1"]')!;
      fireEvent.touchStart(row, { touches: [{ clientX: 30, clientY: 40 }] });
      act(() => vi.advanceTimersByTime(499));
      expect(onContextMenu).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(onContextMenu).toHaveBeenCalledWith(message(), { x: 30, y: 40 }, expect.objectContaining({ editable: true }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not take a scroll that starts on a message for a hold", () => {
    vi.useFakeTimers();
    try {
      const onContextMenu = vi.fn();
      const { container } = draw(message(), { onContextMenu });
      const row = container.querySelector('[data-msg-id="m1"]')!;
      fireEvent.touchStart(row, { touches: [{ clientX: 30, clientY: 40 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 30, clientY: 80 }] });
      act(() => vi.advanceTimersByTime(600));
      expect(onContextMenu).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reaches the full menu from the strip, for a screen with no right-click", () => {
    const onContextMenu = vi.fn();
    draw(message(), { alwaysShowActions: true, onContextMenu });
    fireEvent.click(screen.getByLabelText("More options"));
    expect(onContextMenu).toHaveBeenCalledWith(message(), expect.any(Object), expect.objectContaining({ editable: true }));
  });
});
