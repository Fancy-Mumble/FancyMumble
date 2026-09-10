import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { useTheme, type Theme } from "@mui/material/styles";

import { useWatchStart } from "@core/features/chat/watch/useWatchStart";
import type { EmbedMedia, LinkEmbed } from "@core/types";
import { PlayIcon } from "@ui/icons";
import { LinkGuard, Stack } from "../primitives";

/**
 * The card under - or inside - a message that carries a link.
 *
 * # Everything is a poster; the picture decides which kind
 *
 * There is one shell: a rectangle the width of the bubble's band, cut at the
 * corner the skin cuts its bubbles at, with the artwork clipped to the same
 * shape and the words printed over it. What changes between a video, a piece
 * of art, a shop listing and a news story is not the card, it is which poster
 * that shell draws, and that is chosen from two things the server now tells
 * us: what kind of thing the link is, and how big the picture *was* before it
 * was shrunk.
 *
 * * **wide and sharp** - at least twice the band across - fills the poster
 *   edge to edge;
 * * **tall** is contained on a blurred bed of itself, because a portrait
 *   cropped to a banner is a picture of somebody's chin;
 * * **small or low-resolution** is drawn at its own size on that same bed and
 *   never enlarged, because an enlarged thumbnail is mush and the reader can
 *   see it is mush;
 * * **a text source, or no picture at all** gets the half-height side-thumb
 *   poster, and with nothing to show at all, a tinted ground and a monogram;
 * * **a price** turns it into a listing, where the price is the headline.
 *
 * Nothing may enter the cut corner: the bottom row keeps its distance from the
 * trailing edge and the actions sit on the leading side, so no button is ever
 * half-clipped by the notch.
 *
 * # The picture is the server's, always
 *
 * Pictures come from the copy the server inlined wherever there is one, and
 * from the origin only where the reader has allowed external resources: a card
 * that fetched its own thumbnail would tell every site linked here who is
 * reading, and when. [`pictureOf`] is the only place that decides it.
 *
 * # Why the poster is dark in both schemes
 *
 * A poster is artwork with words over it, and the words are legible over
 * artwork by being white with a shadow under a dark scrim. That is a property
 * of the picture, not of the reader's colour scheme, so the shell keeps its
 * own inks in light and dark alike - the same way a film poster does not
 * invert when you turn the lights on.
 */

/**
 * The widest a poster is drawn, and the width the picture rules are measured
 * against.
 *
 * A *maximum*, not a width: the poster fills the bubble it is in, and capping
 * it at the mock's own 340 left a gutter down the right of every card and a
 * title clamped to two short lines in a column half the card wide.
 */
const BAND = 460;
/** A full poster: a 16:9-ish banner. */
const FULL_H = 200;
/** Tall art, contained: enough height for a portrait to be worth showing. */
const TALL_H = 290;
/** The side-thumb poster, with a picture and without one. */
const ROW_H = 112;
const BARE_H = 88;
/** A listing, whose price block needs more room than a title does. */
const SHOP_H = 196;
/** The picture in a side-thumb poster. */
const THUMB_W = 124;
const THUMB_H = 88;
/** The ordinary inset of anything printed on a poster. */
const PAD = 13;
/**
 * The inset on the bottom corner the skin cuts, where it cuts one.
 *
 * The cut is a 12-18px diagonal, and text run into it is sliced. Only the
 * corner that is actually cut pays for it: a blanket gutter down the trailing
 * edge cost every card 30px of column on the skins whose bubbles are cut on
 * the *leading* side, and every card on the eleven skins that cut nothing at
 * all.
 */
const CUT_PAD = 30;

/**
 * The padding a poster has to cancel to reach its bubble's own edges.
 *
 * Passed in rather than known here: the bubble is the one that applies it,
 * and a poster carrying its own copy of the number is a poster that leaves a
 * strip of bubble showing the day the bubble's padding changes.
 */
export interface Bleed {
  x: number;
  bottom: number;
}

/** A picture ready to draw, and the two sizes that describe it. */
interface Picture {
  src: string;
  /**
   * The size of the bytes being drawn, measured off the picture itself.
   *
   * Every layout decision is made from this rather than from what the page or
   * the server said, because it is the only number that cannot be wrong: a
   * page's `og:image:width` describes whichever picture the page had in mind,
   * an older server reports the size of the original rather than of the
   * thumbnail it sent, and a portrait laid out as a landscape gets its
   * subject cropped out. The shrink keeps the aspect and never enlarges, so
   * measuring the thumbnail answers both questions asked of it - what shape
   * is this, and is it too small to enlarge.
   */
  width: number;
  height: number;
  /** What the page said the original measured, for the chip that states it. */
  claimedWidth: number;
  claimedHeight: number;
}

/**
 * The size of the picture at `src`, measured rather than taken on trust.
 *
 * Every layout decision here is about the shape and the resolution of the
 * bytes - crop them, contain them, or leave them at their own size - and the
 * numbers that come with a preview do not reliably describe those bytes: the
 * page states the size of whichever picture it had in mind, a server older
 * than `source_width` reports the original's size for a thumbnail it shrank,
 * and either way a portrait laid out as a landscape loses its subject to the
 * crop. Measuring is the one answer that cannot disagree with what is drawn.
 *
 * `new Image()` rather than an `onLoad` on the rendered element: the answer
 * decides *which* element to render.
 */
function useNaturalSize(src: string | undefined): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!src) return;
    let live = true;
    const probe = new Image();
    probe.onload = () => {
      if (live) setSize({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return size;
}

/** Which poster a card draws. */
type Shape = "full" | "contained" | "native" | "row" | "shop" | "shopRow";

/**
 * The picture to draw, or nothing.
 *
 * The server's downscaled copy first and the origin URL only on consent -
 * returning `undefined` is the privacy-preserving answer, and the caller draws
 * a poster without a picture rather than reaching for the network.
 */
function pictureOf(embed: LinkEmbed, allowExternal: boolean): Picture | undefined {
  const media: EmbedMedia | undefined = embed.image ?? embed.thumbnail;
  if (!media) return undefined;
  const src = media.preview?.data_url ?? (allowExternal ? media.url : undefined);
  if (!src) return undefined;
  // `width`/`height` are the original's and the preview pair is the bytes that
  // travelled. The original is what the layout is chosen from, because after
  // the shrink the difference between a thumbnail and a photograph is no
  // longer visible in the picture.
  return {
    src,
    // Filled in by the caller once the picture has been measured. What the
    // page claimed is kept beside it, for the chip that states the size of
    // the original - which is a fact about the work, not about the bytes.
    width: 0,
    height: 0,
    claimedWidth: media.width ?? media.preview?.width ?? 0,
    claimedHeight: media.height ?? media.preview?.height ?? 0,
  };
}

/**
 * What kind of thing this link is, as far as anything here can tell.
 *
 * The server's classification wherever it made one - it had the page in front
 * of it, which nothing here does. `link` is what an unclassified page arrives
 * as, and what *every* page arrives as from a server older than the crawler,
 * so rather than draw all of those the same way this reads the two things a
 * client can honestly tell:
 *
 * * the link is a video, because the same detector that offers "watch
 *   together" has already recognised it as one;
 * * the picture is a **sharing card** rather than a photograph. 1200x630 is
 *   what the `OpenGraph` documentation tells publishers to make, so a picture
 *   at about that ratio is one a marketing team drew for exactly this card -
 *   which is what a news story, a repository or a forum thread sends, and
 *   what a piece of art does not.
 *
 * Everything else with a picture is treated as a picture. A crawler that has
 * read the page beats all of this, which is why it is only consulted when the
 * server said nothing.
 */
function kindOf(embed: LinkEmbed, isVideo: boolean): string {
  // A link the same detector that offers "watch together" recognised is a
  // video, whatever the page said - including on a server that says nothing.
  if (isVideo) return "video";
  return embed.type;
}

/**
 * The kinds the server classified as words rather than media.
 *
 * They take the side-thumb poster: a headline with a photograph beside it,
 * which is what the artboard draws for a news story and a forum thread.
 */
const TEXT_KINDS = new Set(["article", "forum", "profile"]);

/**
 * Which poster this link gets.
 *
 * Two questions, in this order: what did the *server* say this is, and what
 * shape is the picture. Nothing here sniffs a ratio to guess at a kind or
 * reads a description to decide whether a page is prose - that is the
 * crawler's job, it has the page in front of it, and every attempt to
 * second-guess it here traded one wrong card for another. An artwork host
 * that calls its pieces articles is corrected in `classify.rs`, where the
 * oEmbed type says "photo"; by the time a kind arrives here it is an answer,
 * not a hint.
 *
 * `link` - an unclassified page, and everything at all from a server older
 * than the classifier - falls through to the picture rules, so a page that
 * came with a hero still gets one.
 */
function shapeOf(embed: LinkEmbed, picture: Picture | undefined, kind: string): Shape {
  if (embed.price?.amount) {
    // A price comparison has no product shot of its own and a list of shops
    // instead, so it collapses to the half-height row with a "from" price.
    const compares = !picture || embed.fields?.some((field) => field.name === "sellers");
    return compares ? "shopRow" : "shop";
  }
  // No picture at all: the side-thumb poster on a tinted ground, with a
  // monogram where the thumb would be. A video is the exception - it still
  // has "watch together" to put somewhere, and the row has nowhere to put
  // it - so it takes the full poster short.
  if (!picture) return kind === "video" ? "full" : "row";
  // Words, as classified: the picture is a photograph beside a headline, not
  // the thing the link is about.
  if (TEXT_KINDS.has(kind)) return "row";

  const { width, height } = picture;
  const ratio = width > 0 && height > 0 ? width / height : 0;
  // The picture decides first, and this is the whole thesis of the design:
  // *the image decides which poster*. A page's `og:type` does not survive
  // contact with the web - an artwork host declares its pieces "article",
  // a news site declares a photo essay the same - so a portrait is contained
  // and a small picture is left at its own size whatever the page called
  // itself. Believing the label here is what put a piece of art in a 124px
  // thumbnail beside two lines of text.
  if (ratio > 0 && ratio < 0.9) return "contained";
  if (width > 0 && width < 400) return "native";
  // Media, landscape, big enough to carry the card: the full poster.
  return "full";
}

/**
 * How tall a poster stands.
 *
 * The rows carry text and nothing else, so their height is a *floor* rather
 * than a frame: a headline that wraps to two lines over a two-line blurb is
 * taller than the row a one-line headline needs, and a fixed height turned
 * that into a card with its last line sliced off along the bottom edge. The
 * listing keeps its frame, because the price block it is sized for is drawn
 * over a picture at a fixed place.
 *
 * The three picture posters have no height at all: a band whose height is a
 * constant crops every photograph to the same letterbox whatever shape it
 * was, which is the one thing this design exists not to do. They are given a
 * *ratio* instead and take whatever height the bubble's width implies,
 * clamped so that a panorama still shows and a near-square does not fill the
 * window.
 */
function heightOf(
  shape: Shape,
  picture: Picture | undefined,
): { height?: number; minHeight?: number; aspectRatio?: string; maxHeight?: number } {
  switch (shape) {
    case "row":
      return { minHeight: picture ? ROW_H : BARE_H };
    case "shop":
      return { height: SHOP_H };
    case "shopRow":
      return { minHeight: BARE_H };
    case "contained":
      // Tall art is shown whole on a bed, so the poster is as tall as it is
      // allowed to get and the art is contained inside it.
      return { height: TALL_H };
    case "native":
      // The picture at its own size, with room for the words under it.
      return { height: Math.min(TALL_H, Math.max(FULL_H - 40, (picture?.height ?? 0) + 92)) };
    default: {
      const { width = 0, height = 0 } = picture ?? {};
      if (width <= 0 || height <= 0) return { height: FULL_H - 52 };
      // Between a panorama and a squat 4:3: outside that, the crop is smaller
      // than the damage a poster the height of the window would do.
      const ratio = Math.min(Math.max(width / height, 4 / 3), 2.6);
      // Capped as well as clamped: a wide bubble would otherwise turn a 4:3
      // picture into a poster the height of the conversation.
      return { aspectRatio: `${ratio}`, maxHeight: TALL_H };
    }
  }
}

/**
 * The corner the poster is cut at.
 *
 * `--nebula-clip-bubble` and not the skin object, because that variable is
 * what `chamferedSurface` draws the *bubble* with: reading the same value is
 * what makes the poster and the message it belongs to one shape rather than
 * two that happen to agree. It resolves to `none` on the skins that cut
 * nothing, where the radius below is what every other surface takes.
 */
const OWN_CHAMFER = "polygon(0 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%)";

/**
 * The polygon a poster is cut with: the skin's, or the preview's own.
 *
 * Taking the skin's bubble cut is what makes the poster and the message one
 * shape. Where a skin cuts nothing the poster still cuts its own corner - the
 * chamfer is this preview's identity, not a decoration borrowed from the
 * bubble, and a square card on a square bubble reads as two rectangles that
 * happen to be stacked.
 */
function posterClip(theme: Theme): string {
  const cut = theme.palette.nebulaSkin.clipBubble;
  return cut && cut !== "none" ? cut : OWN_CHAMFER;
}

/**
 * Which bottom corner the skin's bubble cut eats, if either.
 *
 * Read off the polygon the skin states: a cut bottom corner is a vertex at
 * `calc(100% - n)` down one side, next to one at the full height. The
 * catalogue's drawn skins cut the *leading* corner and the mock cuts the
 * trailing one, so neither side can be assumed.
 */
function cutSide(theme: Theme): "left" | "right" | "none" {
  const clip = theme.palette.nebulaSkin.clipBubble;
  if (!clip || clip === "none") return "none";
  if (clip.includes("0 calc(100% -")) return "left";
  if (clip.includes("% calc(100% -")) return "right";
  return "none";
}

/**
 * A hue for a source, derived from its name.
 *
 * The design gives every source its own colour - a red square for one, green
 * for another, gold for a shop. A table of hosts would answer for the five
 * sites somebody thought of and grey for the rest, so the colour is computed
 * from the name instead: stable for a given source, distinct between sources,
 * and it works on a site nobody has ever linked before.
 *
 * Used for the *marks* only - the chip's tile and a monogram's ink - and
 * never for a ground. A whole card tinted by a hash of its host turns a shop
 * maroon and a documentation site green, which is not a design, it is a
 * lottery; the grounds below are the ones the artboard draws, and they are
 * the same cool slate on every card.
 */
function hueOf(label: string): number {
  let hash = 0;
  for (const character of label) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 3600;
  return hash / 10;
}

/**
 * The description, unless it is the title or the source over again.
 *
 * Publishers fill `og:description` with the headline, with the site's own
 * name, or with both, and a card that prints all three says one thing three
 * times. Compared on letters and digits alone, because "Die erste Adresse für
 * Nachrichten" and "Die erste Adresse für Nachrichten." are the same sentence.
 */
function contextOf(embed: LinkEmbed, label: string): string | undefined {
  const description = embed.description?.trim();
  if (!description) return undefined;
  const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const said = bare(description);
  if (!said) return undefined;
  for (const other of [embed.title ?? "", label]) {
    const known = bare(other);
    if (!known) continue;
    // A prefix either way: a description that merely restates the title, and
    // a title that is the first sentence of the description.
    if (said.startsWith(known) || known.startsWith(said)) return undefined;
  }
  return description;
}

/**
 * What to call the place this came from: its host.
 *
 * The host and not `og:site_name`, which is the newer of the two decisions
 * here. A publisher writes whatever it likes in that tag - "Reddit", "pixiv",
 * an empty string, a marketing line - and the question a reader is actually
 * asking of that line is *where does this go*, which only the host answers.
 * `www.` goes because nobody says it.
 */
function sourceLabel(embed: LinkEmbed): string {
  try {
    return new URL(embed.url).hostname.replace(/^www\./, "");
  } catch {
    // Not a URL this can parse, so whatever the page called itself is better
    // than printing the string back.
    return embed.site_name ?? embed.provider?.name ?? embed.url;
  }
}

/** The monogram for a source with no picture: one letter, or two for `r/`. */
function monogramOf(label: string): string {
  const words = label.split(/[\s.]+/).filter(Boolean);
  return (words[0] ?? "?").slice(0, 2);
}

/** The ground under a poster that has no picture to make one from. */
function tintedGround(): string {
  return "radial-gradient(120% 140% at 12% 0%, #33406b 0%, #151c2c 70%)";
}

/** The lit stage a product is photographed on. */
function stageGround(): string {
  return "radial-gradient(120% 130% at 78% 8%, #2c3a5c 0%, #121828 68%)";
}

/** The glyph for the facts that have one, so a count reads at a glance. */
const FACT_GLYPH: Record<string, string> = {
  score: "↑",
  comments: "\u{1F4AC}",
  likes: "♥",
  views: "▶",
};

/** The bottom of a poster: white ink, and a shadow so it survives any picture. */
const OVER_ART = {
  color: "#fff",
  textShadow: "0 1px 10px rgba(0,0,0,.85)",
} as const;

/**
 * The scrim that makes white ink legible over an unknown photograph.
 *
 * Sized for the worst case rather than the average one: the picture under a
 * title is chosen by a stranger, and pale hair, snow or a white product shot
 * are as likely as a dark still. So it starts around the half-way line and
 * reaches near-opaque at the bottom, where the words are - a shallower one
 * looks better on the photographs that did not need it and fails on the ones
 * that did.
 */
const SCRIM =
  "linear-gradient(180deg,rgba(8,11,18,0) 34%,rgba(8,11,18,.45) 55%,rgba(8,11,18,.82) 78%,rgba(8,11,18,.97) 100%)";
/** The same, for a poster whose subject sits in the middle rather than filling it. */
const SCRIM_CONTAINED =
  "linear-gradient(180deg,rgba(8,11,18,.25) 0%,rgba(8,11,18,0) 26%,rgba(8,11,18,.5) 55%,rgba(8,11,18,.86) 80%,rgba(8,11,18,.97) 100%)";
/** A side-thumb poster reads across, so its scrim does too. */
const SCRIM_ACROSS =
  "linear-gradient(90deg,rgba(8,11,18,.55) 0%,rgba(8,11,18,.82) 42%,rgba(8,11,18,.90) 100%)";

/** The blurred, darkened enlargement a contained picture stands on. */
function bedSx(blur: number, brightness: number) {
  return {
    position: "absolute",
    left: -24,
    top: -24,
    width: "calc(100% + 48px)",
    height: "calc(100% + 48px)",
    objectFit: "cover",
    filter: `blur(${blur}px) saturate(1.15) brightness(${brightness})`,
  } as const;
}

/** The ink a source chip prints in. */
const CHIP_INK = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: "#fff",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

/** The source chip, top left: the site's own mark and where this goes. */
function SourceChip({
  label,
  note,
  icon,
}: Readonly<{
  label: string;
  note?: string;
  /** The site's icon, as the server fetched it; a tinted tile without one. */
  icon?: string;
}>) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap="7px"
      sx={{
        position: "absolute",
        left: 13,
        top: 12,
        px: "8px",
        py: "4px",
        maxWidth: `calc(100% - ${CUT_PAD + 26}px)`,
        zIndex: 2,
        background: "rgba(8,11,18,.72)",
        pointerEvents: "none",
      }}
    >
      {/* The site's own mark where the server brought one back, and a tile
          tinted from the name where it did not - never a favicon fetched
          from here, which would tell the origin who is reading. */}
      {icon ? (
        <Box
          component="img"
          src={icon}
          alt=""
          aria-hidden
          sx={{ flex: "none", width: 14, height: 14, objectFit: "contain", display: "block" }}
        />
      ) : (
        <Box
          aria-hidden
          sx={{
            flex: "none",
            width: 13,
            height: 13,
            borderRadius: "2px",
            background: `hsl(${hueOf(label)} 70% 58%)`,
          }}
        />
      )}
      {/* Two elements rather than one interpolated string: the source and
          what qualifies it are two facts, and a reader searching the page for
          either should find it. */}
      <Typography component="span" sx={CHIP_INK}>
        {label}
      </Typography>
      {note && (
        <>
          <Typography component="span" aria-hidden sx={{ ...CHIP_INK, opacity: 0.7 }}>
            ·
          </Typography>
          <Typography component="span" sx={CHIP_INK}>
            {note}
          </Typography>
        </>
      )}
    </Stack>
  );
}

/** The playing time, top right, where the page stated one. */
function DurationBadge({ children }: Readonly<{ children: string }>) {
  return (
    <Typography
      sx={{
        position: "absolute",
        right: 13,
        top: 12,
        zIndex: 2,
        px: "7px",
        py: "3px",
        fontSize: 11.5,
        fontWeight: 600,
        color: "#fff",
        background: "rgba(8,11,18,.72)",
        pointerEvents: "none",
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * The poster's own action: a hard-edged pill on the leading side.
 *
 * Two controls in one shape rather than a button with an icon in it. The
 * filled block is the skin's accent with the glyph knocked out of it and is
 * its own button - on a video it plays the thing here, in the card - and the
 * label beside it does whatever the card's action is. A pill that read as one
 * button would have the two most obvious things to do with a video hidden
 * behind the same press.
 *
 * The wrapper is a plain box, because a button inside a button is not
 * something a browser can be asked to render.
 */
function PosterAction({
  children,
  onClick,
  href,
  play,
  playLabel,
}: Readonly<{
  children: React.ReactNode;
  onClick?: () => void;
  /** Where it goes, for an action that is a link rather than a command. */
  href?: string;
  /** What the filled block does, where the card has something to play. */
  play?: () => void;
  /** Its accessible name, since the block is a glyph and no words. */
  playLabel?: string;
}>) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        alignSelf: "flex-start",
        display: "inline-flex",
        alignItems: "stretch",
        // Three points of air, so the two controls read as two: butted
        // together they are one button with a coloured end, and half of what
        // this pill offers disappears.
        gap: "3px",
        height: 30,
        pointerEvents: "auto",
      }}
    >
      {play && (
        <Box
          component="button"
          type="button"
          aria-label={playLabel}
          onClick={play}
          sx={{
            all: "unset",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            // Square, and the only square on the card: it is a play button,
            // which is a shape people know before they read anything.
            width: 30,
            boxSizing: "border-box",
            color: theme.palette.nebula.onAccent,
            background: theme.palette.nebula.accent,
            "&:hover": { filter: "brightness(1.12)" },
          }}
        >
          <PlayIcon width={13} height={13} />
        </Box>
      )}
      <Box
        component={href ? "a" : "button"}
        type={href ? undefined : "button"}
        href={href}
        // See the poster's own link: the guard watches for this attribute.
        data-external={href ? "" : undefined}
        target={href ? "_blank" : undefined}
        rel={href ? "noopener noreferrer" : undefined}
        onClick={onClick}
        sx={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          px: "11px",
          boxSizing: "border-box",
          background: "#fff",
          color: "#0f131c",
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          clipPath: "polygon(0 0,100% 0,100% 62%,calc(100% - 10px) 100%,0 100%)",
          "&:hover": { background: "#e7eefc" },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/** The title line of a poster, in the display face where the skin has one. */
function PosterTitle({ children, size = 18 }: Readonly<{ children: React.ReactNode; size?: number }>) {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        fontFamily: theme.palette.nebulaSkin.display ?? theme.palette.nebulaSkin.font,
        fontSize: size,
        fontWeight: 600,
        lineHeight: 1.2,
        textWrap: "pretty",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        ...OVER_ART,
      }}
    >
      {children}
    </Typography>
  );
}

/** One line of the facts a page published about itself. */
function FactLine({ facts }: Readonly<{ facts: string[] }>) {
  if (facts.length === 0) return null;
  return (
    <Typography
      sx={{
        fontSize: 12.5,
        color: "#eaf2ff",
        textShadow: "0 1px 8px rgba(0,0,0,.8)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {facts.join(" · ")}
    </Typography>
  );
}

/**
 * One preview, as whichever poster its content asks for.
 *
 * Long, and deliberately one function: the six posters are six arrangements of
 * the same six pieces - bed, subject, scrim, chip, badge, bottom block - and
 * splitting them into six components duplicates the pieces six times, which is
 * how they drift apart.
 */
function Poster({
  embed,
  allowExternalResources,
  channelId,
  bleed,
}: Readonly<{
  embed: LinkEmbed;
  allowExternalResources: boolean;
  channelId: number;
  /** Set when the poster is inside a bubble; see [`Bleed`]. */
  bleed: Bleed | undefined;
}>) {
  const { t, i18n } = useTranslation(["chat", "nebulaChat"]);
  const theme = useTheme();
  // Two steps rather than one: asking to play a video the reader has not
  // allowed the origin to serve shows what loading it would cost first.
  const [consented, setConsented] = useState(false);
  const [asked, setAsked] = useState(false);
  // The embed's own URL is the video, so the poster can offer to start a
  // session on it without being told what the message said.
  // `detected` is how the card can play a link the *server* said nothing
  // about: the same detector the watch-together action uses has already
  // worked out that this is a video and which one.
  const { canStart, busy, start, detected } = useWatchStart(embed.url, channelId);

  const label = sourceLabel(embed);
  const found = pictureOf(embed, allowExternalResources);
  // Measured before it is laid out, and measured whatever the page claimed:
  // the rules below are about the bytes on the card, and a claim that
  // describes a different picture is how a portrait ends up cropped to a
  // band. What was claimed is still carried, for the chip that states it.
  const measuredSize = useNaturalSize(found?.src);
  const picture = found && {
    ...found,
    width: measuredSize.width || found.claimedWidth,
    height: measuredSize.height || found.claimedHeight,
  };
  /**
   * How the card would play this itself, if it can.
   *
   * The server's `video` field first, and the link's own detection after it -
   * which is what actually answers, because nothing fills that field: the
   * canon carries what a crawler can read off a page, and an embeddable
   * player URL is not that. Deriving it here from the link is also what makes
   * the play block appear on exactly the videos "watch together" appears on,
   * rather than on none of them.
   */
  const player = (() => {
    if (embed.video?.url) return { frame: true, src: embed.video.url };
    if (detected?.kind === "youtube" && detected.youtubeId) {
      // `-nocookie` because this is playing somebody else's video inside a
      // chat client: the reader asked to watch it, not to be counted.
      return { frame: true, src: `https://www.youtube-nocookie.com/embed/${detected.youtubeId}` };
    }
    if (detected?.kind === "directMedia") return { frame: false, src: detected.url };
    return undefined;
  })();
  const hasVideo = !!player;

  const kind = kindOf(embed, hasVideo);
  const shape = shapeOf(embed, picture, kind);
  const size = heightOf(shape, picture);

  /**
   * The page's own facts, as the short strings a poster prints.
   *
   * The counts the crawler recognised get a glyph and nothing else - an arrow
   * and a number reads as a score in every language. The ones that are words
   * get a translated noun. Anything it did not recognise keeps the label the
   * page wrote, because that is the only thing that explains it. At most
   * three: the line is one line.
   *
   * Written here rather than beside the other helpers because the keys are
   * literals only where the translator is, and a key assembled from a field
   * name is a key nothing can check.
   */
  const facts: string[] = [];
  for (const field of embed.fields ?? []) {
    if (facts.length === 3) break;
    const glyph = FACT_GLYPH[field.name];
    if (glyph) facts.push(`${glyph} ${field.value}`);
    else if (field.name === "sellers") {
      facts.push(t("nebulaChat:linkPreview.fact.sellers", { value: field.value }));
    } else if (field.name === "shipping") {
      facts.push(t("nebulaChat:linkPreview.fact.shipping", { value: field.value }));
    } else if (field.name === "rating") {
      facts.push(t("nebulaChat:linkPreview.fact.rating", { value: field.value }));
    } else if (field.name === "content.rating") {
      // The page's own word for what is on it - "safe", "explicit" - printed
      // as it wrote it rather than as a key nobody typed.
      facts.push(field.value.charAt(0).toUpperCase() + field.value.slice(1));
    } else if (field.name !== "availability" && !field.name.startsWith("price.")) {
      // Availability and the price rows are drawn by the price block, in the
      // shape a listing wants.
      facts.push(`${field.name}: ${field.value}`);
    }
  }

  /** The description, where it is not the title or the source over again. */
  const context = contextOf(embed, label);

  /**
   * The one line under a title.
   *
   * Whoever made it and whatever the page counted about itself, and where a
   * page published neither - which is most of the web, and every page at all
   * from a server older than the crawler - its own blurb, rather than a
   * poster with a title and nothing else on it.
   */
  // The chip already names the channel on a full poster, and printing it
  // again under the title is the same words twice on a card with room for
  // one line.
  const namedInChip = shape === "full" && !!embed.author?.name;
  const byline =
    embed.author?.name && !namedInChip ? [t("nebulaChat:linkPreview.by", { author: embed.author.name })] : [];
  const stated = [...byline, ...facts];

  /** Whether the thing is there to buy, in words. */
  const stock = (() => {
    const state = embed.price?.availability?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
    if (state.includes("preorder")) return [t("nebulaChat:linkPreview.preorder")];
    if (state.includes("outofstock") || state === "oos") {
      return [t("nebulaChat:linkPreview.outOfStock")];
    }
    if (state.includes("instock")) return [t("nebulaChat:linkPreview.inStock")];
    return [];
  })();

  // Which bottom corner is cut, and therefore which one text has to keep
  // clear of. Only that one pays the wider inset.
  const cut = cutSide(theme);
  const padLeft = cut === "left" ? CUT_PAD : PAD;
  const padRight = cut === "right" ? CUT_PAD : PAD;

  const frame = {
    position: "relative" as const,
    // Inside a bubble the poster breaks out of the bubble's padding so its
    // edges *are* the bubble's edges: the brief is one object, and a card
    // inset inside a plate is two. The width is left to stretch rather than
    // computed as `100% + 2x` - a computed width is only right if the padding
    // is exactly what this file thinks it is, and when it is not the poster
    // hangs off one side.
    ...(bleed ? { ml: `-${bleed.x}px`, mr: `-${bleed.x}px`, mb: `-${bleed.bottom}px` } : { maxWidth: BAND }),
    width: "auto",
    ...size,
    // A row's words are the only thing in this card that is *in* the flow, so
    // the frame is the box they stretch inside: as tall as the floor while
    // they are short, and as tall as they are once they are not. Every other
    // poster draws itself out of flow, where a flex container changes
    // nothing.
    display: "flex",
    overflow: "hidden",
    background: "#0a0d14",
    // Always, attached or not: where the skin cuts nothing the poster still
    // cuts its own corner.
    clipPath: posterClip(theme),
  };
  /** The bottom block, clear of whichever corner the skin cuts. */
  const bottom = {
    position: "absolute" as const,
    left: padLeft,
    right: padRight,
    bottom: 12,
    zIndex: 2,
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    // Clicks fall through to the link under it; the actions inside take their
    // own back.
    pointerEvents: "none" as const,
  };

  const play = () => {
    if (allowExternalResources) setConsented(true);
    else setAsked(true);
  };

  /**
   * The action the poster offers, if it offers one.
   *
   * A video gets both halves of one control: the filled block plays it here,
   * in the card, and the label beside it starts a session everybody watches
   * together. Where there is no session to start, the whole pill is the
   * player; where there is no video, only the label is drawn.
   */
  const action = (() => {
    const playable = hasVideo && !consented;
    if (canStart) {
      return (
        <PosterAction
          play={playable ? play : undefined}
          playLabel={t("chat:linkPreview.playVideo")}
          onClick={() => void start()}
        >
          {busy ? t("chat:contextMenu.watchTogetherBusy") : t("chat:contextMenu.watchTogether")}
        </PosterAction>
      );
    }
    if (playable) {
      return (
        <PosterAction play={play} playLabel={t("chat:linkPreview.playVideo")} onClick={play}>
          {t("chat:linkPreview.playVideo")}
        </PosterAction>
      );
    }
    return null;
  })();

  /**
   * The one line under the title, or none.
   *
   * What the page actually published about the thing - a byline the chip has
   * not already taken, a view count, a score. Where it published none, its
   * own blurb takes the line instead, but only on a poster with nothing else
   * under the title: a card that offers "watch together" has its second line
   * already, and a marketing sentence squeezed between the two is what turns
   * a preview into an advertisement.
   */
  // When it went out, where the page said and there is room for it. Last,
  // because it is the least of the three: who made it and how it did matter
  // more than when, and the line holds three things.
  const when = ago(embed.published_time, i18n.language);
  const dated = when && stated.length < 3 ? [...stated, when] : stated;
  const meta = dated.length > 0 ? dated : action || !context ? [] : [context];

  /**
   * The size the chip states on an art poster.
   *
   * The original's, where the page or the server said what it was - that is
   * the fact a reader wants about a piece of art. The thumbnail's own size
   * otherwise, which is at least true of what they are looking at.
   */
  const measured = (() => {
    if (!picture) return undefined;
    const width = picture.claimedWidth || picture.width;
    const height = picture.claimedHeight || picture.height;
    return width > 0 && height > 0 ? `${width}×${height}` : undefined;
  })();

  const title = embed.title ?? label;

  return (
    <LinkGuard>
      {player && consented ? (
        <Box
          sx={{
            // The player takes the poster's own footprint, bleed and all, so
            // pressing play does not make the message jump sideways.
            ...(bleed
              ? { ml: `-${bleed.x}px`, mr: `-${bleed.x}px`, mb: `-${bleed.bottom}px` }
              : { maxWidth: BAND }),
            width: "auto",
            aspectRatio: "16 / 9",
            overflow: "hidden",
            background: "#000",
            clipPath: posterClip(theme),
          }}
        >
          {player.frame ? (
            <Box
              component="iframe"
              src={player.src}
              title={embed.title ?? label}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              sandbox="allow-scripts allow-same-origin allow-popups"
              sx={{ width: "100%", height: "100%", border: 0, display: "block" }}
            />
          ) : (
            // A file rather than a service: played by the browser itself, with
            // no third party between the reader and the bytes.
            <Box
              component="video"
              src={player.src}
              controls
              autoPlay
              sx={{ width: "100%", height: "100%", display: "block", background: "#000" }}
            />
          )}
        </Box>
      ) : (
        // Which poster this turned out to be, stated on the element. It is
        // the one thing about this card that is a *decision* rather than a
        // drawing, and a test that has to infer it from box sizes is a test
        // that breaks when a padding changes.
        <Box data-preview-shape={shape} sx={frame}>
          {/* -- the ground -------------------------------------------- */}
          {picture && shape !== "full" && shape !== "shop" && shape !== "shopRow" && (
            <Box
              component="img"
              src={picture.src}
              alt=""
              aria-hidden
              sx={bedSx(shape === "row" ? 24 : 26, shape === "row" ? 0.42 : 0.6)}
            />
          )}
          {!picture && shape !== "shop" && (
            <Box sx={{ position: "absolute", inset: 0, background: tintedGround() }} />
          )}
          {(shape === "shop" || shape === "shopRow") && (
            <Box sx={{ position: "absolute", inset: 0, background: stageGround() }} />
          )}

          {/* -- the subject ------------------------------------------- */}
          {shape === "full" && picture && (
            <Box
              component="img"
              src={picture.src}
              alt=""
              sx={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          )}
          {shape === "contained" && picture && (
            <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <Box
                component="img"
                src={picture.src}
                alt=""
                sx={{
                  display: "block",
                  width: "auto",
                  // Contained, never enlarged: the height is the poster's or
                  // the picture's, whichever is smaller.
                  height: Math.min(TALL_H, picture.height || TALL_H),
                  maxWidth: "100%",
                }}
              />
            </Box>
          )}
          {shape === "native" && picture && (
            <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <Box
                component="img"
                src={picture.src}
                alt=""
                sx={{
                  display: "block",
                  // Its own pixels, one for one, and only shrunk if it would
                  // not otherwise fit.
                  width: picture.width || "auto",
                  maxWidth: "88%",
                  maxHeight: "76%",
                  boxShadow: "0 6px 22px rgba(0,0,0,.55)",
                }}
              />
            </Box>
          )}

          {/* -- the scrim --------------------------------------------- */}
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                shape === "row" || shape === "shopRow"
                  ? SCRIM_ACROSS
                  : shape === "full" || shape === "shop"
                    ? SCRIM
                    : SCRIM_CONTAINED,
            }}
          />

          {/* -- the side-thumb poster, which reads across -------------- */}
          {shape === "row" && (
            <Stack
              direction="row"
              alignItems="center"
              gap="12px"
              sx={{
                position: "relative",
                flex: 1,
                minWidth: 0,
                zIndex: 2,
                pointerEvents: "none",
                p: `12px ${padRight}px 12px ${padLeft}px`,
              }}
            >
              {picture ? (
                <Box
                  component="img"
                  src={picture.src}
                  alt=""
                  sx={{
                    flex: `0 0 ${THUMB_W}px`,
                    width: THUMB_W,
                    height: THUMB_H,
                    objectFit: "cover",
                    display: "block",
                    // A ground of its own, because a logo with a transparent
                    // corner and a picture shorter than the slot would both
                    // otherwise show the blurred bed through in patches and
                    // leave the thumb without an edge.
                    background: "#10151f",
                    boxShadow: "0 4px 16px rgba(0,0,0,.5)",
                  }}
                />
              ) : (
                <Box
                  aria-hidden
                  sx={{
                    flex: "0 0 64px",
                    width: 64,
                    height: 64,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(8,11,18,.55)",
                    fontFamily: theme.palette.nebulaSkin.display ?? theme.palette.nebulaSkin.font,
                    fontSize: 22,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: `hsl(${hueOf(label)} 70% 62%)`,
                  }}
                >
                  {monogramOf(label)}
                </Box>
              )}
              {/* All the width the thumb did not take. Without `flex: 1` the
                  column is only as wide as its longest unbreakable word, and
                  a two-line title clamps inside a third of the card. */}
              <Stack sx={{ flex: 1, gap: "4px", minWidth: 0 }}>
                <Caps icon={embed.favicon?.preview?.data_url}>{label}</Caps>
                <PosterTitle size={15.5}>{title}</PosterTitle>
                {facts.length > 0 ? <FactLine facts={facts} /> : context && <Sub>{context}</Sub>}
              </Stack>
            </Stack>
          )}

          {/* -- a price comparison, which is a row with a price -------- */}
          {shape === "shopRow" && (
            <Stack
              direction="row"
              alignItems="center"
              gap="12px"
              sx={{
                position: "relative",
                flex: 1,
                minWidth: 0,
                zIndex: 2,
                pointerEvents: "none",
                p: `12px ${padRight}px 12px ${padLeft}px`,
              }}
            >
              <Box
                aria-hidden
                sx={{
                  flex: "0 0 64px",
                  width: 64,
                  height: 64,
                  display: "grid",
                  placeItems: "center",
                  background: "#fff",
                  overflow: "hidden",
                }}
              >
                {picture ? (
                  <Box
                    component="img"
                    src={picture.src}
                    alt=""
                    sx={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  />
                ) : (
                  <Box
                    sx={{
                      fontSize: 15,
                      fontWeight: 700,
                      letterSpacing: ".04em",
                      textTransform: "uppercase",
                      color: "#1b2130",
                    }}
                  >
                    {monogramOf(label)}
                  </Box>
                )}
              </Box>
              <Stack sx={{ flex: 1, gap: "3px", minWidth: 0 }}>
                <Caps icon={embed.favicon?.preview?.data_url}>{label}</Caps>
                <PosterTitle size={15}>{title}</PosterTitle>
                <Stack direction="row" alignItems="baseline" gap="8px">
                  <Typography
                    sx={{
                      fontFamily: theme.palette.nebulaSkin.display ?? theme.palette.nebulaSkin.font,
                      fontSize: 16,
                      fontWeight: 700,
                      color: theme.palette.nebula.ok,
                    }}
                  >
                    {embed.price
                      ? t("nebulaChat:linkPreview.fromPrice", {
                          price: money(embed.price, i18n.language),
                        })
                      : null}
                  </Typography>
                  <FactLine facts={facts} />
                </Stack>
              </Stack>
            </Stack>
          )}

          {/* -- a listing: the product on its stage, price as headline - */}
          {shape === "shop" && (
            <>
              {picture && (
                <Box
                  sx={{
                    position: "absolute",
                    right: 16,
                    top: 14,
                    width: 132,
                    height: 104,
                    background: "#fff",
                    display: "grid",
                    placeItems: "center",
                    overflow: "hidden",
                    boxShadow: "0 8px 26px rgba(0,0,0,.5)",
                  }}
                >
                  <Box
                    component="img"
                    src={picture.src}
                    alt=""
                    sx={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  />
                </Box>
              )}
              <Box sx={{ ...bottom, gap: "8px" }}>
                <Box sx={{ maxWidth: 200 }}>
                  <PosterTitle size={16.5}>{title}</PosterTitle>
                </Box>
                <PriceLine embed={embed} locale={i18n.language} />
                <Stack direction="row" alignItems="center" gap="10px">
                  <PosterAction href={embed.url}>{t("nebulaChat:linkPreview.viewDeal")}</PosterAction>
                  <FactLine facts={[...stock, ...facts]} />
                </Stack>
              </Box>
            </>
          )}

          {/* -- the picture posters, whose words sit at the bottom ----- */}
          {(shape === "full" || shape === "contained" || shape === "native") && (
            <Box sx={bottom}>
              <PosterTitle>{title}</PosterTitle>
              {shape === "native" ? (
                <Sub>{t("nebulaChat:linkPreview.thumbnailOnly")}</Sub>
              ) : (
                <FactLine facts={meta} />
              )}
              {action}
            </Box>
          )}

          {/* -- the chips, over everything ----------------------------
              Only on the posters whose ground is a picture. The side-thumb
              row and the price row name their source in the text column, and
              a chip as well was the same words twice - printed, on those
              layouts, half over the thumb and half over the column it was
              repeating. */}
          {shape !== "row" && shape !== "shopRow" && (
            <SourceChip
              icon={embed.favicon?.preview?.data_url}
              label={label}
              note={
                embed.author?.name && shape === "full"
                  ? embed.author.name
                  : (shape === "contained" || shape === "native") && measured
                    ? measured
                    : undefined
              }
            />
          )}
          {embed.media_duration && <DurationBadge>{embed.media_duration}</DurationBadge>}

          {/* The link itself, under the words and over the picture: the whole
              poster is clickable, and the actions sitting above it stay
              clickable in their own right. An anchor *around* the poster
              would have a button inside a link, which is not a thing a
              browser can be asked to do. */}
          <Box
            component="a"
            href={embed.url}
            // Marked, and this is not decoration: `LinkGuard` intercepts
            // `data-external` anchors and nothing else, so an unmarked one
            // navigates this window to the page and leaves nothing to come
            // back with. It matters more here than it ever did in the body -
            // the poster *is* the link now, and on a message that is nothing
            // but a link it is the only way out.
            data-external
            target="_blank"
            rel="noopener noreferrer"
            aria-label={title}
            title={embed.url}
            sx={{ position: "absolute", inset: 0, zIndex: 1 }}
          />
        </Box>
      )}

      {asked && !consented && (
        <Stack direction="row" alignItems="center" gap="10px" sx={{ mt: "8px" }}>
          <Typography sx={{ fontSize: 12, color: theme.palette.nebula.muted }}>
            {t("chat:linkPreview.privacyGateText", { site: label })}
          </Typography>
          <Box
            component="button"
            type="button"
            onClick={() => setConsented(true)}
            sx={{
              all: "unset",
              ml: "auto",
              cursor: "pointer",
              px: "10px",
              height: 26,
              display: "inline-flex",
              alignItems: "center",
              fontSize: 12,
              fontWeight: 600,
              color: theme.palette.nebula.text,
              border: "var(--nebula-line-width, 1px) solid " + theme.palette.nebula.line2,
              background: theme.palette.nebula.card,
            }}
          >
            {t("chat:linkPreview.loadContent")}
          </Box>
        </Stack>
      )}
    </LinkGuard>
  );
}

/** The quiet line a side-thumb poster names its source in. */
function Caps({ children, icon }: Readonly<{ children: React.ReactNode; icon?: string }>) {
  return (
    <Stack direction="row" alignItems="center" gap="6px" sx={{ minWidth: 0 }}>
      {icon && (
        <Box
          component="img"
          src={icon}
          alt=""
          aria-hidden
          sx={{ flex: "none", width: 13, height: 13, objectFit: "contain", display: "block" }}
        />
      )}
      <Typography
        sx={{
          // Not tracked caps any more: a host set in spaced capitals reads as
          // a heading for the card, and it is not one - it is the smallest
          // fact on it. Plain, white and quiet sits under the title without
          // competing with it, and white clears the contrast floor over a
          // blurred bed, which the old grey did not.
          fontSize: 11,
          fontWeight: 600,
          color: "#fff",
          textShadow: "0 1px 6px rgba(0,0,0,.75)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {children}
      </Typography>
    </Stack>
  );
}

/** A line of context under a title. */
function Sub({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Typography
      sx={{
        fontSize: 12,
        lineHeight: 1.35,
        color: "#dbe4f2",
        textShadow: "0 1px 8px rgba(0,0,0,.8)",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}
    >
      {children}
    </Typography>
  );
}

/** The headline of a listing: what it costs, what it cost, and the saving. */
function PriceLine({ embed, locale }: Readonly<{ embed: LinkEmbed; locale: string }>) {
  const theme = useTheme();
  const price = embed.price;
  if (!price?.amount) return null;
  const off = discountOf(price.amount, price.was);
  return (
    <Stack direction="row" alignItems="flex-end" gap="9px">
      <Typography
        sx={{
          fontFamily: theme.palette.nebulaSkin.display ?? theme.palette.nebulaSkin.font,
          fontSize: 26,
          lineHeight: 0.95,
          fontWeight: 700,
          color: theme.palette.nebula.ok,
        }}
      >
        {money(price, locale)}
      </Typography>
      {price.was && (
        <Typography
          sx={{
            fontSize: 13,
            pb: "2px",
            color: "#c9d6ea",
            textDecoration: "line-through",
          }}
        >
          {money({ ...price, amount: price.was }, locale)}
        </Typography>
      )}
      {off !== undefined && (
        <Typography
          sx={{
            mb: "2px",
            px: "7px",
            py: "3px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".1em",
            color: "#0f131c",
            background: theme.palette.nebula.ok,
          }}
        >
          {`−${off}%`}
        </Typography>
      )}
    </Stack>
  );
}

/** How much cheaper the price is than what it was, or nothing. */
function discountOf(amount: string, was: string): number | undefined {
  const now = Number.parseFloat(amount);
  const before = Number.parseFloat(was);
  if (!Number.isFinite(now) || !Number.isFinite(before) || before <= now) return undefined;
  return Math.round(((before - now) / before) * 100);
}

/**
 * A published date as "8 years ago", in the reader's own language.
 *
 * The date itself is what the page wrote - ISO-8601 on most, whatever an
 * editor typed on the rest - so anything unparseable prints nothing rather
 * than "Invalid Date". Relative rather than absolute because the question a
 * card answers is how old this is, not which Tuesday it was.
 */
function ago(published: string | undefined, locale: string): string | undefined {
  if (!published) return undefined;
  const at = Date.parse(published);
  if (!Number.isFinite(at)) return undefined;
  const seconds = (at - Date.now()) / 1000;
  const scale: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  try {
    const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    for (const [unit, size] of scale) {
      if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
    }
    return format.format(0, "minute");
  } catch {
    return undefined;
  }
}

/** A price as the reader's own locale writes one. */
function money(price: { amount: string; currency: string }, locale: string): string {
  const amount = Number.parseFloat(price.amount);
  if (!Number.isFinite(amount)) return price.amount;
  try {
    return new Intl.NumberFormat(locale, {
      style: price.currency ? "currency" : "decimal",
      currency: price.currency || undefined,
    }).format(amount);
  } catch {
    // An unknown currency code is the page's mistake, not the reader's: the
    // number is still worth showing.
    return price.currency ? `${price.amount} ${price.currency}` : price.amount;
  }
}

export default memo(function LinkPreviewCard({
  embeds,
  allowExternalResources,
  channelId,
  attached = false,
  bleed,
}: Readonly<{
  embeds: LinkEmbed[];
  allowExternalResources: boolean;
  channelId: number;
  /**
   * The bubble's padding, when the poster is drawn inside one.
   *
   * See [`Bleed`]: the poster cancels it so its edges are the bubble's, and a
   * caller that draws the card on its own passes nothing.
   */
  bleed?: Bleed;
  /**
   * Drawn inside the message bubble rather than as a card beneath it.
   *
   * A preview under a bubble is a second block in the river, and a reader
   * coming to it has to guess which message it answers - the one above, or
   * the one below. Attached, it is part of the message that carried the
   * link, which is the only thing it was ever about.
   */
  attached?: boolean;
  /**
   * That bubble is your own.
   *
   * No longer changes the drawing: a poster brings its own dark ground and
   * its own white ink, so it reads the same on an accent bubble as on the
   * canvas. Kept because the callers pass it and the day a skin wants the
   * poster to know, this is where it would arrive.
   */
  ownBubble?: boolean;
}>) {
  if (embeds.length === 0) return null;

  return (
    <Stack
      gap="8px"
      sx={{
        // Air between the sentence and the card it is about - and none where
        // there is no sentence, because then the poster *is* the bubble and a
        // margin would be a strip of bubble above it.
        mt: attached ? (bleed ? "10px" : 0) : "6px",
        alignItems: "stretch",
        width: "100%",
      }}
    >
      {embeds.map((embed) => (
        <Poster
          key={embed.url}
          embed={embed}
          allowExternalResources={allowExternalResources}
          channelId={channelId}
          bleed={attached ? bleed : undefined}
        />
      ))}
    </Stack>
  );
});
