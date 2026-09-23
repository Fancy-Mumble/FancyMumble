/**
 * What the shell hands to a pane, as a type rather than as an argument list.
 *
 * `NebulaClientApp` is about eleven hundred lines of hooks followed by as many
 * of layout, and the handheld layout needs the same data and the same handlers
 * as the window one. Assembling them twice is how the two drift; lifting the
 * hooks out into a model hook is a reordering risk across a block that large.
 * So the hooks stay exactly where they are and hand each pane one memoised
 * bundle, which both trees spread.
 *
 * Nothing here is React. These are the shapes the panes already take, named
 * once so the mobile components, the preview page's fixture and the tests can
 * all speak about them without importing the shell.
 */
import type { ComponentProps, ReactNode } from "react";
import type { UserEntry } from "@core/types";
import type { Screen } from "./clientState";
import type { ChannelList } from "./components/sidebar/ChannelList";
import type { ServerRail } from "./components/sidebar/ServerRail";
import type { VoiceDock } from "./components/sidebar/VoiceDock";
import type { ChatHeader } from "./components/chat/ChatHeader";
import type { Composer } from "./components/chat/Composer";
import type { MessageList } from "./components/chat/MessageList";
import type { MemberPanel } from "./components/chat/MemberPanel";

/**
 * Taken from the components rather than restated.
 *
 * A hand-written copy of a props interface is a second definition that nobody
 * updates: the day `ChannelList` grows a prop, a duplicate here still compiles
 * and the mobile pane silently stops passing it.
 */
export type ChannelPaneModel = ComponentProps<typeof ChannelList>;
export type ChatHeaderModel = ComponentProps<typeof ChatHeader>;
export type ComposerModel = ComponentProps<typeof Composer>;
export type MessageListModel = ComponentProps<typeof MessageList>;
export type MemberPanelModel = ComponentProps<typeof MemberPanel>;
export type ServerRailModel = ComponentProps<typeof ServerRail>;
export type VoiceDockModel = ComponentProps<typeof VoiceDock>;

/**
 * What a handheld server strip needs, which is the rail's bundle minus the
 * four fields that only mean something to a column: whether it is expanded,
 * whether it has been pinned open as the connect screen's own list, the search
 * box that pinning puts in it, and the panel that slides out of it.
 */
export type ServerStripModel = Omit<
  ServerRailModel,
  "expanded" | "onToggleExpanded" | "pinned" | "search" | "panelEntries"
>;

/**
 * Everything the handheld shell draws, as one value.
 *
 * The window shows a rail, a column and a conversation at once. A phone shows
 * one of them, so the shell needs both halves of whichever screen is open and
 * a way to say which half is in front - but it does not need its own copy of
 * any of the wiring, which is why every field here is a bundle the window
 * already built.
 */
/**
 * A call in progress, or null when there is none.
 *
 * The window says this in the dock at the foot of the channel column, which a
 * phone has no room for - so the same facts become a bar above the composer
 * and, opened, a screen of their own.
 */
export interface VoiceModel {
  channelName: string;
  participants: readonly UserEntry[];
  ownSession: number | null;
  micLive: boolean;
  deafened: boolean;
  onToggleMic: () => void;
  onToggleDeafen: () => void;
  /** Leave the call, not the server. */
  onLeave: () => void;
  onShareScreen?: () => void;
  /** How long the call has been up, already formatted. */
  elapsedLabel?: string;
  /** What the call is being carried by, e.g. "OPUS 48KHZ". */
  codecLabel?: string;
}

export interface MobileShellModel {
  voice: VoiceModel | null;
  /** The start screen's two halves, when there is no session yet. */
  servers?: MobileServersModel;
  connect?: MobileConnectModel;
  serverStrip: ServerStripModel;
  channels: ChannelPaneModel;
  chatHeader: ChatHeaderModel;
  /** Null while the conversation is empty or still arriving. */
  messageList: MessageListModel | null;
  composer: ComposerModel;
  voiceDock: VoiceDockModel;
  members: MemberPanelModel;
  membersOpen: boolean;
  onCloseMembers: () => void;
  /**
   * The conversation's banners. The list draws them as its own header, so the
   * pane draws them only where there is no list - an empty conversation, whose
   * history sentinel is among them and is what fetches the first page.
   */
  chatBanners?: ReactNode;
  /**
   * What the window hangs between the header and the river - pins, the share
   * strip, a live document, a key request, the search box - and what it keeps
   * between the river and the composer: the selection bar, failed sends, who is
   * typing. The same fragments the window draws, so no surface is window-only.
   */
  chatUpper?: ReactNode;
  chatLower?: ReactNode;
  /** A live document has the pane; the conversation is kept, but put away. */
  hidesChat?: boolean;
  /** Said instead of the conversation while the session is still arriving. */
  loadingLabel?: string;
  /**
   * The open session is connecting, reconnecting or gone: said, with the ways
   * out of it, in place of a channel list that would otherwise just be empty.
   */
  sessionStatus?: ReactNode;
  /** Under the conversation's own empty state. */
  emptyLabel: string;
  channelSearch: { value: string; onChange: (next: string) => void; placeholder: string };
  brand: string;
  serverName: string;
  /**
   * The screens that are not the conversation, in their two halves.
   *
   * Settings is a list of pages beside a page, and the connect screen is a
   * list of servers beside a form - the same nav-and-content split the chat
   * screen has, so the same pane switch serves all three and none of them
   * needs a handheld design of its own to stop being clipped.
   */
  screenNav?: ReactNode;
  screenContent?: ReactNode;
  screen: Screen;
  onScreen: (next: Screen) => void;
  /**
   * A counter the navigation pane bumps whenever it opens something.
   *
   * The pane switch needs to know that a page was *chosen*, which the page's
   * own id cannot say: pressing the row you are already on opens the same page
   * and changes nothing. Only the pane that owns the rows knows a press
   * happened, and this is how it says so without reaching into the shell.
   */
  openedContent?: number;
  /** What the content half of a non-conversation screen is called. */
  screenTitle?: string;
  unread: { chats: number; people: number };
}

/** One saved address on the start screen's list. */
export interface MobileServerRow {
  key: string;
  /** The address, which is what the artboard prints as the row's name. */
  label: string;
  favorite: boolean;
  online: boolean;
  /** Occupancy, already formatted, e.g. "2/101". Absent while unknown. */
  usersLabel?: string;
  /** "5 identities", already counted and pluralised. */
  identitiesLabel: string;
  /** Two letters, or a digit pair for an address. */
  initials: string;
  /** The colour the address hashes to, so a tile is recognisable by shape. */
  tint: { from: string; to: string };
}

/**
 * The start screen: which server, before there is a session to have a channel
 * in. It is the pack's `connect` screen, which on a window is a column of
 * addresses beside a form and here is two screens with a chevron between them.
 */
export interface MobileServersModel {
  rows: readonly MobileServerRow[];
  activeKey: string | null;
  search: { value: string; onChange: (next: string) => void; placeholder: string };
  onOpen: (key: string) => void;
  onAddServer: () => void;
  onOpenFriends: () => void;
  /** "Last session · magical.rocks · 41m", or nothing on a first run. */
  lastSession?: string;
}

/** One login saved against an address. */
export interface MobileIdentity {
  id: string;
  name: string;
  /** What it authenticates with, e.g. "Certificate · default". */
  detail: string;
  /** Reserved, or otherwise not yours to arrive as. */
  disabled?: boolean;
}

/** The second half of the start screen: which login, and go. */
export interface MobileConnectModel {
  server: {
    label: string;
    /** The URL the artboard prints under the name. */
    address: string;
    initials: string;
    online: boolean;
    tint: { from: string; to: string };
  };
  /** The three plates over the list: occupancy, latency, version. */
  stats: readonly { label: string; tone?: "ok" | "plain" }[];
  identities: readonly MobileIdentity[];
  selectedIdentity: string | null;
  onSelectIdentity: (id: string) => void;
  onAddIdentity: () => void;
  /** Change one saved login - the window's pencil, on a long press. */
  onEditIdentity?: (id: string) => void;
  onConnect: () => void;
  onBack: () => void;
  autoConnect: boolean;
  onAutoConnectChange: (next: boolean) => void;
}
