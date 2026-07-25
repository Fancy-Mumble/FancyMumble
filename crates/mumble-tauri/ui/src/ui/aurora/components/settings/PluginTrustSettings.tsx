import { revokePluginTrust, useAppStore } from "@core/store";
import { capabilityLabel, decodePluginInfo } from "@core/plugins/tier1/trust";
import { Button } from "../primitives";
import styles from "./PluginTrustSettings.module.css";

export default function PluginTrustSettings() {
  const registry = useAppStore((state) => state.pluginRegistry);
  const trust = useAppStore((state) => state.pluginTrust);
  const manifests = useAppStore((state) => state.pluginManifests);
  if (registry.length === 0)
    return <p className={styles.empty}>This server has not advertised client extensions.</p>;
  return (
    <div className={styles.list}>
      {registry.map((plugin) => {
        const record = trust.get(plugin.pluginName);
        const manifest = manifests.get(plugin.pluginName);
        const info = decodePluginInfo(plugin.infoJson);
        return (
          <article key={plugin.pluginName}>
            <div>
              <strong>
                {plugin.pluginName} <small>v{plugin.version}</small>
              </strong>
              <p>{info.description || "No description supplied."}</p>
              <span>
                {(manifest?.capabilities ?? []).map(capabilityLabel).join(" · ") ||
                  "No privileged capabilities"}
              </span>
            </div>
            <b className={record?.decision === "allow" ? styles.allowed : styles.blocked}>
              {record?.decision ?? "Built-in layout only"}
            </b>
            {record && (
              <Button variant="bare" onClick={() => void revokePluginTrust(plugin.pluginName)}>
                Review again
              </Button>
            )}
          </article>
        );
      })}
    </div>
  );
}
