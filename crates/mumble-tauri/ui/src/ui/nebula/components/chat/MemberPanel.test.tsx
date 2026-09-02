import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserEntry } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import type { RosterGroup, RosterMember } from "../../selectors";
import { MemberPanel } from "./MemberPanel";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null }));

const USER: UserEntry = {
  session: 7,
  name: "ZewiWin",
  channel_id: 1,
  texture_size: null,
  mute: false,
  deaf: false,
  suppress: false,
  self_mute: false,
  self_deaf: false,
  priority_speaker: false,
};

/** A registered user who is not connected, as `synthesiseOfflineEntry` makes them. */
const ABSENT: UserEntry = { ...USER, session: -12, name: "Lyroit", user_id: 11 };

const here = (user: UserEntry): RosterMember => ({ user, channel: "Gaming", offline: false });
const away = (user: UserEntry, channel: string | null = "Lounge"): RosterMember => ({
  user,
  channel,
  offline: channel === null,
});

const CHANNEL_GROUP: RosterGroup = {
  key: "channel",
  kind: "channel",
  label: "",
  color: null,
  members: [here(USER)],
};

interface Options {
  onInfo?: (session: number) => void;
  groups?: readonly RosterGroup[];
  showOffline?: boolean;
}

function renderPanel({ onInfo, groups, showOffline = true }: Options = {}) {
  const onSelect = vi.fn();
  const onShowOfflineChange = vi.fn();
  render(
    withNebulaTheme(
      <MemberPanel
        groups={groups ?? [CHANNEL_GROUP]}
        query=""
        onQueryChange={() => undefined}
        talkingSessions={new Set()}
        ownSession={1}
        showOffline={showOffline}
        onShowOfflineChange={onShowOfflineChange}
        onSelect={onSelect}
        onHover={() => undefined}
        onLeave={() => undefined}
        onInfo={onInfo}
        onClose={() => undefined}
      />,
    ),
  );
  return { onSelect, onShowOfflineChange };
}

describe("MemberPanel", () => {
  it("opens the information sheet from the (i), not the card", () => {
    const onInfo = vi.fn();
    const { onSelect } = renderPanel({ onInfo });
    fireEvent.click(screen.getByLabelText("Information about ZewiWin"));
    expect(onInfo).toHaveBeenCalledWith(7);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("draws no (i) for a host that has no sheet to open", () => {
    renderPanel();
    expect(screen.queryByLabelText("Information about ZewiWin")).toBeNull();
  });

  it("heads the open channel and every role with its own count", () => {
    renderPanel({
      groups: [
        CHANNEL_GROUP,
        { key: "admin", kind: "role", label: "admin", color: "#41b4f9", members: [away(USER)] },
        { key: "__members__", kind: "members", label: "", color: null, members: [away(ABSENT, null)] },
      ],
    });
    expect(screen.getByText("This channel — 1")).toBeTruthy();
    expect(screen.getByText("admin — 1")).toBeTruthy();
    expect(screen.getByText("Members — 1")).toBeTruthy();
  });

  it("says where a member outside the open channel is, and nothing about voice", () => {
    renderPanel({
      onInfo: vi.fn(),
      groups: [
        { key: "admin", kind: "role", label: "admin", color: null, members: [away(USER)] },
      ],
    });
    expect(screen.getByText("#Lounge")).toBeTruthy();
    // The trailing slot is the location, so the sheet stays behind the card.
    expect(screen.queryByLabelText("Information about ZewiWin")).toBeNull();
  });

  it("leaves an absent member unclickable and without a sheet", () => {
    const onInfo = vi.fn();
    const { onSelect } = renderPanel({
      onInfo,
      groups: [
        { key: "__members__", kind: "members", label: "", color: null, members: [away(ABSENT, null)] },
      ],
    });
    fireEvent.click(screen.getByText("Lyroit"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Information about Lyroit")).toBeNull();
  });

  it("switches the registered-but-absent people on and off", () => {
    const { onShowOfflineChange } = renderPanel({ showOffline: false });
    const toggle = screen.getByRole("checkbox", { name: "Show offline members" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onShowOfflineChange).toHaveBeenCalledWith(true);
  });
});
