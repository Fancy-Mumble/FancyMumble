import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "@core/store";
import type { PresenceEntry } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { RichPresencePanel } from "./RichPresencePanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

function entry(overrides: Partial<PresenceEntry> = {}): PresenceEntry {
  return {
    id: 1,
    applicationId: "1234",
    displayName: "Factorio",
    activity: { name: "Factorio", details: "Nauvis", state: "Building a mall" },
    ...overrides,
  } as PresenceEntry;
}

function draw(entries: PresenceEntry[], status: Record<string, unknown> = { enabled: true }) {
  useAppStore.setState({ richPresence: entries, richPresenceStatus: status } as never);
  render(withNebulaTheme(<RichPresencePanel />));
}

describe("Nebula RichPresencePanel", () => {
  beforeEach(() => cleanup());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows what an application is publishing", () => {
    draw([entry()]);
    expect(screen.getByText("Factorio")).toBeTruthy();
    expect(screen.getByText("Nauvis")).toBeTruthy();
    expect(screen.getByText("Building a mall")).toBeTruthy();
  });

  it("names the blocked case rather than looking merely empty", () => {
    draw([], { enabled: true, bridgeState: "blocked" });
    // The one cause the user can act on: start this before Discord next time.
    expect(screen.getByText(/discord started first/i)).toBeTruthy();
  });

  it("says presence is off rather than that nothing is playing", () => {
    draw([], { enabled: false });
    expect(screen.getByText(/rich presence is off/i)).toBeTruthy();
  });

  it("reports an idle listener as nothing playing", () => {
    draw([], { enabled: true });
    expect(screen.getByText(/no apps are publishing/i)).toBeTruthy();
  });

  it("counts elapsed time from the activity's start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T18:00:00Z"));
    const started = Date.now() - 125_000; // 2:05
    draw([entry({ activity: { timestamps: { start: started } } as never })]);

    expect(screen.getByText("2:05 elapsed")).toBeTruthy();
  });

  it("puts an application's own buttons behind the link guard", () => {
    draw([
      entry({
        activity: {
          buttons: [{ label: "Open the wiki", url: "https://wiki.factorio.com" }, { label: "No link here" }],
        } as never,
      }),
    ]);

    // The URL is the application's, so it must not be a bare live anchor: the
    // guard works by intercepting anchors it has marked.
    const link = screen.getByText("Open the wiki");
    expect(link.getAttribute("href")).toBe("https://wiki.factorio.com");
    expect(link.hasAttribute("data-external")).toBe(true);

    // A label with nothing to open is shown, but is not a link.
    expect(screen.getByText("No link here").tagName).not.toBe("A");
  });

  it("falls back to an initial when the artwork did not resolve", () => {
    draw([entry({ largeImageUrl: null })]);
    expect(screen.getByText("F")).toBeTruthy();
  });
});
