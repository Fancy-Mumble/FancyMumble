import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Pinned messages" }));
    expect(handlers.onShowPinned).toHaveBeenCalled();
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
});
