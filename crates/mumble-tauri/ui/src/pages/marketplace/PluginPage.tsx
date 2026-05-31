import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { marked } from "marked";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeftIcon, DownloadIcon, StarIcon, ArrowUpRightIcon, GlobeIcon, CheckIcon,
} from "../../icons";
import { SafeHtml } from "../../components/elements/SafeHtml";
import { useAppStore } from "../../store";
import type { ServerPluginEntry } from "../admin/ServerPluginsTab";
import { getPreferences } from "../../preferencesStorage";
import { isPluginAdminSupported } from "../admin/index";
import {
  PROD_MARKETPLACE_BASE, bannerGradient, resolveMarketplaceImage,
} from "../../utils/marketplaceMedia";
import styles from "./PluginPage.module.css";

interface PluginVersion {
  version: string;
  released_at?: string | null;
  yanked?: boolean;
  min_server_version?: string | null;
  min_fancy_server_version?: string | null;
  changelog?: string | null;
  /** Plugin ABI version this release targets (null for legacy entries). */
  abi_version?: number | null;
  /** Whether this release matches the connected server's host ABI. */
  compatible?: boolean | null;
}

interface MarketplacePlugin {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  author?: string | null;
  homepage?: string | null;
  icon_url?: string | null;
  banner_url?: string | null;
  gallery?: string[];
  manifest_url?: string | null;
  downloads?: number | null;
  rating?: number | null;
  rating_count?: number | null;
  /** Per-star tally [1★, 2★, 3★, 4★, 5★]; empty for legacy entries. */
  rating_histogram?: number[];
  official?: boolean;
  capabilities?: string[];
  tags?: string[];
  readme?: string | null;
  license?: string | null;
  source_url?: string | null;
  ini_snippet?: string | null;
  versions?: PluginVersion[];
  /** Plugin ABI version of the latest release (null for legacy entries). */
  abi_version?: number | null;
  /** Whether the latest release matches the connected server's host ABI. */
  compatible?: boolean | null;
}

interface PluginAckPayload {
  plugin_name: string | null;
  ok: boolean;
  error: string | null;
  request_id: string | null;
  verb: string | null;
}

export default function MarketplacePluginPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation("settings");
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const serverHostAbiVersion = useAppStore((s) => s.serverHostAbiVersion);
  const status = useAppStore((s) => s.status);
  const canInstall = isPluginAdminSupported(serverFancyVersion) && status === "connected";

  const [plugin, setPlugin] = useState<MarketplacePlugin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [lastAck, setLastAck] = useState<PluginAckPayload | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<ServerPluginEntry[]>([]);
  const [marketplaceBaseUrl, setMarketplaceBaseUrl] = useState<string | null>(null);

  const readmeHtml = useMemo(() => {
    if (!plugin?.readme) return null;
    return String(marked.parse(plugin.readme, { async: false, gfm: true }));
  }, [plugin?.readme]);

  const iconSrc = resolveMarketplaceImage(plugin?.icon_url, marketplaceBaseUrl);
  const bannerSrc = resolveMarketplaceImage(plugin?.banner_url, marketplaceBaseUrl);
  const galleryUrls = useMemo(
    () => (plugin?.gallery ?? [])
      .map((g) => resolveMarketplaceImage(g, marketplaceBaseUrl))
      .filter((u): u is string => !!u),
    [plugin?.gallery, marketplaceBaseUrl],
  );
  const bannerBg = bannerSrc
    ? `center / cover no-repeat url("${bannerSrc}")`
    : plugin ? bannerGradient(plugin.id || plugin.name) : undefined;

  // Derive the public web-store URL for this plugin from the marketplace
  // API base (its origin hosts the store front-end at /plugins/{id}).
  const storeUrl = useMemo(() => {
    if (!plugin) return null;
    try {
      const origin = new URL(marketplaceBaseUrl || PROD_MARKETPLACE_BASE).origin;
      return `${origin}/plugins/${encodeURIComponent(plugin.id)}`;
    } catch {
      return null;
    }
  }, [plugin, marketplaceBaseUrl]);

  // Open an external URL in the user's default browser, falling back to a
  // new tab when not running inside Tauri (e.g. the Vite dev server).
  const openExternal = useCallback((url: string) => {
    openUrl(url).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
  }, []);

  useEffect(() => {
    getPreferences().then((p) => {
      setMarketplaceBaseUrl(p.marketplaceBaseUrl ?? null);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<MarketplacePlugin>("fetch_marketplace_plugin", {
      pluginId: decodeURIComponent(id),
      baseUrl: marketplaceBaseUrl,
      serverAbiVersion: serverHostAbiVersion,
    })
      .then((p) => { if (!cancelled) setPlugin(p); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, marketplaceBaseUrl, serverHostAbiVersion]);

  // Learn the connected server's plugin host ABI version (see
  // MarketplaceTab) so per-version compatibility can be evaluated even
  // when this page is opened directly.
  useEffect(() => {
    if (!canInstall) return;
    const off = listen<{ plugins: ServerPluginEntry[]; host_abi_version: number | null }>("plugin-admin-list", (e) => {
      useAppStore.setState({ serverHostAbiVersion: e.payload.host_abi_version ?? null });
      setInstalledPlugins(e.payload.plugins);
    });
    invoke("request_server_plugins").catch(() => { /* surfaced elsewhere */ });
    return () => { off.then((f) => f()); };
  }, [canInstall]);

  useEffect(() => {
    const off = listen<PluginAckPayload>("plugin-admin-ack", (e) => {
      if (e.payload.verb === "install") {
        setLastAck(e.payload);
        setInstalling(false);
        if (e.payload.ok) {
          invoke("request_server_plugins").catch(() => { /* surfaced elsewhere */ });
        }
      }
    });
    return () => { off.then((f) => f()); };
  }, []);

  const handleInstall = useCallback(async () => {
    if (plugin?.compatible === false) {
      setError(t("marketplace.incompatibleAbi", {
        defaultValue: "This plugin targets a different plugin API version than the server and cannot be installed.",
      }));
      return;
    }
    if (!plugin?.manifest_url) {
      setError(t("marketplace.missingManifestUrl"));
      return;
    }
    setInstalling(true);
    setLastAck(null);
    const manifestUrl = plugin.manifest_url;
    try {
      // Pin the SHA-256 of the manifest we reviewed so the server rejects
      // the install if it fetches a different manifest.  Fall back to an
      // unpinned install only if the hash cannot be computed.
      let expectedSha256: string | null = null;
      try {
        expectedSha256 = await invoke<string>("fetch_plugin_manifest_sha256", { manifestUrl });
      } catch (e) {
        console.warn("[marketplace] manifest hash pin skipped:", e);
      }
      await invoke("install_server_plugin", {
        marketplaceId: plugin.id,
        version: plugin.version,
        manifestUrl,
        expectedSha256,
      });
    } catch (err) {
      setError(String(err));
      setInstalling(false);
    }
  }, [plugin, t]);

  // Rating breakdown (read-only). Reviews require sign-in and live on a
  // separate endpoint, so only the aggregate histogram is shown here.
  const ratingHistogram = useMemo(() => {
    const h = plugin?.rating_histogram;
    return h && h.length === 5 ? h : null;
  }, [plugin?.rating_histogram]);
  const ratingTotal = ratingHistogram
    ? ratingHistogram.reduce((a, b) => a + b, 0)
    : (plugin?.rating_count ?? 0);

  const isInstalled = plugin != null && installedPlugins.some((ip) => ip.marketplace_id === plugin.id);

  return (
    <div className={styles.pageScroll}>
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => navigate("/admin?tab=marketplace")}
        >
          <ArrowLeftIcon width={16} height={16} />
          {t("marketplace.back", { defaultValue: "Back" })}
        </button>
      </div>

      {loading && <div className={styles.empty}>{t("marketplace.loading")}</div>}

      {error && (
        <div className={styles.errorBanner}>{error}</div>
      )}

      {plugin && (
        <>
          <div className={styles.headerCard}>
            <div className={styles.banner} style={bannerBg ? { background: bannerBg } : undefined} />
            <div className={styles.headerBody}>
            {iconSrc ? (
              <img className={styles.icon} src={iconSrc} alt="" />
            ) : (
              <div
                className={styles.iconFallback}
                style={{ background: bannerGradient(plugin.id || plugin.name) }}
              >
                {plugin.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className={styles.headerMain}>
              <h1 className={styles.title}>
                {plugin.name}
                {plugin.official && (
                  <span className={styles.officialBadge}>
                    {t("marketplace.official")}
                  </span>
                )}
              </h1>
              <div className={styles.subtitle}>
                <span>v{plugin.version}</span>
                {plugin.abi_version != null && (
                  <span title={plugin.compatible === false
                    ? t("marketplace.incompatibleAbi", { defaultValue: "This plugin targets a different plugin API version than the server and cannot be installed." })
                    : undefined}>
                    {t("marketplace.abiVersion", { defaultValue: "API v{{version}}", version: plugin.abi_version })}
                  </span>
                )}
                {plugin.author && (
                  <span>{t("marketplace.byAuthor", { author: plugin.author })}</span>
                )}
                {plugin.rating != null && (
                  <span className={styles.rating}>
                    <StarIcon width={12} height={12} />
                    {plugin.rating.toFixed(1)}
                  </span>
                )}
                {plugin.downloads != null && (
                  <span>{t("marketplace.downloadsCount", { count: plugin.downloads })}</span>
                )}
                {plugin.license && (
                  <span>{plugin.license}</span>
                )}
              </div>
            </div>
            <div className={styles.actions}>
              {isInstalled && (
                <div className={styles.installedBadge}>
                  <CheckIcon width={13} height={13} />
                  {t("marketplace.installed", { defaultValue: "Installed" })}
                </div>
              )}
              <button
                type="button"
                className={styles.installBtn}
                onClick={handleInstall}
                disabled={installing || !canInstall || !plugin.manifest_url || plugin.compatible === false || isInstalled}
                title={!canInstall
                  ? t("marketplace.installUnsupported")
                  : plugin.compatible === false
                    ? t("marketplace.incompatibleAbi", { defaultValue: "This plugin targets a different plugin API version than the server and cannot be installed." })
                    : isInstalled
                      ? t("marketplace.alreadyInstalled", { defaultValue: "Already installed on this server" })
                      : undefined}
              >
                <DownloadIcon width={14} height={14} />
                {installing
                  ? t("marketplace.installing")
                  : t("marketplace.install")}
              </button>
              {storeUrl && (
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => openExternal(storeUrl)}
                  title={t("marketplace.openInStoreTitle", { defaultValue: "Open this plugin's page in your browser" })}
                >
                  <GlobeIcon width={14} height={14} />
                  {t("marketplace.openInStore", { defaultValue: "Open in store" })}
                </button>
              )}
              {plugin.homepage && (
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => openExternal(plugin.homepage!)}
                >
                  <ArrowUpRightIcon width={14} height={14} />
                  {t("marketplace.homepage", { defaultValue: "Homepage" })}
                </button>
              )}
            </div>
            </div>
          </div>

          {!canInstall && (
            <div className={styles.warnBanner}>
              {status === "connected"
                ? t("marketplace.installUnsupported")
                : t("marketplace.connectToInstall", { defaultValue: "Connect to a server with admin rights to install this plugin." })}
            </div>
          )}

          {plugin.compatible === false && (
            <div className={styles.warnBanner}>
              {t("marketplace.incompatibleAbi", { defaultValue: "This plugin targets a different plugin API version than the server and cannot be installed." })}
            </div>
          )}

          {lastAck?.ok && (
            <div className={styles.successBanner}>
              {t("marketplace.installSuccess", { name: lastAck.plugin_name })}
            </div>
          )}
          {lastAck && !lastAck.ok && (
            <div className={styles.errorBanner}>
              {t("marketplace.installFailed")}: {lastAck.error}
            </div>
          )}

          {plugin.description && (
            <section className={styles.section}>
              <p className={styles.description}>{plugin.description}</p>
            </section>
          )}

          {galleryUrls.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {t("marketplace.gallery", { defaultValue: "Screenshots" })}
              </h2>
              <div className={styles.gallery}>
                {galleryUrls.map((src) => (
                  <img key={src} className={styles.galleryImg} src={src} alt="" />
                ))}
              </div>
            </section>
          )}

          {plugin.capabilities && plugin.capabilities.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {t("marketplace.capabilities", { defaultValue: "Capabilities" })}
              </h2>
              <div className={styles.capRow}>
                {plugin.capabilities.map((c) => (
                  <span key={c} className={styles.capBadge}>{c}</span>
                ))}
              </div>
            </section>
          )}

          {plugin.tags && plugin.tags.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {t("marketplace.tags", { defaultValue: "Tags" })}
              </h2>
              <div className={styles.tagRow}>
                {plugin.tags.map((tag) => (
                  <span key={tag} className={styles.tagBadge}>{tag}</span>
                ))}
              </div>
            </section>
          )}

          {plugin.rating != null && ratingTotal > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {t("marketplace.ratingsReviews", { defaultValue: "Ratings & reviews" })}
              </h2>
              <div className={styles.ratingSummary}>
                <div className={styles.ratingScore}>
                  <span className={styles.ratingBig}>{plugin.rating.toFixed(1)}</span>
                  <span className={styles.ratingStars}>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <StarIcon
                        key={s}
                        width={14}
                        height={14}
                        fill={s <= Math.round(plugin.rating!) ? "currentColor" : "none"}
                      />
                    ))}
                  </span>
                  <span className={styles.ratingCount}>
                    {t("marketplace.ratingsCount", { count: ratingTotal })}
                  </span>
                </div>
                {ratingHistogram && (
                  <div className={styles.histogram}>
                    {[5, 4, 3, 2, 1].map((stars) => {
                      const count = ratingHistogram[stars - 1] ?? 0;
                      const pct = ratingTotal > 0 ? (count / ratingTotal) * 100 : 0;
                      return (
                        <div key={stars} className={styles.histRow}>
                          <span className={styles.histLabel}>{stars}★</span>
                          <span className={styles.histTrack}>
                            <span className={styles.histFill} style={{ width: `${pct}%` }} />
                          </span>
                          <span className={styles.histValue}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {plugin.ini_snippet && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {t("marketplace.configuration", { defaultValue: "Configuration" })}
              </h2>
              <pre className={styles.configBlock}>{plugin.ini_snippet}</pre>
            </section>
          )}

          {readmeHtml && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>README</h2>
              <SafeHtml html={readmeHtml} className={styles.readme} />
            </section>
          )}

          {plugin.versions && plugin.versions.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {t("marketplace.versions", { defaultValue: "Versions" })}
              </h2>
              <table className={styles.versionsTable}>
                <tbody>
                  {plugin.versions.map((v) => (
                    <tr key={v.version} className={v.yanked ? styles.yanked : undefined}>
                      <td className={styles.versionCell}>
                        {v.version}
                        {v.yanked && <span className={styles.yancedBadge}>yanked</span>}
                      </td>
                      <td className={styles.dateCell}>
                        {v.released_at ? new Date(v.released_at).toLocaleDateString() : null}
                      </td>
                      <td className={styles.reqCell}>
                        {v.min_server_version && `server ≥ ${v.min_server_version}`}
                        {v.min_fancy_server_version && (
                          <span>
                            {v.min_server_version ? " · " : ""}
                            {t("marketplace.minFancyServer", { defaultValue: "Fancy server ≥ {{version}}", version: v.min_fancy_server_version })}
                          </span>
                        )}
                        {v.abi_version != null && (
                          <span className={v.compatible === false ? styles.abiBad : undefined}>
                            {(v.min_server_version || v.min_fancy_server_version) ? " · " : ""}
                            {t("marketplace.abiVersion", { defaultValue: "API v{{version}}", version: v.abi_version })}
                          </span>
                        )}
                      </td>
                      <td className={styles.changelogCell}>{v.changelog}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {(plugin.license || plugin.source_url) && (
            <section className={styles.section}>
              <div className={styles.metaRow}>
                {plugin.license ? (
                  <span className={styles.licenseNote}>
                    {t("marketplace.license", { defaultValue: "License" })}: <strong>{plugin.license}</strong>
                  </span>
                ) : <span />}
                {plugin.source_url && (
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => openExternal(plugin.source_url!)}
                  >
                    <ArrowUpRightIcon width={14} height={14} />
                    {t("marketplace.sourceCode", { defaultValue: "Source code" })}
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
    </div>
  );
}
