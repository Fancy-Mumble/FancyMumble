import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { openDmPopout } = await import("./dmPopout");

const partner = { session: 7, name: "ZewiWin", hash: "abc123" };
const server = { id: "sess-1", label: "magical.rocks", host: "voice.magical.rocks" };

describe("openDmPopout", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("names the person and the server the conversation belongs to", async () => {
    await openDmPopout(partner, server);
    expect(invoke).toHaveBeenCalledWith("open_dm_popout", {
      payload: {
        server_id: "sess-1",
        server_label: "magical.rocks",
        user_session: 7,
        user_name: "ZewiWin",
        user_hash: "abc123",
      },
    });
  });

  it("falls back to the host when the server carries no label", async () => {
    await openDmPopout(partner, { id: "sess-1", host: "voice.magical.rocks" });
    expect(invoke.mock.calls[0][1].payload.server_label).toBe("voice.magical.rocks");
  });

  it("sends a null hash rather than dropping the field", async () => {
    // The popout keys on the certificate hash to survive a reconnect, so the
    // field has to be present and explicitly empty when there is none.
    await openDmPopout({ session: 7, name: "guest" }, server);
    expect(invoke.mock.calls[0][1].payload).toHaveProperty("user_hash", null);
  });

  it("still asks with an empty server id when there is no session", async () => {
    await openDmPopout(partner, null);
    expect(invoke.mock.calls[0][1].payload.server_id).toBe("");
  });

  it("logs a refusal rather than rejecting into the caller", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockRejectedValue(new Error("no window"));
    await expect(openDmPopout(partner, server)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
