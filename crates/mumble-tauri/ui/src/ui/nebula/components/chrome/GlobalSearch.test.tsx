import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelEntry, SearchResult, UserEntry } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { GlobalSearch } from "./GlobalSearch";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null }));

const channel = (id: number, name: string, user_count = 0) =>
  ({
    id,
    parent_id: id === 0 ? null : 0,
    name,
    description_size: null,
    user_count,
    permissions: null,
    temporary: false,
    position: 0,
    max_users: 0,
  }) as ChannelEntry;

const user = (session: number, name: string, channel_id = 1) =>
  ({ session, name, channel_id, texture_size: null }) as UserEntry;

const messageHit = (): SearchResult => ({
  category: "message",
  score: 0,
  title: "queue is up - who's <b>game</b> for ranked?",
  subtitle: "enot in #Gaming",
  id: 1,
  string_id: "m-1",
  message: {
    sender_session: 8,
    sender_name: "enot",
    context: "in #Gaming",
    timestamp: 1_787_403_060_000,
    dm: false,
  },
});

function open(props: Partial<React.ComponentProps<typeof GlobalSearch>> = {}) {
  const handlers = { onClose: vi.fn(), onSelect: vi.fn() };
  render(
    withNebulaTheme(
      <GlobalSearch
        open
        channels={[channel(0, "Root"), channel(1, "Gaming", 3)]}
        users={[user(7, "ZewiWin"), user(8, "enot")]}
        sessions={[{ id: "sess", host: "magical.rocks", port: 64738, username: "ZewiWin" }]}
        ownSession={7}
        serverLabel="magical.rocks"
        {...handlers}
        {...props}
      />,
    ),
  );
  return { ...handlers, field: screen.getByLabelText("Search channels, people and messages") };
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
  });

  it("offers somewhere to go before anything is typed", () => {
    open();
    expect(screen.getByText("Channels")).toBeTruthy();
    expect(screen.getByText("Gaming")).toBeTruthy();
    expect(screen.getByText("3 people here")).toBeTruthy();
    // Own session excluded: there is no conversation to have with yourself.
    expect(screen.queryByText("ZewiWin")).toBeNull();
  });

  it("counts what it is showing", () => {
    open();
    expect(screen.getByText("4 results")).toBeTruthy();
  });

  it("asks the backend once a burst of typing has settled", async () => {
    const { field } = open();
    fireEvent.change(field, { target: { value: "ga" } });
    fireEvent.change(field, { target: { value: "gam" } });
    fireEvent.change(field, { target: { value: "game" } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("super_search", { query: "game" });
  });

  it("draws a message as its sender, its place and its time", async () => {
    invokeMock.mockResolvedValue([messageHit()]);
    const { field } = open();
    fireEvent.change(field, { target: { value: "game" } });

    expect(await screen.findByText("Messages")).toBeTruthy();
    expect(screen.getByText("enot")).toBeTruthy();
    expect(screen.getByText("in #Gaming")).toBeTruthy();
    // The excerpt is the message's text, not the markup it was sent as.
    expect(screen.getByText(/queue is up/).textContent).toBe("queue is up - who's game for ranked?");
  });

  it("heads the best-matching group first", async () => {
    invokeMock.mockResolvedValue([{ ...messageHit(), title: "test", score: 0 }]);
    const { field } = open({ channels: [channel(1, "latest testing protocols")] });
    fireEvent.change(field, { target: { value: "test" } });

    await screen.findByText("Messages");
    const headings = screen
      .getAllByText(/^(Channels|People|Messages|Servers)$/)
      .map((node) => node.textContent);
    expect(headings[0]).toBe("Messages");
  });

  it("keeps the local matches when the backend cannot answer", async () => {
    invokeMock.mockRejectedValue(new Error("not connected"));
    const { field } = open();
    fireEvent.change(field, { target: { value: "Gaming" } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(screen.getByText("Gaming")).toBeTruthy();
  });

  it("opens the row the arrows have walked to", () => {
    const { onSelect, onClose, field } = open();
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "channel", id: 1 }));
    expect(onClose).toHaveBeenCalled();
  });

  it("wraps around rather than stopping at either end", () => {
    const { onSelect, field } = open();
    fireEvent.keyDown(field, { key: "ArrowUp" });
    fireEvent.keyDown(field, { key: "Enter" });
    // Four rows: up from the first lands on the last, which is the server.
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "server" }));
  });

  it("says so when nothing matches", async () => {
    const { field } = open();
    fireEvent.change(field, { target: { value: "nothing here" } });
    expect(await screen.findByText('Nothing matches "nothing here".')).toBeTruthy();
  });

  it("ignores an answer overtaken by a later one", async () => {
    // The first query's answer lands after the second's; taking it would leave
    // the panel showing results for a query that is no longer in the field.
    let settleFirst: (value: SearchResult[]) => void = () => undefined;
    invokeMock.mockImplementationOnce(
      () => new Promise<SearchResult[]>((resolve) => (settleFirst = resolve)),
    );
    invokeMock.mockResolvedValueOnce([]);

    const { field } = open();
    fireEvent.change(field, { target: { value: "game" } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    fireEvent.change(field, { target: { value: "Gaming" } });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));

    settleFirst([messageHit()]);
    await waitFor(() => expect(screen.getByText("Gaming")).toBeTruthy());
    expect(screen.queryByText("Messages")).toBeNull();
  });

  it("closes once on escape, and on the close control", () => {
    const { onClose, field } = open();
    // Once, not twice: the dialog and the field must not both answer it.
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Close search"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
