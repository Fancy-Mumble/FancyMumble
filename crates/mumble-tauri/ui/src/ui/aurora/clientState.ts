/**
 * The client's UI state, grouped by the concern that owns it.
 *
 * These were twenty-one loose `useState` calls in one component body, which
 * made every piece of state reachable from every screen and gave no hint about
 * which ones belong together. Each hook below owns one concern, absorbs the
 * effects that maintain it, and exposes the pieces a screen actually needs.
 */
import { useCallback, useEffect, useState } from "react";
import type { ChannelEntry } from "@core/types";
import { useDismissOnInteraction } from "./clientHooks";
import type { Surface } from "./components";

/** Which modal surface is open, plus the transient arguments it was opened with. */
export function useSurfaceRouting() {
  const [surface, setSurface] = useState<Surface>(null);
  const [marketplacePluginId, setMarketplacePluginId] = useState<string | undefined>();
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);

  const openMarketplace = useCallback((pluginId?: string) => {
    setMarketplacePluginId(pluginId);
    setSurface("marketplace");
  }, []);

  // The composer is nested well below this level, so it asks for the poll
  // creator by event rather than threading a callback down every layer.
  useEffect(() => {
    const open = () => setShowPollCreator(true);
    globalThis.addEventListener("new-ui:create-poll", open);
    return () => globalThis.removeEventListener("new-ui:create-poll", open);
  }, []);

  return {
    surface, setSurface,
    marketplacePluginId, openMarketplace,
    quickSwitcherOpen, setQuickSwitcherOpen,
    showPollCreator, setShowPollCreator,
  };
}

/** Channel create/edit/move/purge dialogs and the two floating context menus. */
export function useChannelModeration() {
  const [channelEditor, setChannelEditor] = useState<{ channel: ChannelEntry | null; parentId: number; structural?: boolean } | null>(null);
  const [channelMenu, setChannelMenu] = useState<{ channel: ChannelEntry; x: number; y: number } | null>(null);
  const [sidebarMenu, setSidebarMenu] = useState<{ x: number; y: number } | null>(null);
  const [moveUsersSource, setMoveUsersSource] = useState<ChannelEntry | null>(null);
  const [purgeChannel, setPurgeChannel] = useState<ChannelEntry | null>(null);
  const [restrictedChannel, setRestrictedChannel] = useState<ChannelEntry | null>(null);

  const closeFloatingMenus = useCallback(() => { setChannelMenu(null); setSidebarMenu(null); }, []);
  useDismissOnInteraction(!!channelMenu || !!sidebarMenu, closeFloatingMenus);

  return {
    channelEditor, setChannelEditor,
    channelMenu, setChannelMenu,
    sidebarMenu, setSidebarMenu,
    moveUsersSource, setMoveUsersSource,
    purgeChannel, setPurgeChannel,
    restrictedChannel, setRestrictedChannel,
    closeFloatingMenus,
  };
}

/**
 * In-channel search and message selection.
 *
 * The selection is cleared whenever the conversation changes - carrying ids
 * across a channel switch would let a later "delete selected" act on messages
 * the user can no longer see.
 */
export function useChatSearch(selectedChannel: number | null, selectedDmUser: number | null) {
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const [showPinned, setShowPinned] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());

  useEffect(() => setSelectedMessageIds(new Set()), [selectedChannel, selectedDmUser]);

  const toggleMessageSelection = useCallback((messageId: string) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  return {
    chatSearchOpen, setChatSearchOpen,
    chatQuery, setChatQuery,
    showPinned, setShowPinned,
    selectedMessageIds, setSelectedMessageIds,
    toggleMessageSelection,
  };
}

/** Filter and scope for the member sidebar. */
export function useMemberDirectory() {
  const [memberQuery, setMemberQuery] = useState("");
  const [memberScope, setMemberScope] = useState<"channel" | "server">("channel");
  const toggleMemberScope = useCallback(
    () => setMemberScope((value) => (value === "channel" ? "server" : "channel")),
    [],
  );
  return { memberQuery, setMemberQuery, memberScope, setMemberScope, toggleMemberScope };
}

/** Server-rail expansion, tracked separately for the launcher and the client. */
export function useRailExpansion() {
  const [launcherRailExpanded, setLauncherRailExpanded] = useState(true);
  const [connectedRailExpanded, setConnectedRailExpanded] = useState(false);
  const toggleConnectedRail = useCallback(() => setConnectedRailExpanded((value) => !value), []);
  return {
    launcherRailExpanded, setLauncherRailExpanded,
    connectedRailExpanded, setConnectedRailExpanded,
    toggleConnectedRail,
  };
}
