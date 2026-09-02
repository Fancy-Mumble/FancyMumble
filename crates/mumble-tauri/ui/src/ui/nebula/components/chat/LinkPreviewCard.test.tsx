import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "@core/store";
import type { LinkEmbed } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import LinkPreviewCard from "./LinkPreviewCard";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

function embed(partial: Partial<LinkEmbed> = {}): LinkEmbed {
  return {
    url: "https://www.youtube.com/watch?v=eKqZWVcYs7E",
    type: "video",
    title: "Entity — Stargazer",
    site_name: "youtube.com",
    author: { name: "Entity Records" },
    video: { url: "https://www.youtube.com/embed/eKqZWVcYs7E" },
    ...partial,
  } as LinkEmbed;
}

function draw(one: LinkEmbed, allowExternalResources = false) {
  render(
    withNebulaTheme(
      <LinkPreviewCard embeds={[one]} allowExternalResources={allowExternalResources} channelId={1} />,
    ),
  );
}

describe("LinkPreviewCard", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      ownSession: 1,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      watchSessions: new Map(),
      watchSessionsVersion: 0,
    });
  });

  it("names the source, the title and one line of context", () => {
    draw(
      embed({
        thumbnail: { url: "https://img.example/t.jpg", preview: { data_url: DATA_URL, mime: "image/png" } },
      }),
    );

    expect(screen.getByText("youtube.com")).toBeTruthy();
    expect(screen.getByText("Entity — Stargazer")).toBeTruthy();
    // The channel answers "what is this" where there is one, so it takes the
    // line the description would otherwise have.
    expect(screen.getByText("Entity Records")).toBeTruthy();
  });

  it("falls back to the hostname where the server named no site", () => {
    draw(embed({ site_name: undefined, provider: undefined, url: "https://www.example.org/a/b" }));
    expect(screen.getByText("example.org")).toBeTruthy();
  });

  it("draws the picture the server inlined rather than fetching the origin's", () => {
    draw(
      embed({
        thumbnail: { url: "https://img.example/t.jpg", preview: { data_url: DATA_URL, mime: "image/png" } },
      }),
    );

    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe(DATA_URL);
  });

  it("draws no picture at all rather than reaching for the origin uninvited", () => {
    // No inlined preview and no consent: a card that loaded this would tell
    // the origin who is reading the conversation.
    draw(embed({ thumbnail: { url: "https://img.example/t.jpg" } }));
    expect(document.querySelector("img")).toBeNull();
  });

  it("uses the origin's picture once external resources are allowed", () => {
    draw(embed({ thumbnail: { url: "https://img.example/t.jpg" } }), true);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://img.example/t.jpg");
  });

  it("asks before loading a player the reader has not allowed", () => {
    draw(
      embed({
        thumbnail: { url: "https://img.example/t.jpg", preview: { data_url: DATA_URL, mime: "image/png" } },
      }),
    );

    fireEvent.click(screen.getByLabelText("Play video"));
    expect(document.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByText("Load content"));
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://www.youtube.com/embed/eKqZWVcYs7E",
    );
  });

  it("starts a watch-together session on the video it is showing", async () => {
    draw(embed());

    await act(async () => {
      fireEvent.click(screen.getByText("Watch together"));
    });

    const session = Array.from(useAppStore.getState().watchSessions.values())[0];
    expect(session.sourceUrl).toBe("https://www.youtube.com/watch?v=eKqZWVcYs7E");
    expect(session.channelId).toBe(1);
  });

  it("offers nothing to watch on a card that is not a video", () => {
    draw(
      embed({
        type: "article",
        url: "https://example.org/posts/one",
        video: undefined,
        author: undefined,
        description: "Why the numbers look fine and sound wrong.",
      }),
    );

    expect(screen.queryByText("Watch together")).toBeNull();
    // With no channel to name, the description takes the line instead.
    expect(screen.getByText("Why the numbers look fine and sound wrong.")).toBeTruthy();
  });
});
