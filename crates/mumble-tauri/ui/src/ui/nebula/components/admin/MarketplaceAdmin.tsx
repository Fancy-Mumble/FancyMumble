import { useCallback, useEffect, useState } from "react";
import { Box, Button, MenuItem, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@core/store";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { bannerGradient, resolveMarketplaceImage } from "@core/utils/marketplaceMedia";
import { CheckIcon, DownloadIcon, RefreshCwIcon, StarIcon, StoreIcon } from "@ui/icons";
import { SearchBox, Stack } from "../primitives";
import { Banner, EmptyState, SettingsCard } from "../settings/controls";
import { AdminPage } from "./controls";
import { isPluginAdminSupported } from "./capabilities";
import type { ServerPluginEntry } from "./ServerPluginsAdmin";
import { radius } from "../../tokens";

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
  /** Plugin ABI version of the latest release (null for legacy entries). */
  abi_version?: number | null;
  /** Whether that release matches the connected server's host ABI. */
  compatible?: boolean | null;
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
  { label: "Production", value: PROD_URL },
  { label: "Local (localhost)", value: LOCAL_URL },
];

/**
 * Reduce any URL in an error to its origin.
 *
 * A failed fetch can carry a full URL with a query string; the origin is the
 * part that tells the admin which host was unreachable, and the rest is noise
 * that may include a token.
 */
function urlOriginOnly(message: string): string {
  return message.replaceAll(/https?:\/\/[^\s)]+/g, (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  });
}

/**
 * The plugin marketplace.
 *
 * Installing pins the hash of the manifest that was just read, so the server
 * fetches the same bytes this client reviewed rather than whatever the URL
 * serves a moment later.
 */
export function MarketplaceAdmin({ onOpenPlugin }: Readonly<{ onOpenPlugin?: (id: string) => void }>) {
  const { t } = useTranslation("settings");
  const serverFancyVersion = useAppStore((state) => state.serverFancyVersion);
  const serverHostAbiVersion = useAppStore((state) => state.serverHostAbiVersion);
  const canInstall = isPluginAdminSupported(serverFancyVersion);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<MarketplacePlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [lastAck, setLastAck] = useState<PluginAckPayload | null>(null);
  const [installed, setInstalled] = useState<ServerPluginEntry[]>([]);
  const [baseUrl, setBaseUrl] = useState(PROD_URL);
  const [isDevMode, setIsDevMode] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => {
    void getPreferences().then((prefs) => {
      setIsDevMode(prefs.userMode === "developer");
      if (prefs.marketplaceBaseUrl) setBaseUrl(prefs.marketplaceBaseUrl);
      setPrefsLoaded(true);
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const off = listen<PluginAckPayload>("plugin-admin-ack", (event) => {
      if (event.payload.verb !== "install") return;
      setLastAck(event.payload);
      setInstallingId(null);
      if (event.payload.ok) invoke("request_server_plugins").catch(() => undefined);
    });
    return () => {
      void off.then((stop) => stop());
    };
  }, []);

  // The server announces its plugin host ABI on every `plugin-admin-list`.
  // Asking for the inventory here makes that available even when the Server
  // plugins page was never opened, which is what lets this page mark an
  // incompatible plugin before the install is attempted.
  useEffect(() => {
    if (!canInstall) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const off = await listen<{ plugins: ServerPluginEntry[]; host_abi_version: number | null }>(
        "plugin-admin-list",
        (event) => {
          useAppStore.setState({ serverHostAbiVersion: event.payload.host_abi_version ?? null });
          setInstalled(event.payload.plugins);
        },
      );
      if (cancelled) return off();
      unlisten = off;
      invoke("request_server_plugins").catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [canInstall]);

  const fetchIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const index = await invoke<MarketplaceIndex>("fetch_marketplace_index", {
        query: debouncedQuery,
        page: 1,
        baseUrl: baseUrl !== PROD_URL ? baseUrl : null,
        serverAbiVersion: serverHostAbiVersion,
      });
      setResults(index.plugins);
    } catch (e) {
      setError(urlOriginOnly(String(e)));
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, baseUrl, serverHostAbiVersion]);

  useEffect(() => {
    if (prefsLoaded) void fetchIndex();
  }, [fetchIndex, prefsLoaded]);

  const incompatibleText = t("marketplace.incompatibleAbi", {
    defaultValue:
      "This plugin targets a different plugin API version than the server and cannot be installed.",
  });

  const install = async (plugin: MarketplacePlugin) => {
    if (!canInstall) return setError(t("marketplace.installUnsupported"));
    if (plugin.compatible === false) return setError(incompatibleText);
    if (!plugin.manifest_url) return setError(t("marketplace.missingManifestUrl"));

    setInstallingId(plugin.id);
    setLastAck(null);
    const manifestUrl = plugin.manifest_url;
    try {
      // Pin the manifest we just read, so the server installs those bytes
      // rather than whatever the URL serves by the time it fetches.
      let expectedSha256: string | null = null;
      try {
        expectedSha256 = await invoke<string>("fetch_plugin_manifest_sha256", { manifestUrl });
      } catch {
        // The pin is a hardening step, not a precondition for installing.
      }
      await invoke("install_server_plugin", {
        marketplaceId: plugin.id,
        version: plugin.version,
        manifestUrl,
        expectedSha256,
      });
    } catch (e) {
      setError(String(e));
      setInstallingId(null);
    }
  };

  return (
    <AdminPage
      wide
      title={t("marketplace.title")}
      toolbar={
        <>
          <Box sx={{ width: 220 }}>
            <SearchBox value={query} onChange={setQuery} placeholder={t("marketplace.searchPlaceholder")} />
          </Box>
          {isDevMode && (
            <TextField
              select
              size="small"
              sx={{ width: 180 }}
              value={baseUrl}
              title="Dev: select marketplace URL"
              onChange={(event) => {
                const url = event.target.value;
                setBaseUrl(url);
                void updatePreferences({ marketplaceBaseUrl: url === PROD_URL ? undefined : url });
              }}
              slotProps={{ htmlInput: { "aria-label": "Marketplace URL" } }}
            >
              {DEV_URL_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Button
            size="small"
            variant="outlined"
            disabled={loading}
            startIcon={<RefreshCwIcon width={13} height={13} />}
            onClick={() => void fetchIndex()}
          >
            {t("marketplace.refresh")}
          </Button>
        </>
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}
      {!canInstall && <Banner tone="warn">{t("marketplace.installUnsupported")}</Banner>}
      {lastAck && !lastAck.ok && (
        <Banner tone="danger">
          {t("marketplace.installFailed")}: {lastAck.error}
        </Banner>
      )}
      {lastAck?.ok && (
        <Banner tone="ok">{t("marketplace.installSuccess", { name: lastAck.plugin_name })}</Banner>
      )}

      {loading && results.length === 0 ? (
        <EmptyState>{t("marketplace.loading")}</EmptyState>
      ) : results.length === 0 ? (
        <EmptyState>
          <Stack alignItems="center" gap={1}>
            <StoreIcon width={30} height={30} />
            <span>{t("marketplace.empty")}</span>
          </Stack>
        </EmptyState>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
            gap: "12px",
            mt: "12px",
          }}
        >
          {results.map((plugin) => {
            const iconSrc = resolveMarketplaceImage(plugin.icon_url, baseUrl === PROD_URL ? null : baseUrl);
            const isInstalled = installed.some((entry) => entry.marketplace_id === plugin.id);
            const incompatible = plugin.compatible === false;
            return (
              <SettingsCard key={plugin.id}>
                <Stack direction="row" gap={1.25} alignItems="flex-start">
                  {iconSrc ? (
                    <Box
                      component="img"
                      src={iconSrc}
                      alt=""
                      sx={{ flex: "none", width: 38, height: 38, borderRadius: radius("md") }}
                    />
                  ) : (
                    <Box
                      sx={{
                        flex: "none",
                        width: 38,
                        height: 38,
                        borderRadius: radius("md"),
                        display: "grid",
                        placeItems: "center",
                        fontSize: 16,
                        fontWeight: 700,
                        color: "#fff",
                        background: bannerGradient(plugin.id || plugin.name),
                      }}
                    >
                      {plugin.name.charAt(0).toUpperCase()}
                    </Box>
                  )}

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" gap={0.75} flexWrap="wrap">
                      <Box
                        component="button"
                        onClick={() => onOpenPlugin?.(plugin.id)}
                        sx={{
                          all: "unset",
                          cursor: onOpenPlugin ? "pointer" : "default",
                          fontSize: 13,
                          fontWeight: 600,
                          "&:hover": { textDecoration: onOpenPlugin ? "underline" : "none" },
                        }}
                      >
                        {plugin.name}
                      </Box>
                      {plugin.official && (
                        <Box
                          component="span"
                          sx={(theme) => ({
                            px: "6px",
                            py: "1px",
                            borderRadius: "999px",
                            fontSize: 9.5,
                            fontWeight: 600,
                            color: theme.palette.nebula.accent,
                            background: theme.palette.nebula.accentSoft,
                          })}
                        >
                          {t("marketplace.official")}
                        </Box>
                      )}
                    </Stack>

                    <Stack
                      direction="row"
                      gap={1}
                      flexWrap="wrap"
                      alignItems="center"
                      sx={(theme) => ({ mt: "3px", fontSize: 10.5, color: theme.palette.nebula.muted })}
                    >
                      <span>v{plugin.version}</span>
                      {isInstalled && (
                        <Stack direction="row" alignItems="center" gap={0.25}>
                          <CheckIcon width={10} height={10} />
                          {t("marketplace.installed", { defaultValue: "Installed" })}
                        </Stack>
                      )}
                      {plugin.abi_version != null && (
                        <Box
                          component="span"
                          title={incompatible ? incompatibleText : undefined}
                          sx={(theme) => ({ color: incompatible ? theme.palette.nebula.bad : "inherit" })}
                        >
                          {t("marketplace.abiVersion", {
                            defaultValue: "API v{{version}}",
                            version: plugin.abi_version,
                          })}
                        </Box>
                      )}
                      {plugin.author && <span>{t("marketplace.byAuthor", { author: plugin.author })}</span>}
                      {plugin.rating != null && (
                        <Stack direction="row" alignItems="center" gap={0.25}>
                          <StarIcon width={11} height={11} />
                          {plugin.rating.toFixed(1)}
                        </Stack>
                      )}
                    </Stack>
                  </Box>
                </Stack>

                {plugin.description && (
                  <Typography
                    sx={(theme) => ({
                      mt: "9px",
                      fontSize: 11.5,
                      lineHeight: 1.55,
                      color: theme.palette.nebula.muted,
                    })}
                  >
                    {plugin.description}
                  </Typography>
                )}

                {plugin.capabilities && plugin.capabilities.length > 0 && (
                  <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: "9px" }}>
                    {plugin.capabilities.map((capability) => (
                      <Box
                        key={capability}
                        component="span"
                        sx={(theme) => ({
                          px: "7px",
                          py: "2px",
                          borderRadius: "999px",
                          fontSize: 10,
                          background: theme.palette.nebula.card2,
                          color: theme.palette.nebula.muted,
                        })}
                      >
                        {capability}
                      </Box>
                    ))}
                  </Stack>
                )}

                {incompatible && <Banner tone="warn">{incompatibleText}</Banner>}

                <Stack direction="row" alignItems="center" gap={1.25} sx={{ mt: "12px" }}>
                  <Button
                    size="small"
                    variant={isInstalled ? "outlined" : "contained"}
                    disabled={installingId === plugin.id || !canInstall || incompatible || isInstalled}
                    startIcon={
                      isInstalled ? (
                        <CheckIcon width={13} height={13} />
                      ) : (
                        <DownloadIcon width={13} height={13} />
                      )
                    }
                    title={
                      incompatible
                        ? incompatibleText
                        : isInstalled
                          ? t("marketplace.alreadyInstalled", {
                              defaultValue: "Already installed on this server",
                            })
                          : undefined
                    }
                    onClick={() => void install(plugin)}
                  >
                    {installingId === plugin.id
                      ? t("marketplace.installing")
                      : isInstalled
                        ? t("marketplace.installed", { defaultValue: "Installed" })
                        : t("marketplace.install")}
                  </Button>
                  {plugin.downloads != null && (
                    <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
                      {t("marketplace.downloadsCount", { count: plugin.downloads })}
                    </Typography>
                  )}
                </Stack>
              </SettingsCard>
            );
          })}
        </Box>
      )}
    </AdminPage>
  );
}
