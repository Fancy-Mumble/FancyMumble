import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPendingPreviewRequests, useAppStore } from "@core/store";
import type { LinkEmbed } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { Composer } from "./Composer";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

const URL_ = "https://www.youtube.com/watch?v=f-0exTFd404";

function draw() {
  const { container } = render(withNebulaTheme(<Composer target="#Gaming" onSend={vi.fn()} />));
  return { container, field: screen.getByLabelText("Message #Gaming") as HTMLTextAreaElement };
}

function type(field: HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
}

/** Let the draft sit long enough for its link to count as finished. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

function previewRequests() {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === "request_link_preview");
}

describe("Composer link preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockClear();
    clearPendingPreviewRequests();
    useAppStore.setState({
      ownSession: 1,
      selectedChannel: 1,
      users: [],
      pluginManifests: new Map(),
      linkEmbeds: new Map(),
      disableLinkPreviews: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("asks for a pasted link's card once it has settled, not on every keystroke", () => {
    const { field } = draw();
    type(field, "https://www.you");
    type(field, URL_);
    expect(previewRequests()).toHaveLength(0);

    settle();
    // Keyed by the URL, like a sent message's cards, so sending reuses it.
    expect(previewRequests()).toEqual([
      ["request_link_preview", { urls: [URL_], requestId: `draft:${URL_}` }],
    ]);
    expect(screen.getByText("youtube.com")).toBeTruthy();
    expect(screen.getByText("Fetching a preview…")).toBeTruthy();
  });

  it("draws the card's title once it has arrived", () => {
    const embed: LinkEmbed = { url: URL_, type: "video", title: "Landing at Warsaw", site_name: "YouTube" };
    useAppStore.setState({ linkEmbeds: new Map([[URL_, embed]]) });
    const { container, field } = draw();
    type(field, `look ${URL_}`);
    settle();
    expect(screen.getByText("Landing at Warsaw")).toBeTruthy();
    expect(container.querySelector("[data-nebula-draft-link]")).not.toBeNull();
    // Already held, so nothing went out.
    expect(previewRequests()).toHaveLength(0);
  });

  it("goes away when closed, and stays away for that draft", () => {
    const { container, field } = draw();
    type(field, URL_);
    settle();
    fireEvent.click(screen.getByLabelText("Hide link preview"));
    expect(container.querySelector("[data-nebula-draft-link]")).toBeNull();

    type(field, `${URL_} nice`);
    settle();
    expect(container.querySelector("[data-nebula-draft-link]")).toBeNull();
  });

  it("gives up on a link that never gets a card", () => {
    const { container, field } = draw();
    type(field, URL_);
    settle();
    expect(container.querySelector("[data-nebula-draft-link]")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.querySelector("[data-nebula-draft-link]")).toBeNull();
  });

  it("does nothing while link previews are switched off", () => {
    useAppStore.setState({ disableLinkPreviews: true });
    const { container, field } = draw();
    type(field, URL_);
    settle();
    expect(previewRequests()).toHaveLength(0);
    expect(container.querySelector("[data-nebula-draft-link]")).toBeNull();
  });
});
