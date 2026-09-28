import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameOverlaySettings, UserPreferences } from "@core/types/preferences";

const invokeMock = vi.fn();
/** The handler `safeListen` registers, so a test can deliver an event. */
let askHandler: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (e: { payload: unknown }) => void) => {
    if (event === "game-overlay-ask") askHandler = handler;
    return Promise.resolve(() => undefined);
  },
}));

const prefs: { current: UserPreferences } = { current: {} as UserPreferences };
const updatePreferencesMock = vi.fn();

vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () => Promise.resolve(prefs.current),
  updatePreferences: (patch: Partial<UserPreferences>) => {
    updatePreferencesMock(patch);
    prefs.current = { ...prefs.current, ...patch };
    return Promise.resolve(prefs.current);
  },
}));

const overlay = (patch: Partial<GameOverlaySettings> = {}): GameOverlaySettings => ({
  mode: "whileActive",
  corner: "topRight",
  showLastMessage: true,
  hideFromCapture: true,
  rules: {},
  asked: [],
  ...patch,
});

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  updatePreferencesMock.mockReset();
  askHandler = null;
  prefs.current = { gameOverlay: overlay() } as UserPreferences;
});

describe("setGameOverlayRule", () => {
  it("records the decision and tells the detector about it", async () => {
    const { setGameOverlayRule } = await import("./gameOverlay");
    await setGameOverlayRule("c:\\games\\thing.exe", "allow");

    expect(prefs.current.gameOverlay?.rules).toEqual({ "c:\\games\\thing.exe": "allow" });
    expect(invokeMock).toHaveBeenCalledWith("game_overlay_set_rule", {
      exePath: "c:\\games\\thing.exe",
      rule: "allow",
    });
  });

  it("remembers that it asked, so the prompt is a one-time interruption", async () => {
    const { setGameOverlayRule } = await import("./gameOverlay");
    // "Not now" - no rule, but the question was put.
    await setGameOverlayRule("c:\\games\\thing.exe", null);

    expect(prefs.current.gameOverlay?.rules).toEqual({});
    expect(prefs.current.gameOverlay?.asked).toEqual(["c:\\games\\thing.exe"]);
  });

  it("forgets a decision when the rule is cleared", async () => {
    prefs.current = {
      gameOverlay: overlay({ rules: { "c:\\games\\thing.exe": "deny" } }),
    } as UserPreferences;
    const { setGameOverlayRule } = await import("./gameOverlay");
    await setGameOverlayRule("c:\\games\\thing.exe", null);

    expect(prefs.current.gameOverlay?.rules).toEqual({});
  });
});

describe("useGameOverlayAsk", () => {
  const deliver = async (exePath: string) => {
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useGameOverlayAsk } = await import("./gameOverlay");
    const { result } = renderHook(() => useGameOverlayAsk());
    await waitFor(() => expect(askHandler).not.toBeNull());
    askHandler?.({ payload: { exePath, name: "Thing", score: 40 } });
    return { result, waitFor };
  };

  it("asks about something that might be a game", async () => {
    const { result, waitFor } = await deliver("c:\\games\\thing.exe");
    await waitFor(() => expect(result.current.pending?.exePath).toBe("c:\\games\\thing.exe"));
  });

  it("says nothing while the overlay is switched off", async () => {
    prefs.current = { gameOverlay: overlay({ mode: "off" }) } as UserPreferences;
    const { result } = await deliver("c:\\games\\thing.exe");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.pending).toBeNull();
  });

  it("never asks twice about the same program", async () => {
    prefs.current = {
      gameOverlay: overlay({ asked: ["c:\\games\\thing.exe"] }),
    } as UserPreferences;
    const { result } = await deliver("c:\\games\\thing.exe");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.pending).toBeNull();
  });

  it("does not ask about a program the user has already ruled on", async () => {
    prefs.current = {
      gameOverlay: overlay({ rules: { "c:\\games\\thing.exe": "deny" } }),
    } as UserPreferences;
    const { result } = await deliver("c:\\games\\thing.exe");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.pending).toBeNull();
  });
});

describe("applyGameOverlaySettings", () => {
  it("sends only what the detector needs, not the whole preference", async () => {
    const { applyGameOverlaySettings } = await import("./gameOverlay");
    await applyGameOverlaySettings(overlay({ rules: { "c:\\a.exe": "allow" } }));

    expect(invokeMock).toHaveBeenCalledWith("game_overlay_configure", {
      settings: {
        mode: "whileActive",
        corner: "topRight",
        hideFromCapture: true,
        rules: { "c:\\a.exe": "allow" },
      },
    });
  });
});
