import type { PluginPanelState } from "@core/plugins/tier1/store";
import styles from "./Plugins.module.css";

export interface PluginPanelViewProps {
  panel: PluginPanelState;
}

/**
 * A settings panel supplied by the plugin itself.
 *
 * Rows are whatever the plugin last pushed, so an empty panel means it has
 * connected but sent nothing yet - worth saying, rather than rendering a blank.
 */
export default function PluginPanelView({ panel }: PluginPanelViewProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>{panel.title}</div>
      {panel.rows.length === 0 ? (
        <div className={styles.emptyPanel}>This panel has no entries yet.</div>
      ) : (
        panel.rows.map((row, index) => (
          <div key={`${panel.panelId}:${index}`} className={styles.panelRow}>
            <span className={styles.panelLabel}>{row.label}</span>
            <span className={styles.panelValue}>{row.value}</span>
          </div>
        ))
      )}
    </div>
  );
}
