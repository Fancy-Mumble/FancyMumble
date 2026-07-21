import { useTranslation } from "react-i18next";
import { RoleChip } from "./RoleChip";
import styles from "./RolePreviewCard.module.css";

export interface RolePreviewCardProps {
  readonly name: string;
  readonly color?: string | null;
  readonly icon?: number[] | null;
  /** Sample username used in the rendered preview. */
  readonly sampleUsername?: string;
}

/**
 * Displays a small live preview of how a role's customization looks in chat:
 * the chip itself, a sample username with the role color applied and a
 * sample mention bubble.
 */
export function RolePreviewCard({ name, color, icon, sampleUsername }: RolePreviewCardProps) {
  const { t } = useTranslation("settings");
  const resolvedUsername = sampleUsername ?? t("roleDisplay.previewSampleUser");
  const style = color ? ({ "--role-color": color } as React.CSSProperties) : undefined;
  return (
    <div className={styles.card} style={style}>
      <span className={styles.title}>{t("roleDisplay.previewTitle")}</span>
      <div className={styles.row}>
        <RoleChip name={name || t("roleDisplay.previewRoleFallback")} color={color} icon={icon} size="large" />
      </div>
      <div className={styles.row}>
        <span className={styles.usernameSample} data-has-color={Boolean(color)}>
          {resolvedUsername}
          <span className={styles.handle}>{t("roleDisplay.previewOnlineStatus")}</span>
        </span>
      </div>
      <div className={styles.bubble}>
        {t("roleDisplay.previewBubblePre")}<span className={styles.mention}>@{name || t("roleDisplay.previewRoleFallback")}</span>{t("roleDisplay.previewBubblePost")}
      </div>
    </div>
  );
}
