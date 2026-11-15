/**
 * How chat draws media: one line of facts, a clip that is a poster until it is
 * asked for, and a block of pictures that stops at four.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FileAttachmentCard from "../chat/file/FileAttachmentCard";
import MediaPreview, { MediaLightbox } from "../chat/media/MediaPreview";
import { createPortal } from "react-dom";
import type { FileAttachmentInfo } from "@core/features/chat/fileAttachments";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => p,
  invoke: vi.fn(() => Promise.reject(new Error("no backend"))),
}));
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

/** Proportions jsdom will not invent on its own, then the load event. */
function loadPicture(image: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(image, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(image, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(image);
}

describe("a picture drawn bare", () => {
  const picture = info({ filename: "shot.png", url: "https://example.invalid/shot.png" });

  it("keeps its own shape while that is a shape worth keeping", () => {
    const { container } = render(<FileAttachmentCard info={picture} bare />);
    const image = container.querySelector("img")!;
    loadPicture(image, 1200, 800);
    expect(image.className).not.toContain("bareCropped");
    expect(image.style.getPropertyValue("--bare-ratio")).toBe("1.5");
  });

  it("frames a picture far longer than it is wide, whole, on a blurred copy", () => {
    const { container } = render(<FileAttachmentCard info={picture} bare />);
    const image = container.querySelector("img")!;
    // 154x829: the height cap alone would draw this 59 pixels across.
    loadPicture(image, 154, 829);
    const frame = container.querySelector("button")!;
    expect(frame.className).toContain("frame");
    expect(frame.style.getPropertyValue("--frame-ratio")).toBe("0.75");
    // Two pictures now: the blurred backdrop, then the picture itself - whole,
    // never cropped, which is what `contain` is for in `.framedImage`.
    const drawn = container.querySelectorAll("img");
    expect(drawn).toHaveLength(2);
    expect(drawn[0]!.className).toContain("frameBackdrop");
    expect(drawn[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(drawn[1]!.className).toContain("framedImage");
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
  const imgs = (n: number) => Array.from({ length: n }, (_, i) => `<img src="${i}.jpg">`).join("");

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

/** A 1920x1080 PNG, header only - which is all anything here reads of it. */
function pngDataUrl(width: number, height: number): string {
  const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const bytes = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
  ];
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(bin)}`;
}

describe("a picture that has not decoded yet", () => {
  it("holds open the box the picture is going to fill", () => {
    const html = `<img src="${pngDataUrl(1920, 1080)}">`;
    const { container } = render(<MediaPreview html={html} messageId="sized" />);
    const frame = container.querySelector("button")!;
    // The picture's own pixels: the stylesheet turns those into the same box
    // the loaded picture would have taken, before it has taken it.
    expect(frame.style.getPropertyValue("--thumb-w")).toBe("1920");
    expect(frame.style.getPropertyValue("--thumb-h")).toBe("1080");
    expect(frame.className).toContain("thumbWrapSized");
  });

  it("shimmers in that box until the picture arrives, then stops", () => {
    const html = `<img src="${pngDataUrl(800, 600)}">`;
    const { container } = render(<MediaPreview html={html} messageId="shimmer" />);
    expect(container.querySelector("[class*='thumbSkeleton']")).toBeTruthy();
    loadPicture(container.querySelector("img")!, 800, 600);
    expect(container.querySelector("[class*='thumbSkeleton']")).toBeNull();
  });

  it("stops shimmering over a picture that will never arrive", () => {
    const html = `<img src="${pngDataUrl(800, 600)}">`;
    const { container } = render(<MediaPreview html={html} messageId="broken" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("[class*='thumbSkeleton']")).toBeNull();
  });

  it("believes a tag that states its own size", () => {
    const { container } = render(
      <MediaPreview html='<img src="a.jpg" width="400" height="300">' messageId="tagged" />,
    );
    const frame = container.querySelector("button")!;
    expect(frame.style.getPropertyValue("--thumb-w")).toBe("400");
    expect(frame.style.getPropertyValue("--thumb-h")).toBe("300");
  });

  it("reserves nothing for a picture nobody can measure yet", () => {
    const { container } = render(<MediaPreview html='<img src="unknown.jpg">' messageId="unknown" />);
    const frame = container.querySelector("button")!;
    expect(frame.style.getPropertyValue("--thumb-w")).toBe("");
    expect(frame.className).not.toContain("thumbWrapSized");
  });

  it("leaves a tiled block alone - its tiles are square whatever they hold", () => {
    const html = `<img src="${pngDataUrl(1920, 1080)}"><img src="${pngDataUrl(600, 900)}">`;
    const { container } = render(<MediaPreview html={html} messageId="tiles" />);
    for (const frame of container.querySelectorAll("button")) {
      expect(frame.className).not.toContain("thumbWrapSized");
    }
  });
});

describe("a picture tile whose picture is still being fetched", () => {
  const stored = info({ url: "", key: "7/cat.png", filename: "cat.png", sizeBytes: 2048, mode: "session" });

  it("waits at the size of the picture, not as a file row", async () => {
    // A fetch that never lands: the tile stays in the state the block spends
    // the whole download in.
    const core = await import("@tauri-apps/api/core");
    vi.spyOn(core, "invoke").mockReturnValue(new Promise(() => {}));

    const { container } = render(<FileAttachmentCard info={stored} tile />);
    expect(container.querySelector("[class*='tileSkeleton']")).toBeTruthy();
    // None of the row a file gets: that is the thing a photograph replaced a
    // moment later, under the block's own chips.
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
    expect(screen.queryByText("cat.png")).toBeNull();
    expect(screen.getByRole("img", { name: "cat.png" })).toBeTruthy();
  });

  it("goes back to being a row when the fetch fails", async () => {
    const core = await import("@tauri-apps/api/core");
    vi.spyOn(core, "invoke").mockRejectedValue(new Error("gone"));

    const { container } = render(<FileAttachmentCard info={stored} tile />);
    await waitFor(() => expect(container.querySelector("[class*='tileSkeleton']")).toBeNull());
    // A shimmer that never resolves would be a file with no way to save it.
    expect(screen.getByRole("button", { name: /Save/ })).toBeTruthy();
  });
});

describe("the address a picture menu can offer", () => {
  const picture = info({ filename: "shot.png", url: "https://example.invalid/shot.png" });

  /** The link the card wrote onto the picture for a right-click to find. */
  function pictureLink(container: HTMLElement): string | null {
    return container.querySelector("img[data-picture]")?.getAttribute("data-picture-link") ?? null;
  }

  it("hands over a public share's address", () => {
    const { container } = render(<FileAttachmentCard info={picture} bare />);
    expect(pictureLink(container)).toBe("https://example.invalid/shot.png");
  });

  it("hands over a public canon share's address too, though it is not what is drawn", async () => {
    // The one this was reported on. A public canon share carries both a key
    // and a URL: the key only says how *this* client fetches it - off the
    // session, from the loopback origin - so the address in the picture's
    // `src` is no use to anybody else, and the card used to offer nothing to
    // open. The URL is still there, and it is the thing worth handing on.
    const core = await import("@tauri-apps/api/core");
    vi.spyOn(core, "invoke").mockResolvedValue("http://127.0.0.1:41234/tok/7%2Fshot.png");

    const canon = info({ ...picture, key: "7/shot.png", sizeBytes: 2048 });
    const { container } = render(<FileAttachmentCard info={canon} bare />);

    await waitFor(() => expect(container.querySelector("img[data-picture]")).toBeTruthy());
    expect(container.querySelector("img[data-picture]")?.getAttribute("src")).toBe(
      "http://127.0.0.1:41234/tok/7%2Fshot.png",
    );
    expect(pictureLink(container)).toBe("https://example.invalid/shot.png");
  });

  it("offers nothing for a file only this session can follow", () => {
    const { container } = render(<FileAttachmentCard info={info({ ...picture, mode: "session" })} bare />);
    expect(pictureLink(container)).toBeNull();
  });

  it("offers nothing once the link has expired", () => {
    const gone = Math.floor(Date.now() / 1000) - HOUR;
    const { container } = render(<FileAttachmentCard info={info({ ...picture, expiresAt: gone })} bare />);
    expect(pictureLink(container)).toBeNull();
  });
});

describe("the lightbox's own picture menu", () => {
  const item = {
    kind: "image" as const,
    src: "https://example.invalid/shot.png",
    alt: "shot",
    spoiler: false,
  };

  /** The lightbox where it actually lives: portalled out of the message row. */
  function Host({ onContextMenu }: { onContextMenu: () => void }) {
    return (
      <div onContextMenu={onContextMenu}>
        {createPortal(<MediaLightbox item={item} onClose={vi.fn()} link={item.src} />, document.body)}
      </div>
    );
  }

  it("answers the right-click itself instead of letting the message row answer it too", () => {
    // The overlay is portalled to the body, but React propagates through the
    // tree it was written in - so the row underneath used to see the same
    // right-click and open its menu at the row's z-index, behind the blur.
    const onContextMenu = vi.fn();
    render(<Host onContextMenu={onContextMenu} />);

    fireEvent.contextMenu(screen.getByAltText("shot"));

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Open in browser")).toBeTruthy();
    expect(onContextMenu).not.toHaveBeenCalled();
  });
});
