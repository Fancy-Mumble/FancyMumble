/**
 * Keep remote media out of untrusted HTML before it is rendered.
 *
 * A picture the webview fetches from a third party tells that party the
 * reader's IP address and the moment they read the message - a tracking pixel
 * needs nothing more than `<img src="https://tracker.example/p.png">` in a
 * chat line. So a message never makes the client fetch anything on its own:
 * media it carries inline (`data:`, `blob:`) renders as before, and anything
 * that would have to be downloaded is turned into an ordinary link to it. The
 * reader can still follow that link, through the same external-link guard as
 * every other one; what changes is that looking at the message no longer
 * reaches out.
 *
 * Link previews already work this way - the server fetches the page and sends
 * the thumbnail inline - and profile bios strip remote pictures outright.
 *
 * # The one kind of remote media that does load
 *
 * A server that proxies GIFs (Starling's `gif_proxy_media`) serves them from
 * an address it announces, and a GIF sent into chat points there. Loading one
 * tells nobody anything new: it is the server this client is already talking
 * to. So those addresses are trusted - announced ones only, by exact prefix,
 * see {@link trustMediaBase}.
 */

import { useSyncExternalStore } from "react";

/** Media a message carries itself, which rendering cannot leak anything by. */
const LOCAL_MEDIA_RE = /^(?:data:(?:image|video|audio)\/|blob:)/i;

/** Prefixes a connected server announced for its own GIF proxy. */
const trustedBases = new Set<string>();

/** Renderers that drew a link where a picture may now be allowed. */
const trustListeners = new Set<() => void>();
let trustVersion = 0;

/**
 * Whether `base` is shaped like a proxy prefix a server may announce:
 * `http(s)://host[:port]/path?` and nothing else. A bare scheme, a prefix with
 * a query already in it, or anything the URL parser would read differently is
 * refused - trusting `"https://"` would be trusting the whole web.
 */
export function isMediaBase(base: string): boolean {
  if (!base.endsWith("?")) return false;
  try {
    const url = new URL(base);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname !== "" &&
      url.search === "" &&
      `${url.origin}${url.pathname}?` === base
    );
  } catch {
    return false;
  }
}

/** Trust media under `base`, a connected server's GIF proxy. Ignored unless {@link isMediaBase}. */
export function trustMediaBase(base: string): void {
  if (!isMediaBase(base) || trustedBases.has(base)) return;
  trustedBases.add(base);
  trustVersion += 1;
  for (const listener of trustListeners) listener();
}

/** Whether `src` is served by a connected server's own GIF proxy. */
export function isTrustedMediaSrc(src: string): boolean {
  const trimmed = src.trim();
  for (const base of trustedBases) if (trimmed.startsWith(base)) return true;
  return false;
}

/** Be told whenever a new proxy is trusted. */
export function subscribeTrustedMedia(listener: () => void): () => void {
  trustListeners.add(listener);
  return () => trustListeners.delete(listener);
}

/**
 * A number that changes whenever a new proxy is trusted - a memo dependency
 * for anything that turned a picture into a link before it was.
 */
export function useTrustedMediaVersion(): number {
  return useSyncExternalStore(
    subscribeTrustedMedia,
    () => trustVersion,
    () => trustVersion,
  );
}

/**
 * Whether drawing `src` reaches nobody new.
 *
 * Inline media does not, nor does anything that resolves to the page's own
 * origin - the app's bundled assets - nor a connected server's GIF proxy. The
 * URL parser decides the origin, not a pattern: it is what the webview will do
 * with the string, including turning `\\host\x.png` into a request to `host`.
 */
export function isLocalMediaSrc(src: string): boolean {
  const trimmed = src.trim();
  if (LOCAL_MEDIA_RE.test(trimmed) || isTrustedMediaSrc(trimmed)) return true;
  try {
    return new URL(trimmed, globalThis.location.href).origin === globalThis.location.origin;
  } catch {
    return false;
  }
}

/**
 * A link standing in for media that was not loaded.
 *
 * The text is the address itself: it says where the picture lives, which is
 * the one thing a reader deciding whether to open it needs to know, and it
 * reads the same in every language. The alt text rides along as the title.
 */
export function remoteMediaLink(doc: Document, src: string, alt = ""): HTMLAnchorElement {
  const link = doc.createElement("a");
  link.setAttribute("href", src);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
  link.dataset["external"] = "true";
  link.dataset["remoteMedia"] = "true";
  if (alt) link.setAttribute("title", alt);
  link.textContent = src;
  return link;
}

/** Only a web address is worth a link; anything else is simply dropped. */
const WEB_URL_RE = /^https?:\/\//i;

/**
 * Replace an element whose media is remote with a link to it, or remove it
 * when its address is not one a link could follow.
 */
export function replaceWithLink(element: Element, src: string, alt: string): void {
  const doc = element.ownerDocument;
  if (WEB_URL_RE.test(src.trim())) element.replaceWith(remoteMediaLink(doc, src.trim(), alt));
  else element.remove();
}

/** Attributes that make the browser fetch a picture with no element of its own. */
const FETCHING_ATTRS = ["srcset", "poster", "background", "lowsrc", "dynsrc"];

/**
 * Take every remote fetch out of `root`, in place.
 *
 * `<img>`, `<video>`, `<audio>` and `<source>` with a remote source become
 * links; the attributes that fetch without being a source (`srcset`,
 * `poster`, the legacy `background` table attribute) are dropped, whatever
 * they point at; and so is every inline-style declaration that could fetch,
 * whichever property it sets. A caller's own style allow-list still applies
 * on top - this only guarantees that nothing reaches out.
 */
export function neutraliseRemoteMedia(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const name of FETCHING_ATTRS) element.removeAttribute(name);
    const style = element.getAttribute("style");
    if (style !== null && styleValueFetches(style)) {
      const kept = style.split(";").filter((decl) => !styleValueFetches(decl));
      if (kept.join("").trim()) element.setAttribute("style", kept.join(";"));
      else element.removeAttribute("style");
    }
  }
  for (const img of Array.from(root.querySelectorAll("img, input[type='image' i]"))) {
    const src = img.getAttribute("src") ?? "";
    if (!isLocalMediaSrc(src)) replaceWithLink(img, src, img.getAttribute("alt") ?? "");
  }
  for (const source of Array.from(root.querySelectorAll("source, track"))) {
    const src = source.getAttribute("src") ?? "";
    if (!isLocalMediaSrc(src)) source.remove();
  }
  for (const media of Array.from(root.querySelectorAll("video, audio"))) {
    const src = media.getAttribute("src") ?? "";
    if (src && !isLocalMediaSrc(src)) replaceWithLink(media, src, "");
  }
}

/**
 * Whether an inline style value could make the browser fetch something.
 *
 * `url(` is the obvious one; `image-set("...")` fetches from a bare string, and
 * a CSS escape (`\75rl(` is `url(`) hides either from a pattern, so any
 * backslash is refused too - no safe property in a chat message needs one.
 */
export function styleValueFetches(value: string): boolean {
  return /url\s*\(|image-set\s*\(|\\/i.test(value);
}
