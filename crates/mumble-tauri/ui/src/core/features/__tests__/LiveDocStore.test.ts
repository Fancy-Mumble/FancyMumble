/**
 * Regression tests for the Live Doc store actions.
 *
 * Covers the open/close panel cycle, the announce <-> open
 * mutual-exclusion invariant, and the per-server scoping that
 * prevents two server tabs from colliding on the same numeric
 * channel id.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  useAppStore,
  liveDocKey,
  encodeLiveDocInviteMarker,
  decodeLiveDocInviteMarker,
  FANCY_LIVEDOC_MARKER_RE,
  type LiveDocSessionInfo,
  type LiveDocAnnounceInfo,
} from "../../store";

const SRV_A = "srv-a";
const SRV_B = "srv-b";

function session(
  channelId: number,
  slug = "notes",
  appServerId: string | null = SRV_A,
): LiveDocSessionInfo {
  return {
    serverId: 1,
    appServerId,
    channelId,
    slug,
    title: "Test Doc",
    wsUrl: "ws://localhost/ws",
    token: "t",
    ownSession: 7,
    ownName: "Tester",
    ownColor: "#2aabee",
  };
}

function announce(
  channelId: number,
  appServerId: string | null = SRV_A,
): LiveDocAnnounceInfo {
  return {
    openerName: "Alice",
    title: "Plan",
    appServerId,
    channelId,
    slug: "plan",
  };
}

describe("Live Doc store actions", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeLiveDocs: new Map(),
      pendingLiveDocAnnounces: new Map(),
      pendingLiveDocSeeds: new Map(),
      activeServerId: SRV_A,
    });
  });

  it("opens and closes a Live Doc panel for a channel", () => {
    const { openLiveDoc, closeActiveLiveDoc } = useAppStore.getState();
    openLiveDoc(session(42));
    expect(useAppStore.getState().activeLiveDocs.get(liveDocKey(SRV_A, 42))?.slug).toBe("notes");
    closeActiveLiveDoc(42);
    expect(useAppStore.getState().activeLiveDocs.has(liveDocKey(SRV_A, 42))).toBe(false);
  });

  it("opening a doc clears a pending announce on the same channel", () => {
    const { setLiveDocAnnounce, openLiveDoc } = useAppStore.getState();
    setLiveDocAnnounce(announce(99));
    expect(useAppStore.getState().pendingLiveDocAnnounces.has(liveDocKey(SRV_A, 99))).toBe(true);
    openLiveDoc(session(99));
    expect(useAppStore.getState().pendingLiveDocAnnounces.has(liveDocKey(SRV_A, 99))).toBe(false);
  });

  it("announces and closes are scoped per-channel", () => {
    const s = useAppStore.getState();
    s.setLiveDocAnnounce(announce(1));
    s.setLiveDocAnnounce(announce(2));
    s.clearLiveDocAnnounce(1);
    const remaining = useAppStore.getState().pendingLiveDocAnnounces;
    expect(remaining.has(liveDocKey(SRV_A, 1))).toBe(false);
    expect(remaining.has(liveDocKey(SRV_A, 2))).toBe(true);
  });

  it("closeActiveLiveDoc is idempotent", () => {
    const { closeActiveLiveDoc } = useAppStore.getState();
    closeActiveLiveDoc(7);
    closeActiveLiveDoc(7);
    expect(useAppStore.getState().activeLiveDocs.size).toBe(0);
  });

  it("scopes live-doc state per server tab (same channel id, two servers)", () => {
    const { openLiveDoc } = useAppStore.getState();
    openLiveDoc(session(5, "doc-a", SRV_A));
    openLiveDoc(session(5, "doc-b", SRV_B));
    const live = useAppStore.getState().activeLiveDocs;
    expect(live.get(liveDocKey(SRV_A, 5))?.slug).toBe("doc-a");
    expect(live.get(liveDocKey(SRV_B, 5))?.slug).toBe("doc-b");
  });

  it("closeActiveLiveDoc only closes the currently active server's session", () => {
    const { openLiveDoc, closeActiveLiveDoc } = useAppStore.getState();
    openLiveDoc(session(8, "doc-a", SRV_A));
    openLiveDoc(session(8, "doc-b", SRV_B));
    closeActiveLiveDoc(8);
    const live = useAppStore.getState().activeLiveDocs;
    expect(live.has(liveDocKey(SRV_A, 8))).toBe(false);
    expect(live.get(liveDocKey(SRV_B, 8))?.slug).toBe("doc-b");
  });

  it("closeActiveLiveDoc with explicit appServerId targets the right tab regardless of active tab", () => {
    const { openLiveDoc, closeActiveLiveDoc } = useAppStore.getState();
    openLiveDoc(session(9, "doc-a", SRV_A));
    openLiveDoc(session(9, "doc-b", SRV_B));
    // Active tab is SRV_A but we close the SRV_B session explicitly.
    closeActiveLiveDoc(9, SRV_B);
    const live = useAppStore.getState().activeLiveDocs;
    expect(live.get(liveDocKey(SRV_A, 9))?.slug).toBe("doc-a");
    expect(live.has(liveDocKey(SRV_B, 9))).toBe(false);
  });

  it("pendingLiveDocSeed is scoped to the active server", () => {
    const { setPendingLiveDocSeed, consumePendingLiveDocSeed } = useAppStore.getState();
    setPendingLiveDocSeed(3, "# hello");
    useAppStore.setState({ activeServerId: SRV_B });
    expect(consumePendingLiveDocSeed(3)).toBeUndefined();
    useAppStore.setState({ activeServerId: SRV_A });
    expect(consumePendingLiveDocSeed(3)).toBe("# hello");
    expect(consumePendingLiveDocSeed(3)).toBeUndefined();
  });
});

describe("FANCY_LIVEDOC marker codec", () => {
  it("round-trips slug + title through the marker payload", () => {
    const marker = encodeLiveDocInviteMarker("daily-standup", "Daily Standup Notes");
    const m = FANCY_LIVEDOC_MARKER_RE.exec(marker);
    expect(m).not.toBeNull();
    const decoded = decodeLiveDocInviteMarker(m![1]);
    expect(decoded).toEqual({ slug: "daily-standup", title: "Daily Standup Notes" });
  });

  it("handles non-ASCII titles", () => {
    const title = "Sprintplanung \u00fcber alles \u4eba\u751f \ud83d\udcdd";
    const marker = encodeLiveDocInviteMarker("plan", title);
    const m = FANCY_LIVEDOC_MARKER_RE.exec(marker);
    expect(m).not.toBeNull();
    expect(decodeLiveDocInviteMarker(m![1])?.title).toBe(title);
  });

  it("returns null for malformed payload", () => {
    expect(decodeLiveDocInviteMarker("not-base64!!!")).toBeNull();
  });

  it("marker does not match other FANCY_ markers", () => {
    expect(FANCY_LIVEDOC_MARKER_RE.exec("<!-- FANCY_POLL:abc -->")).toBeNull();
    expect(FANCY_LIVEDOC_MARKER_RE.exec("<!-- FANCY_FILE:abc -->")).toBeNull();
  });
});
