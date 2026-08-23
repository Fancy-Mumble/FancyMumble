import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileData } from "@core/features/settings/profileData";
import { withNebulaTheme } from "../../testTheme";
import { ProfileSettings } from "./ProfileSettings";

const saved: ProfileData[] = [];

vi.mock("@core/features/settings/profileData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@core/features/settings/profileData")>();
  return {
    ...actual,
    loadProfileData: () => Promise.resolve({ profile: {}, bio: "", avatarDataUrl: null }),
    saveProfileData: (data: ProfileData) => {
      saved.push(data);
      return Promise.resolve();
    },
  };
});

vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () => Promise.resolve({ defaultUsername: "ZewiWin" }),
  updatePreferences: () => Promise.resolve(),
}));

async function renderPage() {
  const view = render(withNebulaTheme(<ProfileSettings />));
  await screen.findByLabelText("Display name");
  return view;
}

describe("ProfileSettings", () => {
  beforeEach(() => {
    saved.length = 0;
  });

  it("offers a control for every part of the card the mock lets you set", async () => {
    await renderPage();
    for (const label of ["Display name", "Pronouns", "Contact", "Status", "About you"])
      expect(screen.getByLabelText(label)).toBeTruthy();
    for (const row of ["Card colours", "Avatar frame", "Sticker", "Nameplate", "Name style", "Profile effect"])
      expect(screen.getByText(row)).toBeTruthy();
  });

  it("lets every optional row of the card be switched off", async () => {
    await renderPage();
    for (const row of ["Badges", "Badge shelves", "Pronouns & contact", "Mutual servers", "Stats"])
      expect(screen.getByLabelText(`Show ${row}`)).toBeTruthy();
  });

  it("edits the status and the bio in the WYSIWYG field, not in markup", async () => {
    await renderPage();
    for (const label of ["Status", "About you"]) {
      const box = screen.getByLabelText(label);
      // A textarea would take the markup as literal text; this is the editor.
      expect(box.getAttribute("contenteditable")).toBe("true");
    }
    // The bio's field is the one that carries pictures and colour.
    expect(screen.getByLabelText("Insert image")).toBeTruthy();
    expect(screen.getAllByLabelText("Text colour")).toHaveLength(2);
  });

  it("writes what is typed straight into the stored profile", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("Pronouns"), { target: { value: "she/her" } });
    await waitFor(() => expect(saved.at(-1)?.profile.pronouns).toBe("she/her"));
  });

  it("hides a row in the stored profile when its switch is turned off", async () => {
    await renderPage();
    fireEvent.click(screen.getByLabelText("Show Stats"));
    await waitFor(() => expect(saved.at(-1)?.profile.sections?.stats).toBe(false));
  });

  it("previews the profile with the real card, not a drawing of one", async () => {
    await renderPage();
    expect(screen.getByLabelText("ZewiWin profile")).toBeTruthy();
    expect(screen.getByText(/all yours/i)).toBeTruthy();
  });
});
