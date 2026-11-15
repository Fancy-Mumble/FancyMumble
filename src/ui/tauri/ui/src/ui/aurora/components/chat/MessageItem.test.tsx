import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@core/types";
import MessageItem from "./MessageItem";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: () => Promise.resolve() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve() }));

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function message(body: string): ChatMessage {
  return {
    sender_session: 7,
    sender_name: "Lorelando",
    body,
    channel_id: 1,
    is_own: false,
    message_id: "m1",
    timestamp: 1_700_000_000_000,
  };
}

/** The body as the row drew it, without the row's own chrome. */
function drawBody(body: string): HTMLElement {
  const { container } = render(<MessageItem message={message(body)} />);
  const article = container.querySelector("article")!;
  const header = article.querySelector("header")!;
  return header.nextElementSibling as HTMLElement;
}

describe("Aurora MessageItem body", () => {
  afterEach(cleanup);

  it("strips what would restyle the app or navigate it away", () => {
    // A stock client's source tab or a bot can send any markup at all: a
    // `<style>` applies to the whole window, and a form or an image map
    // navigates it to the sender's page.
    const body = drawBody(
      "x<style>*{display:none}</style>" +
        '<form action="https://evil.example/p"><input type="password"><button>Login</button></form>' +
        '<map name="m"><area href="https://evil.example/a"></map>' +
        '<iframe srcdoc="<b>x</b>"></iframe><object data="https://evil.example/o"></object>',
    );

    expect(body.querySelector("style, form, input, button, map, area, iframe, object")).toBeNull();
    expect(body.innerHTML).not.toContain("evil.example");
    expect(body.textContent).toContain("x");
  });

  it("keeps a message inside its row however it is styled", () => {
    const body = drawBody('<span style="position:fixed;inset:0;z-index:99999;color:red">OVERLAY</span>');
    const span = body.querySelector("span")!;
    expect(span.style.position).toBe("");
    expect(span.style.zIndex).toBe("");
    expect(span.style.color).toBe("red");
  });

  it("marks links for the guard instead of leaving them live", () => {
    const body = drawBody('<a href="https://example.com/x">site</a> <a href="javascript:alert(1)">bad</a>');
    const [good, bad] = Array.from(body.querySelectorAll("a"));
    expect(good.dataset["external"]).toBe("true");
    expect(good.getAttribute("target")).toBe("_blank");
    expect(bad.hasAttribute("href")).toBe(false);
  });

  it("still draws formatting, inline pictures, spoilers and code", () => {
    const body = drawBody(
      `<b>bold</b> <img src="${PNG}" alt="cat" data-spoiler="1"><pre><code>let x = 1;</code></pre>`,
    );
    expect(body.querySelector("b")?.textContent).toBe("bold");
    expect(body.querySelector("img")?.getAttribute("src")).toBe(PNG);
    expect(body.querySelector("img")?.dataset["spoiler"]).toBe("1");
    expect(body.querySelector("pre code")?.textContent).toBe("let x = 1;");
  });
});
