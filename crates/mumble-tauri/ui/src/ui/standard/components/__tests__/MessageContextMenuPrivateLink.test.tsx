/**
 * The "open in a private window" row on Standard's message menu.
 *
 * Two things are worth pinning down and neither is about the browser: that the
 * row acts on the link the pointer was over rather than on the message, and
 * that it is absent wherever the desktop cannot honour it. The second is the
 * one that rots quietly - a row that always draws and sometimes errors looks
 * fine in every test that only ever asks whether it is there.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import MessageContextMenu, { type MessageContextMenuState } from "../chat/message/MessageContextMenu";
import { resetPrivateBrowsingCache } from "@core/features/elements/privateBrowsing";
import type { ChatMessage } from "@core/types";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

const message: ChatMessage = {
  sender_session: 1,
  sender_name: "Alice",
  body: 'see <a data-external href="https://example.com/a">this</a>',
  channel_id: 0,
  is_own: false,
  message_id: "m1",
  timestamp: Date.now(),
};

function renderMenu(link: string | null) {
  const menu: MessageContextMenuState = { x: 10, y: 20, message, link };
  render(
    <MessageContextMenu
      menu={menu}
      canDelete={false}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onSelectMode={vi.fn()}
    />,
  );
}

/** Let the backend's answer land before the menu is read. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("MessageContextMenu private windows", () => {
  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    // Cached for the session, so one test's answer would otherwise be the next
    // test's starting condition.
    resetPrivateBrowsingCache();
  });

  /** Answer the one question the row is gated on. */
  function withPrivateSupport(available: boolean) {
    invokeMock.mockImplementation((cmd) =>
      Promise.resolve(cmd === "can_open_url_private" ? available : undefined),
    );
  }

  it("opens the link the pointer was over, not the message", async () => {
    withPrivateSupport(true);
    renderMenu("https://example.com/a");
    await settle();
    fireEvent.click(screen.getByText("Open link in private window"));
    expect(invokeMock).toHaveBeenCalledWith("open_url_private", { url: "https://example.com/a" });
  });

  it("says nothing where the default browser has no private mode", async () => {
    withPrivateSupport(false);
    renderMenu("https://example.com/a");
    await settle();
    expect(screen.queryByText("Open link in private window")).toBeNull();
  });

  it("says nothing when the right-click was not on a link", async () => {
    withPrivateSupport(true);
    renderMenu(null);
    await settle();
    expect(screen.queryByText("Open link in private window")).toBeNull();
  });

  it("never falls back to an ordinary window when the browser refuses", async () => {
    // The whole promise of the row. A private request served by a normal
    // window is worse than one that fails and says so.
    invokeMock.mockImplementation((cmd) => {
      if (cmd === "can_open_url_private") return Promise.resolve(true);
      return Promise.reject(new Error("no private mode"));
    });
    renderMenu("https://example.com/a");
    await settle();
    fireEvent.click(screen.getByText("Open link in private window"));
    await settle();
    const opened = invokeMock.mock.calls.map(([cmd]) => cmd);
    expect(opened).toContain("open_url_private");
    expect(opened).not.toContain("plugin:opener|open_url");
  });
});
