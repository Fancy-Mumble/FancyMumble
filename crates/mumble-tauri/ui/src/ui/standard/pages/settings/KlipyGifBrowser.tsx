import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import styles from "./KlipyGifBrowser.module.css";
import { getActiveApiKey } from "@core/features/chat/gif/klipyConfig";
import {
  searchServerGifs,
  serverGifsUnavailable,
  shouldFallBack,
  type ServerGif,
} from "@core/features/chat/gif/serverGifs";
import { PickerSearch } from "../../components/elements/SearchFields";

const KLIPY_BASE = "https://api.klipy.com/api/v1";

interface KlipyFileMeta {
  url: string;
  width: number;
  height: number;
  size: number;
}

interface KlipyFileFormats {
  gif: KlipyFileMeta;
  webp: KlipyFileMeta;
  mp4?: KlipyFileMeta;
}

interface KlipySizeVariants {
  hd: KlipyFileFormats;
  md: KlipyFileFormats;
  sm: KlipyFileFormats;
  xs: KlipyFileFormats;
}

interface KlipyMediaItem {
  id: number;
  title?: string;
  slug?: string;
  blur_preview?: string;
  file?: KlipySizeVariants;
  type: string;
  content?: string;
  width?: number;
  height?: number;
}

interface KlipyPaginatedResponse {
  result: boolean;
  data: {
    data: KlipyMediaItem[];
    current_page: number;
    per_page: number;
    has_next: boolean;
  };
}

/** Shared so a pack can draw its own grid over the same source. */
export interface KlipyGif {
  id: number;
  title: string;
  url: string;
  preview: string;
  width: number;
  height: number;
}

async function klipyFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = getActiveApiKey();
  if (!apiKey) {
    throw new Error("No Klipy API key configured. Set one in Settings > Advanced.");
  }
  const url = new URL(`${KLIPY_BASE}/${apiKey}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Klipy API error: ${res.status}`);
  const text = await res.text();
  if (!text) throw new Error("Klipy API returned empty response");
  return JSON.parse(text) as T;
}

function mapMediaItems(items: KlipyMediaItem[]): KlipyGif[] {
  return items
    .filter((item) => item.file)
    .map((item) => {
      const file = item.file!;
      const full = file.hd?.gif ?? file.md?.gif ?? file.sm?.gif;
      const thumb = file.sm?.gif ?? file.xs?.gif ?? full;
      if (!full) return null;
      return {
        id: item.id,
        title: item.title ?? "",
        url: full.url,
        preview: thumb.url,
        width: full.width ?? 200,
        height: full.height ?? 200,
      };
    })
    .filter(Boolean) as KlipyGif[];
}

export interface PagedResult {
  items: KlipyGif[];
  hasNext: boolean;
}

/** The server's shape, in the one this browser draws. */
function fromServer(results: ServerGif[]): KlipyGif[] {
  return results.map((gif, index) => ({
    // Numeric because that is what this grid has always keyed on, and the
    // index is stable within the page it is rendered from.
    id: index,
    title: gif.title || "GIF",
    url: gif.url,
    preview: gif.preview,
    width: gif.preview_width,
    height: gif.preview_height,
  }));
}

/**
 * One page, from the server when it will and from a personal key when it will
 * not. An empty `query` is trending, which is how both entry points share a
 * path. See `serverGifs` for why only one kind of refusal falls back.
 */
async function pageOfGifs(query: string, page: number): Promise<PagedResult> {
  try {
    const answer = await searchServerGifs(query, page);
    return { items: fromServer(answer.items), hasNext: answer.hasNext };
  } catch (error) {
    if (!shouldFallBack(error)) throw error;
  }
  const data = await klipyFetch<KlipyPaginatedResponse>(
    query ? "/gifs/search" : "/gifs/trending",
    query ? { q: query, per_page: "30", page: String(page) } : { per_page: "30", page: String(page) },
  );
  return { items: mapMediaItems(data.data.data), hasNext: data.data.has_next };
}

export async function searchGifs(query: string, page = 1): Promise<PagedResult> {
  return await pageOfGifs(query, page);
}

export async function fetchTrending(page = 1): Promise<PagedResult> {
  return await pageOfGifs("", page);
}

// -- Component ---------------------------------------------------

interface KlipyGifBrowserProps {
  onSelect: (url: string) => void;
}

type View = { kind: "categories" } | { kind: "category"; name: string };

const GIF_CATEGORIES = [
  "trending",
  "thumbs up",
  "happy",
  "sad",
  "angry",
  "love",
  "laugh",
  "shrug",
  "dance",
  "excited",
  "applause",
  "bye",
  "crying",
  "confused",
  "cool",
  "facepalm",
  "high five",
  "hug",
];

async function fetchCategoryPreview(name: string): Promise<string | null> {
  try {
    // One page through the same path, so a server-provided browser shows
    // category tiles too rather than a grid of empty cards.
    const { items } = await pageOfGifs(name, 1);
    return items[0]?.preview ?? null;
  } catch {
    return null;
  }
}

export function KlipyGifBrowser({ onSelect }: Readonly<KlipyGifBrowserProps>) {
  const { t } = useTranslation("settings");
  const [view, setView] = useState<View>({ kind: "categories" });
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryPreviews, setCategoryPreviews] = useState<Record<string, string>>({});
  const [results, setResults] = useState<KlipyGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<() => void>(() => {});

  const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { threshold: 0.1 },
    );
    observerRef.current.observe(node);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    function loadInitialData() {
      if (cancelled) return;
      // Waiting for a key only makes sense while there is nothing else that
      // could answer. Preferences load asynchronously, so this spin exists to
      // let a personal key arrive - but a server that provides GIFs needs no
      // key at all, and blocking on one there would leave its picker empty.
      if (!getActiveApiKey() && serverGifsUnavailable()) {
        retryTimer = setTimeout(loadInitialData, 250);
        return;
      }
      setLoading(true);
      setError(null);

      setCategories(GIF_CATEGORIES);
      GIF_CATEGORIES.forEach((name) => {
        fetchCategoryPreview(name).then((url) => {
          if (cancelled || !url) return;
          setCategoryPreviews((prev) => ({ ...prev, [name]: url }));
        });
      });

      fetchTrending(1)
        .then(({ items, hasNext: hn }) => {
          if (cancelled) return;
          setResults(items);
          setHasNext(hn);
          setPage(1);
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    loadInitialData();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, []);

  const loadCategoryResults = useCallback((categoryName: string, query: string) => {
    setLoading(true);
    setResults([]);
    const searchTerm = query.trim() ? `${categoryName} ${query}` : categoryName;
    searchGifs(searchTerm, 1)
      .then(({ items, hasNext: hn }) => {
        setResults(items);
        setHasNext(hn);
        setPage(1);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (view.kind !== "categories") return;
    if (!searchQuery.trim()) return;
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setLoading(true);
      searchGifs(searchQuery, 1)
        .then(({ items, hasNext: hn }) => {
          setResults(items);
          setHasNext(hn);
          setPage(1);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(searchTimerRef.current);
  }, [searchQuery, view]);

  useEffect(() => {
    if (view.kind !== "category") return;
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(
      () => {
        loadCategoryResults(view.name, searchQuery);
      },
      searchQuery.trim() ? 350 : 0,
    );
    return () => clearTimeout(searchTimerRef.current);
  }, [searchQuery, view, loadCategoryResults]);

  useEffect(() => {
    const isTrendingView = view.kind === "categories" && !searchQuery.trim();

    const effectiveQuery =
      view.kind === "category"
        ? searchQuery.trim()
          ? `${view.name} ${searchQuery}`
          : view.name
        : searchQuery;

    loadMoreRef.current = () => {
      if (!hasNext || loadingMore) return;
      const nextPage = page + 1;
      setLoadingMore(true);

      const fetchPage = isTrendingView ? fetchTrending(nextPage) : searchGifs(effectiveQuery, nextPage);

      fetchPage
        .then(({ items, hasNext: hn }) => {
          setResults((prev) => [...prev, ...items]);
          setHasNext(hn);
          setPage(nextPage);
        })
        .catch(console.error)
        .finally(() => setLoadingMore(false));
    };
  });

  const handleCategoryClick = useCallback((name: string) => {
    setView({ kind: "category", name });
    setSearchQuery("");
  }, []);

  const handleBack = useCallback(() => {
    setView({ kind: "categories" });
    setSearchQuery("");
    setResults([]);
    setLoading(true);
    fetchTrending(1)
      .then(({ items, hasNext: hn }) => {
        setResults(items);
        setHasNext(hn);
        setPage(1);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const isInitialView = view.kind === "categories" && !searchQuery.trim();
  const showCategoryGrid = isInitialView && categories.length > 0;

  const searchPlaceholder =
    view.kind === "category"
      ? t("klipyBrowser.searchInCategory", { categoryName: view.name })
      : t("klipyBrowser.searchPlaceholder");

  return (
    <div className={styles.browser}>
      {view.kind === "category" && (
        <button type="button" className={styles.backBtn} onClick={handleBack}>
          &larr; {view.name}
        </button>
      )}

      <div className={styles.searchBar}>
        <PickerSearch
          className={styles.searchInput}
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className={styles.content}>
        {loading && results.length === 0 && (
          <div className={styles.statusMsg}>{t("klipyBrowser.loading")}</div>
        )}

        {showCategoryGrid && (
          <div className={styles.categoryGrid}>
            {categories.slice(0, 18).map((name) => (
              <button
                key={name}
                type="button"
                className={styles.categoryCard}
                onClick={() => handleCategoryClick(name)}
              >
                {categoryPreviews[name] && (
                  <img
                    src={categoryPreviews[name]}
                    alt={name}
                    className={styles.categoryImg}
                    loading="lazy"
                  />
                )}
                <span className={styles.categoryLabel}>{name}</span>
              </button>
            ))}
          </div>
        )}

        {results.length > 0 && (
          <div className={styles.gifGrid}>
            {results.map((gif) => (
              <button
                key={gif.id}
                type="button"
                className={styles.gifCard}
                onClick={() => onSelect(gif.url)}
                title={gif.title}
              >
                <img src={gif.preview} alt={gif.title} loading="lazy" className={styles.gifImg} />
              </button>
            ))}
            <div ref={sentinelCallbackRef} className={styles.sentinel} />
          </div>
        )}

        {loadingMore && <div className={styles.statusMsg}>{t("klipyBrowser.loading")}</div>}

        {!loading && results.length === 0 && searchQuery.trim() && (
          <div className={styles.statusMsg}>{t("klipyBrowser.noResults", { query: searchQuery })}</div>
        )}

        {!loading && error && results.length === 0 && categories.length === 0 && (
          <div className={styles.statusMsg}>{error}</div>
        )}
      </div>

      <div className={styles.footer}>
        <span>Powered by Klipy</span>
      </div>
    </div>
  );
}
