import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import { RecordingDialog } from "./RecordingDialog";
import { DEFAULT_FILENAME, formatElapsed, loadTarget, useRecording, type RecordingControls } from "./useRecording";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

function controls(overrides: Partial<RecordingControls> = {}): RecordingControls {
  return {
    state: { is_recording: false, file_path: null, elapsed_secs: 0 },
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    ...overrides,
  };
}

function show(recording: RecordingControls) {
  const onClose = vi.fn();
  render(withNebulaTheme(<RecordingDialog recording={recording} onClose={onClose} />));
  return { onClose };
}

describe("recording", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
  });
  afterEach(cleanup);

  it("formats the elapsed clock the way Standard does", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(83.7)).toBe("01:23");
    expect(formatElapsed(3723)).toBe("01:02:03");
  });

  it("starts with Standard's template and no folder", () => {
    expect(loadTarget()).toEqual({ directory: "", filename: DEFAULT_FILENAME });
  });

  it("refuses to start until there is a folder to record into", () => {
    const recording = controls();
    show(recording);
    const startButton = screen.getByRole("button", { name: "Start Recording" }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Directory"), { target: { value: "/home/me/rec" } });
    expect(startButton.disabled).toBe(false);
  });

  it("starts into the chosen folder and remembers it for next time", async () => {
    const recording = controls();
    show(recording);
    fireEvent.change(screen.getByLabelText("Directory"), { target: { value: " /home/me/rec " } });
    fireEvent.click(screen.getByRole("button", { name: "Start Recording" }));
    await waitFor(() =>
      expect(recording.start).toHaveBeenCalledWith({ directory: "/home/me/rec", filename: DEFAULT_FILENAME }),
    );
    expect(loadTarget().directory).toBe("/home/me/rec");
  });

  it("shows where it is recording and for how long, and stops", async () => {
    const recording = controls({
      state: { is_recording: true, file_path: "/home/me/rec/a.wav", elapsed_secs: 65 },
    });
    show(recording);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("/home/me/rec/a.wav");
    expect(status.textContent).toContain("01:05");
    expect((screen.getByLabelText("Directory") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Stop Recording" }));
    await waitFor(() => expect(recording.stop).toHaveBeenCalled());
  });

  it("says why the backend refused", async () => {
    const recording = controls({ start: vi.fn(async () => Promise.reject(new Error("directory does not exist"))) });
    show(recording);
    fireEvent.change(screen.getByLabelText("Directory"), { target: { value: "/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Recording" }));
    expect((await screen.findByRole("alert")).textContent).toBe("directory does not exist");
  });

  it("asks the backend once when enabled and polls only while recording", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation(async (cmd) =>
        cmd === "get_recording_state" ? { is_recording: true, file_path: "/r.wav", elapsed_secs: 3 } : null,
      );
      const { result } = renderHook(() => useRecording(true));
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.state.is_recording).toBe(true);
      const asked = invokeMock.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(invokeMock.mock.calls.length).toBeGreaterThan(asked);

      invokeMock.mockImplementation(async () => "/r.wav");
      await act(async () => {
        await result.current.stop();
      });
      const afterStop = invokeMock.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(invokeMock.mock.calls.length).toBe(afterStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks nothing while the feature is unavailable", () => {
    renderHook(() => useRecording(false));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
