/**
 * The Voice page's four groups, and the fact that each of them reaches the
 * engine.
 *
 * The page grew from "devices and a gate" into the whole capture chain, and
 * every control on it is one that changes nothing visible in the page itself -
 * a wrong `patch` shape or a missing write would look exactly like a working
 * switch. So what is checked here is the write: which command went out, and
 * with what.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));

const savedAudio = vi.fn<() => Promise<unknown>>();
const saveAudio = vi.fn<(settings: unknown) => Promise<void>>();
const preferences = { userMode: "normal" as string };
vi.mock("@core/preferencesStorage", () => ({
  getSavedAudioSettings: () => savedAudio(),
  saveAudioSettings: (settings: unknown) => saveAudio(settings),
  getPreferences: () => Promise.resolve({ ...preferences }),
  updatePreferences: () => Promise.resolve(undefined),
}));

// Exclusive capture is a Windows switch and jsdom is not Windows, so the one
// fact the page reads off the platform is stated here rather than left to the
// user agent. Everything else in the module keeps its real behaviour.
vi.mock("@core/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/utils/platform")>()),
  isWindows: true,
}));

import type { AudioSettings, DenoiserParamSpec } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { VoiceSettings } from "./VoiceSettings";

/** One knob, shaped the way the backend describes them. */
const ATTENUATION: DenoiserParamSpec = {
  id: "attenuation_db",
  label: "Attenuation limit",
  description: "How much the denoiser may pull the noise floor down.",
  min: 0,
  max: 40,
  step: 0.5,
  default: 12,
  unit: "dB",
};

const SETTINGS: AudioSettings = {
  selected_device: null,
  auto_gain: true,
  vad_threshold: 0.013,
  max_gain_db: 18.2,
  noise_gate_close_ratio: 0.71,
  hold_frames: 20,
  push_to_talk: false,
  push_to_talk_key: null,
  bitrate_bps: 72000,
  frame_size_ms: 20,
  noise_suppression: true,
  denoiser_algorithm: "rnnoise",
  denoiser_params: {},
  selected_output_device: null,
  input_volume: 0.35,
  output_volume: 1,
  auto_input_sensitivity: true,
  force_tcp_audio: false,
};

/** A backend that answers every command the page opens with. */
function backend(cmd: string): Promise<unknown> {
  if (cmd === "get_audio_settings") return Promise.resolve(SETTINGS);
  if (cmd === "get_audio_devices" || cmd === "get_output_devices") return Promise.resolve([]);
  if (cmd === "get_available_denoiser_algorithms")
    return Promise.resolve(["none", "rnnoise", "omlsa_imcra", "spectral_subtraction"]);
  if (cmd === "get_audio_backend") return Promise.resolve(true);
  return Promise.resolve(undefined);
}

/** The settings object of the last write to the engine. */
function lastWrite(): AudioSettings | undefined {
  const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === "set_audio_settings");
  return (calls.at(-1)?.[1] as { settings: AudioSettings } | undefined)?.settings;
}

async function renderPage(overrides: Partial<AudioSettings> = {}) {
  invokeMock.mockImplementation((cmd) => {
    if (cmd === "get_audio_settings") return Promise.resolve({ ...SETTINGS, ...overrides });
    return backend(cmd);
  });
  const view = render(withNebulaTheme(<VoiceSettings />));
  await screen.findByRole("radio", { name: "Voice activation" });
  return view;
}

describe("VoiceSettings", () => {
  beforeEach(() => {
    preferences.userMode = "normal";
    savedAudio.mockReset();
    savedAudio.mockResolvedValue(null);
    saveAudio.mockReset();
    saveAudio.mockResolvedValue(undefined);
    invokeMock.mockReset();
    invokeMock.mockImplementation(backend);
  });

  it("names the group each control belongs to", async () => {
    await renderPage();
    for (const group of ["Voice gate", "Processing", "Transmission", "Audio statistics"]) {
      expect(screen.getByText(group)).toBeTruthy();
    }
  });

  it("writes a packet length to the engine and to storage", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "40 ms" }));

    await waitFor(() => expect(lastWrite()?.frame_size_ms).toBe(40));
    expect((saveAudio.mock.calls.at(-1)?.[0] as AudioSettings).frame_size_ms).toBe(40);
  });

  it("turns the noise-suppression row off through the flag, not the algorithm", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));

    await waitFor(() => expect(lastWrite()?.noise_suppression).toBe(false));
    // The chosen algorithm is kept, so switching back does not silently
    // demote the user to whatever the default happens to be.
    expect(lastWrite()?.denoiser_algorithm).toBe("rnnoise");
  });

  it("offers only the algorithms this build carries", async () => {
    await renderPage();
    expect(screen.queryByRole("radio", { name: "DeepFilterNet" })).toBeNull();
    expect(screen.getByRole("radio", { name: "RNNoise" })).toBeTruthy();
  });

  it("keeps the audio backend behind expert mode", async () => {
    await renderPage();
    expect(screen.queryByLabelText("Legacy audio backend")).toBeNull();
  });

  it("switches the backend for an expert, and reverts if the engine refuses", async () => {
    preferences.userMode = "expert";
    await renderPage();
    invokeMock.mockImplementation((cmd) =>
      cmd === "set_audio_backend" ? Promise.reject(new Error("no")) : backend(cmd),
    );

    const toggle = await screen.findByLabelText("Legacy audio backend");
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(invokeMock.mock.calls.some(([cmd]) => cmd === "set_audio_backend")).toBe(true),
    );
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
  });

  it("asks for a calibration the input chain has never had, and starts one", async () => {
    await renderPage();
    expect(screen.getByText("Calibration needed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Calibrate" }));
    await waitFor(() => expect(invokeMock.mock.calls.some(([cmd]) => cmd === "start_mic_test")).toBe(true));
  });

  it("drops the gate entirely for the modes that do not have one", async () => {
    await renderPage({ push_to_talk: true });
    expect(screen.queryByText("Voice gate")).toBeNull();
    expect(screen.queryByText("Hear yourself")).toBeNull();
  });

  it("swaps the gate for the meter when it is tuned by hand", async () => {
    await renderPage({ auto_input_sensitivity: false });
    expect(screen.queryByText("Calibration needed")).toBeNull();
    expect(screen.getByRole("button", { name: "Test microphone" })).toBeTruthy();
    expect(screen.getByLabelText("Open threshold")).toBeTruthy();
    expect(screen.getByLabelText("Close threshold")).toBeTruthy();
  });

  it("records a sample through the replay recorder", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Record sample" }));
    await waitFor(() =>
      expect(invokeMock.mock.calls.some(([cmd]) => cmd === "start_voice_replay")).toBe(true),
    );
  });

  it("says there are no packet counters rather than showing zeroes", async () => {
    await renderPage();
    expect(screen.getByText(/No statistics available/)).toBeTruthy();
  });

  it("takes the microphone exclusively, and says so to the engine", async () => {
    await renderPage();
    const toggle = screen.getByLabelText("Exclusive microphone mode") as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    await waitFor(() => expect(lastWrite()?.exclusive_input).toBe(true));
    expect((saveAudio.mock.calls.at(-1)?.[0] as AudioSettings).exclusive_input).toBe(true);
  });

  it("keeps the denoiser knobs behind expert mode", async () => {
    invokeMock.mockImplementation((cmd) =>
      cmd === "get_denoiser_param_specs" ? Promise.resolve([ATTENUATION]) : backend(cmd),
    );
    render(withNebulaTheme(<VoiceSettings />));
    await screen.findByRole("radio", { name: "Voice activation" });

    expect(screen.queryByText("Fine tuning")).toBeNull();
  });

  it("draws one knob per parameter the algorithm exposes, and writes it", async () => {
    preferences.userMode = "expert";
    invokeMock.mockImplementation((cmd) =>
      cmd === "get_denoiser_param_specs" ? Promise.resolve([ATTENUATION]) : backend(cmd),
    );
    render(withNebulaTheme(<VoiceSettings />));

    // The spec's default stands in until the record carries a value.
    const knob = await screen.findByLabelText("Attenuation limit");
    expect(screen.getByText("12.0 dB")).toBeTruthy();

    fireEvent.change(knob, { target: { value: "18.5" } });
    await waitFor(() => expect(lastWrite()?.denoiser_params).toEqual({ attenuation_db: 18.5 }));
  });

  it("draws nothing where the algorithm has nothing to tune", async () => {
    preferences.userMode = "expert";
    await renderPage();
    // `backend` answers the specs call with undefined, which is what an
    // algorithm with no knobs amounts to.
    await waitFor(() =>
      expect(invokeMock.mock.calls.some(([cmd]) => cmd === "get_denoiser_param_specs")).toBe(true),
    );
    expect(screen.queryByText("Fine tuning")).toBeNull();
  });
});
