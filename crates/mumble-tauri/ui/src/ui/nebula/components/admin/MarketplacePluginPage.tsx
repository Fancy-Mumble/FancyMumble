import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { marked } from "marked";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore } from "@core/store";
import { getPreferences } from "@core/preferencesStorage";
import {
  PROD_MARKETPLACE_BASE,
  bannerGradient,
  resolveMarketplaceImage,
} from "@core/utils/marketplaceMedia";
import { SafeHtml } from "@standard/components/elements/SafeHtml";
import { ArrowLeftIcon, CheckIcon, DownloadIcon, GlobeIcon, StarIcon } from "@ui/icons";
import { NEBULA_MONO, radius } from "../../tokens";
import { Stack } from "../primitives";
import { Banner, GroupTitle, SettingsCard } from "../settings/controls";
import { AdminPage, DataTable } from "./controls";
import { isPluginAdminSupported } from "./capabilities";
import type { ServerPluginEntry } from "./ServerPluginsAdmin";

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
  /** Per-star tally [1★ … 5★]; empty for legacy entries. */
  rating_histogram?: number[];
  official?: boolean;
  capabilities?: string[];
  tags?: string[];
  readme?: string | null;
  license?: string | null;
  source_url?: string | null;
  ini_snippet?: string | null;
  versions?: PluginVersion[];
  abi_version?: number | null;
  compatible?: boolean | null;
}

interface PluginAckPayload {
  plugin_name: string | null;
  ok: boolean;
  error: string | null;
  request_id: string | null;
  verb: string | null;
}

/**
 * One marketplace listing.
 *
 * Reached from the Marketplace page and from a `fancy://marketplace/plugin/…`
 * link, so it can be the first thing a session sees - which is why it fetches
 * the server's plugin inventory itself rather than assuming the Marketplace
 * page has already done so.
 */
export function MarketplacePluginPage({
  pluginId,
  onBack,
}: Readonly<{ pluginId: string; onBack: () => void }>) {
  const { t } = useTranslation("settings");
  const serverFancyVersion = useAppStore((state) => state.serverFancyVersion);
  const serverHostAbiVersion = useAppStore((state) => state.serverHostAbiVersion);
  const status = useAppStore((state) => state.status);
  const canInstall = isPluginAdminSupported(serverFancyVersion) && status === "connected";

  const [plugin, setPlugin] = useState<MarketplacePlugin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [lastAck, setLastAck] = useState<PluginAckPayload | null>(null);
  const [installed, setInstalled] = useState<ServerPluginEntry[]>([]);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);

  const readmeHtml = useMemo(
    () => (plugin?.readme ? String(marked.parse(plugin.readme, { async: false, gfm: true })) : null),
    [plugin?.readme],
  );

  const iconSrc = resolveMarketplaceImage(plugin?.icon_url, baseUrl);
  const bannerSrc = resolveMarketplaceImage(plugin?.banner_url, baseUrl);
  const gallery = useMemo(
    () =>
      (plugin?.gallery ?? [])
        .map((entry) => resolveMarketplaceImage(entry, baseUrl))
        .filter((url): url is string => !!url),
    [plugin?.gallery, baseUrl],
  );

  // The API base's origin hosts the store front-end at /plugins/{id}.
  const storeUrl = useMemo(() => {
    if (!plugin) return null;
    try {
      return `${new URL(baseUrl || PROD_MARKETPLACE_BASE).origin}/plugins/${encodeURIComponent(plugin.id)}`;
    } catch {
      return null;
    }
  }, [plugin, baseUrl]);

  // Opens in the user's browser; falls back to a tab outside Tauri.
  const openExternal = useCallback((url: string) => {
    openUrl(url).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
  }, []);

  useEffect(() => {
    void getPreferences().then((prefs) => setBaseUrl(prefs.marketplaceBaseUrl ?? null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<MarketplacePlugin>("fetch_marketplace_plugin", {
      pluginId: decodeURIComponent(pluginId),
      baseUrl,
      serverAbiVersion: serverHostAbiVersion,
    })
      .then((found) => !cancelled && setPlugin(found))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pluginId, baseUrl, serverHostAbiVersion]);

  // The host ABI arrives on every `plugin-admin-list`, and per-version
  // compatibility cannot be judged without it - so it is asked for here too,
  // for the case where this page is the first one opened.
  useEffect(() => {
    if (!canInstall) return;
    const off = listen<{ plugins: ServerPluginEntry[]; host_abi_version: number | null }>(
      "plugin-admin-list",
      (event) => {
        useAppStore.setState({ serverHostAbiVersion: event.payload.host_abi_version ?? null });
        setInstalled(event.payload.plugins);
      },
    );
    invoke("request_server_plugins").catch(() => undefined);
    return () => {
      void off.then((stop) => stop());
    };
  }, [canInstall]);

  useEffect(() => {
    const off = listen<PluginAckPayload>("plugin-admin-ack", (event) => {
      if (event.payload.verb !== "install") return;
      setLastAck(event.payload);
      setInstalling(false);
      if (event.payload.ok) invoke("request_server_plugins").catch(() => undefined);
    });
    return () => {
      void off.then((stop) => stop());
    };
  }, []);

  const incompatibleText = t("marketplace.incompatibleAbi", {
    defaultValue:
      "This plugin targets a different plugin API version than the server and cannot be installed.",
  });

  const install = async () => {
    if (plugin?.compatible === false) return setError(incompatibleText);
    if (!plugin?.manifest_url) return setError(t("marketplace.missingManifestUrl"));
    setInstalling(true);
    setLastAck(null);
    const manifestUrl = plugin.manifest_url;
    try {
      // Pin the hash of the manifest just reviewed, so the server refuses the
      // install if what it fetches is not the same document.
      let expectedSha256: string | null = null;
      try {
        expectedSha256 = await invoke<string>("fetch_plugin_manifest_sha256", { manifestUrl });
      } catch {
        // The pin hardens the install; it is not a precondition for it.
      }
      await invoke("install_server_plugin", {
        marketplaceId: plugin.id,
        version: plugin.version,
        manifestUrl,
        expectedSha256,
      });
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  // Reviews need a sign-in and live on another endpoint, so only the
  // aggregate histogram is shown.
  const histogram = plugin?.rating_histogram?.length === 5 ? plugin.rating_histogram : null;
  const ratingTotal = histogram
    ? histogram.reduce((total, count) => total + count, 0)
    : (plugin?.rating_count ?? 0);
  const isInstalled = plugin != null && installed.some((entry) => entry.marketplace_id === plugin.id);

  return (
    <AdminPage
      wide
      title={plugin?.name ?? t("marketplace.title")}
      toolbar={
        <Button
          size="small"
          variant="outlined"
          startIcon={<ArrowLeftIcon width={13} height={13} />}
          onClick={onBack}
        >
          {t("marketplace.back", { defaultValue: "Back" })}
        </Button>
      }
    >
      {loading && (
        <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
          {t("marketplace.loading")}
        </Typography>
      )}
      {error && <Banner tone="danger">{error}</Banner>}

      {plugin && (
        <>
          <SettingsCard sx={{ p: 0, overflow: "hidden" }}>
            <Box
              sx={{
                height: 110,
                background: bannerSrc
                  ? `center / cover no-repeat url("${bannerSrc}")`
                  : bannerGradient(plugin.id || plugin.name),
              }}
            />
            <Stack direction="row" gap={1.75} sx={{ p: "14px 16px" }} alignItems="flex-start" flexWrap="wrap">
              {iconSrc ? (
                <Box
                  component="img"
                  src={iconSrc}
                  alt=""
                  sx={{ flex: "none", width: 54, height: 54, borderRadius: radius("lg"), mt: "-32px" }}
                />
              ) : (
                <Box
                  sx={{
                    flex: "none",
                    width: 54,
                    height: 54,
                    mt: "-32px",
                    borderRadius: radius("lg"),
                    display: "grid",
                    placeItems: "center",
                    fontSize: 22,
                    fontWeight: 700,
                    color: "#fff",
                    background: bannerGradient(plugin.id || plugin.name),
                  }}
                >
                  {plugin.name.charAt(0).toUpperCase()}
                </Box>
              )}

              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Stack direction="row" alignItems="center" gap={0.875} flexWrap="wrap">
                  <Typography sx={{ fontSize: 17, fontWeight: 600 }}>{plugin.name}</Typography>
                  {plugin.official && (
                    <Box
                      component="span"
                      sx={(theme) => ({
                        px: "7px",
                        py: "1px",
                        borderRadius: "999px",
                        fontSize: 10,
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
                  gap={1.25}
                  flexWrap="wrap"
                  alignItems="center"
                  sx={(theme) => ({ mt: "4px", fontSize: 11, color: theme.palette.nebula.muted })}
                >
                  <span>v{plugin.version}</span>
                  {plugin.abi_version != null && (
                    <Box
                      component="span"
                      title={plugin.compatible === false ? incompatibleText : undefined}
                      sx={(theme) => ({
                        color: plugin.compatible === false ? theme.palette.nebula.bad : "inherit",
                      })}
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
                  {plugin.downloads != null && (
                    <span>{t("marketplace.downloadsCount", { count: plugin.downloads })}</span>
                  )}
                  {plugin.license && <span>{plugin.license}</span>}
                </Stack>
              </Box>

              <Stack direction="row" gap={0.75} alignItems="center" flexWrap="wrap" sx={{ flex: "none" }}>
                {isInstalled && (
                  <Stack
                    direction="row"
                    alignItems="center"
                    gap={0.375}
                    sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.ok })}
                  >
                    <CheckIcon width={12} height={12} />
                    {t("marketplace.installed", { defaultValue: "Installed" })}
                  </Stack>
                )}
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<DownloadIcon width={13} height={13} />}
                  disabled={
                    installing ||
                    !canInstall ||
                    !plugin.manifest_url ||
                    plugin.compatible === false ||
                    isInstalled
                  }
                  title={
                    !canInstall
                      ? t("marketplace.installUnsupported")
                      : plugin.compatible === false
                        ? incompatibleText
                        : isInstalled
                          ? t("marketplace.alreadyInstalled", {
                              defaultValue: "Already installed on this server",
                            })
                          : undefined
                  }
                  onClick={() => void install()}
                >
                  {installing ? t("marketplace.installing") : t("marketplace.install")}
                </Button>
                {storeUrl && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<GlobeIcon width={13} height={13} />}
                    title={t("marketplace.openInStoreTitle", {
                      defaultValue: "Open this plugin's page in your browser",
                    })}
                    onClick={() => openExternal(storeUrl)}
                  >
                    {t("marketplace.openInStore", { defaultValue: "Open in store" })}
                  </Button>
                )}
                {plugin.homepage && (
                  <Button size="small" variant="outlined" onClick={() => openExternal(plugin.homepage!)}>
                    {t("marketplace.homepage", { defaultValue: "Homepage" })}
                  </Button>
                )}
              </Stack>
            </Stack>
          </SettingsCard>

          {!canInstall && (
            <Banner tone="warn">
              {status === "connected"
                ? t("marketplace.installUnsupported")
                : t("marketplace.connectToInstall", {
                    defaultValue: "Connect to a server with admin rights to install this plugin.",
                  })}
            </Banner>
          )}
          {plugin.compatible === false && <Banner tone="warn">{incompatibleText}</Banner>}
          {lastAck?.ok && (
            <Banner tone="ok">{t("marketplace.installSuccess", { name: lastAck.plugin_name })}</Banner>
          )}
          {lastAck && !lastAck.ok && (
            <Banner tone="danger">
              {t("marketplace.installFailed")}: {lastAck.error}
            </Banner>
          )}

          {plugin.description && (
            <Typography sx={{ mt: "16px", fontSize: 12.5, lineHeight: 1.6 }}>
              {plugin.description}
            </Typography>
          )}

          {gallery.length > 0 && (
            <>
              <GroupTitle>{t("marketplace.gallery", { defaultValue: "Screenshots" })}</GroupTitle>
              <Stack direction="row" gap={1} sx={{ overflowX: "auto", pb: "6px" }}>
                {gallery.map((src) => (
                  <Box
                    key={src}
                    component="img"
                    src={src}
                    alt=""
                    sx={{ flex: "none", height: 160, borderRadius: radius("md") }}
                  />
                ))}
              </Stack>
            </>
          )}

          {plugin.capabilities && plugin.capabilities.length > 0 && (
            <>
              <GroupTitle>{t("marketplace.capabilities", { defaultValue: "Capabilities" })}</GroupTitle>
              <Stack direction="row" gap={0.5} flexWrap="wrap">
                {plugin.capabilities.map((capability) => (
                  <Pill key={capability}>{capability}</Pill>
                ))}
              </Stack>
            </>
          )}

          {plugin.tags && plugin.tags.length > 0 && (
            <>
              <GroupTitle>{t("marketplace.tags", { defaultValue: "Tags" })}</GroupTitle>
              <Stack direction="row" gap={0.5} flexWrap="wrap">
                {plugin.tags.map((tag) => (
                  <Pill key={tag}>{tag}</Pill>
                ))}
              </Stack>
            </>
          )}

          {plugin.rating != null && ratingTotal > 0 && (
            <>
              <GroupTitle>
                {t("marketplace.ratingsReviews", { defaultValue: "Ratings & reviews" })}
              </GroupTitle>
              <SettingsCard>
                <Stack direction="row" gap={3} alignItems="center" flexWrap="wrap">
                  <Box sx={{ textAlign: "center" }}>
                    <Typography sx={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>
                      {plugin.rating.toFixed(1)}
                    </Typography>
                    <Stack direction="row" gap={0.125} justifyContent="center" sx={{ mt: "4px" }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <StarIcon
                          key={star}
                          width={13}
                          height={13}
                          fill={star <= Math.round(plugin.rating!) ? "currentColor" : "none"}
                        />
                      ))}
                    </Stack>
                    <Typography sx={(theme) => ({ mt: "3px", fontSize: 10.5, color: theme.palette.nebula.dim })}>
                      {t("marketplace.ratingsCount", { count: ratingTotal })}
                    </Typography>
                  </Box>
                  {histogram && (
                    <Box sx={{ flex: 1, minWidth: 180 }}>
                      {[5, 4, 3, 2, 1].map((stars) => {
                        const count = histogram[stars - 1] ?? 0;
                        const pct = ratingTotal > 0 ? (count / ratingTotal) * 100 : 0;
                        return (
                          <Stack key={stars} direction="row" alignItems="center" gap={0.75} sx={{ py: "2px" }}>
                            <Typography sx={{ width: 22, fontSize: 10.5 }}>{stars}★</Typography>
                            <Box
                              sx={(theme) => ({
                                flex: 1,
                                height: 5,
                                borderRadius: "999px",
                                overflow: "hidden",
                                background: theme.palette.nebula.card2,
                              })}
                            >
                              <Box
                                sx={(theme) => ({
                                  width: `${pct}%`,
                                  height: "100%",
                                  background: theme.palette.nebula.accent,
                                })}
                              />
                            </Box>
                            <Typography sx={{ width: 26, fontSize: 10.5, textAlign: "right" }}>
                              {count}
                            </Typography>
                          </Stack>
                        );
                      })}
                    </Box>
                  )}
                </Stack>
              </SettingsCard>
            </>
          )}

          {plugin.ini_snippet && (
            <>
              <GroupTitle>{t("marketplace.configuration", { defaultValue: "Configuration" })}</GroupTitle>
              <Box
                component="pre"
                sx={(theme) => ({
                  p: "12px",
                  borderRadius: radius("md"),
                  overflowX: "auto",
                  fontFamily: NEBULA_MONO,
                  fontSize: 11,
                  background: theme.palette.nebula.card2,
                })}
              >
                {plugin.ini_snippet}
              </Box>
            </>
          )}

          {readmeHtml && (
            <>
              <GroupTitle>README</GroupTitle>
              {/* The README is Markdown from a third party, so it goes through
                  the sanitiser rather than straight into the DOM. */}
              <SettingsCard>
                <SafeHtml html={readmeHtml} />
              </SettingsCard>
            </>
          )}

          {plugin.versions && plugin.versions.length > 0 && (
            <>
              <GroupTitle>{t("marketplace.versions", { defaultValue: "Versions" })}</GroupTitle>
              <DataTable
                rows={plugin.versions}
                rowKey={(version) => version.version}
                empty=""
                columns={[
                  {
                    key: "version",
                    header: "",
                    cell: (version) => (
                      <Stack direction="row" alignItems="center" gap={0.625}>
                        <Box component="span" sx={{ fontWeight: 600, opacity: version.yanked ? 0.5 : 1 }}>
                          {version.version}
                        </Box>
                        {version.yanked && (
                          <Box
                            component="span"
                            sx={(theme) => ({ fontSize: 9.5, color: theme.palette.nebula.bad })}
                          >
                            yanked
                          </Box>
                        )}
                      </Stack>
                    ),
                  },
                  {
                    key: "released",
                    header: "",
                    cell: (version) =>
                      version.released_at ? new Date(version.released_at).toLocaleDateString() : "",
                  },
                  {
                    key: "requires",
                    header: "",
                    cell: (version) => (
                      <Stack
                        direction="row"
                        gap={0.75}
                        flexWrap="wrap"
                        sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })}
                      >
                        {version.min_server_version && <span>server ≥ {version.min_server_version}</span>}
                        {version.min_fancy_server_version && (
                          <span>
                            {t("marketplace.minFancyServer", {
                              defaultValue: "Fancy server ≥ {{version}}",
                              version: version.min_fancy_server_version,
                            })}
                          </span>
                        )}
                        {version.abi_version != null && (
                          <Box
                            component="span"
                            sx={(theme) => ({
                              color: version.compatible === false ? theme.palette.nebula.bad : "inherit",
                            })}
                          >
                            {t("marketplace.abiVersion", {
                              defaultValue: "API v{{version}}",
                              version: version.abi_version,
                            })}
                          </Box>
                        )}
                      </Stack>
                    ),
                  },
                  { key: "changelog", header: "", cell: (version) => version.changelog ?? "" },
                ]}
              />
            </>
          )}

          {(plugin.license || plugin.source_url) && (
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: "18px" }}>
              {plugin.license ? (
                <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
                  {t("marketplace.license", { defaultValue: "License" })}: <strong>{plugin.license}</strong>
                </Typography>
              ) : (
                <span />
              )}
              {plugin.source_url && (
                <Button size="small" variant="outlined" onClick={() => openExternal(plugin.source_url!)}>
                  {t("marketplace.sourceCode", { defaultValue: "Source code" })}
                </Button>
              )}
            </Stack>
          )}
        </>
      )}
    </AdminPage>
  );
}

function Pill({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        px: "8px",
        py: "3px",
        borderRadius: "999px",
        fontSize: 10.5,
        background: theme.palette.nebula.card2,
        color: theme.palette.nebula.muted,
      })}
    >
      {children}
    </Box>
  );
}
