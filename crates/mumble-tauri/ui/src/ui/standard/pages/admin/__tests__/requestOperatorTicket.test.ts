/**
 * `requestOperatorTicket` is a Tauri command paired with an event, not a
 * request/reply call: the reply can only ever arrive as an `operator-ticket`
 * event, so the promise has to subscribe before it sends, or a fast answer
 * would arrive with nobody listening.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = ((event: { payload: { ticket: unknown } }) => void) | null;

// `vi.mock` factories are hoisted above the rest of the module, so anything
// they close over has to be created through `vi.hoisted` rather than a plain
// top-level `const`.
const { order, invokeMock, listenMock, getEventHandler } = vi.hoisted(() => {
  const order: string[] = [];
  let eventHandler: EventHandler = null;
  const invokeMock = vi.fn(async () => {
    order.push("invoke");
  });
  const listenMock = vi.fn(async (_event: string, handler: EventHandler) => {
    order.push("listen");
    eventHandler = handler;
    return () => {
      eventHandler = null;
    };
  });
  return { order, invokeMock, listenMock, getEventHandler: () => eventHandler };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { requestOperatorTicket } from "../liveryAdmin";

beforeEach(() => {
  order.length = 0;
  invokeMock.mockClear();
  listenMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requestOperatorTicket", () => {
  it("subscribes before it sends the request", async () => {
    const pending = requestOperatorTicket(["server-config:write"]);
    // The command only resolves the subscription setup, not the ticket, so
    // this settles once `listen` has run and `invoke` has been dispatched.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["listen", "invoke"]);
    expect(invokeMock).toHaveBeenCalledWith("request_operator_ticket", {
      scopes: ["server-config:write"],
    });

    getEventHandler()?.({ payload: { ticket: { token: "t", grantedScopes: [], expiresAtMs: 0, baseUrl: "" } } });
    await expect(pending).resolves.toEqual({
      token: "t",
      grantedScopes: [],
      expiresAtMs: 0,
      baseUrl: "",
    });
  });

  it("resolves with whatever the server granted, denial included", async () => {
    const pending = requestOperatorTicket(["moderation:write"]);
    await Promise.resolve();
    await Promise.resolve();
    getEventHandler()?.({
      payload: {
        ticket: {
          token: "",
          grantedScopes: [],
          expiresAtMs: 0,
          baseUrl: "",
          deniedReason: "no requested scope is covered by a permission this session holds",
        },
      },
    });
    const ticket = await pending;
    expect(ticket.token).toBe("");
    expect(ticket.deniedReason).toContain("permission");
  });

  it("rejects if the request itself could not be sent", async () => {
    invokeMock.mockRejectedValueOnce(new Error("not connected"));
    await expect(requestOperatorTicket(["server-config:write"])).rejects.toThrow("not connected");
  });

  it("times out rather than hanging forever when nothing answers", async () => {
    vi.useFakeTimers();
    const pending = requestOperatorTicket(["server-config:write"]);
    const assertion = expect(pending).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });
});
