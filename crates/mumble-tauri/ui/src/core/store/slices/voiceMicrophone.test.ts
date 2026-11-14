/**
 * The microphone is asked for when voice is first used, not at launch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("..", () => ({ cancelVoicePersist: vi.fn(), persistVoiceState: vi.fn() }));
vi.mock("../../preferencesStorage", () => ({ updatePreferences: vi.fn().mockResolvedValue(undefined) }));
const platform = vi.hoisted(() => ({ isMobile: false }));
vi.mock("../../utils/platform", () => platform);

import { createVoiceSlice, microphoneAllowed } from "./voice";
import type { VoiceSlice } from "./voice";

/** A slice over a plain object, standing in for the store. */
function slice(voiceState: VoiceSlice["voiceState"]) {
  let state = { voiceState } as Partial<VoiceSlice>;
  const set = (partial: Partial<VoiceSlice>) => {
    state = { ...state, ...partial };
  };
  const created = (createVoiceSlice as unknown as (s: typeof set, g: () => typeof state) => VoiceSlice)(
    set,
    () => state,
  );
  return { actions: created, state: () => state };
}

const commands = () => invokeMock.mock.calls.map((call) => call[0]);

describe("asking for the microphone", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("asks nothing on a desktop", async () => {
    platform.isMobile = false;
    await expect(microphoneAllowed()).resolves.toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("asks on a phone, and turns voice on to listen when refused", async () => {
    platform.isMobile = true;
    invokeMock.mockImplementation((cmd: string) => Promise.resolve(cmd === "request_microphone" ? false : undefined));
    const voice = slice("inactive");
    await voice.actions.enableVoice();
    expect(commands()).toEqual(["request_microphone", "enable_voice_muted"]);
    expect(voice.state().voiceState).toBe("muted");
  });

  it("turns voice on with the microphone once allowed", async () => {
    platform.isMobile = true;
    invokeMock.mockImplementation((cmd: string) => Promise.resolve(cmd === "request_microphone" ? true : undefined));
    const voice = slice("inactive");
    await voice.actions.enableVoice();
    expect(commands()).toEqual(["request_microphone", "enable_voice"]);
  });

  it("stays muted when unmuting is refused the microphone", async () => {
    platform.isMobile = true;
    invokeMock.mockImplementation((cmd: string) => Promise.resolve(cmd === "request_microphone" ? false : undefined));
    await slice("muted").actions.toggleMute();
    expect(commands()).toEqual(["request_microphone"]);
  });
});
