import type { PluginRegistryEntry } from "@core/store";
import type { PluginPanelState } from "@core/plugins/tier1/store";
import type { ClientManifest } from "@core/plugins/tier1/types";
import { isOfficialPlugin } from "@core/plugins/tier1/official";
import {
  TrustDecision,
  TrustScope,
  capabilityLabel,
  decodePluginInfo,
  type TrustRecord,
} from "@core/plugins/tier1/trust";
import PluginPanelView from "./PluginPanelView";
import PluginTrustActions from "./PluginTrustActions";
import styles from "./Plugins.module.css";

export interface PluginCardProps {
  entry: PluginRegistryEntry;
  manifest: ClientManifest | null;
  trust: TrustRecord | null;
  panels: PluginPanelState[];
}

function scopeLabel(scope: TrustScope | undefined): string {
  if (scope === TrustScope.Global) return "on every server";
  if (scope === TrustScope.Once) return "this session only";
  return "on this server";
}

/** One advertised plugin: what it is, what it may do, and whether it may. */
export default function PluginCard({ entry, manifest, trust, panels }: PluginCardProps) {
  const info = decodePluginInfo(entry.infoJson);
  const allowed = trust?.decision === TrustDecision.Allow;
  const denied = trust?.decision === TrustDecision.Deny;
  const capabilities = manifest?.capabilities ?? [];
  // Nothing to decide when a plugin asks for no privileges - it only gets the
  // built-in layout either way, so trust buttons would be noise.
  const trustable = capabilities.length > 0;

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <div className={styles.name}>
            {entry.pluginName}
            <span className={styles.version}>v{entry.version}</span>
            {isOfficialPlugin(entry.pluginName) && <span className={styles.official}>OFFICIAL</span>}
          </div>
          <p className={styles.description}>{info.description || "No description supplied."}</p>
        </div>
        <span
          className={`${styles.state} ${allowed ? styles.allowed : denied ? styles.denied : styles.untrusted}`}
        >
          <span>{allowed ? "Trusted" : denied ? "Blocked" : "Not reviewed"}</span>
          {allowed && <span className={styles.scope}>{scopeLabel(trust?.scope)}</span>}
        </span>
      </header>

      {capabilities.length > 0 && (
        <div className={styles.capabilities}>
          {capabilities.map((capability) => (
            <span key={capability} className={styles.tag} title={capabilityLabel(capability)}>
              {capability}
            </span>
          ))}
        </div>
      )}

      {panels.map((panel) => (
        <PluginPanelView key={panel.panelId} panel={panel} />
      ))}

      {trustable && <PluginTrustActions pluginName={entry.pluginName} allowed={allowed} denied={denied} />}
    </section>
  );
}
