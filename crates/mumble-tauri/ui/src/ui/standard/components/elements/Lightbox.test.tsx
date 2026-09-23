import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@core/types";
import { Lightbox, type LightboxHandle } from "./Lightbox";

function message(body: string): ChatMessage {
  return {
    channel_id: 1,
    sender_name: "Lorelando",
    sender_session: 7,
    body,
    timestamp: 1_700_000_000_000,
    is_own: false,
    message_id: "m1",
  } as ChatMessage;
}

function open(body: string, src: string) {
  const ref = createRef<LightboxHandle>();
  render(
    <Lightbox
      ref={ref}
      allMessages={[message(body)]}
      selectedChannel={1}
      selectedDmUser={null}
      currentScope={() => null}
    />,
  );
  act(() => ref.current?.open(src));
}

/** A lightbox whose conversation holds nothing, ready to be handed a gallery. */
function empty() {
  const ref = createRef<LightboxHandle>();
  render(
    <Lightbox
      ref={ref}
      allMessages={[]}
      selectedChannel={1}
      selectedDmUser={null}
      currentScope={() => null}
    />,
  );
  return ref;
}

describe("Lightbox", () => {
  it("opens on the src the gallery was built from", () => {
    open('<img src="cat.png" alt="cat">', "cat.png");
    expect(screen.getByAltText("cat")).toBeTruthy();
  });

  it("still opens when the caller passes the resolved URL of a relative src", () => {
    // What a click handler reading `img.src` off the live element hands over.
    open('<img src="files/cat.png" alt="cat">', `${document.baseURI}files/cat.png`);
    expect(screen.getByAltText("cat")).toBeTruthy();
  });

  it("never gathers a remote picture from a message", () => {
    // Drawing it would fetch it, telling its host who looked and when - the
    // message carries it as a link instead (see remoteMedia.ts).
    open('<img src="https://example.com/cat.png" alt="cat">', "https://example.com/cat.png");
    expect(screen.queryByAltText("cat")).toBeNull();
  });

  it("stays shut for a picture that is in no message", () => {
    open('<img src="cat.png" alt="cat">', "dog.png");
    expect(screen.queryByAltText("cat")).toBeNull();
  });

  it("answers a right-click on the picture with the picture's own menu", () => {
    // What used to happen: nothing here handled it, so the menu that came up
    // belonged to the message underneath - drawn at the message's z-index,
    // which put it behind this overlay's blur. A caller's gallery, because
    // only a remote picture has link rows and no message carries one.
    const ref = empty();
    act(() => ref.current?.openGallery([{ src: "https://example.com/cat.png", alt: "cat" }], 0));

    fireEvent.contextMenu(screen.getByAltText("cat"));

    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();
    expect(screen.getByText("Copy image")).toBeTruthy();
    // A remote picture has an address, so both link rows are there.
    expect(screen.getByText("Copy image link")).toBeTruthy();
    expect(screen.getByText("Open in browser")).toBeTruthy();
    // Drawn inside the overlay: only a child of it comes out on top of the
    // blur it lays over everything else.
    expect(menu.closest('[role="dialog"]')).toBeTruthy();
  });

  it("keeps the platform's own menu away from the space around the picture", () => {
    open('<img src="cat.png" alt="cat">', "cat.png");
    const overlay = screen.getByRole("dialog");

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    overlay.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves the menu behind when the reader moves to the next picture", () => {
    open('<img src="cat.png" alt="cat"><img src="dog.png" alt="dog">', "cat.png");
    fireEvent.contextMenu(screen.getByAltText("cat"));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Next image"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on a gallery the caller brought, for pictures no message carries yet", () => {
    // The composer's staged files: they are not in any message, so the
    // conversation's own gallery cannot find them.
    const ref = empty();
    act(() =>
      ref.current?.openGallery(
        [
          { src: "asset://dusk", alt: "dusk.png", caption: "dusk.png" },
          { src: "asset://dawn", alt: "dawn.png", caption: "dawn.png" },
        ],
        1,
      ),
    );

    expect(screen.getByAltText("dawn.png")).toBeTruthy();
    expect(screen.getByText("Photo 2 / 2")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous image"));
    expect(screen.getByAltText("dusk.png")).toBeTruthy();
  });

  it("gives the conversation its gallery back when the caller's is closed", () => {
    const ref = empty();
    act(() => ref.current?.openGallery([{ src: "asset://dusk", alt: "dusk.png" }], 0));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByAltText("dusk.png")).toBeNull();
  });

  it("ignores an index that names nothing", () => {
    const ref = empty();
    act(() => ref.current?.openGallery([{ src: "asset://dusk", alt: "dusk.png" }], 3));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the menu up long enough to say the link was copied", async () => {
    // A click on a row also reaches the overlay, which dismisses the menu on
    // the next click anywhere - so without the row keeping its own click the
    // menu vanished in the same tick it was pressed.
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const ref = empty();
    act(() => ref.current?.openGallery([{ src: "https://example.com/cat.png", alt: "cat" }], 0));
    fireEvent.contextMenu(screen.getByAltText("cat"));

    fireEvent.click(screen.getByText("Copy image link"));

    expect(writeText).toHaveBeenCalledWith("https://example.com/cat.png");
    expect(screen.getByRole("menu")).toBeTruthy();
    await screen.findByText("Copied");
  });
});
