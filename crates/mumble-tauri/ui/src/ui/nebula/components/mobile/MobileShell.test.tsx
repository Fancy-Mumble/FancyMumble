/**
 * The handheld shell, in every skin the catalog draws.
 *
 * The first test in the pack that renders a component across all thirteen, and
 * it has to be: the reference the layout was drawn from is one skin, and every
 * mark in it is either a token or a `chrome: "stencil"` branch. What that buys
 * is only real if the other twelve actually come out in their own language,
 * and there is no way to know that from one theme's screenshot.
 *
 * The skin is handed to `createNebulaTheme` directly rather than stamped on
 * `<html>`. `data-theme` does nothing here: vitest processes no CSS, so
 * `readThemeVars` finds an empty cascade and `useNebulaAppearance` falls back
 * to `DEFAULT_SKIN` - a test written that way passes on the default skin while
 * appearing to cover thirteen.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@mui/material/styles";
import type { ReactNode } from "react";
import { createNebulaTheme, handheldChrome } from "../../theme";
import { NEBULA_THEMES } from "../../themeCatalog";
import { nebulaScheme } from "../../themeScheme";
import type { NebulaMode } from "../../tokens";
import type { MobileShellModel } from "../../shellModel";
import { MobileShell } from "./MobileShell";

vi.mock("@core/lazyBlobs", () => ({
  useUserAvatar: () => null,
  useChannelDescription: () => null,
  useUserComment: () => null,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null), convertFileSrc: (v: string) => v }));

/** The width every one of these has to fit inside. */
const SCREEN = 390;

const noop = () => {};

function channel(id: number, name: string) {
  return {
    id,
    parent_id: 0,
    name,
    description_size: null,
    user_count: 0,
    permissions: null,
    temporary: false,
  };
}

const CHANNELS = [channel(1, "Green is fucked"), channel(2, "general")];
const USERS = [
  { session: 1, name: "Sebi", channel_id: 1, texture_size: null },
  { session: 7, name: "ZewiLinux", channel_id: 1, texture_size: null },
];

const GROUP = {
  key: "magical.rocks:64738",
  label: "Magical Rocks",
  host: "magical.rocks",
  port: 64738,
  identities: [],
  favorite: true,
  sessionId: "s1",
};

function model(over: Partial<MobileShellModel> = {}): MobileShellModel {
  return {
    voice: {
      channelName: "Green is fucked",
      participants: USERS as never,
      ownSession: 1,
      micLive: false,
      deafened: false,
      onToggleMic: noop,
      onToggleDeafen: noop,
      onLeave: noop,
      elapsedLabel: "00:41",
    },
    serverStrip: {
      entries: [
        { group: GROUP, session: { label: "Magical Rocks" }, status: "connected", unread: 0 },
        { group: { ...GROUP, key: "b:1", label: "Aoba Base" }, session: null, status: "idle", unread: 7 },
      ] as never,
      activeKey: GROUP.key,
      onSelect: noop,
      onAddServer: noop,
    },
    channels: {
      channels: CHANNELS.map((entry) => ({ channel: entry as never, depth: 0 })),
      users: USERS as never,
      selectedChannel: 1,
      currentChannel: 1,
      unreadCounts: {},
      ownSession: 1,
      onSelect: noop,
      onJoin: noop,
      onContextMenu: noop,
      onSelectUser: noop,
      onHoverUser: noop,
      onLeaveUser: noop,
    },
    chatHeader: {
      title: "Green is fucked",
      subtitle: "2 in voice",
      memberCount: 2,
      canJoinVoice: false,
      onJoinVoice: noop,
      onToggleSearch: noop,
      onShowMembers: noop,
      onShareScreen: noop,
      onShowPinned: noop,
      onShowInfo: noop,
      onShowDownloads: noop,
    },
    messageList: null,
    composer: { target: "#green", onSend: noop },
    voiceDock: {
      name: "Sebi",
      session: 1,
      textureSize: null,
      channelName: "Green is fucked",
      latencyMs: null,
      hideEmpty: false,
      onToggleHideEmpty: noop,
      onOpenSettings: noop,
      onOpenProfile: noop,
    },
    members: {
      groups: [],
      query: "",
      onQueryChange: noop,
      ownSession: 1,
      showOffline: false,
      onShowOfflineChange: noop,
      onSelect: noop,
      onHover: noop,
      onLeave: noop,
      onClose: noop,
    },
    membersOpen: false,
    onCloseMembers: noop,
    emptyLabel: "Pick a channel",
    channelSearch: { value: "", onChange: noop, placeholder: "Search channels" },
    brand: "Fancy Mumble",
    serverName: "Magical Rocks",
    screen: "chat",
    onScreen: noop,
    unread: { chats: 0, people: 0 },
    ...over,
  };
}


/** The start screen's two halves, for the tests that need them. */
function startModel(over: Partial<MobileShellModel> = {}): MobileShellModel {
  return model({
    screen: "connect",
    servers: {
      rows: [
        {
          key: GROUP.key,
          label: "magical.rocks",
          favorite: true,
          online: true,
          usersLabel: "2/101 online",
          identitiesLabel: "5 identities",
          initials: "MR",
          tint: { from: "#2f5f96", to: "#7a4f8f" },
        },
        {
          key: "local",
          label: "localhost",
          favorite: false,
          online: false,
          identitiesLabel: "Offline",
          initials: "L",
          tint: { from: "#3d6b5a", to: "#2f5f96" },
        },
      ],
      activeKey: GROUP.key,
      search: { value: "", onChange: noop, placeholder: "Search servers" },
      onOpen: noop,
      onAddServer: noop,
      onOpenFriends: noop,
      lastSession: "Last session",
    },
    connect: {
      server: {
        label: "magical.rocks",
        address: "mumble://magical.rocks",
        initials: "MR",
        online: true,
        tint: { from: "#2f5f96", to: "#7a4f8f" },
      },
      stats: [{ label: "2/101", tone: "ok" }, { label: "35 ms" }],
      identities: [
        { id: "zewi", name: "Zewi", detail: "Certificate" },
        { id: "su", name: "SuperUser", detail: "Certificate", disabled: true },
      ],
      selectedIdentity: "zewi",
      onSelectIdentity: noop,
      onAddIdentity: noop,
      onConnect: noop,
      onBack: noop,
      autoConnect: true,
      onAutoConnectChange: noop,
    },
    ...over,
  });
}

function mount(skin: Parameters<typeof createNebulaTheme>[3], mode: NebulaMode, node: ReactNode) {
  const scheme = nebulaScheme(
    NEBULA_THEMES.find((theme) => theme.skin === skin)?.id ?? "dark",
    mode,
  );
  const theme = createNebulaTheme(mode, scheme?.tokens ?? null, null, skin);
  return { theme, ...render(<ThemeProvider theme={theme}>{node}</ThemeProvider>) };
}

/**
 * Every px width the skin resolved to, so a fixed column that survived into
 * the handheld tree is caught by its number rather than by eye.
 *
 * jsdom lays nothing out, so `getBoundingClientRect` is all zeroes and useless
 * here - but it does compute styles, and a hardcoded `width: 264` is a
 * computed `264px` whether or not anything was laid out. That is exactly the
 * class of bug this is for: the desktop column, the roster's 264, a popover's
 * 400.
 */
function tooWide(container: HTMLElement): string[] {
  const guilty: string[] = [];
  for (const node of container.querySelectorAll<HTMLElement>("*")) {
    // One read per node: `getComputedStyle` is the expensive call in jsdom,
    // and this walks a whole shell for twenty-six theme-and-scheme pairs.
    const style = getComputedStyle(node);
    // Out of flow, so it cannot widen anything: the backdrop's rings and the
    // artboard's own decorative circle are drawn deliberately larger than the
    // screen and clipped by the shell. What this is hunting is a box in the
    // layout that pushes the page sideways.
    if (style.position === "absolute" || style.position === "fixed") continue;
    for (const prop of ["width", "minWidth"] as const) {
      const raw = style[prop];
      const px = /^(\d+(?:\.\d+)?)px$/.exec(raw);
      if (px && Number(px[1]) > SCREEN) {
        guilty.push(`${node.tagName}[${node.dataset.testid ?? ""}] ${prop}=${raw}`);
      }
    }
  }
  return guilty;
}

afterEach(cleanup);

describe("the handheld shell, in every skin", () => {
  for (const def of NEBULA_THEMES) {
    for (const mode of ["light", "dark"] as const) {
      describe(`${def.id} / ${mode}`, () => {
        // Two whole shells rendered and walked, so it is given a budget: the
        // default 5s is a pass/fail coin toss on the two busiest skins, and a
        // timeout reads as a layout failure that is not one.
        it("puts nothing wider than the screen into the tree", () => {
          for (const pane of ["nav", "content"] as const) {
            const { container } = mount(def.skin, mode, <MobileShell model={model()} initialPane={pane} />);
            expect(tooWide(container), `${def.id} ${mode} ${pane}`).toEqual([]);
            cleanup();
          }
        }, 30_000);

        it("gives the chrome the heights this skin asks for", () => {
          const { theme, container } = mount(def.skin, mode, <MobileShell model={model()} />);
          const chrome = handheldChrome(theme);
          const strip = container.querySelector<HTMLElement>('[data-testid="nebula-mobile-server-strip"]');
          const tabs = container.querySelector<HTMLElement>('[data-testid="nebula-mobile-tabbar"]');
          expect(getComputedStyle(strip!).height).toBe(`${chrome.stripHeight}px`);
          // The tab bar's own height plus whatever the gesture bar takes, which
          // is why this is a `calc` rather than a number.
          expect(getComputedStyle(tabs!).height).toContain(`${chrome.tabBarHeight}px`);
        });

        it("draws the reference's extra marks only where the skin draws marks", () => {
          const { container } = mount(def.skin, mode, <MobileShell model={model()} />);
          const hazard = container.querySelectorAll('[data-nebula-mark="hazard"]');
          const plain = container.querySelectorAll('[data-testid="nebula-mobile-rule"]');
          if (def.skin.chrome === "stencil") {
            expect(hazard.length, def.id).toBeGreaterThan(0);
          } else {
            // Not "fewer": a hazard stripe is Nimbus's handwriting, and a skin
            // that does not draw one has to get the rule it does draw instead.
            expect(hazard.length, def.id).toBe(0);
            expect(plain.length, def.id).toBeGreaterThan(0);
          }
        });

        it("marks the open server with the bar this skin uses for a selection", () => {
          const { container } = mount(def.skin, mode, <MobileShell model={model()} />);
          const bar = container.querySelector<HTMLElement>('[data-nebula-mark="underbar"]');
          if (def.skin.chrome === "stencil") expect(bar, def.id).not.toBeNull();
          else expect(bar, def.id).toBeNull();
        });
      });
    }
  }
});

describe("the handheld shell", () => {
  const skin = NEBULA_THEMES[0].skin;

  it("opens a channel into the conversation, and comes back", () => {
    mount(skin, "dark", <MobileShell model={model()} />);
    expect(screen.getByTestId("nebula-mobile-channels-header")).toBeTruthy();
    fireEvent.click(screen.getByText("general"));
    expect(screen.queryByTestId("nebula-mobile-channels-header")).toBeNull();

    fireEvent.click(screen.getByLabelText("Back"));
    expect(screen.getByTestId("nebula-mobile-channels-header")).toBeTruthy();
  });

  it("gives the conversation the whole screen", () => {
    // The tab bar is the list's, not the conversation's: three more
    // destinations under the composer are three ways to lose a draft.
    mount(skin, "dark", <MobileShell model={model()} initialPane="content" />);
    expect(screen.queryByTestId("nebula-mobile-tabbar")).toBeNull();
  });

  it("sends a tab to the screen it stands for", () => {
    const onScreen = vi.fn();
    mount(skin, "dark", <MobileShell model={model({ onScreen })} />);
    fireEvent.click(screen.getByTestId("nebula-mobile-tab-people"));
    expect(onScreen).toHaveBeenCalledWith("messages");
    fireEvent.click(screen.getByTestId("nebula-mobile-tab-settings"));
    expect(onScreen).toHaveBeenCalledWith("settings");
  });

  it("raises the call from the bar and puts it away again", () => {
    mount(skin, "dark", <MobileShell model={model()} initialPane="content" />);
    expect(screen.queryByTestId("nebula-mobile-voice")).toBeNull();
    fireEvent.click(screen.getByTestId("nebula-mobile-call-expand"));
    expect(screen.getByTestId("nebula-mobile-voice")).toBeTruthy();
    fireEvent.click(screen.getByTestId("nebula-mobile-voice-collapse"));
    expect(screen.queryByTestId("nebula-mobile-voice")).toBeNull();
  });

  it("draws no call bar when there is no call", () => {
    mount(skin, "dark", <MobileShell model={model({ voice: null })} initialPane="content" />);
    expect(screen.queryByTestId("nebula-mobile-call-bar")).toBeNull();
  });

  it("lands on a screen's own list rather than the last screen's page", () => {
    const { rerender, theme } = mount(skin, "dark", <MobileShell model={model()} initialPane="content" />);
    expect(screen.queryByTestId("nebula-mobile-channels-header")).toBeNull();
    rerender(
      <ThemeProvider theme={theme}>
        <MobileShell model={model({ screen: "settings", screenNav: <div>Settings list</div> })} />
      </ThemeProvider>,
    );
    expect(screen.getByText("Settings list")).toBeTruthy();
  });

  it("stands a screen that is not the conversation in the same two panes", () => {
    // Settings is a list of pages beside a page, which is the same shape the
    // chat screen has - so it needs no handheld design of its own.
    mount(
      skin,
      "dark",
      <MobileShell
        model={model({
          screen: "settings",
          screenNav: <div>Settings list</div>,
          screenContent: <div>A settings page</div>,
        })}
        initialPane="content"
      />,
    );
    expect(screen.getByText("A settings page")).toBeTruthy();
  });

  it("brings the roster up as a sheet rather than a column beside nothing", () => {
    mount(skin, "dark", <MobileShell model={model({ membersOpen: true })} />);
    const sheet = screen.getByTestId("nebula-mobile-members-sheet");
    expect(within(sheet).getByTestId("member-list")).toBeTruthy();
  });

  it("gives the roster sheet one title and one way out", () => {
    // The panel's own header stood under the sheet's: two titles, two crosses.
    mount(skin, "dark", <MobileShell model={model({ membersOpen: true })} />);
    const sheet = screen.getByTestId("nebula-mobile-members-sheet");
    expect(within(sheet).getAllByRole("button", { name: /close/i })).toHaveLength(1);
  });

  it("draws what the window hangs above and below the conversation", () => {
    // Pins, the share strip, a live document and the search box above the
    // river; the selection bar, failed sends and who is typing below it. Left
    // to the window alone, each was a menu entry that opened nothing here.
    mount(
      skin,
      "dark",
      <MobileShell
        model={model({ chatUpper: <div>Pinned panel</div>, chatLower: <div>Someone is typing</div> })}
        initialPane="content"
      />,
    );
    expect(screen.getByText("Pinned panel")).toBeTruthy();
    expect(screen.getByText("Someone is typing")).toBeTruthy();
  });

  it("says why a session has no channels rather than listing none", () => {
    mount(skin, "dark", <MobileShell model={model({ sessionStatus: <div>Connection ended</div> })} />);
    expect(screen.getByText("Connection ended")).toBeTruthy();
    expect(screen.queryByText("general")).toBeNull();
  });

  it("opens a friend's conversation in the pane the channels use, and comes back", () => {
    const friends = model({ screen: "messages", screenNav: <div>Friends list</div>, openedContent: 0 });
    const { rerender, theme } = mount(skin, "dark", <MobileShell model={friends} />);
    expect(screen.getByText("Friends list")).toBeTruthy();

    rerender(
      <ThemeProvider theme={theme}>
        <MobileShell model={{ ...friends, openedContent: 1 }} />
      </ThemeProvider>,
    );
    expect(screen.queryByText("Friends list")).toBeNull();
    expect(screen.getByLabelText("Back")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Back"));
    expect(screen.getByText("Friends list")).toBeTruthy();
  });

  it("calls the second tab Friends, which is what it opens", () => {
    mount(skin, "dark", <MobileShell model={model()} />);
    expect(screen.getByTestId("nebula-mobile-tab-people").textContent).toContain("Friends");
  });

  it("opens a server's menu on a long press of its tile", () => {
    // A long press is a `contextmenu` in Android's webview; the phone had no
    // other way to edit, leave or forget a server.
    mount(skin, "dark", <MobileShell model={model()} />);
    fireEvent.contextMenu(screen.getByLabelText("Aoba Base"));
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});

describe("the start screen", () => {
  const skin = NEBULA_THEMES[0].skin;

  it("leads with the servers, not with a rail of them", () => {
    // There is no session yet, so there is nothing for the strip to switch
    // between - the masthead has that space instead.
    mount(skin, "dark", <MobileShell model={startModel()} />);
    expect(screen.getByTestId("nebula-mobile-masthead")).toBeTruthy();
    expect(screen.queryByTestId("nebula-mobile-server-strip")).toBeNull();
    expect(screen.getAllByTestId("nebula-mobile-server-row")).toHaveLength(2);
  });

  it("opens a server into the login it will arrive as", () => {
    const onOpen = vi.fn();
    const base = startModel();
    mount(skin, "dark", <MobileShell model={{ ...base, servers: { ...base.servers!, onOpen } }} />);
    fireEvent.click(screen.getByText("localhost"));
    expect(onOpen).toHaveBeenCalledWith("local");
    expect(screen.getByTestId("nebula-mobile-connect-hero")).toBeTruthy();
  });

  it("comes back to the list from the login screen", () => {
    mount(skin, "dark", <MobileShell model={startModel()} initialPane="content" />);
    expect(screen.getByTestId("nebula-mobile-connect-hero")).toBeTruthy();
    fireEvent.click(screen.getByTestId("nebula-mobile-connect-back"));
    expect(screen.getByTestId("nebula-mobile-masthead")).toBeTruthy();
  });

  it("says the first tab lists servers while there is no session", () => {
    mount(skin, "dark", <MobileShell model={startModel()} />);
    expect(screen.getByTestId("nebula-mobile-tab-chats").textContent).toContain("Servers");
  });

  it("will not let you arrive as a login that is not yours", () => {
    const onSelectIdentity = vi.fn();
    const base = startModel();
    mount(
      skin,
      "dark",
      <MobileShell
        model={{ ...base, connect: { ...base.connect!, onSelectIdentity } }}
        initialPane="content"
      />,
    );
    fireEvent.click(screen.getByText("SuperUser"));
    expect(onSelectIdentity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Zewi"));
    expect(onSelectIdentity).toHaveBeenCalledWith("zewi");
  });
});

describe("a screen that is a list beside a page", () => {
  const skin = NEBULA_THEMES[0].skin;
  const settings = (over: Partial<MobileShellModel> = {}) =>
    model({
      screen: "settings",
      screenTitle: "Settings",
      screenNav: <div>Settings list</div>,
      screenContent: <div>A settings page</div>,
      ...over,
    });

  it("lands on the list", () => {
    mount(skin, "dark", <MobileShell model={settings()} />);
    expect(screen.getByText("Settings list")).toBeTruthy();
    expect(screen.queryByText("A settings page")).toBeNull();
  });

  it("brings the page forward when the list opens one", () => {
    // The page id cannot say this happened - pressing the row you are already
    // on opens the same page - so the list counts its own presses.
    const { rerender, theme } = mount(skin, "dark", <MobileShell model={settings({ openedContent: 0 })} />);
    rerender(
      <ThemeProvider theme={theme}>
        <MobileShell model={settings({ openedContent: 1 })} />
      </ThemeProvider>,
    );
    expect(screen.getByText("A settings page")).toBeTruthy();
  });

  it("gives the page a way back, which the window did not need", () => {
    mount(skin, "dark", <MobileShell model={settings()} initialPane="content" />);
    expect(screen.getByTestId("nebula-mobile-screen-header").textContent).toContain("Settings");
    fireEvent.click(screen.getByLabelText("Back"));
    expect(screen.getByText("Settings list")).toBeTruthy();
  });

  it("goes back to the list when the tab you are on is pressed again", () => {
    // The screen has not changed, so the screen-change switch cannot do it -
    // and without this a settings page is a room with no door.
    mount(skin, "dark", <MobileShell model={settings()} initialPane="content" />);
    expect(screen.getByText("A settings page")).toBeTruthy();
    fireEvent.click(screen.getByTestId("nebula-mobile-tab-settings"));
    expect(screen.getByText("Settings list")).toBeTruthy();
  });
});
