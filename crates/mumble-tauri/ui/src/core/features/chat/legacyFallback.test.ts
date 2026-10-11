import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async () => "AAAA");
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
const fitDataUrl = vi.fn(async (..._args: unknown[]) => "data:image/jpeg;base64,AAAA");
vi.mock("@core/utils/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/utils/media")>()),
  fitDataUrl,
  videoPosterDataUrl: vi.fn(async () => "data:image/jpeg;base64,BBBB"),
}));

const {
  hideSpoilersFromLegacy,
  legacyFileLine,
  legacyImageFallbacks,
  serverAccepts,
  stripLegacyFallback,
  withLegacyBlock,
  withLegacyFallback,
  withQuoteFallback,
  withRemoteImageLink,
  withRemoteImageLinks,
  withVideoFallback,
} = await import("./legacyFallback");
const { useAppStore, liveDocInviteBody, encodeLiveDocInviteMarker } = await import("@core/store");
const { watchLegacyLine } = await import("./watch/useWatchStart");
const { fitInlineImages } = await import("@core/utils/media");

const LIMITS = { max_message_length: 5000, max_image_message_length: 131_072, allow_html: true };

/** What Qt draws of a body: comments are skipped whole, up to the first `-->`. */
function legacyView(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "");
}

beforeEach(() => {
  useAppStore.setState({ serverConfig: { ...useAppStore.getState().serverConfig, ...LIMITS } });
  fitDataUrl.mockClear();
});

describe("legacy fallback", () => {
  it("is cut out of a body, leaving the marker", () => {
    const body =
      'hi\n<!-- FANCY_FILE:abc -->\n<!-- FANCY_LEGACY --><img src="data:image/jpeg;base64,AA" /><!-- /FANCY_LEGACY -->';
    expect(stripLegacyFallback(body)).toBe("hi\n<!-- FANCY_FILE:abc -->");
  });

  it("is made for pictures only", async () => {
    const blocks = await legacyImageFallbacks(
      [
        { filePath: "a.png", filename: "a.png" },
        { filePath: "b.pdf", filename: "b.pdf" },
      ],
      "<!-- FANCY_FILE:abc -->",
      131_072,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatch(
      /^<!-- FANCY_LEGACY --><img src="data:image\/jpeg;base64,AAAA" alt="a.png" \/><!-- \/FANCY_LEGACY -->$/,
    );
    expect(stripLegacyFallback(`<!-- FANCY_FILE:abc -->\n${blocks[0]}`)).toBe("<!-- FANCY_FILE:abc -->");
  });

  it("is not cut out of a body that carries no marker", () => {
    const body = "<!-- FANCY_LEGACY -->hidden<!-- /FANCY_LEGACY -->";
    expect(stripLegacyFallback(body)).toBe(body);
  });

  it("is cut out beside any Fancy marker, not just a file", () => {
    const body =
      "<!-- FANCY_QUOTE:m1 --><!-- FANCY_LEGACY --><blockquote>a: b</blockquote><!-- /FANCY_LEGACY -->hi";
    expect(stripLegacyFallback(body)).toBe("<!-- FANCY_QUOTE:m1 -->hi");
  });

  it("is not vouched for by a marker inside a fence", () => {
    const inside = "<!-- FANCY_LEGACY -->hidden<!-- FANCY_QUOTE:x --><!-- /FANCY_LEGACY -->";
    expect(stripLegacyFallback(inside)).toBe(inside);
    const unclosed = "<!-- FANCY_LEGACY -->a<!-- /FANCY_LEGACY --><!-- FANCY_LEGACY -->b";
    expect(stripLegacyFallback(unclosed)).toBe(unclosed);
  });

  it("carries a long name without going over the limit", async () => {
    const [block] = await legacyImageFallbacks(
      [{ filePath: "a.png", filename: `${"&".repeat(500)}.png` }],
      "<!-- FANCY_FILE:abc -->",
      131_072,
    );
    expect(block).toBeDefined();
    expect(block!.length).toBeLessThan(131_072 - 30);
    expect(block).not.toContain("&amp;".repeat(65));
  });

  it("skips a picture too large to read again", async () => {
    const blocks = await legacyImageFallbacks(
      [{ filePath: "a.png", filename: "a.png", sizeBytes: 200 * 1024 * 1024 }],
      "<!-- FANCY_FILE:abc -->",
      131_072,
    );
    expect(blocks).toEqual([]);
  });

  it("is left out when the server's limit leaves no room for it", async () => {
    const body = "x".repeat(130_000);
    expect(await legacyImageFallbacks([{ filePath: "a.png", filename: "a.png" }], body, 131_072)).toEqual([]);
  });

  it("stacks several copies no taller than a legacy client lays out", async () => {
    await legacyImageFallbacks(
      [
        { filePath: "a.png", filename: "a.png" },
        { filePath: "b.png", filename: "b.png" },
        { filePath: "c.png", filename: "c.png" },
      ],
      "<!-- FANCY_FILE:abc -->",
      1_000_000,
    );
    expect(fitDataUrl).toHaveBeenCalledTimes(3);
    for (const call of fitDataUrl.mock.calls) {
      expect(call[2]).toMatchObject({ maxWidth: 1600, maxHeight: 600 });
    }
  });
});

describe("the fence builder", () => {
  it("tags a body that has no marker of its own, and the cut restores it", () => {
    const body = '<img src="https://x/g.gif" alt="GIF">';
    const out = withLegacyBlock(body, "line", LIMITS);
    expect(out).toContain("<!-- FANCY_FALLBACK -->");
    expect(legacyView(out)).toContain("line");
    expect(stripLegacyFallback(out)).toBe(body);
  });

  it("adds no tag beside an existing marker", () => {
    const out = withLegacyBlock("<!-- FANCY_WATCH:s -->", "line", LIMITS);
    expect(out).not.toContain("FANCY_FALLBACK");
    expect(stripLegacyFallback(out)).toBe("<!-- FANCY_WATCH:s -->");
  });

  it("never turns an accepted message into a refused one", () => {
    const body = "x".repeat(4_995);
    expect(serverAccepts(body, LIMITS)).toBe(true);
    expect(withLegacyBlock(body, "a long enough line", LIMITS)).toBe(body);
  });

  it("adds nothing on a server with HTML off", () => {
    expect(withLegacyBlock("<!-- FANCY_WATCH:s -->", "line", { ...LIMITS, allow_html: false })).toBe(
      "<!-- FANCY_WATCH:s -->",
    );
  });

  it("measures a body as Starling does", () => {
    // Over the text limit but under the image one: markup is discounted.
    expect(serverAccepts(`<b>${"x".repeat(10)}</b>`, { ...LIMITS, max_message_length: 10 })).toBe(true);
    expect(serverAccepts("x".repeat(11), { ...LIMITS, max_message_length: 10 })).toBe(false);
    expect(serverAccepts("x".repeat(20), { ...LIMITS, max_image_message_length: 10 })).toBe(false);
  });
});

describe("spoilers", () => {
  it("hide their text from legacy clients and come back unchanged for Fancy ones", () => {
    const body = 'before <span class="spoiler">the <b>butler</b> did-it --&gt;</span> after';
    const out = hideSpoilersFromLegacy(body, LIMITS);
    expect(legacyView(out)).not.toContain("butler");
    expect(legacyView(out)).toContain("[spoiler]");
    expect(out).not.toMatch(/<!--(?:(?!-->)[\s\S])*--(?!>)/);
    expect(stripLegacyFallback(out)).toBe(body);
  });

  it("hide a spoiler picture and a spoiler video", () => {
    const img = '<img src="data:image/png;base64,AA+/" alt="x-y" data-spoiler="1" />';
    const video = '<video src="data:video/mp4;base64,AA" controls data-spoiler="1">clip</video>';
    const out = hideSpoilersFromLegacy(`${img}${video}`, LIMITS);
    expect(legacyView(out)).not.toContain("<img");
    expect(legacyView(out)).not.toContain("clip");
    expect(stripLegacyFallback(out)).toBe(`${img}${video}`);
  });

  it("leave a body without spoilers, and a body already hidden, alone", () => {
    expect(hideSpoilersFromLegacy("<b>hi</b>", LIMITS)).toBe("<b>hi</b>");
    const once = hideSpoilersFromLegacy('<span class="spoiler">x</span>', LIMITS);
    expect(hideSpoilersFromLegacy(once, LIMITS)).toBe(once);
  });
});

describe("replies", () => {
  const quoted = { sender_name: 'Al "<b>"', body: 'one <span class="spoiler">secret</span> two' };

  it("quote what they answer for legacy clients, escaped and without spoilers", () => {
    const body = "<!-- FANCY_QUOTE:m1 -->yes";
    const out = withQuoteFallback(body, [quoted], LIMITS);
    const legacy = legacyView(out);
    expect(legacy.indexOf("<blockquote>")).toBeLessThan(legacy.indexOf("yes"));
    expect(legacy).toContain("Al &quot;&lt;b&gt;&quot;: one [spoiler] two");
    expect(legacy).not.toContain("secret");
    expect(stripLegacyFallback(out)).toBe(body);
  });

  it("cut a long quote short", () => {
    const out = withQuoteFallback(
      "<!-- FANCY_QUOTE:m1 -->k",
      [{ sender_name: "a", body: "w".repeat(500) }],
      LIMITS,
    );
    expect(out).toContain(`${"w".repeat(120)}…`);
    expect(out).not.toContain("w".repeat(121));
  });
});

describe("remote pictures", () => {
  it("get a link legacy clients can open", () => {
    const tag = '<img src="https://g.example/a.gif" alt="cat &quot;wow&quot;" />';
    const out = withRemoteImageLink(tag, "https://g.example/a.gif", 'cat "wow"', LIMITS);
    expect(legacyView(out)).toContain('<a href="https://g.example/a.gif">GIF: cat &quot;wow&quot;</a>');
    expect(stripLegacyFallback(out)).toBe(tag);
  });

  it("get nothing when the URL is not https", () => {
    expect(withRemoteImageLink("<img>", "javascript:alert(1)", "x", LIMITS)).toBe("<img>");
  });

  it("are found in an editor's markup", () => {
    const html = '<p>look <img src="https://g.example/a.gif?x=1&amp;y=2" alt="cat"></p>';
    const out = withRemoteImageLinks(html, LIMITS);
    expect(legacyView(out)).toContain('href="https://g.example/a.gif?x=1&amp;y=2"');
    expect(stripLegacyFallback(out)).toBe(html);
    expect(withRemoteImageLinks("<p>plain</p>", LIMITS)).toBe("<p>plain</p>");
  });
});

describe("shared files", () => {
  const pdf = {
    url: "https://files.example/d/report.pdf",
    filename: "report.pdf",
    sizeBytes: 2_200_000,
    mode: "public" as const,
  };

  it("name a durable public file with its link", () => {
    expect(legacyFileLine(pdf, { mode: "public" })).toBe(
      '📎 <a href="https://files.example/d/report.pdf">report.pdf</a> (2.1 MiB)',
    );
  });

  it("give no link that would not open", () => {
    expect(legacyFileLine({ ...pdf, mode: "session" }, { mode: "session" })).not.toContain("<a");
    expect(legacyFileLine({ ...pdf, mode: "password" }, { mode: "password" })).toBe(
      "📎 report.pdf (2.1 MiB) 🔒",
    );
    expect(legacyFileLine({ ...pdf, expiresAt: 1 }, { mode: "public", ttlSeconds: 60 })).not.toContain("<a");
  });

  it("say how long a voice message is", () => {
    const voice = { url: "", key: "k", filename: "voice-message.ogg", mode: "session" as const };
    expect(
      legacyFileLine({ ...voice, voice: { durationMs: 12_300, waveform: [] } }, { mode: "session" }),
    ).toBe("🎤 Voice message (0:12)");
  });

  it("send a line for a file and a copy for a picture, both cut for Fancy", async () => {
    const marker = "<!-- FANCY_FILE:abc -->\n<!-- FANCY_FILE:def -->";
    const out = await withLegacyFallback(
      marker,
      [
        { info: pdf, filePath: "C:/report.pdf" },
        { info: { ...pdf, filename: "a.png", url: "", key: "k", mode: "session" }, filePath: "C:/a.png" },
      ],
      { mode: "public" },
    );
    expect(legacyView(out)).toContain("report.pdf</a>");
    expect(legacyView(out)).toContain('<img src="data:image/jpeg;base64,AAAA" alt="a.png" />');
    expect(stripLegacyFallback(out)).toBe(marker);
  });

  it("send a line instead of a copy for a password picture", async () => {
    const marker = "<!-- FANCY_FILE:abc -->";
    const out = await withLegacyFallback(
      marker,
      [{ info: { ...pdf, filename: "a.png", mode: "password" }, filePath: "C:/a.png" }],
      { mode: "password" },
    );
    expect(legacyView(out)).toContain("🖼️ a.png");
    expect(legacyView(out)).not.toContain("<img");
    expect(stripLegacyFallback(out)).toBe(marker);
  });
});

describe("other markers", () => {
  it("a document invite says what was shared", () => {
    const out = liveDocInviteBody("plan", "Q3 <plan>");
    expect(legacyView(out)).toContain("📝 shared a document: Q3 &lt;plan&gt;");
    expect(stripLegacyFallback(out)).toBe(encodeLiveDocInviteMarker("plan", "Q3 <plan>"));
  });

  it("a watch-together card links the video", () => {
    expect(watchLegacyLine("https://youtu.be/x", "Cats")).toBe(
      '📺 started Watch Together: <a href="https://youtu.be/x">Cats</a>',
    );
    expect(watchLegacyLine("file:///x.mp4", null)).toBe("📺 started Watch Together: file:///x.mp4");
  });

  it("a video gets a still and its name", async () => {
    const body = '<video src="data:video/mp4;base64,AA" controls>clip.mp4</video>';
    const out = await withVideoFallback(body, new File(["x"], "clip.mp4"), "clip.mp4", LIMITS);
    expect(legacyView(out)).toContain("🎬 clip.mp4");
    expect(legacyView(out)).toContain("data:image/jpeg;base64,BBBB");
    expect(stripLegacyFallback(out)).toBe(body);
  });
});

describe("inline pictures in one message", () => {
  it("are left alone when the whole body fits", async () => {
    const html = '<p><img src="data:image/png;base64,AAAA"></p>';
    expect(await fitInlineImages(html, 1_000)).toBe(html);
  });

  it("are refused when there is no room worth sharing", async () => {
    const html = `<img src="data:image/png;base64,${"A".repeat(5_000)}"><img src="data:image/png;base64,${"A".repeat(5_000)}">`;
    await expect(fitInlineImages(html, 6_000)).rejects.toThrow();
  });
});
