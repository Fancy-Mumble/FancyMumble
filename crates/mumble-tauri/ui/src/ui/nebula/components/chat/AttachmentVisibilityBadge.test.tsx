import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileAttachmentInfo } from "@core/features/chat/fileAttachments";
import { withNebulaTheme } from "../../testTheme";
import { AttachmentVisibilityBadge } from "./AttachmentVisibilityBadge";

function info(partial: Partial<FileAttachmentInfo> & Pick<FileAttachmentInfo, "mode">): FileAttachmentInfo {
  return { url: "https://files.example/dusk.png", filename: "dusk.png", ...partial };
}

describe("AttachmentVisibilityBadge", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("stays silent for a channel-only attachment", () => {
    const { container } = render(
      withNebulaTheme(<AttachmentVisibilityBadge info={info({ mode: "session" })} />),
    );
    expect(container.firstChild).toBeNull();
  });

  it("flags a public link and copies it on click", async () => {
    render(withNebulaTheme(<AttachmentVisibilityBadge info={info({ mode: "public" })} />));
    expect(screen.getByText("Public link")).toBeTruthy();

    fireEvent.click(screen.getByText("Public link").closest("button")!);
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://files.example/dusk.png");
  });

  it("flags a password-protected link without offering to copy a password nobody kept", () => {
    render(withNebulaTheme(<AttachmentVisibilityBadge info={info({ mode: "password" })} />));
    expect(screen.getByText("Password protected")).toBeTruthy();
  });

  it("says a link expired rather than letting it be copied dead", () => {
    const pastEpochSeconds = Math.floor(Date.now() / 1000) - 60;
    render(
      withNebulaTheme(
        <AttachmentVisibilityBadge info={info({ mode: "public", expiresAt: pastEpochSeconds })} />,
      ),
    );
    expect(screen.getByText("Link expired")).toBeTruthy();
    // Expired is drawn as a `div`, not a `button` - there's nothing left to copy.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows how long a public link has left", () => {
    const futureEpochSeconds = Math.floor(Date.now() / 1000) + 6 * 86400;
    render(
      withNebulaTheme(
        <AttachmentVisibilityBadge info={info({ mode: "public", expiresAt: futureEpochSeconds })} />,
      ),
    );
    expect(screen.getByText(/left/)).toBeTruthy();
  });
});
