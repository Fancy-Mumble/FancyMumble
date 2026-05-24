import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { marked } from "marked";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeftIcon, DownloadIcon, StoreIcon, StarIcon, ArrowUpRightIcon,
} from "../../icons";
import { SafeHtml } from "../../components/elements/SafeHtml";
import { useAppStore } from "../../store";
import { getPreferences } from "../../preferencesStorage";
import { isPluginAdminSupported } from "../admin/index";
import styles from "./PluginPage.module.css";

interface PluginVersion {
  version: string;
  released_at?: string | null;
  yanked?: boolean;
  min_server_version?: string | null;
  changelog?: string | null;
}

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
  tags?: string[];
  readme?: string | null;
  versions?: PluginVersion[];
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
  const status = useAppStore((s) => s.status);
  const canInstall = isPluginAdminSupported(serverFancyVersion) && status === "connected";

  const [plugin, setPlugin] = useState<MarketplacePlugin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [lastAck, setLastAck] = useState<PluginAckPayload | null>(null);
  const [marketplaceBaseUrl, setMarketplaceBaseUrl] = useState<string | null>(null);

  const readmeHtml = useMemo(() => {
    if (!plugin?.readme) return null;
    return String(marked.parse(plugin.readme, { async: false, gfm: true }));
  }, [plugin?.readme]);

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
    })
      .then((p) => { if (!cancelled) setPlugin(p); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, marketplaceBaseUrl]);

  useEffect(() => {
    const off = listen<PluginAckPayload>("plugin-admin-ack", (e) => {
      if (e.payload.verb === "install") {
        setLastAck(e.payload);
        setInstalling(false);
      }
    });
    return () => { off.then((f) => f()); };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!plugin?.manifest_url) {
      setError(t("marketplace.missingManifestUrl"));
      return;
    }
    setInstalling(true);
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
      setInstalling(false);
    }
  }, [plugin, t]);

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
          <header className={styles.header}>
            {plugin.icon_url ? (
              <img className={styles.icon} src={plugin.icon_url} alt="" />
            ) : (
              <div className={styles.icon}><StoreIcon width={32} height={32} /></div>
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
              </div>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.installBtn}
                onClick={handleInstall}
                disabled={installing || !canInstall || !plugin.manifest_url}
                title={!canInstall ? t("marketplace.installUnsupported") : undefined}
              >
                <DownloadIcon width={14} height={14} />
                {installing
                  ? t("marketplace.installing")
                  : t("marketplace.install")}
              </button>
              {plugin.homepage && (
                <a
                  className={styles.linkBtn}
                  href={plugin.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ArrowUpRightIcon width={14} height={14} />
                  {t("marketplace.homepage", { defaultValue: "Homepage" })}
                </a>
              )}
            </div>
          </header>

          {!canInstall && (
            <div className={styles.warnBanner}>
              {status === "connected"
                ? t("marketplace.installUnsupported")
                : t("marketplace.connectToInstall", { defaultValue: "Connect to a server with admin rights to install this plugin." })}
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
                      </td>
                      <td className={styles.changelogCell}>{v.changelog}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
    </div>
  );
}
