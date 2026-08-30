import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserEntry } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
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

function renderPanel(onInfo?: (session: number) => void) {
  const onSelect = vi.fn();
  render(
    withNebulaTheme(
      <MemberPanel
        members={[USER]}
        scope="channel"
        onScopeChange={() => undefined}
        query=""
        onQueryChange={() => undefined}
        talkingSessions={new Set()}
        ownSession={1}
        onSelect={onSelect}
        onHover={() => undefined}
        onLeave={() => undefined}
        onInfo={onInfo}
        onClose={() => undefined}
      />,
    ),
  );
  return { onSelect };
}

describe("MemberPanel", () => {
  it("opens the information sheet from the (i), not the card", () => {
    const onInfo = vi.fn();
    const { onSelect } = renderPanel(onInfo);
    fireEvent.click(screen.getByLabelText("Information about ZewiWin"));
    expect(onInfo).toHaveBeenCalledWith(7);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("draws no (i) for a host that has no sheet to open", () => {
    renderPanel();
    expect(screen.queryByLabelText("Information about ZewiWin")).toBeNull();
  });
});
