/**
 * How chat draws media: one line of facts, a clip that is a poster until it is
 * asked for, and a block of pictures that stops at four.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FileAttachmentCard from "../chat/file/FileAttachmentCard";
import MediaPreview from "../chat/media/MediaPreview";
import type { FileAttachmentInfo } from "@core/features/chat/fileAttachments";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const HOUR = 3600;

function info(overrides: Partial<FileAttachmentInfo> = {}): FileAttachmentInfo {
  return {
    filename: "notes.txt",
    url: "https://example.invalid/notes.txt",
    sizeBytes: 2 * 1024 * 1024,
    mode: "public",
    expiresAt: null,
    ...overrides,
  } as FileAttachmentInfo;
}

/** The facts row, wherever it was drawn, as the text a reader would see. */
function factsText(): string {
  const node = screen.getByText("2 MiB").parentElement!;
  return node.textContent ?? "";
}

describe("attachment facts", () => {
  it("puts size, reach and expiry on one line in that order", () => {
    const now = Math.floor(Date.now() / 1000);
    render(<FileAttachmentCard info={info({ mode: "session", expiresAt: now + 24 * HOUR })} />);
    expect(factsText()).toBe("2 MiB·session·23h left");
  });

  it("drops the reach when a file is simply public", () => {
    render(<FileAttachmentCard info={info()} />);
    expect(factsText()).toBe("2 MiB");
  });

  it("counts down only while a countdown says something, then gives a date", () => {
    const now = Math.floor(Date.now() / 1000);
    // 90 minutes rounds *down*: never promise more time than is left.
    const { unmount } = render(<FileAttachmentCard info={info({ expiresAt: now + 90 * 60 })} />);
    expect(factsText()).toBe("2 MiB·1h left");
    unmount();

    const far = now + 8 * 24 * HOUR;
    render(<FileAttachmentCard info={info({ expiresAt: far })} />);
    const day = new Date(far * 1000).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    expect(factsText()).toBe(`2 MiB·expires ${day}`);
  });
});

describe("a clip in a message", () => {
  const clip = info({ filename: "clip.mp4", url: "https://example.invalid/clip.mp4" });

  it("is a poster with a play control, not a mounted player", () => {
    render(<FileAttachmentCard info={clip} />);
    expect(screen.getByRole("button", { name: "Play clip.mp4" })).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Seek" })).toBeNull();
  });

  it("swaps the poster for the player when it is asked for", () => {
    render(<FileAttachmentCard info={clip} />);
    fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
    expect(screen.getByRole("slider", { name: "Seek" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play clip.mp4" })).toBeNull();
    // The name rides the frame rather than a row beneath it.
    expect(screen.getByTitle("clip.mp4").textContent).toBe("clip.mp4");
  });
});

describe("a block of pictures", () => {
  const imgs = (n: number) =>
    Array.from({ length: n }, (_, i) => `<img src="https://example.invalid/${i}.jpg">`).join("");

  beforeEach(() => {
    // `extractMedia` keys its per-tile state off the message id; keep them apart.
  });

  it("draws every picture while there are four or fewer", () => {
    const { container } = render(<MediaPreview html={imgs(4)} messageId="a" />);
    expect(container.querySelectorAll("img")).toHaveLength(4);
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("stops at four and says how many are behind the last one", () => {
    const { container } = render(<MediaPreview html={imgs(9)} messageId="b" />);
    expect(container.querySelectorAll("img")).toHaveLength(4);
    expect(screen.getByText("+5")).toBeTruthy();
  });

  it("hands over the rest when that tile is clicked", () => {
    const { container } = render(<MediaPreview html={imgs(9)} messageId="c" />);
    fireEvent.click(screen.getByText("+5"));
    expect(container.querySelectorAll("img")).toHaveLength(9);
    expect(screen.queryByText("+5")).toBeNull();
  });
});
