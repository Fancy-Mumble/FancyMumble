import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
type Handler = (e: { payload: { received: number; total: number | null } }) => void;
const handlers: Handler[] = [];
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, handler: Handler) => {
    handlers.push(handler);
    return unlisten;
  }),
}));

const { useSignalBridgeAddon } = await import("./signalBridgeAddon");

const missing = { installed: false, source: null, downloadable: true, version: "0.1.0" };
const installed = { installed: true, source: "addon", downloadable: true, version: "0.1.0" };

describe("signal bridge add-on store", () => {
  beforeEach(() => {
    invoke.mockReset();
    unlisten.mockReset();
    handlers.length = 0;
    useSignalBridgeAddon.setState({
      status: null,
      installing: false,
      progress: null,
      error: null,
      prompted: false,
    });
  });

  it("reads the status from the host", async () => {
    invoke.mockResolvedValueOnce(missing);
    await useSignalBridgeAddon.getState().refresh();
    expect(invoke).toHaveBeenCalledWith("signal_bridge_status");
    expect(useSignalBridgeAddon.getState().status).toEqual(missing);
  });

  it("reports progress while installing and the new status after", async () => {
    let finish: (v: unknown) => void = () => undefined;
    invoke.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const done = useSignalBridgeAddon.getState().install();
    await vi.waitFor(() => expect(handlers).toHaveLength(1));

    handlers[0]({ payload: { received: 512, total: 1024 } });
    expect(useSignalBridgeAddon.getState()).toMatchObject({ installing: true, progress: 50 });

    finish(installed);
    expect(await done).toBe(true);
    expect(useSignalBridgeAddon.getState()).toMatchObject({
      installing: false,
      progress: null,
      status: installed,
    });
    expect(unlisten).toHaveBeenCalled();
  });

  it("keeps the error when the install fails", async () => {
    invoke.mockRejectedValueOnce("the signal bridge download failed verification");
    expect(await useSignalBridgeAddon.getState().install()).toBe(false);
    expect(useSignalBridgeAddon.getState()).toMatchObject({
      installing: false,
      error: "the signal bridge download failed verification",
    });
    expect(unlisten).toHaveBeenCalled();
  });

  it("does not start a second install while one runs", async () => {
    useSignalBridgeAddon.setState({ installing: true });
    expect(await useSignalBridgeAddon.getState().install()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
