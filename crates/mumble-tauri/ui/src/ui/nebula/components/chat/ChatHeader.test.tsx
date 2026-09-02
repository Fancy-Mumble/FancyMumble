import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import { ChatHeader } from "./ChatHeader";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null }));

type HeaderProps = Parameters<typeof ChatHeader>[0];

function show(overrides: Partial<HeaderProps> = {}) {
  const handlers = {
    onJoinVoice: vi.fn(),
    onToggleSearch: vi.fn(),
    onShowMembers: vi.fn(),
    onShareScreen: vi.fn(),
    onShowPinned: vi.fn(),
    onShowInfo: vi.fn(),
    onShowDownloads: vi.fn(),
    onShowChannelInfo: vi.fn(),
    onVerifyKey: vi.fn(),
  };
  render(
    withNebulaTheme(
      <ChatHeader
        title="Gaming"
        subtitle="3 in voice · 5 members"
        memberCount={5}
        canJoinVoice={false}
        {...handlers}
        {...overrides}
      />,
    ),
  );
  return handlers;
}

describe("ChatHeader", () => {
  afterEach(cleanup);

  it("names the channel and says who is in it", () => {
    show();
    expect(screen.getByText("Gaming")).toBeTruthy();
    expect(screen.getByText("3 in voice · 5 members")).toBeTruthy();
    expect(screen.getByLabelText("Members (5)")).toBeTruthy();
  });

  it("opens the roster from the member count", () => {
    const handlers = show();
    fireEvent.click(screen.getByLabelText("Members (5)"));
    expect(handlers.onShowMembers).toHaveBeenCalled();
  });

  it("says a persisted channel keeps its history", () => {
    show({ persisted: true, encrypted: true, trustLevel: "Verified" });
    expect(screen.getByText("History saved")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
  });

  it("claims neither for an ordinary channel", () => {
    show();
    expect(screen.queryByText("History saved")).toBeNull();
    expect(screen.queryByText("Verified")).toBeNull();
    expect(screen.queryByText("Encrypted")).toBeNull();
  });

  it("says only that the channel is encrypted until there is a key to judge", () => {
    show({ persisted: true, encrypted: true });
    expect(screen.getByText("Encrypted")).toBeTruthy();
    expect(screen.queryByText("Unverified")).toBeNull();
  });

  it("gives each trust level its own word", () => {
    show({ encrypted: true, trustLevel: "ManuallyVerified" });
    expect(screen.getByText("Manually verified")).toBeTruthy();
    cleanup();
    show({ encrypted: true, trustLevel: "Unverified" });
    expect(screen.getByText("Unverified")).toBeTruthy();
    cleanup();
    show({ encrypted: true, trustLevel: "Disputed" });
    expect(screen.getByText("Disputed")).toBeTruthy();
  });

  it("reaches verification through the trust badge", () => {
    const handlers = show({ encrypted: true, trustLevel: "Unverified" });
    fireEvent.click(screen.getByText("Unverified"));
    expect(handlers.onVerifyKey).toHaveBeenCalled();
  });

  it("opens the channel menu from the name as well as the kebab", () => {
    const handlers = show();
    fireEvent.click(screen.getByRole("button", { name: /Gaming/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Channel info" }));
    expect(handlers.onShowChannelInfo).toHaveBeenCalled();
  });

  it("opens the pins from the header rather than from inside the menu", () => {
    const handlers = show();
    fireEvent.click(screen.getByLabelText("Pinned messages"));
    expect(handlers.onShowPinned).toHaveBeenCalled();

    // Not in the menu as well: two ways in is two badges to keep in step.
    fireEvent.click(screen.getByLabelText("Channel menu"));
    expect(screen.queryByRole("menuitem", { name: /Pinned messages/ })).toBeNull();
  });

  it("offers Documents only where the server has the live-doc plugin", () => {
    // Absent by default: the entry is gated on the plugin being loaded, and a
    // server without it has no library to open.
    const handlers = show();
    fireEvent.click(screen.getByLabelText("Channel menu"));
    expect(screen.queryByRole("menuitem", { name: "Documents" })).toBeNull();
    cleanup();

    const withDocs = { ...handlers, onShowDocs: vi.fn() };
    show(withDocs);
    fireEvent.click(screen.getByLabelText("Channel menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Documents" }));
    expect(withDocs.onShowDocs).toHaveBeenCalled();
  });

  it("offers no channel menu or roster on a direct message", () => {
    show({
      title: "Lorelando",
      subtitle: "Direct message",
      memberCount: undefined,
      partner: { name: "Lorelando", session: 7, textureSize: null },
    });
    expect(screen.queryByRole("button", { name: /Lorelando/ })).toBeNull();
    expect(screen.queryByLabelText(/^Members \(/)).toBeNull();
  });
  it("describes the channel from the menu, and offers nothing to describe on a direct message", () => {
    const handlers = show();
    fireEvent.click(screen.getByLabelText("Channel menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Channel info" }));
    expect(handlers.onShowChannelInfo).toHaveBeenCalled();
    cleanup();

    // A direct message is not a room, so the entry is dropped rather than
    // opening a panel about whichever channel happens to be selected.
    show({
      title: "Lorelando",
      memberCount: undefined,
      onShowChannelInfo: undefined,
      partner: { name: "Lorelando", session: 7, textureSize: null },
    });
    fireEvent.click(screen.getByLabelText("Channel menu"));
    expect(screen.queryByRole("menuitem", { name: "Channel info" })).toBeNull();
  });

  it("says nothing is new until something is", () => {
    show();
    expect(screen.getByLabelText("Channel menu")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Channel menu"));
    expect(screen.queryByLabelText("New")).toBeNull();
  });

  it("marks the pin button itself when a pin has arrived", () => {
    show({ hasNewPins: true });
    const pins = screen.getByLabelText("Pinned messages (new)");
    expect(within(pins).getByLabelText("New")).toBeTruthy();
    // The kebab stays clean: its own panels have nothing new in them, and a
    // dot there would send the reader into a menu the pins are not in.
    expect(screen.getByLabelText("Channel menu")).toBeTruthy();
  });

  it("marks downloads on the kebab, so the two badges say which panel they mean", () => {
    show({ hasNewDownloads: true });
    const kebab = screen.getByLabelText("Channel menu (new items)");
    expect(within(kebab).getByLabelText("New")).toBeTruthy();
    expect(within(screen.getByLabelText("Pinned messages")).queryByLabelText("New")).toBeNull();

    fireEvent.click(kebab);
    expect(within(screen.getByRole("menuitem", { name: /Downloads/ })).getByLabelText("New")).toBeTruthy();
  });

  it("lights the pin while its panel is hanging from it", () => {
    show({ pinnedOpen: true });
    expect(screen.getByLabelText("Pinned messages").getAttribute("aria-expanded")).toBe("true");
  });
});
