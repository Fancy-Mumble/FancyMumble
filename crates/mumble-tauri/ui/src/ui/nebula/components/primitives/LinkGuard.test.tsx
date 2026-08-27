import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import { LinkGuard } from "./LinkGuard";

const { openUrlMock, getPreferencesMock, updatePreferencesMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn((_url: string) => Promise.resolve()),
  getPreferencesMock: vi.fn(),
  updatePreferencesMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrlMock(url) }));

// The guard reads the trust list through the Tauri store plugin, which has no
// backend in jsdom; stub the two accessors and leave the rest real.
vi.mock("@core/preferencesStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/preferencesStorage")>()),
  getPreferences: getPreferencesMock,
  updatePreferences: updatePreferencesMock,
}));

const URL_UNDER_TEST = "https://intfeet.com/customize";

function draw(trustedLinkHosts: string[] = []) {
  getPreferencesMock.mockResolvedValue({ trustedLinkHosts });
  return render(
    withNebulaTheme(
      <LinkGuard>
        <a href={URL_UNDER_TEST} data-external="true">
          customize
        </a>
      </LinkGuard>,
    ),
  );
}

/** Click the guarded link once the trust list has loaded. */
async function clickLink() {
  await waitFor(() => expect(getPreferencesMock).toHaveBeenCalled());
  fireEvent.click(screen.getByText("customize"));
}

describe("LinkGuard", () => {
  beforeEach(() => {
    openUrlMock.mockClear();
    updatePreferencesMock.mockClear();
    updatePreferencesMock.mockResolvedValue({});
  });

  it("asks before a link leaves, then hands it to the browser", async () => {
    draw();
    await clickLink();

    expect(screen.getByText("Leaving Fancy Mumble")).toBeTruthy();
    expect(openUrlMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Open link"));
    expect(openUrlMock).toHaveBeenCalledWith(URL_UNDER_TEST);
  });

  it("opens nothing when the warning is cancelled", async () => {
    draw();
    await clickLink();
    fireEvent.click(screen.getByText("Cancel"));

    expect(openUrlMock).not.toHaveBeenCalled();
    // The dialog unmounts at the end of its exit transition, not on the click.
    await waitFor(() => expect(screen.queryByText("Leaving Fancy Mumble")).toBeNull());
  });

  it("remembers a host the user ticked, once they actually confirm", async () => {
    draw();
    await clickLink();

    fireEvent.click(screen.getByLabelText("Trust intfeet.com"));
    fireEvent.click(screen.getByText("Open link"));

    await waitFor(() =>
      expect(updatePreferencesMock).toHaveBeenCalledWith({ trustedLinkHosts: ["intfeet.com"] }),
    );
  });

  it("trusts nothing when the tick is set but the dialog is cancelled", async () => {
    draw();
    await clickLink();

    fireEvent.click(screen.getByLabelText("Trust intfeet.com"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(updatePreferencesMock).not.toHaveBeenCalled();
  });

  it("does not ask again about a host already trusted", async () => {
    draw(["intfeet.com"]);
    await clickLink();

    expect(screen.queryByText("Leaving Fancy Mumble")).toBeNull();
    // Still the browser's job, though - a trusted host is not permission to
    // navigate the app's own window.
    expect(openUrlMock).toHaveBeenCalledWith(URL_UNDER_TEST);
  });

  it("still asks about a host that merely resembles a trusted one", async () => {
    draw(["feet.com"]);
    await clickLink();

    expect(screen.getByText("Leaving Fancy Mumble")).toBeTruthy();
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});
