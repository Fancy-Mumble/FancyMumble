import { useTranslation } from "react-i18next";
import { ShieldCheckIcon } from "../../icons";
import styles from "./OfficialBadge.module.css";

// The predicate moved to core so Aurora can badge official plugins too;
// re-exported here because this module is the established import site.
export { isOfficialPlugin } from "@core/plugins/tier1/official";

/** Small badge rendered next to official first-party plugin names. */
export function OfficialBadge() {
  const { t } = useTranslation("common");
  return (
    <span className={styles.badge} title={t("officialBadge.title")}>
      <ShieldCheckIcon width={11} height={11} />
      {t("officialBadge.label")}
    </span>
  );
}
