import { getActiveApiKey } from "./klipyConfig";

export interface KlipyResult { id: number; title: string; url: string; preview: string; }

interface MediaFile { url: string; }
interface MediaItem { id: number; title?: string; file?: { hd?: { webp?: MediaFile }; md?: { webp?: MediaFile }; sm?: { webp?: MediaFile }; xs?: { webp?: MediaFile } } }
interface Response { data: { data: MediaItem[]; has_next: boolean } }

export async function findKlipyMedia(query: string, page = 1): Promise<{ items: KlipyResult[]; hasNext: boolean }> {
  const apiKey = getActiveApiKey();
  if (!apiKey) throw new Error("Add a Klipy API key in Advanced settings to search GIFs.");
  const action = query.trim() ? "search" : "trending";
  const url = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(apiKey)}/gifs/${action}`);
  url.searchParams.set("per_page", "24"); url.searchParams.set("page", String(page));
  if (query.trim()) url.searchParams.set("q", query.trim());
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Klipy returned ${response.status}.`);
  const payload = await response.json() as Response;
  const items = payload.data.data.flatMap((item) => {
    const full = item.file?.hd?.webp ?? item.file?.md?.webp ?? item.file?.sm?.webp;
    const preview = item.file?.sm?.webp ?? item.file?.xs?.webp ?? full;
    return full && preview ? [{ id: item.id, title: item.title || "GIF", url: full.url, preview: preview.url }] : [];
  });
  return { items, hasNext: payload.data.has_next };
}
