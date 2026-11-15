import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MediaPlayer, { fractionAt, formatTime } from "./MediaPlayer";

describe("reading a time back", () => {
  it("counts in minutes until there is an hour to show", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(75)).toBe("1:15");
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3725)).toBe("1:02:05");
  });

  it("says 0:00 rather than NaN for a duration nobody knows yet", () => {
    // What an element reports before its metadata arrives, which is most of
    // the time a player is on screen but not yet playing.
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
  });
});

describe("where a click on the rail lands", () => {
  const rail = { left: 100, width: 200 } as DOMRect;

  it("maps a position along the rail to a fraction of it", () => {
    expect(fractionAt(100, rail)).toBe(0);
    expect(fractionAt(200, rail)).toBe(0.5);
    expect(fractionAt(300, rail)).toBe(1);
  });

  it("clamps a drag that left the rail", () => {
    // The pointer is captured, so a drag continues well past both ends.
    expect(fractionAt(-40, rail)).toBe(0);
    expect(fractionAt(9999, rail)).toBe(1);
  });

  it("survives a rail with no width, which is one not laid out yet", () => {
    expect(fractionAt(50, { left: 0, width: 0 } as DOMRect)).toBe(0);
  });
});

describe("the player", () => {
  it("draws no native controls, because those are the ones that differ per system", () => {
    const { container } = render(<MediaPlayer src="http://x/clip.mp4" kind="video" label="clip.mp4" />);
    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.hasAttribute("controls")).toBe(false);
  });

  it("offers a way out when the media fails instead of writing Error over the timeline", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <MediaPlayer src="http://x/clip.mp4" kind="video" label="clip.mp4" onRetry={onRetry} />,
    );

    fireEvent.error(container.querySelector("video")!);

    expect(screen.getByText(/stopped loading/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("clears the failure when it is handed a fresh source", () => {
    // Retry mints a new URL upstream; the player must not stay broken.
    const { container, rerender } = render(
      <MediaPlayer src="http://x/one.mp4" kind="video" label="clip.mp4" />,
    );
    fireEvent.error(container.querySelector("video")!);
    expect(screen.queryByText(/stopped loading/i)).toBeTruthy();

    rerender(<MediaPlayer src="http://x/two.mp4" kind="video" label="clip.mp4" />);

    expect(screen.queryByText(/stopped loading/i)).toBeNull();
  });

  it("seeks with the arrow keys, so the timeline is usable without a pointer", () => {
    const { container } = render(<MediaPlayer src="http://x/clip.mp4" kind="video" label="clip.mp4" />);
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { value: 120, configurable: true });
    fireEvent.durationChange(video);

    const slider = screen.getByRole("slider", { name: "Seek" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(video.currentTime).toBe(5);
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(video.currentTime).toBe(35);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(video.currentTime).toBe(0);
    fireEvent.keyDown(slider, { key: "End" });
    expect(video.currentTime).toBe(120);
  });

  it("does not seek past either end of the file", () => {
    const { container } = render(<MediaPlayer src="http://x/clip.mp4" kind="video" label="clip.mp4" />);
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { value: 10, configurable: true });
    fireEvent.durationChange(video);

    const slider = screen.getByRole("slider", { name: "Seek" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(video.currentTime).toBe(0);
    fireEvent.keyDown(slider, { key: "End" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(video.currentTime).toBe(10);
  });

  it("tells a screen reader where the playhead is", () => {
    const { container } = render(<MediaPlayer src="http://x/clip.mp4" kind="video" label="clip.mp4" />);
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { value: 65, configurable: true });
    fireEvent.durationChange(video);

    expect(screen.getByRole("slider", { name: "Seek" }).getAttribute("aria-valuetext")).toBe(
      "0:00 of 1:05",
    );
  });

  it("gives sound its controls without a picture to hang them on", () => {
    const { container } = render(<MediaPlayer src="http://x/talk.opus" kind="audio" label="talk.opus" />);
    expect(container.querySelector("audio")).toBeTruthy();
    expect(container.querySelector("video")).toBeNull();
    // No full-screen button for something with nothing to show.
    expect(screen.queryByRole("button", { name: /full screen/i })).toBeNull();
  });
});
