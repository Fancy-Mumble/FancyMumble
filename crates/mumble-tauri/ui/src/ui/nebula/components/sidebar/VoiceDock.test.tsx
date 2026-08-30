import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import { VoiceDock } from "./VoiceDock";

// The dock only needs to know whether a share is running, which it reads off
// the store; the capture itself has no place in jsdom.
vi.mock("@standard/components/chat/stream/useScreenShare", () => ({ stopOwnBroadcast: vi.fn() }));

function renderDock(props: Partial<React.ComponentProps<typeof VoiceDock>> = {}) {
  const handlers = {
    onOpenSettings: vi.fn(),
    onOpenProfile: vi.fn(),
    onToggleHideEmpty: vi.fn(),
  };
  render(
    withNebulaTheme(
      <VoiceDock
        name="ZewiWin"
        session={7}
        textureSize={null}
        channelName="Gaming"
        latencyMs={14}
        hideEmpty={false}
        {...handlers}
        {...props}
      />,
    ),
  );
  return handlers;
}

describe("VoiceDock", () => {
  afterEach(cleanup);

  it("offers the list filter from the overflow menu", () => {
    const handlers = renderDock();
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    const item = screen.getByRole("menuitemcheckbox", { name: "Hide empty channels" });
    expect(item.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(item);
    expect(handlers.onToggleHideEmpty).toHaveBeenCalledTimes(1);
  });

  it("shows the filter ticked once it is on", () => {
    renderDock({ hideEmpty: true });
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    const item = screen.getByRole("menuitemcheckbox", { name: "Hide empty channels" });
    expect(item.getAttribute("aria-checked")).toBe("true");
    expect(item.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
  });
});
