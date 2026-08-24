import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@core/store";
import { PowerIcon, PuzzleIcon, RefreshCwIcon, TrashIcon } from "@ui/icons";
import { NEBULA_MONO } from "../../tokens";
import { Stack } from "../primitives";
import { Banner, EmptyState, SettingsCard } from "../settings/controls";
import { AdminPage } from "./controls";
import { isPluginAdminSupported } from "./capabilities";

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

/** A small state word beside a plugin's name. */
function Badge({ label, tone, title }: Readonly<{ label: string; tone?: "warn" | "error"; title?: string }>) {
  return (
    <Box
      component="span"
      title={title}
      sx={(theme) => {
        const { nebula } = theme.palette;
        const color = tone === "error" ? nebula.bad : tone === "warn" ? nebula.warn : nebula.muted;
        return {
          flex: "none",
          px: "7px",
          py: "2px",
          borderRadius: "999px",
          fontSize: 10,
          fontWeight: 600,
          color,
          border: `1px solid ${color}`,
        };
      }}
    >
      {label}
    </Box>
  );
}

/**
 * The plugins the *server* is running.
 *
 * Not to be confused with the client's Plugins settings page: this installs,
 * enables and uninstalls code on the server, and every action here is a request
 * the server acknowledges asynchronously - which is why the page tracks a
 * `busy` plugin name rather than awaiting the invoke.
 */
export function ServerPluginsAdmin() {
  const { t } = useTranslation(["settings", "common"]);
  const serverFancyVersion = useAppStore((state) => state.serverFancyVersion);
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
    const offList = listen<PluginListPayload>("plugin-admin-list", (event) => {
      setPlugins(event.payload.plugins);
      setPluginsDir(event.payload.plugins_dir);
      useAppStore.setState({ serverHostAbiVersion: event.payload.host_abi_version ?? null });
      setLoading(false);
    });
    const offAck = listen<PluginAckPayload>("plugin-admin-ack", (event) => {
      setBusy(null);
      if (!event.payload.ok) setLastError(event.payload.error ?? t("serverPlugins.unknownError"));
      else {
        setLastError(null);
        refresh();
      }
    });
    // Both listeners must be live before the request goes out, or a fast
    // server's answer lands before the subscription and is dropped - Tauri
    // does not replay, so the page would sit on "loading" for ever.
    if (supported) {
      void Promise.all([offList, offAck]).then(() => active && refresh());
    }
    return () => {
      active = false;
      void offList.then((stop) => stop());
      void offAck.then((stop) => stop());
    };
  }, [refresh, t, supported]);

  // A request that is never acknowledged would otherwise leave the page
  // claiming to be loading indefinitely.
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setLoading(false);
      setLastError(t("serverPlugins.loadTimeout"));
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading, t]);

  const toggle = async (entry: ServerPluginEntry) => {
    // A plugin that failed to load has no instance to toggle, so the server
    // could not honour this even if the button were pressed.
    if (entry.load_error) return;
    setBusy(entry.plugin_name);
    setLastError(null);
    try {
      await invoke("set_server_plugin_enabled", {
        pluginName: entry.plugin_name,
        enabled: !entry.enabled,
      });
    } catch (e) {
      setLastError(String(e));
      setBusy(null);
    }
  };

  // Reload in place: disable, then enable. The server re-reads the plugin's
  // INI on the enable transition, so configuration changes apply without a
  // restart. Both messages travel the ordered control channel and are handled
  // sequentially, so `on_unload` has released its sockets before `on_load`
  // rebinds them.
  const reload = async (entry: ServerPluginEntry) => {
    setBusy(entry.plugin_name);
    setLastError(null);
    try {
      await invoke("set_server_plugin_enabled", { pluginName: entry.plugin_name, enabled: false });
      await invoke("set_server_plugin_enabled", { pluginName: entry.plugin_name, enabled: true });
    } catch (e) {
      setLastError(String(e));
      setBusy(null);
    }
  };

  const uninstall = async () => {
    if (!pendingUninstall) return;
    const entry = pendingUninstall;
    setPendingUninstall(null);
    setBusy(entry.plugin_name);
    setLastError(null);
    try {
      await invoke("uninstall_server_plugin", { pluginName: entry.plugin_name });
    } catch (e) {
      setLastError(String(e));
      setBusy(null);
    }
  };

  if (!supported) {
    return (
      <AdminPage title={t("serverPlugins.title")}>
        <Banner tone="info">{t("serverPlugins.unsupported")}</Banner>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title={t("serverPlugins.title")}
      toolbar={
        <Button
          size="small"
          variant="outlined"
          disabled={loading}
          startIcon={<RefreshCwIcon width={13} height={13} />}
          onClick={refresh}
        >
          {t("serverPlugins.refresh")}
        </Button>
      }
    >
      {pluginsDir && (
        <Typography sx={(theme) => ({ mb: "12px", fontSize: 11, color: theme.palette.nebula.muted })}>
          {t("serverPlugins.pluginsDir")}:{" "}
          <Box component="code" sx={{ fontFamily: NEBULA_MONO }}>
            {pluginsDir}
          </Box>
        </Typography>
      )}

      {lastError && <Banner tone="danger">{lastError}</Banner>}

      {loading && plugins.length === 0 ? (
        <EmptyState>{t("serverPlugins.loading")}</EmptyState>
      ) : plugins.length === 0 ? (
        <EmptyState>
          <Stack alignItems="center" gap={1}>
            <PuzzleIcon width={30} height={30} />
            <span>{t("serverPlugins.empty")}</span>
          </Stack>
        </EmptyState>
      ) : (
        <Stack gap={0.875}>
          {plugins.map((plugin) => (
            <SettingsCard key={plugin.plugin_name} sx={{ p: "12px 14px" }}>
              <Stack direction="row" alignItems="center" gap={1.5}>
                <Box sx={(theme) => ({ flex: "none", color: theme.palette.nebula.muted })}>
                  <PuzzleIcon width={24} height={24} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" alignItems="center" gap={0.75} flexWrap="wrap">
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{plugin.plugin_name}</Typography>
                    {!plugin.load_error && plugin.version && (
                      <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
                        v{plugin.version}
                      </Typography>
                    )}
                    {plugin.marketplace_id && <Badge label={t("serverPlugins.marketplaceBadge")} />}
                    {/* Enabled but not loaded: the server holds an older
                        instance than the file on disk. */}
                    {!plugin.loaded && plugin.enabled && (
                      <Badge tone="warn" label={t("serverPlugins.staleBadge")} />
                    )}
                    {plugin.load_error && (
                      <Badge tone="error" title={plugin.load_error} label={t("serverPlugins.brokenBadge")} />
                    )}
                  </Stack>
                  {plugin.path && (
                    <Typography
                      sx={(theme) => ({
                        mt: "2px",
                        fontFamily: NEBULA_MONO,
                        fontSize: 10.5,
                        color: theme.palette.nebula.dim,
                      })}
                      noWrap
                    >
                      {plugin.path}
                    </Typography>
                  )}
                </Box>

                <Stack direction="row" alignItems="center" gap={0.625} sx={{ flex: "none" }}>
                  <Button
                    size="small"
                    variant={plugin.enabled ? "contained" : "outlined"}
                    disabled={busy === plugin.plugin_name || !!plugin.load_error}
                    startIcon={<PowerIcon width={13} height={13} />}
                    title={
                      plugin.load_error
                        ? t("serverPlugins.incompatibleTitle", {
                            defaultValue: "Incompatible with this server - cannot be enabled.",
                          })
                        : plugin.enabled
                          ? t("serverPlugins.disable")
                          : t("serverPlugins.enable")
                    }
                    onClick={() => void toggle(plugin)}
                  >
                    {plugin.load_error
                      ? t("serverPlugins.incompatible", { defaultValue: "Incompatible" })
                      : plugin.enabled
                        ? t("serverPlugins.enabled")
                        : t("serverPlugins.disabled")}
                  </Button>
                  {plugin.enabled && (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy === plugin.plugin_name}
                      startIcon={<RefreshCwIcon width={13} height={13} />}
                      title={t("serverPlugins.reloadTitle", {
                        defaultValue:
                          "Reload the plugin to apply configuration changes without restarting the server.",
                      })}
                      onClick={() => void reload(plugin)}
                    >
                      {t("serverPlugins.reload", { defaultValue: "Reload" })}
                    </Button>
                  )}
                  {/* A built-in plugin ships with the server; there is no file
                      to remove and the server would refuse. */}
                  {!plugin.builtin && (
                    <IconButton
                      size="small"
                      disabled={busy === plugin.plugin_name}
                      title={t("serverPlugins.uninstall")}
                      aria-label={t("serverPlugins.uninstall")}
                      onClick={() => setPendingUninstall(plugin)}
                    >
                      <TrashIcon width={14} height={14} />
                    </IconButton>
                  )}
                </Stack>
              </Stack>
            </SettingsCard>
          ))}
        </Stack>
      )}

      <Dialog
        open={pendingUninstall !== null}
        onClose={() => setPendingUninstall(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>{t("serverPlugins.uninstall")}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5 }}>
            {pendingUninstall
              ? t("serverPlugins.confirmUninstall", { name: pendingUninstall.plugin_name })
              : ""}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setPendingUninstall(null)}>
            {t("common:actions.cancel")}
          </Button>
          <Button size="small" color="error" variant="contained" onClick={() => void uninstall()}>
            {t("serverPlugins.uninstall")}
          </Button>
        </DialogActions>
      </Dialog>
    </AdminPage>
  );
}
