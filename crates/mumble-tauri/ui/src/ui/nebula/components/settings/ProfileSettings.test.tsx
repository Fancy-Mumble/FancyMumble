import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileData } from "@core/features/settings/profileData";
import { useAppStore } from "@core/store";
import { withNebulaTheme } from "../../testTheme";
import { ProfileSettings } from "./ProfileSettings";

const saved: ProfileData[] = [];
/** The identity the last save was written under. */
let savedFor: string | null | undefined;
/** What each identity's profile store holds, keyed by label ("" = no identity). */
const stored: Record<string, ProfileData> = {};
/** What `list_certificates` answers. */
let certificates: string[] = [];

/** Every `invoke` the page made, so the sends to the server can be read back. */
const invoked: { cmd: string; args: Record<string, unknown> | undefined }[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    return cmd === "list_certificates" ? Promise.resolve([...certificates]) : Promise.resolve(undefined);
  },
}));

/** The `permission-denied` handler the page registered, if it registered one. */
let denyListener: ((event: { payload: { deny_type: number | null; reason: string | null } }) => void) | null =
  null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (payload: never) => void) => {
    if (event === "permission-denied") denyListener = handler as unknown as typeof denyListener;
    return Promise.resolve(() => {
      denyListener = null;
    });
  },
}));

vi.mock("@core/features/settings/profileData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@core/features/settings/profileData")>();
  return {
    ...actual,
    loadProfileData: (identity?: string | null) =>
      Promise.resolve(stored[identity ?? ""] ?? { profile: {}, bio: "", avatarDataUrl: null }),
    saveProfileData: (data: ProfileData, identity?: string | null) => {
      saved.push(data);
      savedFor = identity;
      return Promise.resolve();
    },
    migrateProfilesToIdentities: () => Promise.resolve(),
  };
});

vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () => Promise.resolve({ defaultUsername: "ZewiWin" }),
  updatePreferences: () => Promise.resolve(),
}));

async function renderPage(props: { identity?: string | null; onManageIdentities?: () => void } = {}) {
  const view = render(withNebulaTheme(<ProfileSettings {...props} />));
  await screen.findByLabelText("Display name");
  return view;
}

/** The identity pills, in the order the page draws them. */
function identityPills() {
  return screen
    .getAllByRole("radio")
    .filter((pill) => pill.closest("[role=radiogroup]")?.ariaLabel === "Identity");
}

describe("ProfileSettings", () => {
  beforeEach(() => {
    saved.length = 0;
    savedFor = undefined;
    for (const key of Object.keys(stored)) delete stored[key];
    certificates = [];
    invoked.length = 0;
    denyListener = null;
    useAppStore.setState({ connectedCertLabel: null, status: "disconnected" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The last profile comment the page sent to the server, if any. */
  function sentComment() {
    return invoked.filter((call) => call.cmd === "set_user_comment").at(-1)?.args?.comment as
      string | undefined;
  }

  it("offers a control for every part of the card the mock lets you set", async () => {
    await renderPage();
    for (const label of ["Display name", "Pronouns", "Contact", "Status", "About you"])
      expect(screen.getByLabelText(label)).toBeTruthy();
    for (const row of [
      "Card colours",
      "Avatar frame",
      "Sticker",
      "Nameplate",
      "Name style",
      "Profile effect",
    ])
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

  it("says nothing about identities when there are none to choose between", async () => {
    await renderPage();
    expect(screen.queryByText("Identity")).toBeNull();
  });

  it("shows the connected identity first, marked, however the certificates are ordered", async () => {
    certificates = ["personal", "streaming", "work"];
    useAppStore.setState({ connectedCertLabel: "work" });
    await renderPage();

    const pills = await waitFor(() => {
      const found = identityPills();
      expect(found).toHaveLength(3);
      return found;
    });
    expect(pills.map((pill) => pill.textContent)).toEqual(["workconnected", "personal", "streaming"]);
    // First *and* selected: the page opens on the profile people can see.
    expect(pills[0].getAttribute("aria-checked")).toBe("true");
  });

  it("edits the connected identity's profile, not the pre-identity one", async () => {
    certificates = ["personal", "work"];
    stored.work = { profile: { pronouns: "they/them" }, bio: "", avatarDataUrl: null };
    useAppStore.setState({ connectedCertLabel: "work" });
    await renderPage();

    await waitFor(() => expect(screen.getByLabelText("Pronouns").getAttribute("value")).toBe("they/them"));
    fireEvent.change(screen.getByLabelText("Contact"), { target: { value: "me@example.org" } });
    await waitFor(() => expect(savedFor).toBe("work"));
  });

  it("switches to another identity's profile, and warns that it is not the connected one", async () => {
    certificates = ["personal", "work"];
    stored.personal = { profile: { pronouns: "she/her" }, bio: "", avatarDataUrl: null };
    useAppStore.setState({ connectedCertLabel: "work" });
    await renderPage();

    await waitFor(() => expect(identityPills()).toHaveLength(2));
    fireEvent.click(screen.getByText("personal"));

    await waitFor(() => expect(screen.getByLabelText("Pronouns").getAttribute("value")).toBe("she/her"));
    expect(screen.getByText(/will not be applied to the server/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Contact"), { target: { value: "me@example.org" } });
    await waitFor(() => expect(savedFor).toBe("personal"));
  });

  it("sends an edit to the server, so the card people see is the card just edited", async () => {
    certificates = ["work"];
    useAppStore.setState({ connectedCertLabel: "work", status: "connected" });
    await renderPage();
    await waitFor(() => expect(identityPills()).toHaveLength(1));

    fireEvent.change(screen.getByLabelText("Pronouns"), { target: { value: "she/her" } });
    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => expect(sentComment()).toContain("she/her"));
    // The avatar rides along, because clearing one is an edit like any other.
    expect(invoked.some((call) => call.cmd === "set_user_texture")).toBe(true);
  });

  it("sends once for a burst of typing rather than once per keystroke", async () => {
    certificates = ["work"];
    useAppStore.setState({ connectedCertLabel: "work", status: "connected" });
    await renderPage();
    await waitFor(() => expect(identityPills()).toHaveLength(1));

    for (const value of ["s", "sh", "she", "she/", "she/her"])
      fireEvent.change(screen.getByLabelText("Pronouns"), { target: { value } });
    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => expect(sentComment()).toContain("she/her"));
    expect(invoked.filter((call) => call.cmd === "set_user_comment")).toHaveLength(1);
  });

  it("does not send another identity's profile to the connection it is not for", async () => {
    certificates = ["personal", "work"];
    useAppStore.setState({ connectedCertLabel: "work", status: "connected" });
    await renderPage();
    await waitFor(() => expect(identityPills()).toHaveLength(2));

    fireEvent.click(screen.getByText("personal"));
    await waitFor(() => expect(screen.getByText(/will not be applied to the server/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Pronouns"), { target: { value: "she/her" } });
    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => expect(savedFor).toBe("personal"));
    expect(sentComment()).toBeUndefined();
  });

  it("keeps the edit to itself while disconnected", async () => {
    certificates = ["work"];
    useAppStore.setState({ connectedCertLabel: "work", status: "disconnected" });
    await renderPage();
    await waitFor(() => expect(identityPills()).toHaveLength(1));

    fireEvent.change(screen.getByLabelText("Pronouns"), { target: { value: "she/her" } });
    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => expect(savedFor).toBe("work"));
    expect(sentComment()).toBeUndefined();
  });

  it("says so when the server refuses the profile for being too big", async () => {
    certificates = ["work"];
    useAppStore.setState({ connectedCertLabel: "work", status: "connected" });
    await renderPage();
    await waitFor(() => expect(denyListener).not.toBeNull());

    denyListener?.({ payload: { deny_type: 4, reason: null } });
    expect(await screen.findByText(/too large for this server/i)).toBeTruthy();
  });

  it("opens on the identity the Identities page sent it to", async () => {
    certificates = ["personal", "work"];
    useAppStore.setState({ connectedCertLabel: "work" });
    await renderPage({ identity: "personal" });

    await waitFor(() => {
      const checked = identityPills().filter((pill) => pill.getAttribute("aria-checked") === "true");
      expect(checked.map((pill) => pill.textContent)).toEqual(["personal"]);
    });
  });
});
