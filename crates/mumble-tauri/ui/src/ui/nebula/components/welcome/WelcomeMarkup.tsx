/**
 * A greeting's markup, with the live parts made live.
 *
 * Every surface that shows a welcome message sanitises it and hands it to
 * `dangerouslySetInnerHTML`, which is right: the markup is somebody else's, and
 * the one filter it goes through should be the only thing standing between it
 * and the DOM. That leaves no room for a React component in the middle of it.
 *
 * So the markup is still rendered exactly as before, and the components are
 * *portalled* into the markers afterwards. Nothing about the sanitising path
 * changes - a marker is a `<span class="fm-presence">` that survived it like
 * any other span, and if the swap never happens the operator's own words are
 * already inside it.
 */
import { useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Box, type SxProps, type Theme } from "@mui/material";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { ASSET_CLASS, BACKDROP_CLASS, PRESENCE_CLASS } from "../admin/welcome/compile";
import { OnlineNow } from "./OnlineNow";

/**
 * How this marker wants its picture to sit, from its own class list.
 *
 * A class rather than an attribute for the third time in this file, and the
 * same reason each time: `data-` never survives the sanitiser and `class` does.
 */
function fitIn(node: HTMLElement): string | undefined {
  for (const name of node.classList) {
    if (name.startsWith("fm-fit-")) return name.slice("fm-fit-".length);
  }
  return undefined;
}

/** Which picture this marker names, from its own class list. */
function assetIn(node: HTMLElement): string | undefined {
  for (const name of node.classList) {
    if (name.startsWith("fm-a-")) return name.slice("fm-a-".length);
  }
  return undefined;
}

/**
 * How many faces this marker asked for, from its own class list.
 *
 * A second class rather than an attribute, for the same reason the label is
 * the text: `data-` never survives the sanitiser, and `class` does.
 */
function facesIn(node: HTMLElement): number | undefined {
  for (const name of node.classList) {
    const match = /^fm-faces-(\d+)$/.exec(name);
    if (match) return Number(match[1]);
  }
  return undefined;
}

export function WelcomeMarkup({
  html,
  sx,
  live = true,
  assets,
}: Readonly<{
  html: string;
  sx?: SxProps<Theme>;
  /**
   * The pictures that travelled beside this markup, by id.
   *
   * Separate from the markup because that is how they arrive: a Fancy client is
   * sent the two together and the bytes never go through base64. A marker whose
   * picture is missing draws nothing rather than a broken-image icon - a
   * greeting is not worth showing somebody an error about.
   */
  assets?: ReadonlyMap<string, string>;
  /**
   * Whether the live blocks are drawn live.
   *
   * Off where there is no session to be live *about* - the operator's own
   * preview of a design they are editing shows the markup as sent, and a
   * cluster of whoever happens to be online on the server they are
   * administering is not what that pane is answering.
   */
  live?: boolean;
}>) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [slots, setSlots] = useState<{ node: HTMLElement; label: string }[]>([]);

  useLayoutEffect(() => {
    if (host === null) return;
    // Written here rather than through `dangerouslySetInnerHTML`, and that is
    // not a style choice. React owns the children of an element it sets that
    // prop on, and re-applies the string on any later render - so a picture
    // swapped into the markup, or a marker emptied to make room for a portal,
    // was silently put back the moment this component rendered again. Setting
    // it once ourselves makes the subtree ours to change.
    host.innerHTML = clean;
    if (!live) {
      setSlots([]);
      return;
    }
    // The pictures first: a plain swap with no React in it, so it is done here
    // rather than portalled.
    for (const slot of host.querySelectorAll<HTMLElement>(`.${ASSET_CLASS}`)) {
      const id = assetIn(slot);
      const src = id === undefined ? undefined : assets?.get(id);
      if (src === undefined) continue;
      const picture = document.createElement("img");
      picture.src = src;
      picture.alt = "";
      // The block already sized the box; the picture fills it rather than
      // bringing a size of its own, so a design laid out against that box does
      // not move when the picture turns out to be a different shape.
      picture.style.width = "100%";
      picture.style.height = "100%";
      // The block said how it wants the picture to sit; `cover` is the answer
      // for a band, which is what a picture with nothing said about it is.
      picture.style.objectFit = fitIn(slot) ?? "cover";
      picture.style.display = "block";
      slot.replaceChildren(picture);
    }
    // A picture painted *behind* a block keeps whatever is inside it. The
    // markup already carries the geometry - size, position, repeat - because
    // those are inert; only the picture itself has to come from here, since a
    // `url()` in CSS is a fetch and the sanitiser refuses every one.
    for (const slot of host.querySelectorAll<HTMLElement>(`.${BACKDROP_CLASS}`)) {
      const id = assetIn(slot);
      const src = id === undefined ? undefined : assets?.get(id);
      if (src === undefined) continue;
      slot.style.backgroundImage = `url("${src}")`;
    }
    // The words inside a live marker carry the operator's label as well as
    // being the fallback, which is why they are read before they are cleared.
    // They cannot ride on a `data-` attribute: the sanitiser is configured
    // with `ALLOW_DATA_ATTR: false`, so one would never arrive.
    setSlots(
      [...host.querySelectorAll<HTMLElement>(`.${PRESENCE_CLASS}`)].map((node) => {
        const label = (node.textContent ?? "").trim();
        node.textContent = "";
        return { node, label };
      }),
    );
  }, [host, clean, live, assets]);

  if (clean === "") return null;

  return (
    <>
      <Box
        ref={setHost}
        // Clipped, and the caller's own overflow still wins after it. A shadow
        // is the one paint property on the allow-list that draws *outside* the
        // element it belongs to, so without this a greeting could spread one
        // over the client's own chrome. `clip` rather than `hidden` because it
        // clips without turning the box into a scroll container.
        sx={[{ overflow: "clip" }, ...(Array.isArray(sx) ? sx : [sx])]}
      />
      {slots.map(({ node, label }, index) =>
        createPortal(
          <OnlineNow
            label={label === "" ? undefined : label}
            faces={facesIn(node)}
            height={node.offsetHeight || undefined}
          />,
          node,
          `presence-${index}`,
        ),
      )}
    </>
  );
}
