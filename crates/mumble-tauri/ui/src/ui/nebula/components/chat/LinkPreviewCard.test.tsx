import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "@core/store";
import type { LinkEmbed } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import LinkPreviewCard from "./LinkPreviewCard";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

function embed(partial: Partial<LinkEmbed> = {}): LinkEmbed {
  return {
    url: "https://www.youtube.com/watch?v=eKqZWVcYs7E",
    type: "video",
    title: "Entity — Stargazer",
    site_name: "youtube.com",
    author: { name: "Entity Records" },
    video: { url: "https://www.youtube.com/embed/eKqZWVcYs7E" },
    ...partial,
  } as LinkEmbed;
}

function draw(one: LinkEmbed, allowExternalResources = false) {
  render(
    withNebulaTheme(
      <LinkPreviewCard embeds={[one]} allowExternalResources={allowExternalResources} channelId={1} />,
    ),
  );
}

describe("LinkPreviewCard", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      ownSession: 1,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      watchSessions: new Map(),
      watchSessionsVersion: 0,
    });
  });

  it("names the source, the title and one line of context", () => {
    draw(
      embed({
        thumbnail: { url: "https://img.example/t.jpg", preview: { data_url: DATA_URL, mime: "image/png" } },
      }),
    );

    expect(screen.getByText("youtube.com")).toBeTruthy();
    expect(screen.getByText("Entity — Stargazer")).toBeTruthy();
    // The channel answers "what is this" where there is one, so it takes the
    // line the description would otherwise have.
    expect(screen.getByText("Entity Records")).toBeTruthy();
  });

  it("falls back to the hostname where the server named no site", () => {
    draw(embed({ site_name: undefined, provider: undefined, url: "https://www.example.org/a/b" }));
    expect(screen.getByText("example.org")).toBeTruthy();
  });

  it("draws the picture the server inlined rather than fetching the origin's", () => {
    draw(
      embed({
        thumbnail: { url: "https://img.example/t.jpg", preview: { data_url: DATA_URL, mime: "image/png" } },
      }),
    );

    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe(DATA_URL);
  });

  it("draws no picture at all rather than reaching for the origin uninvited", () => {
    // No inlined preview and no consent: a card that loaded this would tell
    // the origin who is reading the conversation.
    draw(embed({ thumbnail: { url: "https://img.example/t.jpg" } }));
    expect(document.querySelector("img")).toBeNull();
  });

  it("uses the origin's picture once external resources are allowed", () => {
    draw(embed({ thumbnail: { url: "https://img.example/t.jpg" } }), true);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://img.example/t.jpg");
  });

  it("asks before loading a player the reader has not allowed", () => {
    draw(
      embed({
        thumbnail: { url: "https://img.example/t.jpg", preview: { data_url: DATA_URL, mime: "image/png" } },
      }),
    );

    fireEvent.click(screen.getByLabelText("Play video"));
    expect(document.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByText("Load content"));
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://www.youtube.com/embed/eKqZWVcYs7E",
    );
  });

  it("starts a watch-together session on the video it is showing", async () => {
    draw(embed());

    await act(async () => {
      fireEvent.click(screen.getByText("Watch together"));
    });

    const session = Array.from(useAppStore.getState().watchSessions.values())[0];
    expect(session.sourceUrl).toBe("https://www.youtube.com/watch?v=eKqZWVcYs7E");
    expect(session.channelId).toBe(1);
  });

  it("offers nothing to watch on a card that is not a video", () => {
    draw(
      embed({
        type: "article",
        url: "https://example.org/posts/one",
        video: undefined,
        author: undefined,
        description: "Why the numbers look fine and sound wrong.",
      }),
    );

    expect(screen.queryByText("Watch together")).toBeNull();
    // With no channel to name, the description takes the line instead.
    expect(screen.getByText("Why the numbers look fine and sound wrong.")).toBeTruthy();
  });
  it("draws the picture at its own size, and says so, when it is too small to enlarge", () => {
    // 360 across is under the band: blown up to fill the poster it is mush,
    // and a reader can see it is mush. The chip states the real size so the
    // small picture reads as a deliberate thumbnail rather than a bad card.
    draw(
      embed({
        type: "image",
        video: undefined,
        author: undefined,
        image: {
          url: "https://img.example/a.png",
          width: 360,
          height: 253,
          preview: { data_url: DATA_URL, mime: "image/png", width: 360, height: 253 },
        },
      }),
    );

    expect(screen.getByText("360×253")).toBeTruthy();
    expect(screen.getByText("Thumbnail only · open for full size")).toBeTruthy();
  });

  it("contains tall art rather than cropping it to a band", () => {
    // The size is stated for the same reason as above, and the thumbnail-only
    // line is not: this picture is large, it is merely the wrong shape for a
    // banner.
    draw(
      embed({
        type: "image",
        video: undefined,
        author: undefined,
        image: {
          url: "https://img.example/tall.png",
          width: 1000,
          height: 1418,
          preview: { data_url: DATA_URL, mime: "image/png", width: 452, height: 640 },
        },
      }),
    );

    expect(screen.getByText("1000×1418")).toBeTruthy();
    expect(screen.queryByText("Thumbnail only · open for full size")).toBeNull();
  });

  it("makes the price the headline of a listing, with what it saves", () => {
    draw(
      embed({
        type: "product",
        title: "THE C64 Maxi",
        site_name: "mydealz.de",
        url: "https://www.mydealz.de/deals/the-c64-maxi",
        video: undefined,
        author: undefined,
        price: { amount: "89.99", currency: "EUR", was: "129.99", availability: "instock" },
        fields: [{ name: "shipping", value: "Free", inline: true }],
        image: {
          url: "https://img.example/c64.png",
          width: 600,
          height: 400,
          preview: { data_url: DATA_URL, mime: "image/png", width: 600, height: 400 },
        },
      }),
    );

    expect(screen.getByText(/89/)).toBeTruthy();
    // What it cost before, and the saving stated rather than left to be
    // worked out from two numbers.
    expect(screen.getByText(/129/)).toBeTruthy();
    expect(screen.getByText("−31%")).toBeTruthy();
    expect(screen.getByText("View deal")).toBeTruthy();
    expect(screen.getByText("In stock · Free shipping")).toBeTruthy();
  });

  it("collapses a price comparison to a row with a from-price", () => {
    // No product shot of its own and a list of shops instead: there is
    // nothing to make a poster out of, so it takes the half-height row.
    draw(
      embed({
        type: "product",
        title: "Samsung 860 EVO 1TB",
        site_name: "idealo.de",
        url: "https://www.idealo.de/preisvergleich/860-evo",
        video: undefined,
        author: undefined,
        price: { amount: "64.90", currency: "EUR", was: "", availability: "" },
        fields: [{ name: "sellers", value: "21", inline: true }],
      }),
    );

    expect(screen.getByText(/from .*64/)).toBeTruthy();
    expect(screen.getByText("21 shops")).toBeTruthy();
  });

  it("draws a thread's counts as counts and prints the facts it does not know", () => {
    draw(
      embed({
        type: "forum",
        title: "[OC] Eli Lilly first half of 2026 revenue",
        site_name: "Reddit",
        url: "https://www.reddit.com/r/dataisbeautiful/comments/x",
        video: undefined,
        author: undefined,
        fields: [
          { name: "score", value: "3.4K", inline: true },
          { name: "comments", value: "206", inline: true },
          { name: "Assembled by", value: "hand", inline: true },
        ],
      }),
    );

    // The two the crawler recognised get a glyph, which reads as a score and
    // a reply count in any language; the one it did not keeps the label the
    // page wrote, because that is the only thing that explains it.
    expect(screen.getByText("↑ 3.4K · 💬 206 · Assembled by: hand")).toBeTruthy();
  });

  it("names an unclassified link by its host and offers nothing to play", () => {
    draw(
      embed({
        type: "link",
        title: undefined,
        site_name: undefined,
        provider: undefined,
        video: undefined,
        author: undefined,
        url: "https://example.org/",
      }),
    );

    // Nothing to say about it beyond where it goes, which is still better
    // than a bare URL: the host is both the chip and the title.
    expect(screen.getAllByText("example.org").length).toBeGreaterThan(1);
    expect(screen.queryByLabelText("Play video")).toBeNull();
  });
  it("names its source once, not once in a chip and once above the title", () => {
    // The row poster prints the source in its text column. A chip as well was
    // the same words twice, and on that layout the chip sat half over the
    // thumb and half over the column it was repeating.
    draw(
      embed({
        type: "article",
        title: "Die erste Adresse für Nachrichten",
        site_name: "tagesschau.de",
        url: "https://www.tagesschau.de/",
        video: undefined,
        author: undefined,
        image: {
          url: "https://img.example/t.jpg",
          width: 1200,
          height: 630,
          preview: { data_url: DATA_URL, mime: "image/png", width: 640, height: 336 },
        },
      }),
    );

    expect(screen.getAllByText("tagesschau.de")).toHaveLength(1);
  });

  it("says nothing twice when the description is the title again", () => {
    draw(
      embed({
        type: "article",
        title: "Die erste Adresse für Nachrichten",
        description: "Die erste Adresse für Nachrichten.",
        site_name: "tagesschau.de",
        url: "https://www.tagesschau.de/",
        video: undefined,
        author: undefined,
      }),
    );

    // The trailing full stop is not new information, and neither is anything
    // else about that line.
    expect(screen.queryByText("Die erste Adresse für Nachrichten.")).toBeNull();
    expect(screen.getByText("Die erste Adresse für Nachrichten")).toBeTruthy();
  });

  it("lays out an unclassified page by its picture rather than as text", () => {
    // What every page looks like from a server that predates the classifier:
    // type "link", and a portrait picture. Treated as text it went through the
    // side-thumb crop, which is the one thing the shape rules exist to avoid.
    draw(
      embed({
        type: "link",
        title: "水面のふたり",
        site_name: "pixiv",
        url: "https://www.pixiv.net/artworks/1",
        video: undefined,
        author: undefined,
        image: {
          url: "https://img.example/tall.png",
          width: 1000,
          height: 1418,
          preview: { data_url: DATA_URL, mime: "image/png", width: 452, height: 640 },
        },
      }),
    );

    // The measured size is only printed by the posters that show the picture
    // whole, so its presence is the layout having been chosen from the art.
    expect(screen.getByText("1000×1418")).toBeTruthy();
  });
  it("keeps a line under the title when the page named nobody and counted nothing", () => {
    // The line the old card never lost. A page that published no byline and
    // no counts - most of the web - still has a blurb, and a poster with a
    // title and nothing else is the card at its least useful. A card with
    // something to press is the exception, and this one has nothing.
    draw(
      embed({
        type: "image",
        url: "https://example.org/pieces/stargazer",
        title: "Stargazer",
        description: "The fourth of my mixes — tracklist in the description.",
        video: undefined,
        author: undefined,
        image: {
          url: "https://img.example/wide.png",
          width: 1280,
          height: 720,
          preview: { data_url: DATA_URL, mime: "image/png", width: 640, height: 360 },
        },
      }),
    );

    expect(screen.getByText("The fourth of my mixes — tracklist in the description.")).toBeTruthy();
  });

  it("draws the site's own mark from the bytes the server sent", () => {
    const icon = "data:image/png;base64,aWNvbg==";
    draw(
      embed({
        type: "article",
        title: "Die erste Adresse für Nachrichten",
        site_name: "tagesschau.de",
        video: undefined,
        author: undefined,
        favicon: {
          url: "https://www.tagesschau.de/favicon.ico",
          preview: { data_url: icon, mime: "image/png" },
        },
      }),
    );

    const mark = document.querySelector(`img[src="${icon}"]`);
    expect(mark).toBeTruthy();
    // Never the origin's URL: a favicon fetched from here would tell that
    // host who is reading the conversation, which is the whole reason the
    // server fetches previews at all.
    expect(document.querySelector('img[src^="https://"]')).toBeNull();
  });
  it("lays a picture out from its own bytes, not from a claim about another one", () => {
    // The bug this exists for: pixiv's page claims a landscape sharing card
    // while the bytes the server actually fetched are the portrait artwork.
    // Believing the claim laid the portrait out as a banner and cropped the
    // subject out of the middle of it.
    class MeasuredImage {
      onload: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_value: string) {
        this.naturalWidth = 452;
        this.naturalHeight = 640;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", MeasuredImage);

    draw(
      embed({
        type: "link",
        title: "オデット",
        site_name: "pixiv",
        url: "https://www.pixiv.net/en/artworks/148393517",
        video: undefined,
        author: undefined,
        image: {
          url: "https://img.example/card.png",
          width: 1200,
          height: 630,
          preview: { data_url: DATA_URL, mime: "image/png", width: 1200, height: 630 },
        },
      }),
    );

    return waitFor(() => {
      // Contained on a bed of itself draws the picture twice - once blurred
      // as the ground, once whole in front of it - where a cropped banner
      // draws it once. Two is the portrait having been recognised.
      expect(document.querySelectorAll(`img[src="${DATA_URL}"]`)).toHaveLength(2);
    }).finally(() => vi.unstubAllGlobals());
  });
  it("offers a video both ways at once, and drops the blurb that would crowd them", () => {
    // The two things anybody does with a video link: watch it here, or watch
    // it with everybody. They share one pill - the filled block plays, the
    // label starts the session - and the page's marketing sentence does not
    // get squeezed between the title and the control.
    draw(
      embed({
        description: "Best and Funniest Air Traffic Control from mostly the USA.",
        thumbnail: { url: "https://img.example/t.jpg", preview: { data_url: DATA_URL, mime: "image/png" } },
      }),
    );

    expect(screen.getByLabelText("Play video")).toBeTruthy();
    expect(screen.getByText("Watch together")).toBeTruthy();
    expect(screen.queryByText("Best and Funniest Air Traffic Control from mostly the USA.")).toBeNull();
  });
  it("plays a video the server said nothing about, from the link itself", () => {
    // Nothing fills `embed.video`: the canon carries what a crawler reads off
    // a page, and an embeddable player URL is not that. Without deriving one
    // here the blue block appeared on the pill and did nothing.
    draw(
      embed({
        video: undefined,
        thumbnail: { url: "https://img.example/t.jpg", preview: { data_url: DATA_URL, mime: "image/png" } },
      }),
      true,
    );

    fireEvent.click(screen.getByLabelText("Play video"));
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/eKqZWVcYs7E",
    );
  });
  /** Which poster the card decided on. */
  const shape = () => document.querySelector("[data-preview-shape]")?.getAttribute("data-preview-shape");

  it("draws a story the server classified as one with its headline beside the picture", () => {
    // The kind is the crawler's answer, not a guess made here: it had the
    // page in front of it. A story gets the side-thumb row whatever its
    // picture looks like.
    draw(
      embed({
        type: "article",
        title: "Die erste Adresse für Nachrichten",
        description: "Rund um die Uhr aktualisiert.",
        url: "https://www.tagesschau.de/",
        video: undefined,
        author: undefined,
        image: {
          url: "https://img.example/card.png",
          width: 1200,
          height: 630,
          preview: { data_url: DATA_URL, mime: "image/png", width: 1200, height: 630 },
        },
      }),
    );

    expect(shape()).toBe("row");
  });

  it("gives an unclassified page with a picture a poster rather than a thumbnail", () => {
    // "link" is what a page arrives as from a server older than the
    // classifier, and from any page the classifier could not place. A hero it
    // came with is still a hero.
    draw(
      embed({
        type: "link",
        title: "Die erste Adresse für Nachrichten",
        description: "Rund um die Uhr aktualisiert.",
        url: "https://www.tagesschau.de/",
        video: undefined,
        author: undefined,
        image: {
          url: "https://img.example/card.png",
          width: 1200,
          height: 630,
          preview: { data_url: DATA_URL, mime: "image/png", width: 1200, height: 630 },
        },
      }),
    );

    expect(shape()).toBe("full");
  });

  it("still treats a photograph as a photograph", () => {
    draw(
      embed({
        type: "link",
        title: "Summer beach",
        url: "https://danbooru.donmai.us/posts/1",
        video: undefined,
        author: undefined,
        image: {
          url: "https://img.example/photo.png",
          width: 1600,
          height: 900,
          preview: { data_url: DATA_URL, mime: "image/png", width: 640, height: 360 },
        },
      }),
    );

    // 16:9 and no blurb: nobody draws a sharing card at that ratio, so it is
    // the thing itself and gets the full poster.
    expect(shape()).toBe("full");
  });

  it("keeps a video a video, whatever shape its thumbnail is", () => {
    // A YouTube thumbnail is 16:9 with a description under it, which is the
    // shape of a sharing card; the link being recognisably a video settles
    // it before the picture gets a say.
    draw(
      embed({
        type: "link",
        description: "Tracklist in the description.",
        image: {
          url: "https://img.example/thumb.png",
          width: 1280,
          height: 720,
          preview: { data_url: DATA_URL, mime: "image/png", width: 640, height: 360 },
        },
      }),
    );

    expect(shape()).toBe("full");
    expect(screen.getByText("Watch together")).toBeTruthy();
  });
  it("contains a portrait the server classified as a picture", () => {
    // An artwork host declares `og:type=article` on its pieces; its oEmbed
    // endpoint says "photo", and `classify.rs` believes the endpoint. By the
    // time the kind arrives here it is an answer, so this only has to pick
    // the right poster for the shape.
    draw(
      embed({
        type: "image",
        title: "秤アツコ",
        description: "An illustration.",
        url: "https://www.pixiv.net/en/artworks/112922619",
        video: undefined,
        author: undefined,
        image: {
          url: "https://img.example/art.png",
          width: 1000,
          height: 1418,
          preview: { data_url: DATA_URL, mime: "image/png", width: 452, height: 640 },
        },
      }),
    );

    expect(shape()).toBe("contained");
  });
  it("gives an artwork host's sharing card the poster, not the thumbnail", () => {
    // Measured off the real page: pixiv publishes og:type=article, an
    // og:description of "pixiv", and a 1200×630 card with the piece inset in
    // it. Every one of those signals says "text source" on its own, and all
    // three together are still a picture - the card *is* the artwork, and a
    // 124px thumbnail of it is the one thing the link was not about.
    draw(
      embed({
        type: "image",
        title: "BlueArchive, Hakari Atsuko / 秤アツコ - pixiv",
        description: "pixiv",
        site_name: "pixiv",
        url: "https://www.pixiv.net/en/artworks/112922619",
        video: undefined,
        author: undefined,
        image: {
          url: "https://embed.pixiv.net/artwork.php?illust_id=112922619",
          width: 1200,
          height: 630,
          preview: { data_url: DATA_URL, mime: "image/png", width: 1200, height: 630 },
        },
      }),
    );

    expect(shape()).toBe("full");
  });
  it("says who made it, how it did and when, from what the crawler read", () => {
    // The three facts a sharing vocabulary has no room for, which the crawler
    // now reads out of the page's structured data.
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString();
    draw(
      embed({
        type: "image",
        title: "水面のふたり",
        url: "https://art.example/piece",
        video: undefined,
        author: { name: "ame" },
        published_time: twoYearsAgo,
        fields: [{ name: "likes", value: "12.4K", inline: true }],
        image: {
          url: "https://img.example/art.png",
          width: 1000,
          height: 1418,
          preview: { data_url: DATA_URL, mime: "image/png", width: 452, height: 640 },
        },
      }),
    );

    // A contained poster names the source in the chip, so the byline stays on
    // the line under the title with the counts and the age.
    expect(screen.getByText(/by ame/)).toBeTruthy();
    expect(screen.getByText(/12\.4K/)).toBeTruthy();
    // Last of the three, because how old a thing is matters less than who
    // made it and how it did - and the line holds three.
    expect(screen.getByText(/2 years ago/)).toBeTruthy();
  });

  it("prints the page's own word for what is on it", () => {
    draw(
      embed({
        type: "image",
        title: "A piece",
        url: "https://art.example/piece",
        video: undefined,
        author: undefined,
        fields: [{ name: "content.rating", value: "explicit", inline: false }],
        image: {
          url: "https://img.example/art.png",
          width: 900,
          height: 1200,
          preview: { data_url: DATA_URL, mime: "image/png", width: 480, height: 640 },
        },
      }),
    );

    // As the page wrote it, capitalised - not the key it travelled under.
    expect(screen.getByText(/Explicit/)).toBeTruthy();
  });
  it("hands its links to the external-link guard, like every other link in the app", () => {
    // The guard intercepts `data-external` anchors and nothing else. An
    // unmarked one navigates this window to the page, with nothing left to
    // come back with - and on a message that is nothing but a link, the
    // poster is the only way out of the app there is.
    draw(
      embed({
        thumbnail: { url: "https://img.example/t.jpg", preview: { data_url: DATA_URL, mime: "image/png" } },
      }),
    );

    const link = document.querySelector("a[href='https://www.youtube.com/watch?v=eKqZWVcYs7E']");
    expect(link).toBeTruthy();
    expect(link!.hasAttribute("data-external")).toBe(true);
  });

  it("marks a listing's own action as external too", () => {
    draw(
      embed({
        type: "product",
        title: "THE C64 Maxi",
        url: "https://shop.example/c64",
        video: undefined,
        author: undefined,
        price: { amount: "89.99", currency: "EUR", was: "", availability: "" },
        image: {
          url: "https://img.example/c64.png",
          width: 600,
          height: 400,
          preview: { data_url: DATA_URL, mime: "image/png", width: 600, height: 400 },
        },
      }),
    );

    const deal = screen.getByText("View deal").closest("a");
    expect(deal?.hasAttribute("data-external")).toBe(true);
  });
});
