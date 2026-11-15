/**
 * The stage's menu.
 *
 * What is worth pinning is who is offered what: the broadcaster's rows act on
 * a capture only their machine has, so a viewer must never see them, and the
 * rows that report a state have to report the state they were handed. The
 * shape of the menu itself is MUI's and is not restated here.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../../testTheme";
import { StageMenu, type StageMenuBroadcast, type StageMenuProps } from "./StageMenu";
import type { StreamFeed } from "./feeds";

const FEED: StreamFeed = {
  key: "42:display",
  session: 42,
  slot: "display",
  kind: "screen",
  name: "Ada",
  own: false,
  stream: null,
  canvasRef: { current: null },
  live: true,
  failed: false,
};

const BROADCAST: StageMenuBroadcast = {
  quality: "BALANCED",
  onOpenQuality: vi.fn(),
  onChangeSource: vi.fn(),
  screenshotsAllowed: false,
  onToggleScreenshots: vi.fn(),
  overlayOn: false,
  onToggleOverlay: vi.fn(),
  onStop: vi.fn(),
};

const onClose = vi.fn();

function mount(props: Partial<StageMenuProps> = {}) {
  return render(
    withNebulaTheme(
      <StageMenu
        anchor={{ x: 120, y: 80 }}
        onClose={onClose}
        feed={FEED}
        fit="fit"
        onFit={vi.fn()}
        onCopyFrame={vi.fn()}
        annotating={false}
        onToggleAnnotating={vi.fn()}
        expanded={false}
        onToggleExpanded={vi.fn()}
        statsOpen={false}
        onToggleStats={vi.fn()}
        onPopOut={null}
        broadcast={null}
        {...props}
      />,
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StageMenu", () => {
  it("names the feed it acts on", () => {
    mount();
    expect(screen.getByText("Ada · screen")).toBeTruthy();
  });

  it("offers a viewer nothing that belongs to the broadcaster", () => {
    mount();
    expect(screen.queryByText("Stop sharing")).toBeNull();
    expect(screen.queryByText("Change source")).toBeNull();
    expect(screen.queryByText("Stream Quality")).toBeNull();
  });

  it("offers the broadcaster the rows their own capture answers to", () => {
    mount({ broadcast: BROADCAST });
    expect(screen.getByText("Change source")).toBeTruthy();
    expect(screen.getByText("BALANCED")).toBeTruthy();
    fireEvent.click(screen.getByText("Stop sharing"));
    expect(BROADCAST.onStop).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the desktop overlay's row, disabled, where it cannot be placed", () => {
    mount({ broadcast: { ...BROADCAST, overlayUnavailable: "Not on this session" } });
    const row = screen.getByText("Show desktop overlay").closest("li");
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row!);
    expect(BROADCAST.onToggleOverlay).not.toHaveBeenCalled();
  });

  it("marks the scale the picture is at, and reports a change", () => {
    const onFit = vi.fn();
    mount({ fit: "fill", onFit });
    expect(screen.getByRole("menuitemradio", { name: "Fill" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Fit" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "1:1" }));
    expect(onFit).toHaveBeenCalledWith("actual");
  });

  it("says what the toggles currently stand at", () => {
    mount({ statsOpen: true, annotating: true, expanded: true });
    expect(
      screen.getByRole("menuitemcheckbox", { name: /Stats for Nerds/ }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("Stop drawing")).toBeTruthy();
    expect(screen.getByText("Exit fullscreen")).toBeTruthy();
  });

  it("leaves out a popout this feed cannot be given", () => {
    mount();
    expect(screen.queryByText("Pop out to window")).toBeNull();
  });

  it("leaves out drawing until the channel it would be addressed to is known", () => {
    mount({ onPopOut: vi.fn(), onToggleAnnotating: null });
    expect(screen.getByText("Pop out to window")).toBeTruthy();
    expect(screen.queryByText("Draw on screen")).toBeNull();
  });
});
