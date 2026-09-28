import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
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

  it("keeps the filter's description out of what the row is called", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    // The hint is on screen, but the row is still named by its label alone -
    // a menu item called "Hide empty channels Channels you can't post in stay
    // collapsed" is a sentence, not a name.
    const item = screen.getByRole("menuitemcheckbox", { name: "Hide empty channels" });
    expect(screen.getByText(/stay collapsed/i)).toBeTruthy();
    expect(item.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("shows the filter ticked once it is on", () => {
    renderDock({ hideEmpty: true });
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    const item = screen.getByRole("menuitemcheckbox", { name: "Hide empty channels" });
    expect(item.getAttribute("aria-checked")).toBe("true");
    expect(item.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
  });
});

describe("the menu sheet", () => {
  afterEach(cleanup);

  it("says which server it belongs to", () => {
    renderDock({ serverName: "Riverbend" });
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    expect(screen.getByText("Riverbend")).toBeTruthy();
    expect(screen.getByText("Server & app options")).toBeTruthy();
  });

  it("leaves the head off when there is no server to name", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    expect(screen.queryByText("Server & app options")).toBeNull();
  });

  it("leaves the server from the last row", () => {
    const onLeaveServer = vi.fn();
    renderDock({ onLeaveServer });
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    fireEvent.click(screen.getByRole("menuitem", { name: "Leave server" }));
    expect(onLeaveServer).toHaveBeenCalledTimes(1);
  });

  it("offers no way out when there is nothing to leave", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    expect(screen.queryByRole("menuitem", { name: "Leave server" })).toBeNull();
  });

  it("hides administration from anyone who cannot administer", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    expect(screen.queryByRole("menuitem", { name: "Server admin" })).toBeNull();
    // Settings is everyone's, and stays.
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeTruthy();
  });
  it("offers the recorder only where the shell passes it", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("menuitem", { name: "Record audio" })).toBeNull();
    cleanup();

    const onRecord = vi.fn();
    renderDock({ onRecord });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Record audio" }));
    expect(onRecord).toHaveBeenCalledTimes(1);
  });

  it("marks a running recording on the button and says how long in the menu", () => {
    const { container } = render(
      withNebulaTheme(
        <VoiceDock
          name="ZewiWin"
          session={7}
          textureSize={null}
          channelName="Gaming"
          latencyMs={14}
          hideEmpty={false}
          onOpenSettings={vi.fn()}
          onOpenProfile={vi.fn()}
          onToggleHideEmpty={vi.fn()}
          onRecord={vi.fn()}
          recordingElapsed={83}
        />,
      ),
    );
    expect(container.querySelector("[data-recording-dot]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: "Recording · 01:23" })).toBeTruthy();
  });
  it("names the route on the share button", () => {
    useAppStore.setState({ serverConfig: { ...useAppStore.getState().serverConfig, webrtc_sfu_available: true } });
    renderDock({ onShareScreen: vi.fn() });
    expect(screen.getByLabelText("Share your screen · Relayed by the server")).toBeTruthy();
  });

  it("refuses a second share while another server connection holds the capture", () => {
    const initial = useAppStore.getState();
    // Both servers handed out session 4: only the server id tells them apart.
    useAppStore.setState({ ownSession: 4, activeServerId: "b", broadcastingOwnSession: 4, broadcastingServerId: "a" });
    try {
      const onShareScreen = vi.fn();
      const onShareCamera = vi.fn();
      renderDock({ onShareScreen, onShareCamera });
      const button = screen.getByLabelText(
        "You are already sharing your screen from another server. Stop that share first.",
      );
      expect(button.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(button);
      expect(onShareScreen).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "More" }));
      const camera = screen.getByRole("menuitem", { name: /Share your camera/ });
      expect(camera.getAttribute("aria-disabled")).toBe("true");
    } finally {
      useAppStore.setState({
        ownSession: initial.ownSession,
        activeServerId: initial.activeServerId,
        broadcastingOwnSession: initial.broadcastingOwnSession,
        broadcastingServerId: initial.broadcastingServerId,
      });
    }
  });
});
