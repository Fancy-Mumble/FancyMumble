/**
 * Regression test for the bug where a user clicking "Join" on a
 * Live Doc invite card would re-post a duplicate invite card to the
 * channel.  The card must call `requestOpenLiveDoc` with
 * `{ silent: true }` so the store knows NOT to auto-post a fresh
 * invite when the server replies with the doc invite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { useAppStore } from "../../store";
import LiveDocInviteCard from "../chat/livedoc/LiveDocInviteCard";

describe("LiveDocInviteCard", () => {
  const requestOpenLiveDoc = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    requestOpenLiveDoc.mockClear();
    useAppStore.setState({
      activeLiveDocs: new Map(),
      activeServerId: "srv-1",
      requestOpenLiveDoc,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes silent:true when the Join button is clicked", () => {
    render(
      <LiveDocInviteCard
        channelId={7}
        slug="notes"
        title="Team Notes"
        senderName="Alice"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(requestOpenLiveDoc).toHaveBeenCalledTimes(1);
    expect(requestOpenLiveDoc).toHaveBeenCalledWith(7, "notes", "Team Notes", {
      silent: true,
    });
  });

  it("disables the button when the user is already in the same doc", () => {
    useAppStore.setState({
      activeLiveDocs: new Map([
        ["srv-1|7", {
          serverId: 1,
          appServerId: "srv-1",
          channelId: 7,
          slug: "notes",
          title: "Team Notes",
          wsUrl: "",
          token: "",
          ownSession: 1,
          ownName: "me",
          ownColor: "#000",
        }],
      ]),
    });
    render(
      <LiveDocInviteCard
        channelId={7}
        slug="notes"
        title="Team Notes"
        senderName="Alice"
      />,
    );
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(requestOpenLiveDoc).not.toHaveBeenCalled();
  });
});
