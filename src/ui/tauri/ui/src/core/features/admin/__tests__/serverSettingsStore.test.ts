/**
 * Server-settings store behaviour, and the epoch-1 gap it exists to close.
 *
 * An epoch-0 server broadcasts the schema after ServerSync, so the cache is
 * already full when the admin screen opens. Starling answers a query instead -
 * so `load` has to ask, and has to wait for the answer rather than reporting
 * "this server may not support runtime settings" over a question in flight.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

import { ANSWER_TIMEOUT_MS, useServerSettingsStore } from "../serverSettingsStore";
import type { ServerSetting, ServerSettingsSnapshot } from "../../../types";

function setting(over: Partial<ServerSetting> = {}): ServerSetting {
  return {
    key: "welcome_text",
    type: "text",
    group: "General",
    label: "Welcome text",
    value: "hello",
    options: [],
    secret: false,
    ...over,
  };
}

const snapshot: ServerSettingsSnapshot = { revision: 3, settings: [setting()] };

/** Which commands were sent, in order. */
function sent(): string[] {
  return invokeMock.mock.calls.map(([cmd]) => cmd);
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  useServerSettingsStore.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("load", () => {
  it("uses the cached broadcast without asking again", async () => {
    // An epoch-0 server has already told us; a query would be a second answer
    // to a question nobody asked.
    invokeMock.mockImplementation(async (cmd) => (cmd === "get_server_settings" ? snapshot : undefined));

    await useServerSettingsStore.getState().load();

    expect(useServerSettingsStore.getState().snapshot).toEqual(snapshot);
    expect(sent()).toEqual(["get_server_settings"]);
  });

  it("asks the server when nothing has been broadcast", async () => {
    // The whole epoch-1 fix: with no query, the cache stays empty for ever and
    // the screen reports a server that has settings as one that has none.
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "request_server_settings") {
        // The reply arrives on the `server-settings` event, which the screen
        // listens for and feeds back in through `setSnapshot`.
        useServerSettingsStore.getState().setSnapshot(snapshot);
      }
      return undefined;
    });

    await useServerSettingsStore.getState().load();

    expect(sent()).toEqual(["get_server_settings", "request_server_settings"]);
    expect(useServerSettingsStore.getState().snapshot).toEqual(snapshot);
  });

  it("waits for an answer that arrives after the query resolves", async () => {
    // `request_server_settings` resolves once the frame is queued, so the
    // answer is always later than the call. Reporting "unavailable" at that
    // point would be reporting on a question still in flight.
    vi.useFakeTimers();
    const loading = useServerSettingsStore.getState().load();
    await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS - 1);
    expect(sent()).toEqual(["get_server_settings", "request_server_settings"]);

    useServerSettingsStore.getState().setSnapshot(snapshot);
    await loading;
    expect(useServerSettingsStore.getState().snapshot).toEqual(snapshot);
  });
});

describe("save", () => {
  it("sends only what changed, and keeps the snapshot until the server restates it", async () => {
    // The server re-broadcasts the stamped snapshot; adopting the edit locally
    // would show a value the server may have refused.
    useServerSettingsStore.getState().setSnapshot(snapshot);
    const changed = [setting({ value: "cozy corner" })];

    await useServerSettingsStore.getState().save(changed);

    expect(invokeMock).toHaveBeenCalledWith("save_server_settings", { changed });
    expect(useServerSettingsStore.getState().snapshot).toEqual(snapshot);
    expect(useServerSettingsStore.getState().busy).toBe(false);
  });

  it("reports a refusal rather than swallowing it", async () => {
    invokeMock.mockRejectedValue("not permitted");

    await expect(useServerSettingsStore.getState().save([setting()])).rejects.toBe("not permitted");
    expect(useServerSettingsStore.getState().busy).toBe(false);
    expect(useServerSettingsStore.getState().error).toBe("not permitted");
  });
});
