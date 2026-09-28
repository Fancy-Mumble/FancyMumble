import { useMemo } from "react";
import { useAppStore } from "@core/store";
import { panelKey, type PluginPanelState } from "@core/plugins/tier1/store";
import { parseClientManifest } from "@core/plugins/tier1/manifest";
import PluginCard from "./PluginCard";
import styles from "./Plugins.module.css";

/**
 * Every plugin the active server advertises, with its trust decision and any
 * settings panels it has pushed.
 *
 * Capabilities come from the stored manifest when the plugin is trusted and
 * are otherwise parsed straight from the advertised info blob - the user has to
 * see what a plugin is asking for *before* deciding, not after.
 */
export default function PluginTrustSettings() {
  const registry = useAppStore((state) => state.pluginRegistry);
  const manifests = useAppStore((state) => state.pluginManifests);
  const trust = useAppStore((state) => state.pluginTrust);
  const pluginPanels = useAppStore((state) => state.pluginPanels);

  const rows = useMemo(
    () =>
      registry.map((entry) => {
        const manifest = manifests.get(entry.pluginName) ?? parseClientManifest(entry.infoJson);
        const panels: PluginPanelState[] = [];
        for (const declared of manifest?.settings_panels ?? []) {
          const live = pluginPanels.get(panelKey(entry.pluginName, declared.id));
          if (live) panels.push(live);
        }
        return { entry, manifest, trust: trust.get(entry.pluginName) ?? null, panels };
      }),
    [registry, manifests, trust, pluginPanels],
  );

  if (rows.length === 0) {
    return <p className={styles.empty}>This server has not advertised client extensions.</p>;
  }

  return (
    <div>
      {rows.map((row) => (
        <PluginCard
          key={row.entry.pluginName}
          entry={row.entry}
          manifest={row.manifest}
          trust={row.trust}
          panels={row.panels}
        />
      ))}
    </div>
  );
}
