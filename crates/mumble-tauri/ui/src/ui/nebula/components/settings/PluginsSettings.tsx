import { useMemo, useState } from "react";
import { Box, Button, Chip, Menu, MenuItem, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  allowPlugin,
  resetPluginTrust,
  revokePluginTrust,
  useAppStore,
  type PluginRegistryEntry,
} from "@core/store";
import { panelKey, type PluginPanelState } from "@core/plugins/tier1/store";
import type { ClientManifest } from "@core/plugins/tier1/types";
import { parseClientManifest } from "@core/plugins/tier1/manifest";
import {
  TrustDecision,
  TrustScope,
  capabilityLabel,
  decodePluginInfo,
  type TrustRecord,
} from "@core/plugins/tier1/trust";
import { OfficialBadge, isOfficialPlugin } from "@standard/components/elements/OfficialBadge";
import { Stack } from "../primitives";
import { EmptyState, PageTitle, SettingsCard } from "./controls";

interface PluginRow {
  readonly entry: PluginRegistryEntry;
  readonly manifest: ClientManifest | null;
  readonly trust: TrustRecord | null;
  readonly panels: PluginPanelState[];
}

function scopeKey(scope: TrustScope | undefined) {
  if (scope === TrustScope.Global) return "plugins.scopeGlobal" as const;
  if (scope === TrustScope.Once) return "plugins.scopeSession" as const;
  return "plugins.scopeServer" as const;
}

/**
 * The Plugins page.
 *
 * Lists what the active server advertises, so it is empty on a server with no
 * plugins rather than absent - "this server has none" and "this client cannot
 * show them" look identical otherwise.
 *
 * Each card renders the plugin's own declared settings panels, which arrive as
 * `UpdatePanel` responses and stay live through the store subscription.
 */
export function PluginsSettings() {
  const { t } = useTranslation("settings");
  const registry = useAppStore((state) => state.pluginRegistry);
  const manifests = useAppStore((state) => state.pluginManifests);
  const trust = useAppStore((state) => state.pluginTrust);
  const panels = useAppStore((state) => state.pluginPanels);

  const rows = useMemo<PluginRow[]>(
    () =>
      registry.map((entry) => {
        // The allowed manifest is authoritative where there is one; otherwise
        // the advertised JSON is all there is to describe the plugin.
        const manifest = manifests.get(entry.pluginName) ?? parseClientManifest(entry.infoJson);
        const live: PluginPanelState[] = [];
        for (const declared of manifest?.settings_panels ?? []) {
          const state = panels.get(panelKey(entry.pluginName, declared.id));
          if (state) live.push(state);
        }
        return { entry, manifest, trust: trust.get(entry.pluginName) ?? null, panels: live };
      }),
    [registry, manifests, trust, panels],
  );

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={t("tabs.plugins")} />
      {rows.length === 0 ? (
        <EmptyState>{t("plugins.empty")}</EmptyState>
      ) : (
        <Stack gap={1.25}>
          {rows.map((row) => (
            <PluginCard key={row.entry.pluginName} row={row} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function PluginCard({ row }: Readonly<{ row: PluginRow }>) {
  const { t } = useTranslation("settings");
  const [allowAnchor, setAllowAnchor] = useState<HTMLElement | null>(null);
  const info = decodePluginInfo(row.entry.infoJson);
  const allowed = row.trust?.decision === "allow";
  const denied = row.trust?.decision === TrustDecision.Deny;
  // A plugin that asks for nothing has nothing to trust, so it gets no verdict
  // controls rather than a set that would do nothing.
  const trustable = !!row.manifest && (row.manifest.capabilities?.length ?? 0) > 0;

  const allow = (scope: TrustScope) => {
    setAllowAnchor(null);
    void allowPlugin(row.entry.pluginName, scope).catch(() => undefined);
  };

  const ALLOW_SCOPES = [
    { scope: TrustScope.Server, labelKey: "plugins.allowForServer", hintKey: "plugins.allowForServerHint" },
    { scope: TrustScope.Once, labelKey: "plugins.allowOnce", hintKey: "plugins.allowOnceHint" },
    { scope: TrustScope.Global, labelKey: "plugins.alwaysAllow", hintKey: "plugins.alwaysAllowHint" },
  ] as const;

  return (
    <SettingsCard>
      <Stack direction="row" alignItems="flex-start" gap={1.5}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" gap={0.875} flexWrap="wrap">
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{row.entry.pluginName}</Typography>
            <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
              v{row.entry.version}
            </Typography>
            {isOfficialPlugin(row.entry.pluginName) && <OfficialBadge />}
          </Stack>
          {info.description && (
            <Typography sx={(theme) => ({ mt: "4px", fontSize: 11.5, color: theme.palette.nebula.muted })}>
              {info.description}
            </Typography>
          )}
        </Box>

        {allowed && (
          <Box sx={{ flex: "none", textAlign: "right" }}>
            <Typography sx={(theme) => ({ fontSize: 11, fontWeight: 600, color: theme.palette.nebula.ok })}>
              {t("plugins.trusted")}
            </Typography>
            <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })}>
              {t(scopeKey(row.trust?.scope))}
            </Typography>
          </Box>
        )}
        {denied && (
          <Typography
            sx={(theme) => ({ flex: "none", fontSize: 11, fontWeight: 600, color: theme.palette.nebula.bad })}
          >
            {t("plugins.blocked")}
          </Typography>
        )}
      </Stack>

      {row.manifest?.capabilities && row.manifest.capabilities.length > 0 && (
        <Stack direction="row" gap={0.625} flexWrap="wrap" sx={{ mt: "10px" }}>
          {row.manifest.capabilities.map((capability) => (
            <Chip key={capability} label={capability} title={capabilityLabel(capability)} size="small" />
          ))}
        </Stack>
      )}

      {row.panels.map((panel) => (
        <Box
          key={panel.panelId}
          sx={(theme) => ({
            mt: "12px",
            pt: "10px",
            borderTop: `1px solid ${theme.palette.nebula.line}`,
          })}
        >
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: "6px" }}>{panel.title}</Typography>
          {panel.rows.length === 0 ? (
            <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.dim })}>
              {t("plugins.emptyPanel")}
            </Typography>
          ) : (
            panel.rows.map((entry, index) => (
              <Stack
                key={`${panel.panelId}:${index}`}
                direction="row"
                justifyContent="space-between"
                gap={2}
                sx={{ py: "3px" }}
              >
                <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
                  {entry.label}
                </Typography>
                <Typography sx={{ fontSize: 11.5 }}>{entry.value}</Typography>
              </Stack>
            ))
          )}
        </Box>
      ))}

      {trustable && (
        <Stack direction="row" gap={0.75} sx={{ mt: "12px" }}>
          {allowed ? (
            <Button
              size="small"
              variant="outlined"
              title={t("plugins.revokeTrustTitle")}
              onClick={() => void revokePluginTrust(row.entry.pluginName).catch(() => undefined)}
            >
              {t("plugins.revokeTrust")}
            </Button>
          ) : (
            <>
              <Button
                size="small"
                variant="contained"
                onClick={(event) => setAllowAnchor(event.currentTarget)}
              >
                {t("plugins.allowForServer")}
              </Button>
              <Menu anchorEl={allowAnchor} open={allowAnchor !== null} onClose={() => setAllowAnchor(null)}>
                {ALLOW_SCOPES.map(({ scope, labelKey, hintKey }) => (
                  <MenuItem key={labelKey} onClick={() => allow(scope)} sx={{ display: "block" }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{t(labelKey)}</Typography>
                    <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}>
                      {t(hintKey)}
                    </Typography>
                  </MenuItem>
                ))}
              </Menu>
              {denied && (
                <Button
                  size="small"
                  variant="outlined"
                  title={t("plugins.repromptTitle")}
                  onClick={() => void resetPluginTrust(row.entry.pluginName).catch(() => undefined)}
                >
                  {t("plugins.reprompt")}
                </Button>
              )}
            </>
          )}
        </Stack>
      )}
    </SettingsCard>
  );
}
