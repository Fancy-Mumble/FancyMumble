import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { allowPlugin, revokePluginTrust, useAppStore, type PluginRegistryEntry } from "../../store";
import type { PluginPanelState } from "../../plugins/tier1/store";
import { panelKey } from "../../plugins/tier1/store";
import type { ClientManifest } from "../../plugins/tier1/types";
import {
  capabilityLabel,
  decodePluginInfo,
  type TrustRecord,
  type TrustScope,
} from "../../plugins/tier1/trust";
import { parseClientManifest } from "../../plugins/tier1/manifest";
import { SplitButton } from "../../components/elements/SplitButton";
import type { SplitButtonOption } from "../../components/elements/SplitButton";
import { OfficialBadge, isOfficialPlugin } from "../../components/elements/OfficialBadge";
import styles from "./PluginsPanel.module.css";

interface PluginRow {
  readonly entry: PluginRegistryEntry;
  readonly manifest: ClientManifest | null;
  readonly trust: TrustRecord | null;
  readonly panels: PluginPanelState[];
}

/** Settings tab listing every plugin the active server advertises,
 *  rendering each plugin's declared `SettingsPanel`s and exposing a
 *  revoke-trust action.  Panels stay reactive to `UpdatePanel`
 *  responses thanks to the Zustand subscription. */
export default function PluginsPanel() {
  const { t } = useTranslation("settings");
  const registry = useAppStore((s) => s.pluginRegistry);
  const pluginManifests = useAppStore((s) => s.pluginManifests);
  const pluginTrust = useAppStore((s) => s.pluginTrust);
  const pluginPanels = useAppStore((s) => s.pluginPanels);

  const rows = useMemo<PluginRow[]>(
    () =>
      registry.map((entry) => {
        const allowedManifest = pluginManifests.get(entry.pluginName) ?? null;
        const manifest = allowedManifest ?? parseClientManifest(entry.infoJson);
        const trust = pluginTrust.get(entry.pluginName) ?? null;
        const panels: PluginPanelState[] = [];
        for (const declared of manifest?.settings_panels ?? []) {
          const live = pluginPanels.get(panelKey(entry.pluginName, declared.id));
          if (live) panels.push(live);
        }
        return { entry, manifest, trust, panels };
      }),
    [registry, pluginManifests, pluginTrust, pluginPanels],
  );

  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        {t("plugins.empty")}
      </div>
    );
  }

  return (
    <div>
      {rows.map((row) => (
        <PluginCard key={row.entry.pluginName} row={row} />
      ))}
    </div>
  );
}

function scopeKey(scope: TrustScope | undefined): "plugins.scopeGlobal" | "plugins.scopeSession" | "plugins.scopeServer" {
  if (scope === "global") return "plugins.scopeGlobal";
  if (scope === "once") return "plugins.scopeSession";
  return "plugins.scopeServer";
}

function PluginCard({ row }: { readonly row: PluginRow }) {
  const { t } = useTranslation("settings");
  const info = decodePluginInfo(row.entry.infoJson);
  const isAllowed = row.trust?.decision === "allow";
  const isDenied = row.trust?.decision === "deny";
  const isTrustable = !!row.manifest && (row.manifest.capabilities?.length ?? 0) > 0;

  const revoke = () =>
    void revokePluginTrust(row.entry.pluginName).catch((e) =>
      console.warn("[plugin-trust] revoke failed:", e),
    );

  const allowOptions: [SplitButtonOption, ...SplitButtonOption[]] = [
    {
      label: t("plugins.allowForServer"),
      hint: t("plugins.allowForServerHint"),
      onSelect: () =>
        void allowPlugin(row.entry.pluginName, "server").catch((e) =>
          console.warn("[plugin-trust] allow failed:", e),
        ),
    },
    {
      label: t("plugins.allowOnce"),
      hint: t("plugins.allowOnceHint"),
      onSelect: () =>
        void allowPlugin(row.entry.pluginName, "once").catch((e) =>
          console.warn("[plugin-trust] allow failed:", e),
        ),
    },
    {
      label: t("plugins.alwaysAllow"),
      hint: t("plugins.alwaysAllowHint"),
      onSelect: () =>
        void allowPlugin(row.entry.pluginName, "global").catch((e) =>
          console.warn("[plugin-trust] allow failed:", e),
        ),
    },
  ];

  return (
    <section className={styles.pluginCard}>
      <header className={styles.pluginHeader}>
        <div>
          <div className={styles.pluginName}>
            {row.entry.pluginName}
            <span className={styles.pluginVersion}>v{row.entry.version}</span>
            {isOfficialPlugin(row.entry.pluginName) && <OfficialBadge />}
          </div>
          {info.description && (
            <p className={styles.pluginDescription}>{info.description}</p>
          )}
        </div>
        {isAllowed && (
          <span className={`${styles.trustState} ${styles.trustAllowed}`}>
            <span className={styles.trustStateLabel}>{t("plugins.trusted")}</span>
            <span className={styles.trustStateScope}>{t(scopeKey(row.trust?.scope))}</span>
          </span>
        )}
        {isDenied && (
          <span className={`${styles.trustState} ${styles.trustDenied}`}>
            {t("plugins.blocked")}
          </span>
        )}
      </header>

      {row.manifest?.capabilities && row.manifest.capabilities.length > 0 && (
        <div className={styles.capabilityTags}>
          {row.manifest.capabilities.map((c) => (
            <span key={c} className={styles.tag} title={capabilityLabel(c)}>
              {c}
            </span>
          ))}
        </div>
      )}

      {row.panels.map((panel) => (
        <PanelView key={panel.panelId} panel={panel} />
      ))}

      {isTrustable && (
        <div className={styles.actions}>
          {isAllowed && (
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={revoke}
              title={t("plugins.revokeTrustTitle")}
            >
              {t("plugins.revokeTrust")}
            </button>
          )}
          {!isAllowed && (
            <>
              <SplitButton options={allowOptions} variant="primary" />
              {isDenied && (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={revoke}
                  title={t("plugins.repromptTitle")}
                >
                  {t("plugins.reprompt")}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function PanelView({ panel }: { readonly panel: PluginPanelState }) {
  const { t } = useTranslation("settings");
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>{panel.title}</div>
      {panel.rows.length === 0 ? (
        <div className={styles.emptyPanel}>{t("plugins.emptyPanel")}</div>
      ) : (
        <div className={styles.panelRows}>
          {panel.rows.map((row, i) => (
            <div key={`${panel.panelId}:${i}`} className={styles.panelRow}>
              <div className={styles.panelLabel}>{row.label}</div>
              <div className={styles.panelValue}>{row.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
