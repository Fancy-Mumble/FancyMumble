import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ServerPingResult } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { groupSavedServers, quickConnectTargets } from "../../selectors";
import { QuickConnect } from "./QuickConnect";

const saved = (
  id: string,
  host: string,
  username: string,
  extra: { favorite?: boolean; last_joined?: number } = {},
) =>
  ({
    id,
    label: host,
    host,
    port: 64738,
    username,
    cert_label: null,
    favorite: false,
    ...extra,
  }) as never;

const ping = (partial: Partial<ServerPingResult>): ServerPingResult => ({
  online: true,
  latency_ms: 20,
  user_count: null,
  max_user_count: null,
  server_version: null,
  ...partial,
});

function open(
  props: Partial<React.ComponentProps<typeof QuickConnect>> = {},
  servers = [saved("a", "voice.kumo.gg", "Sebi", { last_joined: 5000 }), saved("b", "localhost", "Sebi")],
  sessions: { id: string; host: string; port: number; username: string }[] = [],
) {
  const handlers = {
    onClose: vi.fn(),
    onConnect: vi.fn(),
    onAddByAddress: vi.fn(),
    onBrowsePublic: vi.fn(),
  };
  render(
    withNebulaTheme(
      <QuickConnect
        anchorEl={document.body}
        targets={quickConnectTargets(groupSavedServers(servers, sessions), sessions)}
        savedCount={servers.length}
        pings={new Map()}
        {...handlers}
        {...props}
      />,
    ),
  );
  return handlers;
}

describe("QuickConnect", () => {
  it("lists the servers that are not already open, most recent first", () => {
    open();
    const rows = screen.getAllByRole("menuitem").map((row) => row.textContent);
    expect(rows[0]).toContain("voice.kumo.gg");
    expect(rows[1]).toContain("localhost");
  });

  it("connects to the server whose row was chosen", () => {
    const { onConnect } = open();
    fireEvent.click(screen.getByText("localhost"));
    expect(onConnect.mock.calls[0][0].group.host).toBe("localhost");
  });

  it("reports occupancy for a server that answered the ping, and silence for one that did not", () => {
    open({
      pings: new Map([
        ["voice.kumo.gg:64738", ping({ user_count: 12, max_user_count: 50 })],
        ["localhost:64738", ping({ online: false })],
      ]),
    });
    expect(screen.getByText(/12\/50 online/)).toBeTruthy();
    expect(screen.getByText(/offline/)).toBeTruthy();
  });

  it("says which identity it will arrive as only when the address has a choice", () => {
    open({}, [
      saved("a", "magical.rocks", "Sebi", { last_joined: 9000 }),
      saved("b", "magical.rocks", "Zewi"),
      saved("c", "localhost", "Solo"),
    ]);
    expect(screen.getByText(/as Sebi/)).toBeTruthy();
    expect(screen.queryByText(/as Solo/)).toBeNull();
  });

  it("keeps offering a server you are already in, as the identity you are not", () => {
    const { onConnect } = open(
      {},
      [saved("a", "magical.rocks", "Sebi", { last_joined: 9000 }), saved("b", "magical.rocks", "ZewiWin")],
      [{ id: "sess", host: "magical.rocks", port: 64738, username: "Sebi" }],
    );
    expect(screen.getByText(/as ZewiWin/)).toBeTruthy();

    fireEvent.click(screen.getByText("magical.rocks"));
    expect(onConnect.mock.calls[0][0].identity.username).toBe("ZewiWin");
  });

  it("says nothing is saved rather than claiming everything is open", () => {
    open({ targets: [], savedCount: 0 });
    expect(screen.getByText("No servers saved yet.")).toBeTruthy();
  });

  it("still offers its two escape hatches when every saved login is open", () => {
    const { onAddByAddress, onBrowsePublic } = open({ targets: [], savedCount: 2 });
    expect(screen.getByText("Every saved login is already open.")).toBeTruthy();

    fireEvent.click(screen.getByText("Add server by address…"));
    expect(onAddByAddress).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Browse public servers"));
    expect(onBrowsePublic).toHaveBeenCalled();
  });

  it("stays shut until the button opens it", () => {
    open({ anchorEl: null });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
