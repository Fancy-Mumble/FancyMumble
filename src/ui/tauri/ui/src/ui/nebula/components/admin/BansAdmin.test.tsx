/**
 * The ban editor's masks, as the administrator types them and as they go out.
 *
 * The bug: the editor sent the mask as the administrator thinks of it, so a
 * ban on one IPv4 address (/32) went out as 32 over the sixteen bytes every
 * address travels in, which is a ban on every IPv4 address there is. And a
 * refused list went on looking saved.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WireBanEntry } from "@core/types";

const invoked: { cmd: string; args: Record<string, unknown> | undefined }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    return Promise.resolve(undefined);
  },
}));

const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import { withNebulaTheme } from "../../testTheme";
import { BansAdmin } from "./BansAdmin";

function emit(event: string, payload: unknown) {
  act(() => listeners.get(event)?.({ payload }));
}

function wireBan(overrides: Partial<WireBanEntry>): WireBanEntry {
  return { address: "", mask: 128, name: "", hash: "", reason: "", start: "", duration: 0, ...overrides };
}

/** The bans the last `update_ban_list` carried. */
function sentBans(): WireBanEntry[] {
  const sent = invoked.filter((call) => call.cmd === "update_ban_list").at(-1);
  return (sent?.args?.bans ?? []) as WireBanEntry[];
}

async function openEditor() {
  render(withNebulaTheme(<BansAdmin />));
  await waitFor(() => expect(invoked.some((call) => call.cmd === "request_ban_list")).toBe(true));
}

beforeEach(() => {
  invoked.length = 0;
  listeners.clear();
});

describe("BansAdmin masks", () => {
  it("sends a /32 typed for an IPv4 address as 128 on the wire", async () => {
    await openEditor();
    emit("ban-list", []);
    fireEvent.click(screen.getByRole("button", { name: /add entry/i }));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "203.0.113.7" } });
    fireEvent.change(screen.getByLabelText("Mask"), { target: { value: "32" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(sentBans()).toHaveLength(1));
    expect(sentBans()[0]).toMatchObject({ address: "203.0.113.7", mask: 128 });
  });

  it("starts a new IPv4 ban on the one address typed, not on all of IPv4", async () => {
    await openEditor();
    emit("ban-list", []);
    fireEvent.click(screen.getByRole("button", { name: /add entry/i }));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "203.0.113.7" } });
    expect((screen.getByLabelText("Mask") as HTMLInputElement).value).toBe("32");
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(sentBans()).toHaveLength(1));
    expect(sentBans()[0].mask).toBe(128);
  });

  it("shows a list read back in the address's own terms", async () => {
    await openEditor();
    emit("ban-list", [
      wireBan({ address: "203.0.113.7", mask: 128, name: "one" }),
      wireBan({ address: "198.51.100.0", mask: 120, name: "net" }),
      wireBan({ address: "2001:db8:0:0:0:0:0:0", mask: 48, name: "six" }),
    ]);

    expect(screen.getByText("203.0.113.7/32")).toBeTruthy();
    expect(screen.getByText("198.51.100.0/24")).toBeTruthy();
    expect(screen.getByText("2001:db8:0:0:0:0:0:0/48")).toBeTruthy();
    fireEvent.click(screen.getByText("one"));
    expect((screen.getByLabelText("Mask") as HTMLInputElement).value).toBe("32");
  });

  it("sends an untouched list back exactly as it came", async () => {
    await openEditor();
    const held = [
      wireBan({ address: "203.0.113.7", mask: 128, name: "one" }),
      wireBan({ address: "2001:db8:0:0:0:0:0:0", mask: 48, name: "six" }),
    ];
    emit("ban-list", held);
    fireEvent.click(screen.getByText("one"));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "spam" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(sentBans()).toHaveLength(2));
    expect(sentBans()).toEqual([{ ...held[0], reason: "spam" }, held[1]]);
  });

  it("says when the server refuses the list, and shows the server's list again", async () => {
    await openEditor();
    emit("ban-list", [wireBan({ address: "203.0.113.7", mask: 128, name: "kept" })]);
    fireEvent.click(screen.getByRole("button", { name: /add entry/i }));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "198.51.100.9" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(sentBans()).toHaveLength(2));

    emit("permission-denied", { deny_type: 0, reason: "That ban would cover everybody." });
    emit("ban-list", [wireBan({ address: "203.0.113.7", mask: 128, name: "kept" })]);

    expect(screen.getByRole("alert").textContent).toContain("That ban would cover everybody.");
    expect(screen.queryByText("198.51.100.9/32")).toBeNull();
    expect(screen.getByText("203.0.113.7/32")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
  });

  it("does not blame the list for a refusal that arrived while nothing was being saved", async () => {
    await openEditor();
    emit("ban-list", []);
    emit("permission-denied", { deny_type: 0, reason: "Something else entirely." });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
