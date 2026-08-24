import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { serializeProfile } from "@core/profileFormat";
import { useAppStore } from "@core/store";
import type { FancyProfile, UserEntry } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { ProfileCard } from "./ProfileCard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock("@core/lazyBlobs", () => ({
  useUserAvatar: () => null,
  useUserComment: () => null,
}));

const GROUPS = [
  {
    name: "admin",
    inherited: false,
    inherit: true,
    inheritable: true,
    add: [3],
    remove: [],
    inherited_members: [],
    color: "#41b4f9",
    icon: null,
    style_preset: null,
    metadata: {},
  },
  {
    name: "founders",
    inherited: false,
    inherit: true,
    inheritable: true,
    add: [3],
    remove: [],
    inherited_members: [],
    color: null,
    icon: null,
    style_preset: null,
    metadata: { badge_icon: "crown", badge_label: "Founder", badge_shelf: "special" },
  },
];

vi.mock("@ui/standard/hooks/useAclGroups", () => ({ useAclGroups: () => GROUPS }));

const USER: UserEntry = {
  session: 7,
  name: "ZewiWin",
  channel_id: 1,
  user_id: 3,
  texture_size: null,
  mute: false,
  deaf: false,
  suppress: false,
  self_mute: false,
  self_deaf: false,
  priority_speaker: true,
  hash: "abc",
};

function renderCard(profile: FancyProfile | null, bio = "have a nice day", pinned = true, onClose = vi.fn()) {
  useAppStore.setState({
    channels: [{ id: 1, parent_id: 0, name: "Gaming", user_count: 2, position: 0 } as never],
  });
  const user = profile ? { ...USER, comment: serializeProfile(profile, bio) } : USER;
  return render(
    withNebulaTheme(
      <ProfileCard user={user} anchor={null} pinned={pinned} onClose={onClose} onMessage={vi.fn()} />,
    ),
  );
}

describe("ProfileCard", () => {
  it("badges the groups the server put the user in, and the flags it sent", () => {
    renderCard(null);
    expect(screen.getByLabelText("admin")).toBeTruthy();
    // A shelved badge is on the strip *and* on its rail, as the mock draws it.
    expect(screen.getAllByLabelText("Founder")).toHaveLength(2);
    expect(screen.getByLabelText("Priority speaker")).toBeTruthy();
    expect(screen.queryByLabelText("Muted")).toBeNull();
    expect(screen.queryByLabelText("Deafened")).toBeNull();
  });

  it("shelves a badge the server assigned a shelf, under that shelf's label", () => {
    renderCard(null);
    expect(screen.getByText("Special")).toBeTruthy();
  });

  it("marks a registered account and lists its roles", () => {
    renderCard(null);
    expect(screen.getByLabelText("Registered account")).toBeTruthy();
    expect(screen.getByText("admin")).toBeTruthy();
    expect(screen.getByText("founders")).toBeTruthy();
  });

  it("offers the message composer and the channel the user is in", () => {
    renderCard(null);
    expect(screen.getByPlaceholderText("Message @ZewiWin")).toBeTruthy();
    expect(screen.getByText("In voice — Gaming")).toBeTruthy();
  });

  it("writes the pronouns and contact line the profile carries", () => {
    renderCard({ pronouns: "she/her", contact: "zewi@magical.rocks" });
    expect(screen.getByText("she/her · zewi@magical.rocks")).toBeTruthy();
  });

  it("draws the bio's formatting rather than its markup, or the text bare", () => {
    const { container } = renderCard(
      {},
      '<p>Drum &amp; <strong>bass</strong> and <span style="color:#ff4d4d">ARAM</span></p>',
    );
    expect(screen.getByText("bass").tagName).toBe("STRONG");
    expect(screen.getByText("ARAM").getAttribute("style")).toContain("rgb(255, 77, 77)");
    expect(container.textContent).toContain("Drum & bass and ARAM");
  });

  it("keeps a hostile comment out of the card - it is markup from anyone", () => {
    const { container } = renderCard({}, '<p onclick="steal()">hi</p><script>steal()</script>');
    expect(container.innerHTML).not.toContain("steal");
    expect(screen.getByText("hi")).toBeTruthy();
  });

  it("formats the status too, on the one line it has", () => {
    renderCard({ status: "have a <em>nice</em> day" });
    expect(screen.getByText("nice").tagName).toBe("EM");
  });

  it("drops a row the profile switched off, and keeps the rest", () => {
    renderCard({ pronouns: "she/her", sections: { identity: false } });
    expect(screen.queryByText("she/her")).toBeNull();
    expect(screen.getByPlaceholderText("Message @ZewiWin")).toBeTruthy();
  });

  it("repaints the card and shows the sticker when the user has a styled profile", () => {
    const { container } = renderCard({
      themeColors: ["#2b2420", "#211c24", "#271d1d", "#e8b84b"],
      nameplate: "gold",
      decoration: "gold",
      nameStyle: { font: "cursive" },
    });

    const card = container.querySelector("aside") as HTMLElement;
    const painted = globalThis.getComputedStyle(card);
    expect(painted.backgroundImage).toContain("165deg");
    expect(painted.borderColor).toBe("rgba(232, 184, 75, 0.45)");

    // The sticker overhangs the corner, so the card must stop clipping itself.
    expect(painted.overflow).toBe("visible");
    expect(screen.getByText("👑")).toBeTruthy();

    const name = screen.getByText("ZewiWin");
    expect(globalThis.getComputedStyle(name).fontFamily).toContain("Segoe Script");
  });

  it("closes when the next click lands outside it", () => {
    const onClose = vi.fn();
    renderCard(null, "have a nice day", true, onClose);

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open for a click on the card itself", () => {
    const onClose = vi.fn();
    const { container } = renderCard(null, "have a nice day", true, onClose);

    fireEvent.pointerDown(container.querySelector("aside") as HTMLElement);
    fireEvent.pointerDown(screen.getByPlaceholderText("Message @ZewiWin"));
    expect(onClose).not.toHaveBeenCalled();
  });

  // The preview follows the pointer, so every click is outside it; dismissing
  // one would close the card the click was on its way to pinning.
  it("does not dismiss the preview that is following the pointer", () => {
    const onClose = vi.fn();
    renderCard(null, "have a nice day", false, onClose);

    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  // The pointer preview is this card, not a smaller one beside it: what a hover
  // shows has to be what the click keeps, or the two start telling different
  // stories about the same person.
  it("shows the same rows while it is only following the pointer, minus the pointer", () => {
    const { container } = renderCard(null, "have a nice day", false);
    expect(screen.getByPlaceholderText("Message @ZewiWin")).toBeTruthy();
    expect(screen.getByLabelText("admin")).toBeTruthy();
    const card = container.querySelector("aside") as HTMLElement;
    expect(globalThis.getComputedStyle(card).pointerEvents).toBe("none");
  });

  it("leaves an unstyled card clipped and on the window's colours", () => {
    const { container } = renderCard(null);
    const painted = globalThis.getComputedStyle(container.querySelector("aside") as HTMLElement);
    expect(painted.overflow).toBe("hidden");
    expect(painted.backgroundImage).not.toContain("165deg");
  });
});
