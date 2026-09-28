import { describe, expect, it } from "vitest";
import type { ServerPingResult } from "@core/types";
import type { ServerLivery } from "./livery";
import type { CachedLivery } from "./liveryCache";
import { LIVERY_TITLE_KEYS, LIVERY_TONE, resolveLivery } from "./liveryStatus";

function livery(digest: string, tagline = "a motto"): ServerLivery {
  return { version: 1, digest, tagline, tags: [], palette: {} };
}

function cached(digest: string): CachedLivery {
  return { digest, livery: livery(digest, "remembered"), savedAt: 0 };
}

function ping(over: Partial<ServerPingResult> = {}): ServerPingResult {
  return {
    online: true,
    latency_ms: 20,
    user_count: 4,
    max_user_count: 101,
    server_version: "1.6.0",
    ...over,
  };
}

describe("resolveLivery", () => {
  it("prefers the open connection over anything remembered", () => {
    const resolved = resolveLivery({
      live: livery("aaaa", "live"),
      cached: cached("bbbb"),
      ping: ping({ livery_digest: "bbbb" }),
    });
    expect(resolved.status).toBe("live");
    expect(resolved.livery?.tagline).toBe("live");
  });

  it("paints the remembered document while the probe is still out", () => {
    // Flashing unbranded and then branded a moment later is worse than showing
    // the last known answer and correcting it.
    const resolved = resolveLivery({ live: null, cached: cached("aaaa"), ping: null });
    expect(resolved.status).toBe("probing");
    expect(resolved.livery?.tagline).toBe("remembered");
  });

  it("draws a remembered document the server's digest confirms", () => {
    const resolved = resolveLivery({
      live: null,
      cached: cached("aaaa"),
      ping: ping({ livery_digest: "aaaa" }),
    });
    expect(resolved.status).toBe("cached");
    expect(resolved.livery?.tagline).toBe("remembered");
  });

  it("withholds a remembered document the server has moved on from, and refetches", () => {
    const resolved = resolveLivery({
      live: null,
      cached: cached("aaaa"),
      ping: ping({ livery_digest: "zzzz" }),
    });
    expect(resolved.status).toBe("fetching");
    // Provably the wrong picture, so it is not drawn while the right one is
    // on its way.
    expect(resolved.livery).toBeNull();
    expect(resolved.fetch).toBe(true);
    expect(resolved.forget).toBe(false);
  });

  it("fetches branding this client has never held rather than waiting for a join", () => {
    // The whole point: a livery is readable without joining, exactly as the
    // user count is. Nothing here tells the user to connect first.
    const resolved = resolveLivery({ live: null, cached: null, ping: ping({ livery_digest: "aaaa" }) });
    expect(resolved.status).toBe("fetching");
    expect(resolved.fetch).toBe(true);
  });

  it("does not ask twice while an answer is already on its way", () => {
    const resolved = resolveLivery({
      live: null,
      cached: null,
      ping: ping({ livery_digest: "aaaa" }),
      probe: "running",
    });
    expect(resolved.status).toBe("fetching");
    expect(resolved.fetch).toBe(false);
  });

  it("reports a fetch that did not come back", () => {
    const resolved = resolveLivery({
      live: null,
      cached: null,
      ping: ping({ livery_digest: "aaaa" }),
      probe: "failed",
    });
    expect(resolved.status).toBe("failed");
    expect(resolved.fetch).toBe(false);
  });

  it("asks nothing of a server that says it has none", () => {
    const resolved = resolveLivery({ live: null, cached: null, ping: ping({ livery_digest: "" }) });
    expect(resolved.fetch).toBe(false);
  });

  it("asks nothing of a server that cannot answer the question", () => {
    // A probe against plain Mumble would sit until it timed out: the server
    // ignores the message type rather than refusing it.
    const resolved = resolveLivery({ live: null, cached: null, ping: ping({ livery_digest: null }) });
    expect(resolved.fetch).toBe(false);
  });

  it("clears the cache when a server says it has no branding", () => {
    // An empty digest is a Fancy server answering "none", which is a statement.
    // Silence is not, and the next case proves they are handled differently.
    const resolved = resolveLivery({
      live: null,
      cached: cached("aaaa"),
      ping: ping({ livery_digest: "" }),
    });
    expect(resolved.status).toBe("absent");
    expect(resolved.livery).toBeNull();
    expect(resolved.forget).toBe(true);
  });

  it("does not clear anything for a server that cannot answer", () => {
    // Plain Mumble, or a ping that fell back to the legacy format - six fixed
    // u32s with nowhere to carry a digest. Leave what we have alone.
    const resolved = resolveLivery({
      live: null,
      cached: cached("aaaa"),
      ping: ping({ livery_digest: null }),
    });
    expect(resolved.status).toBe("unverified");
    expect(resolved.livery?.tagline).toBe("remembered");
    expect(resolved.forget).toBe(false);
  });

  it("reports an unreachable server without forgetting what it last said", () => {
    const resolved = resolveLivery({
      live: null,
      cached: cached("aaaa"),
      ping: ping({ online: false, latency_ms: null }),
    });
    expect(resolved.status).toBe("unreachable");
    expect(resolved.forget).toBe(false);
  });

  it("has a tone and a sentence for every state it can report", () => {
    // The indicator renders both unconditionally, so a state added without
    // them would draw a transparent dot with no label.
    const states = [
      "probing",
      "live",
      "cached",
      "fetching",
      "failed",
      "absent",
      "unverified",
      "unreachable",
    ] as const;
    for (const state of states) {
      expect(LIVERY_TONE[state]).toBeTruthy();
      expect(LIVERY_TITLE_KEYS[state].length).toBeGreaterThan(0);
    }
  });
});
