/**
 * The `server-disconnected` listener, driven through the real
 * `initEventListeners` rather than a copy of its conditions.
 *
 * The neighbouring `ConnectRejectSurfacing` tests re-implement the listener's
 * predicates, which cannot catch a change to the listener itself. This one
 * registers the real handlers against a fake Tauri event bus and fires the
 * payload the backend actually emits when a session ends underneath the user:
 * a same-name eviction, or any dropped link, both of which reach the client as
 * nothing more than a closed socket.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const handlers = new Map<string, (e: { payload: unknown }) => unknown>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: (e: { payload: unknown }) => unknown) => {
    handlers.set(event, handler);
    return Promise.resolve(() => undefined);
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "list_servers")
      return Promise.resolve([
        {
          id: "srv-1",
          host: "magical.rocks",
          port: 64738,
          username: "Sebi",
          label: "Sebi@magical.rocks:64738",
          status: "disconnected",
          certLabel: null,
        },
      ]);
    if (cmd === "get_active_server") return Promise.resolve("srv-1");
    if (cmd === "get_voice_state") return Promise.resolve("inactive");
    return Promise.resolve(null);
  }),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => Promise.resolve(false),
  requestPermission: () => Promise.resolve("denied"),
  sendNotification: () => undefined,
}));

import { useAppStore, initEventListeners } from "../../store";

/** A live session with a populated roster, as it is the moment before a drop. */
function connected() {
  useAppStore.setState({
    status: "connected",
    activeServerId: "srv-1",
    error: null,
    sessionErrors: {},
    channels: [{ id: 0, name: "Root" }] as never,
    users: [{ session: 1, name: "Sebi" }] as never,
    pendingConnect: { host: "magical.rocks", port: 64738, username: "Sebi", certLabel: null },
  });
}

beforeEach(() => {
  handlers.clear();
});

describe("a session that ends underneath the user", () => {
  it("leaves the store disconnected, emptied, and carrying the reason", async () => {
    await initEventListeners(() => undefined);
    connected();

    // What the backend emits for a bare socket close: the server said nothing,
    // so this generic reason is all there is. A kick names its own reason here
    // instead; either way the shape is the same.
    await handlers.get("server-disconnected")?.({
      payload: { serverId: "srv-1", reason: "Connection to server was lost." },
    });

    const state = useAppStore.getState();
    // Not connected, and said so: the half state this guards against was a
    // client that kept `status: "connected"` over an emptied roster.
    expect(state.status).toBe("disconnected");
    expect(state.error).toBe("Connection to server was lost.");
    // Recorded per session too, so the reason survives a tab switch.
    expect(state.sessionErrors["srv-1"]).toBe("Connection to server was lost.");
    // Nothing of the dead server is left to render.
    expect(state.channels).toEqual([]);
    expect(state.users).toEqual([]);
  });

  it("does not retry a session the server itself ended", async () => {
    await initEventListeners(() => undefined);
    connected();

    // A kick arrives as `connection-rejected` and then `server-disconnected`.
    // Reconnecting into it would evict whoever took our place, who would
    // reconnect and evict us: the loop this ordering exists to break.
    await handlers.get("connection-rejected")?.({
      payload: {
        serverId: "srv-1",
        reason: "You connected to the server from another device",
        reject_type: null,
      },
    });
    await handlers.get("server-disconnected")?.({
      payload: { serverId: "srv-1", reason: "You connected to the server from another device" },
    });

    const state = useAppStore.getState();
    expect(state.error).toBe("You connected to the server from another device");
    expect(state.reconnectScheduled).toBe(false);
    expect(state.connectionLostAt).toBeNull();
  });
});
