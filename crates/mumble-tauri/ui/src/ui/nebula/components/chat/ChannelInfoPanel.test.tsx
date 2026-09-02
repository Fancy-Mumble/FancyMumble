import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import type { ChannelEntry } from "@core/types";
import { PERM_DELETE_MESSAGE, PERM_KEY_OWNER, PERM_WRITE } from "@core/utils/permissions";
import { withNebulaTheme } from "../../testTheme";
import { ChannelInfoPanel } from "./ChannelInfoPanel";

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const description = vi.hoisted(() => ({ text: null as string | null }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

// The description and the avatars are lazily fetched blobs with no backend
// here; the panel's job is what it does with them, not how they arrive.
vi.mock("@core/lazyBlobs", () => ({
  useChannelDescription: () => description.text,
  useUserAvatar: () => null,
}));

// Mutable, because the developer-mode sections are the panel's other half and
// a fixed "normal" would make them untestable.
const prefs = vi.hoisted(() => ({ userMode: "normal" }));
vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () => Promise.resolve({ userMode: prefs.userMode }),
}));

// Tiptap has its own tests; what this file is about is that the edit reaches
// `update_channel`, so the editor stands in as the plain field it wraps.
vi.mock("../primitives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../primitives")>()),
  RichTextField: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (html: string) => void;
    ariaLabel: string;
  }) => <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />,
}));

const channel = (partial: Partial<ChannelEntry> = {}) =>
  ({
    id: 3,
    parent_id: 0,
    name: "Gaming",
    description_size: null,
    user_count: 2,
    permissions: PERM_WRITE,
    temporary: false,
    position: 0,
    max_users: 0,
    ...partial,
  }) as unknown as ChannelEntry;

const user = (session: number, name: string, hash?: string) =>
  ({ session, name, channel_id: 3, texture_size: null, hash }) as unknown as never;

function show(state: Record<string, unknown> = {}) {
  useAppStore.setState({ channels: [channel()], users: [], keyHolders: {}, ...state } as never);
  const onClose = vi.fn();
  render(withNebulaTheme(<ChannelInfoPanel channelId={3} onClose={onClose} />));
  return { onClose };
}

describe("ChannelInfoPanel", () => {
  beforeEach(() => {
    invoke.mockClear();
    description.text = null;
    prefs.userMode = "normal";
    useAppStore.setState({ channels: [], users: [], keyHolders: {}, messages: [] } as never);
  });
  afterEach(cleanup);

  it("names the channel and counts who belongs to it", () => {
    show({ users: [user(7, "ZewiWin"), user(9, "Lorelando")] });
    expect(screen.getByText("Gaming")).toBeTruthy();
    expect(screen.getByText("2 in voice")).toBeTruthy();
    expect(screen.getByText("2 members")).toBeTruthy();
    expect(screen.getByText("2 online · 0 offline")).toBeTruthy();
  });

  it("lays the room out in the cards the mock draws it in", () => {
    show({ users: [user(7, "ZewiWin")] });
    // "Members" twice by design: the card, and the count inside Activity.
    for (const card of ["Description", "Channel", "Activity", "Members"]) {
      expect(screen.getAllByText(card).length).toBeGreaterThan(0);
    }
    // The facts the header has no room for, which is what the cards are for.
    expect(factValue("Channel ID")).toBe("3");
    expect(factValue("Max users")).toBe("Unlimited");
    expect(factValue("In voice")).toBe("1");
  });

  it("reads the description, which the pack had nowhere else to read", () => {
    description.text = "<p>Where the <b>raids</b> happen</p>";
    show();
    expect(screen.getByText(/Where the/)).toBeTruthy();
    expect(screen.queryByText("No description")).toBeNull();
  });

  it("says so plainly when there is none", () => {
    show();
    expect(screen.getByText("No description")).toBeTruthy();
  });

  it("sends only what was changed to update_channel", async () => {
    description.text = "<p>Old</p>";
    show();
    fireEvent.click(screen.getByRole("button", { name: "Edit channel" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Gaming II" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The description is null because it was left alone: sending it back would
    // rewrite the server's copy with whatever this client had fetched.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("update_channel", {
        channelId: 3,
        name: "Gaming II",
        description: null,
      }),
    );
  });

  it("writes an edited description too", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Edit channel" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "New rules" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("update_channel", {
        channelId: 3,
        name: null,
        description: "New rules",
      }),
    );
  });

  it("asks the server for nothing when nothing moved", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Edit channel" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit channel" })).toBeTruthy());
    expect(invoke).not.toHaveBeenCalledWith("update_channel", expect.anything());
  });

  it("offers no edit where the server has not granted Write", () => {
    show({ channels: [channel({ permissions: PERM_DELETE_MESSAGE })] });
    expect(screen.queryByRole("button", { name: "Edit channel" })).toBeNull();
  });

  it("names the members who belong but are elsewhere, which only this surface does", async () => {
    // A persisted channel's absent members are its key holders; the header can
    // only count them, and the roster lists nobody who is not standing here.
    useAppStore.setState({
      channels: [channel({ pchat_protocol: "signal_v1" })],
      users: [user(7, "ZewiWin", "aaa")],
      keyHolders: {
        3: [
          { cert_hash: "aaa", name: "ZewiWin", is_online: true },
          { cert_hash: "bbb", name: "Nasrin", is_online: false },
        ],
      },
    } as never);
    render(withNebulaTheme(<ChannelInfoPanel channelId={3} onClose={vi.fn()} />));

    expect(screen.getByText("1 online · 1 offline")).toBeTruthy();
    expect(screen.getByText("Nasrin")).toBeTruthy();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("query_key_holders", { channelId: 3 }));
  });

  it("marks who can read the history, and who is on a client that cannot", () => {
    useAppStore.setState({
      channels: [channel({ pchat_protocol: "signal_v1" })],
      users: [user(7, "ZewiWin", "aaa"), user(9, "Lorelando", "ccc")],
      keyHolders: { 3: [{ cert_hash: "aaa", name: "ZewiWin", is_online: true }] },
    } as never);
    render(withNebulaTheme(<ChannelInfoPanel channelId={3} onClose={vi.fn()} />));

    const holder = screen.getByText("ZewiWin").closest("li")!;
    expect(within(holder).getByLabelText("Has encryption key")).toBeTruthy();
    const legacy = screen.getByText("Lorelando").closest("li")!;
    expect(within(legacy).getByLabelText("Legacy client - cannot read encrypted messages")).toBeTruthy();
  });

  it("says nothing about keys on a channel that keeps no history", () => {
    show({ users: [user(7, "ZewiWin", "aaa")] });
    expect(screen.queryByLabelText("Has encryption key")).toBeNull();
    expect(screen.queryByLabelText("Legacy client - cannot read encrypted messages")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("query_key_holders", expect.anything());
  });

  it("offers the key takeover only to a key owner of a channel that keeps history", async () => {
    show({ channels: [channel({ permissions: PERM_WRITE | PERM_KEY_OWNER })] });
    expect(screen.queryByRole("button", { name: /Reset Key Ownership/ })).toBeNull();
    cleanup();

    useAppStore.setState({
      channels: [channel({ permissions: PERM_WRITE | PERM_KEY_OWNER, pchat_protocol: "signal_v1" })],
      users: [],
      keyHolders: {},
    } as never);
    render(withNebulaTheme(<ChannelInfoPanel channelId={3} onClose={vi.fn()} />));

    fireEvent.click(screen.getByRole("button", { name: /Reset Key Ownership/ }));
    fireEvent.click(screen.getByText("Key only"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("key_takeover", { channelId: 3, mode: "key_only" }),
    );
  });

  it("closes", () => {
    const { onClose } = show();
    fireEvent.click(screen.getByLabelText("Close channel info"));
    expect(onClose).toHaveBeenCalled();
  });

  it("names the permissions the server granted, and the ones it withheld", async () => {
    prefs.userMode = "developer";
    show({ channels: [channel({ permissions: PERM_WRITE | PERM_DELETE_MESSAGE })] });

    await waitFor(() => expect(screen.getByText("Permissions")).toBeTruthy());
    expect(screen.getByText("Developer mode")).toBeTruthy();
    expect(factValue("Raw")).toBe("0x00001001");
    // Two of the channel bits are set, and the rest are named as withheld
    // rather than left to be inferred from the mask.
    expect(screen.getByText("Granted — 2")).toBeTruthy();
    expect(screen.getByText("Withheld — 15")).toBeTruthy();
  });

  it("keeps the offload readout out of the way outside developer mode", async () => {
    show({ messages: [heavyMessage("m1"), coldMessage("m2", 200_000)] });

    await waitFor(() => expect(screen.getByText("No description")).toBeTruthy());
    expect(screen.queryByText("Offload queue")).toBeNull();
  });

  it("counts what cold storage is holding for this channel", async () => {
    prefs.userMode = "developer";
    show({
      selectedChannel: 3,
      messages: [
        heavyMessage("m1"),
        coldMessage("m2", 200_000),
        // Another room's message, in the same store list: the panel opens on a
        // channel picked from the tree, so what is loaded may not be its own.
        { ...coldMessage("m3", 999_000), channel_id: 4 },
      ],
    });

    await waitFor(() => expect(screen.getByText("Offload queue")).toBeTruthy());
    // Two of this channel's three bodies are heavy - one still inline, one put
    // away - and the third channel's picture is none of its business.
    expect(factValue("heavy bodies")).toBe("2");
    expect(factValue("in cold storage")).toBe("1");
    expect(factValue("heap freed")).toBe("195 KiB");
    expect(factValue("still inline")).not.toBe("0 B");
  });

  it("says so when the channel it describes is not the one that is loaded", async () => {
    prefs.userMode = "developer";
    show({ selectedChannel: 4, messages: [{ ...coldMessage("m9", 1000), channel_id: 4 }] });

    await waitFor(() => expect(screen.getByText("Offload queue")).toBeTruthy());
    expect(screen.getByText("Open this channel to see what it is holding.")).toBeTruthy();
  });

  it("reads an open channel as loaded even when nobody has said anything in it", async () => {
    // The readout used to key off "are there any messages", so standing in an
    // empty room told you to go and open the room you were already in.
    prefs.userMode = "developer";
    show({ selectedChannel: 3, messages: [] });

    await waitFor(() => expect(screen.getByText("Offload queue")).toBeTruthy());
    expect(screen.queryByText("Open this channel to see what it is holding.")).toBeNull();
    expect(factValue("heavy bodies")).toBe("0");
    expect(factValue("Messages today")).toBe("0");
  });

  describe("the room's own look", () => {
    it("draws the icon and banner it carries, and shows only the text", () => {
      description.text =
        `<!--FANCYCHAN:{"v":1,"icon":"data:image/png;base64,ICON",` +
        `"banner":{"image":"data:image/png;base64,BANNER"}}-->` +
        `<p>Where the raids happen</p>`;
      show();

      expect(screen.getByText(/Where the raids happen/)).toBeTruthy();
      // The marker is machinery, not prose: it must never reach the reader.
      expect(screen.queryByText(/FANCYCHAN/)).toBeNull();
      const icon = screen.getByRole("document").querySelector('img[src*="ICON"]');
      expect(icon).toBeTruthy();
    });

    it("offers the pickers to an editor, and puts what they set back in the description", async () => {
      description.text = "<p>Old</p>";
      show();
      fireEvent.click(screen.getByRole("button", { name: "Edit channel" }));

      expect(screen.getByRole("button", { name: "Icon" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Banner" })).toBeTruthy();

      // Editing the text alone still writes a plain description: a room with
      // no icon and no banner should not start carrying an empty marker.
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "New rules" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("update_channel", {
          channelId: 3,
          name: null,
          description: "New rules",
        }),
      );
    });

    it("keeps the appearance when only the text is edited", async () => {
      description.text = `<!--FANCYCHAN:{"v":1,"icon":"data:image/png;base64,ICON"}-->` + `<p>Old</p>`;
      show();
      fireEvent.click(screen.getByRole("button", { name: "Edit channel" }));
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "New rules" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("update_channel", {
          channelId: 3,
          name: null,
          description: `<!--FANCYCHAN:{"v":1,"icon":"data:image/png;base64,ICON"}-->\nNew rules`,
        }),
      );
    });

    it("drops the marker entirely when the last picture is cleared", async () => {
      description.text = `<!--FANCYCHAN:{"v":1,"icon":"data:image/png;base64,ICON"}-->` + `<p>Old</p>`;
      show();
      fireEvent.click(screen.getByRole("button", { name: "Edit channel" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove Icon" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("update_channel", {
          channelId: 3,
          name: null,
          description: "<p>Old</p>",
        }),
      );
    });
  });
});

/** A body big enough, and inline enough, to be worth putting away. */
function heavyMessage(id: string) {
  return {
    message_id: id,
    channel_id: 3,
    sender_session: 7,
    sender_name: "Lorelando",
    body: `<img src="data:image/png;base64,${"A".repeat(5000)}">`,
    is_own: false,
    timestamp: 1_700_000_000_000,
  };
}

/** One that has already been put away, with the size it ran to. */
function coldMessage(id: string, bytes: number) {
  return { ...heavyMessage(id), message_id: id, body: `<!-- OFFLOADED:${id}:${bytes} -->` };
}

/** The value beside a label in a `Facts` grid. */
function factValue(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}
