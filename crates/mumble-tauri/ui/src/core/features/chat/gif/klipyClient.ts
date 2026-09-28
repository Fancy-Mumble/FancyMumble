import { getActiveApiKey } from "./klipyConfig";
import { searchServerGifs, shouldFallBack } from "./serverGifs";

export interface KlipyResult {
  id: number;
  title: string;
  url: string;
  preview: string;
}

interface MediaFile {
  url: string;
}
interface MediaItem {
  id: number;
  title?: string;
  file?: {
    hd?: { webp?: MediaFile };
    md?: { webp?: MediaFile };
    sm?: { webp?: MediaFile };
    xs?: { webp?: MediaFile };
  };
}
interface Response {
  data: { data: MediaItem[]; has_next: boolean };
}

/**
 * Find GIFs, preferring the server.
 *
 * The server holds one provider key for everybody, rate-limits it and caches
 * the answers, so it is the path that works for a user who has no key of their
 * own - which is most of them. A personal key is the fallback, and only for the
 * one refusal that means "this server does not do this": see `shouldFallBack`.
 */
export async function findKlipyMedia(
  query: string,
  page = 1,
): Promise<{ items: KlipyResult[]; hasNext: boolean }> {
  try {
    const answer = await searchServerGifs(query.trim(), page);
    return {
      items: answer.items.map((gif, index) => ({
        // The canon carries an opaque string; this shape has always been keyed
        // by number, and the index is stable within the page it is rendered
        // from, which is all a React key here has ever needed.
        id: index,
        title: gif.title || "GIF",
        url: gif.url,
        preview: gif.preview,
      })),
      hasNext: answer.hasNext,
    };
  } catch (error) {
    if (!shouldFallBack(error)) throw error;
    // The server does not do this. Fall through to a key of the user's own.
  }
  return await findKlipyMediaDirect(query, page);
}

/**
 * The original path: this client calling the provider with the user's own key.
 *
 * Kept for servers that have configured none. It is the arrangement whose
 * shortcomings moved the key to the server in the first place - every user
 * needs their own key, and the provider sees each of their addresses and every
 * search they type - so it is the fallback rather than the default.
 */
async function findKlipyMediaDirect(
  query: string,
  page = 1,
): Promise<{ items: KlipyResult[]; hasNext: boolean }> {
  const apiKey = getActiveApiKey();
  if (!apiKey)
    throw new Error("This server does not provide GIFs. Add a Klipy API key in Advanced settings to search.");
  const action = query.trim() ? "search" : "trending";
  const url = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(apiKey)}/gifs/${action}`);
  url.searchParams.set("per_page", "24");
  url.searchParams.set("page", String(page));
  if (query.trim()) url.searchParams.set("q", query.trim());
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Klipy returned ${response.status}.`);
  const payload = (await response.json()) as Response;
  const items = payload.data.data.flatMap((item) => {
    const full = item.file?.hd?.webp ?? item.file?.md?.webp ?? item.file?.sm?.webp;
    const preview = item.file?.sm?.webp ?? item.file?.xs?.webp ?? full;
    return full && preview
      ? [{ id: item.id, title: item.title || "GIF", url: full.url, preview: preview.url }]
      : [];
  });
  return { items, hasNext: payload.data.has_next };
}
