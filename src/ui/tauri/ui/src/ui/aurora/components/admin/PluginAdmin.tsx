import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPreferences } from "@core/preferencesStorage";
import { useAppStore } from "@core/store";
import { bannerGradient, resolveMarketplaceImage } from "@core/utils/marketplaceMedia";
import { Button, SearchField } from "../primitives";
import styles from "./PluginAdmin.module.css";

export interface ServerPluginEntry {
  plugin_name: string;
  version: string;
  enabled: boolean;
  loaded: boolean;
  path: string | null;
  marketplace_id: string | null;
  builtin: boolean;
  load_error: string | null;
}
interface PluginListPayload {
  plugins: ServerPluginEntry[];
  plugins_dir: string | null;
  host_abi_version: number | null;
}
interface PluginAck {
  plugin_name: string | null;
  ok: boolean;
  error: string | null;
  verb: string | null;
}
interface MarketplacePlugin {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  author?: string | null;
  icon_url?: string | null;
  manifest_url?: string | null;
  downloads?: number | null;
  rating?: number | null;
  official?: boolean;
  abi_version?: number | null;
  compatible?: boolean | null;
}
interface MarketplaceIndex {
  plugins: MarketplacePlugin[];
  total: number;
  page: number;
  per_page: number;
}

export function ServerPluginManager() {
  const [plugins, setPlugins] = useState<ServerPluginEntry[]>([]);
  const [directory, setDirectory] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    void invoke("request_server_plugins").catch((reason) => setError(String(reason)));
  }, []);
  useEffect(() => {
    const list = listen<PluginListPayload>("plugin-admin-list", (event) => {
      setPlugins(event.payload.plugins);
      setDirectory(event.payload.plugins_dir);
      useAppStore.setState({ serverHostAbiVersion: event.payload.host_abi_version });
    });
    const ack = listen<PluginAck>("plugin-admin-ack", (event) => {
      setBusy(null);
      setError(event.payload.ok ? null : (event.payload.error ?? "Plugin operation failed."));
      if (event.payload.ok) refresh();
    });
    void Promise.all([list, ack]).then(refresh);
    return () => {
      void list.then((off) => off());
      void ack.then((off) => off());
    };
  }, [refresh]);
  const toggle = async (plugin: ServerPluginEntry) => {
    setBusy(plugin.plugin_name);
    await invoke("set_server_plugin_enabled", {
      pluginName: plugin.plugin_name,
      enabled: !plugin.enabled,
    }).catch((reason) => {
      setBusy(null);
      setError(String(reason));
    });
  };
  const reload = async (plugin: ServerPluginEntry) => {
    setBusy(plugin.plugin_name);
    try {
      await invoke("set_server_plugin_enabled", { pluginName: plugin.plugin_name, enabled: false });
      await invoke("set_server_plugin_enabled", { pluginName: plugin.plugin_name, enabled: true });
    } catch (reason) {
      setBusy(null);
      setError(String(reason));
    }
  };
  const uninstall = async (plugin: ServerPluginEntry) => {
    if (!globalThis.confirm(`Uninstall ${plugin.plugin_name}?`)) return;
    setBusy(plugin.plugin_name);
    await invoke("uninstall_server_plugin", { pluginName: plugin.plugin_name }).catch((reason) => {
      setBusy(null);
      setError(String(reason));
    });
  };
  return (
    <div className={styles.page}>
      <header>
        <div>
          <h3>Server plugins</h3>
          <p>Enable, reload, and uninstall extensions hosted by this server.</p>
        </div>
        <Button onClick={refresh}>Refresh</Button>
      </header>
      {directory && <code className={styles.directory}>{directory}</code>}
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.pluginList}>
        {plugins.map((plugin) => (
          <article key={plugin.plugin_name}>
            <span className={styles.pluginIcon}>{plugin.plugin_name.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>
                {plugin.plugin_name} <small>v{plugin.version}</small>
              </strong>
              <p>{plugin.load_error || plugin.path || (plugin.loaded ? "Loaded" : "Not loaded")}</p>
            </div>
            <Button
              disabled={busy === plugin.plugin_name || !!plugin.load_error}
              variant={plugin.enabled ? "secondary" : "bare"}
              onClick={() => void toggle(plugin)}
            >
              {plugin.enabled ? "Enabled" : "Disabled"}
            </Button>
            {plugin.enabled && (
              <Button disabled={busy === plugin.plugin_name} onClick={() => void reload(plugin)}>
                Reload
              </Button>
            )}
            {!plugin.builtin && (
              <Button
                variant="danger"
                disabled={busy === plugin.plugin_name}
                onClick={() => void uninstall(plugin)}
              >
                Uninstall
              </Button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

export function PluginMarketplace({ initialPluginId }: { initialPluginId?: string }) {
  const hostAbi = useAppStore((state) => state.serverHostAbiVersion);
  const [query, setQuery] = useState(initialPluginId ?? "");
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
  const [selected, setSelected] = useState<MarketplacePlugin | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fetchIndex = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const response = await invoke<MarketplaceIndex>("fetch_marketplace_index", {
        query: query.trim(),
        page: 1,
        baseUrl,
        serverAbiVersion: hostAbi,
      });
      setPlugins(response.plugins);
      setSelected((current) => response.plugins.find((plugin) => plugin.id === initialPluginId) ?? current);
    } catch (reason) {
      setStatus(String(reason));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, hostAbi, initialPluginId, query]);
  useEffect(() => {
    void getPreferences()
      .then((preferences) => setBaseUrl(preferences.marketplaceBaseUrl ?? null))
      .finally(() => setPreferencesLoaded(true));
  }, []);
  useEffect(() => {
    if (preferencesLoaded) void fetchIndex();
  }, [fetchIndex, preferencesLoaded]);
  useEffect(() => {
    const ack = listen<PluginAck>("plugin-admin-ack", (event) => {
      if (event.payload.verb !== "install") return;
      setBusy(null);
      setStatus(
        event.payload.ok
          ? `${event.payload.plugin_name ?? "Plugin"} installed.`
          : (event.payload.error ?? "Installation failed."),
      );
    });
    return () => {
      void ack.then((off) => off());
    };
  }, []);
  const install = async (plugin: MarketplacePlugin) => {
    if (!plugin.manifest_url || plugin.compatible === false) return;
    setBusy(plugin.id);
    try {
      let expectedSha256: string | null = null;
      try {
        expectedSha256 = await invoke<string>("fetch_plugin_manifest_sha256", {
          manifestUrl: plugin.manifest_url,
        });
      } catch {
        /* older servers can install without pinning */
      }
      await invoke("install_server_plugin", {
        marketplaceId: plugin.id,
        version: plugin.version,
        manifestUrl: plugin.manifest_url,
        expectedSha256,
      });
    } catch (reason) {
      setBusy(null);
      setStatus(String(reason));
    }
  };
  return (
    <div className={styles.page}>
      <header>
        <div>
          <h3>Plugin marketplace</h3>
          <p>Browse server extensions and install a reviewed manifest.</p>
        </div>
        <SearchField
          aria-label="Search marketplace"
          placeholder="Search plugins"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button disabled={loading} onClick={() => void fetchIndex()}>
          Refresh
        </Button>
      </header>
      {status && <p className={styles.status}>{status}</p>}
      <div className={styles.marketLayout}>
        <div className={styles.marketGrid}>
          {plugins.map((plugin) => {
            const icon = resolveMarketplaceImage(plugin.icon_url, baseUrl);
            return (
              <Button
                variant="bare"
                className={styles.marketCard}
                key={plugin.id}
                onClick={() => setSelected(plugin)}
              >
                {icon ? (
                  <img src={icon} alt="" />
                ) : (
                  <span style={{ background: bannerGradient(plugin.id) }}>{plugin.name.slice(0, 1)}</span>
                )}
                <div>
                  <strong>{plugin.name}</strong>
                  <small>
                    v{plugin.version}
                    {plugin.author ? ` · ${plugin.author}` : ""}
                  </small>
                  <p>{plugin.description || "No description provided."}</p>
                </div>
              </Button>
            );
          })}
          {!loading && plugins.length === 0 && <p className={styles.empty}>No plugins match this search.</p>}
        </div>
        {selected && (
          <aside className={styles.details}>
            <button type="button" className={styles.hero} style={{ background: bannerGradient(selected.id) }}>
              {resolveMarketplaceImage(selected.icon_url, baseUrl) ? (
                <img src={resolveMarketplaceImage(selected.icon_url, baseUrl)!} alt="" />
              ) : (
                selected.name.slice(0, 1)
              )}
            </button>
            <h3>{selected.name}</h3>
            <small>
              Version {selected.version}
              {selected.official ? " · Official" : ""}
            </small>
            <p>{selected.description || "No description provided."}</p>
            {selected.compatible === false && <b>Incompatible with server plugin API v{hostAbi ?? "?"}</b>}
            <Button
              variant="primary"
              disabled={busy === selected.id || !selected.manifest_url || selected.compatible === false}
              onClick={() => void install(selected)}
            >
              {busy === selected.id ? "Installing…" : "Install on server"}
            </Button>
          </aside>
        )}
      </div>
    </div>
  );
}
