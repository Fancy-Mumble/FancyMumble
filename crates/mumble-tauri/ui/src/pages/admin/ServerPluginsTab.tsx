import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ConfirmDialog from "../../components/elements/ConfirmDialog";
import {
  PuzzleIcon, PowerIcon, TrashIcon, RefreshCwIcon,
} from "../../icons";
import { useAppStore } from "../../store";
import { isPluginAdminSupported } from "./index";
import styles from "./AdminPanel.module.css";
import sp from "./ServerPluginsTab.module.css";

const LOAD_TIMEOUT_MS = 10_000;

export interface ServerPluginEntry {
  plugin_name: string;
  version: string;
  enabled: boolean;
  loaded: boolean;
  path: string | null;
  info_json: string | null;
  marketplace_id: string | null;
  installed_at: number | null;
  builtin: boolean;
  load_error: string | null;
}

interface PluginListPayload {
  plugins: ServerPluginEntry[];
  plugins_dir: string | null;
  host_abi_version: number | null;
}

interface PluginAckPayload {
  plugin_name: string | null;
  ok: boolean;
  error: string | null;
  request_id: string | null;
  verb: string | null;
}

export function ServerPluginsTab() {
  const { t } = useTranslation("settings");
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const supported = isPluginAdminSupported(serverFancyVersion);
  const [plugins, setPlugins] = useState<ServerPluginEntry[]>([]);
  const [pluginsDir, setPluginsDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<ServerPluginEntry | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setLastError(null);
    invoke("request_server_plugins").catch((e) => {
      setLastError(String(e));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let active = true;
    const offList = listen<PluginListPayload>("plugin-admin-list", (e) => {
      setPlugins(e.payload.plugins);
      setPluginsDir(e.payload.plugins_dir);
      useAppStore.setState({ serverHostAbiVersion: e.payload.host_abi_version ?? null });
      setLoading(false);
    });
    const offAck = listen<PluginAckPayload>("plugin-admin-ack", (e) => {
      setBusy(null);
      if (!e.payload.ok) {
        setLastError(e.payload.error ?? t("serverPlugins.unknownError"));
      } else {
        setLastError(null);
        refresh();
      }
    });
    // Wait for both listeners to be registered before requesting the plugin
    // list. Without this, the server response can arrive before the listener
    // is active and the event is dropped, leaving the tab stuck loading.
    if (supported) {
      Promise.all([offList, offAck]).then(() => {
        if (active) refresh();
      });
    }
    return () => {
      active = false;
      offList.then((f) => f());
      offAck.then((f) => f());
    };
  }, [refresh, t, supported]);

  useEffect(() => {
    if (!loading) return;
    const id = setTimeout(() => {
      setLoading(false);
      setLastError(t("serverPlugins.loadTimeout"));
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [loading, t]);

  const handleToggle = useCallback(async (entry: ServerPluginEntry) => {
    setBusy(entry.plugin_name);
    setLastError(null);
    try {
      await invoke("set_server_plugin_enabled", {
        pluginName: entry.plugin_name,
        enabled: !entry.enabled,
      });
    } catch (err) {
      setLastError(String(err));
      setBusy(null);
    }
  }, []);

  // Reload a loaded plugin in place: disable then re-enable. The server
  // re-reads its INI on the enable transition, so this applies any config
  // changes (e.g. base_url, public_url) without a full server restart.
  // The two messages travel over the ordered control channel and are
  // processed sequentially server-side, so on_unload fully completes
  // (releasing sockets) before on_load re-binds.
  const handleReload = useCallback(async (entry: ServerPluginEntry) => {
    setBusy(entry.plugin_name);
    setLastError(null);
    try {
      await invoke("set_server_plugin_enabled", {
        pluginName: entry.plugin_name,
        enabled: false,
      });
      await invoke("set_server_plugin_enabled", {
        pluginName: entry.plugin_name,
        enabled: true,
      });
    } catch (err) {
      setLastError(String(err));
      setBusy(null);
    }
  }, []);

  const handleUninstall = useCallback((entry: ServerPluginEntry) => {
    setPendingUninstall(entry);
  }, []);

  const handleConfirmUninstall = useCallback(async () => {
    if (!pendingUninstall) return;
    const entry = pendingUninstall;
    setPendingUninstall(null);
    setBusy(entry.plugin_name);
    setLastError(null);
    try {
      await invoke("uninstall_server_plugin", {
        pluginName: entry.plugin_name,
      });
    } catch (err) {
      setLastError(String(err));
      setBusy(null);
    }
  }, [pendingUninstall]);

  if (!supported) {
    return (
      <div>
        <h2 className={styles.panelTitle}>{t("serverPlugins.title")}</h2>
        <div className={sp.unsupportedBanner}>{t("serverPlugins.unsupported")}</div>
      </div>
    );
  }

  return (
    <>
    <div>
      <h2 className={styles.panelTitle}>{t("serverPlugins.title")}</h2>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCwIcon width={14} height={14} />
          {t("serverPlugins.refresh")}
        </button>
        {pluginsDir && (
          <span className={sp.pluginsDir}>
            {t("serverPlugins.pluginsDir")}: <code>{pluginsDir}</code>
          </span>
        )}
      </div>

      {lastError && (
        <div className={sp.errorBanner}>{lastError}</div>
      )}

      {loading && plugins.length === 0 ? (
        <div className={sp.empty}>{t("serverPlugins.loading")}</div>
      ) : plugins.length === 0 ? (
        <div className={sp.empty}>
          <PuzzleIcon width={36} height={36} />
          <p>{t("serverPlugins.empty")}</p>
        </div>
      ) : (
        <ul className={sp.list}>
          {plugins.map((p) => (
            <li key={p.plugin_name} className={sp.row}>
              <div className={sp.iconCol}>
                <PuzzleIcon width={28} height={28} />
              </div>
              <div className={sp.bodyCol}>
                <div className={sp.title}>
                  <span className={sp.name}>{p.plugin_name}</span>
                  <span className={sp.version}>v{p.version}</span>
                  {p.marketplace_id && (
                    <span className={sp.badge}>
                      {t("serverPlugins.marketplaceBadge")}
                    </span>
                  )}
                  {!p.loaded && p.enabled && (
                    <span className={`${sp.badge} ${sp.badgeWarn}`}>
                      {t("serverPlugins.staleBadge")}
                    </span>
                  )}
                  {p.load_error && (
                    <span className={`${sp.badge} ${sp.badgeError}`} title={p.load_error}>
                      {t("serverPlugins.brokenBadge")}
                    </span>
                  )}
                </div>
                {p.path && <div className={sp.path}>{p.path}</div>}
              </div>
              <div className={sp.actions}>
                <button
                  type="button"
                  className={p.enabled ? sp.btnEnabled : sp.btnDisabled}
                  onClick={() => handleToggle(p)}
                  disabled={busy === p.plugin_name}
                  title={
                    p.enabled
                      ? t("serverPlugins.disable")
                      : t("serverPlugins.enable")
                  }
                >
                  <PowerIcon width={14} height={14} />
                  {p.enabled
                    ? t("serverPlugins.enabled")
                    : t("serverPlugins.disabled")}
                </button>
                {p.enabled && (
                  <button
                    type="button"
                    className={styles.refreshBtn}
                    onClick={() => handleReload(p)}
                    disabled={busy === p.plugin_name}
                    title={t("serverPlugins.reloadTitle", {
                      defaultValue: "Reload the plugin to apply configuration changes without restarting the server.",
                    })}
                  >
                    <RefreshCwIcon width={14} height={14} />
                    {t("serverPlugins.reload", { defaultValue: "Reload" })}
                  </button>
                )}
                {!p.builtin && (
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => handleUninstall(p)}
                    disabled={busy === p.plugin_name}
                    title={t("serverPlugins.uninstall")}
                  >
                    <TrashIcon width={14} height={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>

      {pendingUninstall && (
        <ConfirmDialog
          title={t("serverPlugins.uninstall")}
          body={t("serverPlugins.confirmUninstall", { name: pendingUninstall.plugin_name })}
          confirmLabel={t("serverPlugins.uninstall")}
          danger
          isConfirming={busy === pendingUninstall.plugin_name}
          onConfirm={() => { void handleConfirmUninstall(); }}
          onCancel={() => setPendingUninstall(null)}
        />
      )}
    </>
  );
}
