/**
 * Nebula's own UI state, grouped by the concern that owns it.
 *
 * None of this belongs in the shared store: which screen is showing, whether
 * the roster is open, what is typed into the channel filter - these are
 * decisions this pack makes about its own layout, and another pack answers
 * them differently.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import type { ServerPingResult, UserEntry } from "@core/types";
import type { UserMenuTarget } from "./components/user/UserMenu";
import { pointAnchor, type AnchorRect } from "@shared/profilecard";

/** The four things the left column can be showing. */
export type Screen = "chat" | "messages" | "connect" | "settings";

/** Full-window surfaces that cover the shell while open. */
export type Surface =
  | "downloads"
  | "pinned"
  | "server-info"
  | "screen-share"
  | "camera-share"
  | "public-servers"
  | null;

export function useScreenRouting() {
  const [screen, setScreen] = useState<Screen>("chat");
  const [surface, setSurface] = useState<Surface>(null);
  const [marketplacePluginId, setMarketplacePluginId] = useState<string | undefined>();

  // A marketplace deep link no longer opens a surface of its own - the caller
  // routes to the administration page and this only records which listing.
  const openMarketplace = useCallback((pluginId?: string) => {
    setMarketplacePluginId(pluginId);
  }, []);

  const openScreen = useCallback((next: Screen) => {
    setSurface(null);
    setScreen(next);
  }, []);

  return { screen, openScreen, surface, setSurface, marketplacePluginId, openMarketplace };
}

/** Search boxes that live in the chrome rather than in a screen. */
export function useSearchState(resetKey: unknown) {
  const [channelQuery, setChannelQuery] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState("");

  // Moving to another conversation should not carry a stale message filter
  // with it - the results would belong to a channel that is no longer visible.
  useEffect(() => {
    setChatOpen(false);
    setChatQuery("");
  }, [resetKey]);

  return { channelQuery, setChannelQuery, chatOpen, setChatOpen, chatQuery, setChatQuery };
}

/**
 * The message the "NEW" rule is drawn above, or null when everything is read.
 *
 * The rule marks where reading stopped *when the conversation was opened*, so
 * the count is snapshotted on arrival rather than tracked live: a divider fed
 * from the current unread count walks down the list as messages are read and
 * ends up under the newest message, which is precisely where it means nothing.
 *
 * Nebula drew this rule already - `MessageList` has rendered `UnreadRule` since
 * the pack landed - but nothing ever passed it an id, so it could not appear.
 */
export function useFirstUnreadId(
  messages: readonly { message_id?: string | null }[],
  conversationKey: unknown,
  unreadCount: number,
): string | null {
  const [pending, setPending] = useState(0);

  // Read the count through a ref: this must sample the unread total at the
  // moment the conversation changes, and depending on the count itself would
  // re-snapshot on every arriving message instead.
  const unreadRef = useRef(unreadCount);
  unreadRef.current = unreadCount;
  useEffect(() => {
    setPending(unreadRef.current);
  }, [conversationKey]);

  if (pending <= 0 || messages.length === 0) return null;
  // A conversation opened for the first time is unread all the way down, so
  // the rule clamps to the top rather than disappearing on the one occasion
  // every message behind it is new.
  return messages[Math.max(0, messages.length - pending)]?.message_id ?? null;
}

/**
 * Picking several messages out of a conversation to act on at once.
 *
 * Selection mode is entered from a message's own menu rather than sitting in
 * the chrome: it is a mode you are put into by deciding to act on something,
 * and a permanent "select" control would be a button that does nothing on
 * every server that does not allow deletion.
 *
 * Leaving the conversation drops the selection - the ids belong to messages
 * that are no longer on screen, and acting on them from somewhere else is
 * never what was meant.
 */
export function useMessageSelection(conversationKey: unknown) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setActive(false);
    setSelected(new Set());
  }, [conversationKey]);

  const toggle = useCallback((messageId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(messageId)) next.add(messageId);
      return next;
    });
  }, []);

  const begin = useCallback((messageId: string) => {
    setActive(true);
    setSelected(new Set([messageId]));
  }, []);

  const clear = useCallback(() => {
    setActive(false);
    setSelected(new Set());
  }, []);

  return { active, selected, toggle, begin, clear };
}

/** The optional right-hand roster and its own filter. */
export function useMemberPanel() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"channel" | "server">("channel");
  const [query, setQuery] = useState("");
  return { open, setOpen, scope, setScope, query, setQuery };
}

/**
 * Which member row the pointer is resting on.
 *
 * Delayed on the way in so sweeping the pointer down a list does not flash a
 * card per row, and cleared immediately on the way out so the card never
 * outlives the row it describes.
 */
export function useHoverTarget(delayMs = 350) {
  const [target, setTarget] = useState<{ session: number; anchor: AnchorRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setTarget(null);
  }, []);

  const hover = useCallback(
    (session: number, event: HoverEvent) => {
      if (timer.current) clearTimeout(timer.current);
      // The row, not the pointer: the card is placed beside the person it is
      // about, so it needs their row's box rather than wherever the pointer
      // happened to enter it.
      const anchor = anchorOf(event);
      timer.current = setTimeout(() => setTarget({ session, anchor }), delayMs);
    },
    [delayMs],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { target, hover, clear };
}

/** As much of a mouse event as an anchor can be read from. */
export type HoverEvent = {
  clientX: number;
  clientY: number;
  currentTarget?: { getBoundingClientRect?: () => DOMRect } | null;
};

/** A row's box where the event has one, the pointer where it does not. */
export function anchorOf(event: HoverEvent): AnchorRect {
  const rect = event.currentTarget?.getBoundingClientRect?.();
  if (rect && rect.width > 0)
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  return pointAnchor(event.clientX, event.clientY);
}

/**
 * The person the user menu is open on, and where the click landed.
 *
 * One menu serves the whole client, so the target lives with the shell rather
 * than in each list that can open it: two surfaces cannot then disagree about
 * whether a menu is showing, and the menu keeps its dialogs when the row it
 * came from scrolls away.
 */
export function useUserMenu() {
  const [target, setTarget] = useState<UserMenuTarget | null>(null);

  const open = useCallback((user: UserEntry, event: React.MouseEvent) => {
    // Without this the platform's own menu opens on top of ours.
    event.preventDefault();
    // Rows nest - an occupant sits inside a channel row that has its own menu -
    // so the innermost target is the one that answers.
    event.stopPropagation();
    setTarget({ user, x: event.clientX, y: event.clientY });
  }, []);

  const close = useCallback(() => setTarget(null), []);

  return { target, open, close };
}

/**
 * Which user's full card is open, and the row it was opened from.
 *
 * The selection itself lives in the shared store - every pack agrees on who is
 * selected - but where the card should sit is a fact about this window, so it
 * stays here beside the other pack-local placement state.
 */
export function useProfileAnchor() {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const openFrom = useCallback((event?: HoverEvent | null) => {
    setAnchor(event ? anchorOf(event) : null);
  }, []);
  return { anchor, openFrom };
}

/**
 * The "hide empty channels" preference, shared with every other UI pack.
 *
 * It lives in preferences rather than pack state because the choice is about
 * the user's server, not about Nebula - switching designs should not resurrect
 * a hundred empty channels.
 */
export function useHideEmptyChannels() {
  const [hideEmpty, setHideEmpty] = useState(false);

  useEffect(() => {
    let active = true;
    void getPreferences()
      .then((preferences) => {
        if (active) setHideEmpty(preferences.hideEmptyChannels ?? false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const toggle = useCallback(() => {
    setHideEmpty((current) => {
      const next = !current;
      void updatePreferences({ hideEmptyChannels: next });
      return next;
    });
  }, []);

  return { hideEmpty, toggle };
}

/**
 * Live reachability for each saved address.
 *
 * The server list shows an occupancy count, which only a ping can answer.
 * Probing is keyed by address so several identities on one server cost one
 * request, and results are kept across re-renders so moving between screens
 * does not re-probe the whole list.
 */
export function useServerPings(addresses: readonly { key: string; host: string; port: number }[]) {
  const [pings, setPings] = useState<ReadonlyMap<string, ServerPingResult>>(new Map());
  // Compared as a string: the caller rebuilds the array every render, and the
  // addresses in it are what actually decide whether to probe again.
  const signature = addresses.map((address) => address.key).join(",");

  useEffect(() => {
    let active = true;
    for (const address of addresses) {
      void invoke<ServerPingResult>("ping_server", { host: address.host, port: address.port })
        .then((result) => {
          if (!active) return;
          setPings((current) => new Map(current).set(address.key, result));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
    // Keyed on `signature`, not `addresses`: the caller rebuilds that array on
    // every render, and the addresses in it are what decide whether to reprobe.
  }, [signature]);

  return pings;
}

/**
 * Mini mode: the compact always-on-top window.
 *
 * Only reachable while joined to voice, so leaving the channel drops back to
 * the full window rather than stranding the user in a call-less mini window.
 */
export function useMiniMode(inVoice: boolean) {
  const [mini, setMini] = useState(false);
  useEffect(() => {
    if (!inVoice) setMini(false);
  }, [inVoice]);
  return { mini: mini && inVoice, setMini };
}

/**
 * Shrink the window onto the mini card, and give it back afterwards.
 *
 * Mini mode used to draw a small card inside a full-size window. The window
 * stays where it was, so the empty space around the card still belongs to the
 * client and still swallows every click aimed at whatever is behind it - the
 * thing the user went to mini mode in order to keep using.
 *
 * The card's height depends on how many people are in the call, so it is
 * measured rather than assumed, and re-measured when someone joins or leaves.
 * The size to go back to is read once on the way in: reading it later would
 * pick up the mini size and make the change permanent.
 */
export function useMiniWindow(active: boolean): React.RefObject<HTMLDivElement | null> {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let restore: (() => void) | undefined;
    let observer: ResizeObserver | undefined;

    void (async () => {
      try {
        const [{ getCurrentWindow }, { LogicalSize }] = await Promise.all([
          import("@tauri-apps/api/window"),
          import("@tauri-apps/api/dpi"),
        ]);
        const shell = getCurrentWindow();
        const previous = await shell.innerSize();
        if (cancelled) return;

        const fit = () => {
          const node = cardRef.current;
          if (!node) return;
          const box = node.getBoundingClientRect();
          if (box.width < 1 || box.height < 1) return;
          void shell.setSize(new LogicalSize(Math.ceil(box.width), Math.ceil(box.height)));
        };

        observer = new ResizeObserver(fit);
        if (cardRef.current) observer.observe(cardRef.current);
        fit();

        restore = () => {
          void shell.setSize(previous);
        };
      } catch {
        /* no shell to resize - a browser dev session or a test */
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      restore?.();
    };
  }, [active]);

  return cardRef;
}
