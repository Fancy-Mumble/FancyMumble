/**
 * What the client writes down when the voice state changes underneath it.
 *
 * The mute preference used to be written only by the store's own `toggleMute`
 * action, which meant it recorded the *button*, not the state: the tray's Mute
 * item, the global Ctrl+Shift+M shortcut and the Linux desktop handler all mute
 * through the backend directly, and a mute made that way was never saved - the
 * next connect restored voice unmuted. So this drives the real
 * `voice-state-changed` listener through `initEventListeners`, the same way
 * `DisconnectTeardown` does, and asks what reached the preferences.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const handlers = new Map<string, (e: { payload: unknown }) => unknown>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: (e: { payload: unknown }) => unknown) => {
    handlers.set(event, handler);
    return Promise.resolve(() => undefined);
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "list_servers") return Promise.resolve([]);
    if (cmd === "get_voice_state") return Promise.resolve("inactive");
    return Promise.resolve(null);
  }),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => Promise.resolve(false),
  requestPermission: () => Promise.resolve("denied"),
  sendNotification: () => undefined,
}));

// Hoisted with the mock factory that closes over it - `vi.mock` is lifted to
// the top of the file, so a plain `const` here would not exist yet.
const { updatePreferences } = vi.hoisted(() => ({
  updatePreferences: vi.fn(() => Promise.resolve({})),
}));
vi.mock("../../preferencesStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../preferencesStorage")>()),
  updatePreferences,
}));

import { useAppStore, initEventListeners } from "../../store";

/** Fire the backend event, then let the debounced write fall due. */
async function voiceStateChanged(state: string): Promise<void> {
  handlers.get("voice-state-changed")?.({ payload: state });
  await vi.advanceTimersByTimeAsync(1000);
}

beforeEach(async () => {
  handlers.clear();
  updatePreferences.mockClear();
  vi.useFakeTimers();
  await initEventListeners(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a voice-state change nothing in the UI asked for", () => {
  it("saves a mute made from the tray or the global shortcut", async () => {
    await voiceStateChanged("active");
    updatePreferences.mockClear();

    await voiceStateChanged("muted");

    expect(updatePreferences).toHaveBeenCalledWith({
      voiceOnReconnect: true,
      voiceMutedOnReconnect: true,
    });
    expect(useAppStore.getState().voiceState).toBe("muted");
  });

  it("saves the unmute too, rather than only ever saving mutes", async () => {
    await voiceStateChanged("muted");
    updatePreferences.mockClear();

    await voiceStateChanged("active");

    expect(updatePreferences).toHaveBeenCalledWith({
      voiceOnReconnect: true,
      voiceMutedOnReconnect: false,
    });
  });

  it("writes nothing when voice goes inactive", async () => {
    // A disconnect tears the pipeline down and reports it as "inactive". Saving
    // that would answer the next connect with "the user had voice off", which
    // is not what they chose - and would undo the mute this file is about.
    // Turning voice off deliberately is `disableVoice`, which records itself.
    await voiceStateChanged("muted");
    updatePreferences.mockClear();

    await voiceStateChanged("inactive");

    expect(updatePreferences).not.toHaveBeenCalled();
  });

  it("does not let a queued write turn voice back on after it is switched off", async () => {
    // Mute, then switch voice off before the debounced write falls due. The
    // write still in flight says "voice on, muted"; `disableVoice` says off.
    // The last thing the user did has to be the thing that survives.
    handlers.get("voice-state-changed")?.({ payload: "muted" });
    await useAppStore.getState().disableVoice();
    await vi.advanceTimersByTimeAsync(1000);

    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(updatePreferences).toHaveBeenCalledWith({
      voiceOnReconnect: false,
      voiceMutedOnReconnect: false,
    });
  });

  it("collapses a burst of events into the state they settled on", async () => {
    // The reason this write is debounced rather than done per event: queued IPC
    // can deliver a burst, and an out-of-order pair used to leave the wrong
    // answer on disk. Only the settled state is written, once.
    handlers.get("voice-state-changed")?.({ payload: "active" });
    handlers.get("voice-state-changed")?.({ payload: "muted" });
    await vi.advanceTimersByTimeAsync(1000);

    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(updatePreferences).toHaveBeenCalledWith({
      voiceOnReconnect: true,
      voiceMutedOnReconnect: true,
    });
  });
});
