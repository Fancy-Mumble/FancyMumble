import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import type { UserEntry } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { HoverProfileCard } from "./HoverProfileCard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null, useUserComment: () => null }));
vi.mock("@ui/standard/hooks/useAclGroups", () => ({ useAclGroups: () => [] }));
// A tap on a roster row leaves this behind - the state the bug was made of.
vi.mock("../../clientState", () => ({
  useHoverTarget: () => ({ session: 7, anchor: { left: 10, top: 10, right: 200, bottom: 40 } }),
  useProfileAnchor: () => null,
}));

const USER: UserEntry = {
  session: 7,
  name: "Mira",
  channel_id: 1,
  user_id: 2,
  texture_size: null,
  mute: false,
  deaf: false,
  suppress: false,
  self_mute: false,
  self_deaf: false,
  priority_speaker: false,
  hash: "abc",
};

describe("HoverProfileCard", () => {
  beforeEach(() => {
    useAppStore.setState({ users: [USER], selectedUser: null, channels: [] } as never);
  });
  afterEach(() => document.documentElement.removeAttribute("data-nebula-handheld"));

  it("follows the pointer on a desktop", () => {
    document.documentElement.setAttribute("data-nebula-handheld", "off");
    const { container } = render(withNebulaTheme(<HoverProfileCard onMessage={vi.fn()} />));
    expect(container.ownerDocument.querySelector(".nebula-profile-card")).not.toBeNull();
  });

  it("shows nothing for a leftover hover on a phone, so closing the sheet closes it", () => {
    document.documentElement.setAttribute("data-nebula-handheld", "on");
    const { container } = render(withNebulaTheme(<HoverProfileCard onMessage={vi.fn()} />));
    expect(container.ownerDocument.querySelector(".nebula-profile-card")).toBeNull();
  });
});
