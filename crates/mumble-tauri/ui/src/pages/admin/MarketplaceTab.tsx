import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  SearchIcon, DownloadIcon, RefreshCwIcon, StoreIcon, StarIcon,
} from "../../icons";
import { useAppStore } from "../../store";
import { getPreferences, updatePreferences } from "../../preferencesStorage";
import { isPluginAdminSupported } from "./index";
import styles from "./AdminPanel.module.css";
import mk from "./MarketplaceTab.module.css";

interface MarketplacePlugin {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  author?: string | null;
  homepage?: string | null;
  icon_url?: string | null;
  manifest_url?: string | null;
  downloads?: number | null;
  rating?: number | null;
  official?: boolean;
  capabilities?: string[];
}

interface MarketplaceIndex {
  plugins: MarketplacePlugin[];
  total: number;
  page: number;
  per_page: number;
}

interface PluginAckPayload {
  plugin_name: string | null;
  ok: boolean;
  error: string | null;
  request_id: string | null;
  verb: string | null;
}

const PROD_URL = "https://plugins.fancy-mumble.com/api/v1";
const LOCAL_URL = "http://localhost/api/v1";

const DEV_URL_OPTIONS = [
  { label: "Production",          value: PROD_URL },
  { label: "Local (localhost)", value: LOCAL_URL },
] as const;

function urlOriginOnly(msg: string): string {
  return msg.replaceAll(/https?:\/\/[^\s)]+/g, (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  });
}

export function MarketplaceTab() {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const canInstall = isPluginAdminSupported(serverFancyVersion);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page] = useState(1);
  const [results, setResults] = useState<MarketplacePlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [lastAck, setLastAck] = useState<PluginAckPayload | null>(null);
  const [baseUrl, setBaseUrl] = useState(PROD_URL);
  const [isDevMode, setIsDevMode] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => {
    getPreferences().then((p) => {
      setIsDevMode(p.userMode === "developer");
      if (p.marketplaceBaseUrl) setBaseUrl(p.marketplaceBaseUrl);
      setPrefsLoaded(true);
    });
  }, []);;

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Listen for install acks from the server.
  useEffect(() => {
    const off = listen<PluginAckPayload>("plugin-admin-ack", (e) => {
      if (e.payload.verb === "install") {
        setLastAck(e.payload);
        setInstallingId(null);
      }
    });
    return () => { off.then((f) => f()); };
  }, []);

  const fetchIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const index = await invoke<MarketplaceIndex>("fetch_marketplace_index", {
        query: debouncedQuery,
        page,
        baseUrl: baseUrl !== PROD_URL ? baseUrl : null,
      });
      setResults(index.plugins);
    } catch (e) {
      setError(urlOriginOnly(String(e)));
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, page, baseUrl]);

  useEffect(() => {
    if (!prefsLoaded) return;
    fetchIndex();
  }, [fetchIndex, prefsLoaded]);

  const handleInstall = useCallback(async (plugin: MarketplacePlugin) => {
    if (!canInstall) {
      setError(t("marketplace.installUnsupported"));
      return;
    }
    if (!plugin.manifest_url) {
      setError(t("marketplace.missingManifestUrl"));
      return;
    }
    setInstallingId(plugin.id);
    setLastAck(null);
    try {
      await invoke("install_server_plugin", {
        marketplaceId: plugin.id,
        version: plugin.version,
        manifestUrl: plugin.manifest_url,
        expectedSha256: null,
      });
    } catch (err) {
      setError(String(err));
      setInstallingId(null);
    }
  }, [canInstall, t]);

  return (
    <div>
      <h2 className={styles.panelTitle}>{t("marketplace.title")}</h2>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <SearchIcon className={styles.searchIcon} width={14} height={14} />
          <input
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("marketplace.searchPlaceholder")}
          />
        </div>
        {isDevMode && (
          <select
            className={mk.devSelect}
            value={baseUrl}
            onChange={(e) => {
              const url = e.target.value;
              setBaseUrl(url);
              void updatePreferences({ marketplaceBaseUrl: url === PROD_URL ? undefined : url });
            }}
            title="Dev: select marketplace URL"
          >
            {DEV_URL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={fetchIndex}
          disabled={loading}
        >
          <RefreshCwIcon width={14} height={14} />
          {t("marketplace.refresh")}
        </button>
      </div>

      {error && <div className={mk.errorBanner}>{error}</div>}
      {!canInstall && (
        <div className={mk.warnBanner}>{t("marketplace.installUnsupported")}</div>
      )}
      {lastAck && !lastAck.ok && (
        <div className={mk.errorBanner}>
          {t("marketplace.installFailed")}: {lastAck.error}
        </div>
      )}
      {lastAck?.ok && (
        <div className={mk.successBanner}>
          {t("marketplace.installSuccess", { name: lastAck.plugin_name })}
        </div>
      )}

      {loading && results.length === 0 ? (
        <div className={mk.empty}>{t("marketplace.loading")}</div>
      ) : results.length === 0 ? (
        <div className={mk.empty}>
          <StoreIcon width={36} height={36} />
          <p>{t("marketplace.empty")}</p>
        </div>
      ) : (
        <div className={mk.grid}>
          {results.map((p) => (
            <article key={p.id} className={mk.card}>
              <header className={mk.cardHeader}>
                {p.icon_url ? (
                  <img className={mk.cardIcon} src={p.icon_url} alt="" />
                ) : (
                  <div className={mk.cardIcon}>
                    <StoreIcon width={20} height={20} />
                  </div>
                )}
                <div className={mk.cardTitleCol}>
                  <h3 className={mk.cardTitle}>
                    <button
                      type="button"
                      className={mk.cardTitleBtn}
                      onClick={() => navigate(`/marketplace/plugin/${encodeURIComponent(p.id)}`)}
                    >
                      {p.name}
                    </button>
                    {p.official && (
                      <span className={mk.officialBadge}>
                        {t("marketplace.official")}
                      </span>
                    )}
                  </h3>
                  <div className={mk.cardSubtitle}>
                    <span>v{p.version}</span>
                    {p.author && <span>{t("marketplace.byAuthor", { author: p.author })}</span>}
                    {p.rating != null && (
                      <span className={mk.rating}>
                        <StarIcon width={12} height={12} />
                        {p.rating.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
              </header>
              {p.description && (
                <p className={mk.cardDesc}>{p.description}</p>
              )}
              {p.capabilities && p.capabilities.length > 0 && (
                <div className={mk.capRow}>
                  {p.capabilities.map((c) => (
                    <span key={c} className={mk.capBadge}>{c}</span>
                  ))}
                </div>
              )}
              <footer className={mk.cardFooter}>
                <button
                  type="button"
                  className={mk.installBtn}
                  onClick={() => handleInstall(p)}
                  disabled={installingId === p.id || !canInstall}
                >
                  <DownloadIcon width={14} height={14} />
                  {installingId === p.id
                    ? t("marketplace.installing")
                    : t("marketplace.install")}
                </button>
                {p.downloads != null && (
                  <span className={mk.downloads}>
                    {t("marketplace.downloadsCount", { count: p.downloads })}
                  </span>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
