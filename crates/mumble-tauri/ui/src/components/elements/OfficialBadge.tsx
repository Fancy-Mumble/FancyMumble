import { ShieldCheckIcon } from "../../icons";
import styles from "./OfficialBadge.module.css";

const OFFICIAL_PLUGIN_NAMES = new Set(["fancy-live-doc", "fancy-file-server"]);

export function isOfficialPlugin(pluginName: string): boolean {
  return OFFICIAL_PLUGIN_NAMES.has(pluginName);
}

/** Small badge rendered next to official first-party plugin names. */
export function OfficialBadge() {
  return (
    <span className={styles.badge} title="Official FancyMumble plugin">
      <ShieldCheckIcon width={11} height={11} />
      Official
    </span>
  );
}
