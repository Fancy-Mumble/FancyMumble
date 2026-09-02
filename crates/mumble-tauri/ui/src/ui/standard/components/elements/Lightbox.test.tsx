import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

describe("Lightbox", () => {
  it("opens on the src the gallery was built from", () => {
    open('<img src="https://example.com/cat.png" alt="cat">', "https://example.com/cat.png");
    expect(screen.getByAltText("cat")).toBeTruthy();
  });

  it("still opens when the caller passes the resolved URL of a relative src", () => {
    // What a click handler reading `img.src` off the live element hands over.
    open('<img src="files/cat.png" alt="cat">', `${document.baseURI}files/cat.png`);
    expect(screen.getByAltText("cat")).toBeTruthy();
  });

  it("still opens when the browser normalised a bare host", () => {
    open('<img src="https://example.com" alt="cat">', "https://example.com/");
    expect(screen.getByAltText("cat")).toBeTruthy();
  });

  it("stays shut for a picture that is in no message", () => {
    open('<img src="https://example.com/cat.png" alt="cat">', "https://example.com/dog.png");
    expect(screen.queryByAltText("cat")).toBeNull();
  });
});
