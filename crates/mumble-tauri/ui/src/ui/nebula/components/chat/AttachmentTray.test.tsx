import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StagedAttachment } from "@core/features/chat/useFileUpload";
import { withNebulaTheme } from "../../testTheme";
import { AttachmentTray, DEFAULT_SHARE_OPTIONS } from "./AttachmentTray";

function staged(partial: Omit<StagedAttachment, "filePath"> & { filePath?: string }): StagedAttachment {
  return { filePath: `/tmp/${partial.filename}`, ...partial };
}

/** A batch with one compressible photo and one file the toggle cannot touch. */
const MIXED_BATCH: StagedAttachment[] = [
  staged({
    id: "a1",
    filename: "dusk.png",
    previewUrl: "asset://dusk",
    sizeBytes: 1_024_000,
    compressed: { filePath: "/tmp/dusk-small.jpg", sizeBytes: 102_400 },
  }),
  staged({ id: "a2", filename: "clip.mp4", sizeBytes: 5_400_000 }),
];

function draw(props: Partial<React.ComponentProps<typeof AttachmentTray>> = {}) {
  const onOptionsChange = vi.fn();
  render(
    withNebulaTheme(
      <AttachmentTray
        attachments={MIXED_BATCH}
        target="#Gaming"
        canSharePublic
        canExpire
        options={DEFAULT_SHARE_OPTIONS}
        onOptionsChange={onOptionsChange}
        onRemove={vi.fn()}
        onAddMore={vi.fn()}
        {...props}
      />,
    ),
  );
  return { onOptionsChange };
}

describe("AttachmentTray", () => {
  it("lays both the toggle and its chip rows out as rows, not stacked text", () => {
    // `all: unset` in a button's sx resets the flex the row asked for unless
    // every flex property is restated - this is what broke both of them.
    draw();
    const toggle = screen.getByLabelText("Sending options");
    expect(getComputedStyle(toggle).display).toBe("flex");
    expect(getComputedStyle(toggle).flexDirection).toBe("row");

    fireEvent.click(toggle);
    const chip = screen.getByText("Compressed").closest("button") as HTMLElement;
    expect(getComputedStyle(chip).display).toBe("flex");
    expect(getComputedStyle(chip).flexDirection).toBe("row");
  });

  it("scopes the compressed/full totals to the photos, not the whole batch", () => {
    // The video's 5.4 MB used to be folded into both totals, so a real,
    // tenfold difference between the photo's two sizes disappeared next to
    // it and both read the same.
    draw();
    // The video's own tile still says its own size in MiB - only the
    // Compressed/Full quality chips must stay clear of its bytes.
    expect(screen.getByText("5.1 MiB")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Sending options"));
    expect(screen.getByText("100 KiB")).toBeTruthy();
    expect(screen.getByText("1000 KiB")).toBeTruthy();
  });

  it("offers visibility alongside quality once a server can share a link", () => {
    draw();
    fireEvent.click(screen.getByLabelText("Sending options"));
    expect(screen.getByText("This channel")).toBeTruthy();
    expect(screen.getByText("Anyone with link")).toBeTruthy();
    expect(screen.getByText("Password")).toBeTruthy();

    cleanup();
    const onOptionsChange = vi.fn();
    draw({ onOptionsChange });
    fireEvent.click(screen.getByLabelText("Sending options"));
    fireEvent.click(screen.getAllByText("Anyone with link")[0]);
    expect(onOptionsChange).toHaveBeenCalledWith({ ...DEFAULT_SHARE_OPTIONS, mode: "public" });
  });

  it("still draws Visible to on a server with no way to share a link, locked to the one real choice", () => {
    // The row used to vanish outright, which reads as a bug the first time
    // someone goes looking for an option that was simply never offered.
    draw({ canSharePublic: false });
    fireEvent.click(screen.getByLabelText("Sending options"));
    expect(screen.getByText("This channel")).toBeTruthy();
    expect(screen.getByText("Only option on this server")).toBeTruthy();
    expect(screen.queryByText("Anyone with link")).toBeNull();
    expect(screen.queryByText("Password")).toBeNull();
  });

  it("offers an expiry alongside visibility once a server honours one", () => {
    draw();
    fireEvent.click(screen.getByLabelText("Sending options"));
    expect(screen.getByText("Never")).toBeTruthy();
    expect(screen.getByText("24 hours")).toBeTruthy();
    // The default batch already carries the tray's own default (7 days).
    expect(screen.getByText(/^Expires /)).toBeTruthy();

    cleanup();
    const onOptionsChange = vi.fn();
    draw({ onOptionsChange });
    fireEvent.click(screen.getByLabelText("Sending options"));
    fireEvent.click(screen.getByText("Never"));
    expect(onOptionsChange).toHaveBeenCalledWith({ ...DEFAULT_SHARE_OPTIONS, ttlSeconds: 0 });
  });

  it("locks Expires to Never on a server that never deletes on a timer", () => {
    draw({ canExpire: false });
    fireEvent.click(screen.getByLabelText("Sending options"));
    expect(screen.getByText("Never")).toBeTruthy();
    expect(screen.getByText("Not supported here")).toBeTruthy();
    expect(screen.queryByText("24 hours")).toBeNull();
  });
});
