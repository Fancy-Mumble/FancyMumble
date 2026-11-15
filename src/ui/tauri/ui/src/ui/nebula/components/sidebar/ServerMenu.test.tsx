import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedServer } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import type { ServerRailEntry, ServerRailStatus } from "../../selectors";
import { ServerMenu } from "./ServerMenu";

const identity = (username: string): SavedServer => ({
  id: "id-" + username,
  label: "magical.rocks",
  host: "magical.rocks",
  port: 64738,
  username,
  cert_label: null,
});

const entry = (
  status: ServerRailStatus,
  identities: SavedServer[] = [identity("mira")],
  favorite = false,
): ServerRailEntry => ({
  group: {
    key: "magical.rocks:64738",
    label: "magical.rocks",
    host: "magical.rocks",
    port: 64738,
    identities,
    favorite,
    sessionId: status === "saved" ? null : "s-1",
  },
  session:
    status === "saved"
      ? null
      : { id: "s-1", host: "magical.rocks", port: 64738, username: "mira", status: "connected" },
  status,
  unread: 0,
});

function open(target: Partial<Parameters<typeof ServerMenu>[0]["target"]> & { entry: ServerRailEntry }) {
  const handlers = {
    onOpen: vi.fn(),
    onToggleFavorite: vi.fn(),
    onEdit: vi.fn(),
    onDisconnect: vi.fn(),
    onForget: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    withNebulaTheme(<ServerMenu target={{ active: false, x: 10, y: 10, ...target }} {...handlers} />),
  );
  return handlers;
}

afterEach(cleanup);

describe("ServerMenu", () => {
  it("offers a way in to a saved server and none to the one already open", () => {
    const { onOpen, onClose } = open({ entry: entry("saved") });
    fireEvent.click(screen.getByText("Connect to magical.rocks"));
    expect(onOpen).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    cleanup();
    open({ entry: entry("connected"), active: true });
    expect(screen.queryByText(/magical.rocks$/)).toBeNull();
  });

  it("switches rather than connects when a session is already open", () => {
    open({ entry: entry("connected") });
    expect(screen.getByText("Switch to magical.rocks")).toBeTruthy();
  });

  it("copies the address as host:port", () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    open({ entry: entry("saved") });
    fireEvent.click(screen.getByText("Copy address"));
    expect(writeText).toHaveBeenCalledWith("magical.rocks:64738");
  });

  it("stars and unstars the whole server", () => {
    const { onToggleFavorite } = open({ entry: entry("saved", [identity("mira")], true) });
    fireEvent.click(screen.getByText("Remove from favourites"));
    expect(onToggleFavorite.mock.calls[0][0].key).toBe("magical.rocks:64738");
  });

  it("edits the saved details only while there is one identity to edit", () => {
    const { onEdit } = open({ entry: entry("saved") });
    fireEvent.click(screen.getByText("Edit server"));
    expect(onEdit.mock.calls[0][0].username).toBe("mira");
    cleanup();
    open({ entry: entry("saved", [identity("mira"), identity("nox")]) });
    expect(screen.queryByText("Edit server")).toBeNull();
  });

  it("leaves the session and forgets the server from the same group", () => {
    const { onDisconnect, onForget } = open({ entry: entry("connected") });
    fireEvent.click(screen.getByText("Disconnect from this server"));
    expect(onDisconnect.mock.calls[0][0].group.host).toBe("magical.rocks");
    fireEvent.click(screen.getByText("Remove server"));
    expect(onForget.mock.calls[0][0].identities).toHaveLength(1);
  });

  it("has nothing to disconnect or forget on an address typed straight in", () => {
    // Connected without ever being saved: a tile with a session but no record.
    open({ entry: entry("saved", []) });
    expect(screen.queryByText("Disconnect from this server")).toBeNull();
    expect(screen.queryByText("Remove server")).toBeNull();
    expect(screen.queryByText(/favourites/)).toBeNull();
  });
});
