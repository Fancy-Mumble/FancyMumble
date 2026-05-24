import { TrashIcon } from "../../../icons";
import { useTranslation } from "react-i18next";
import styles from "./MessageSelectionBar.module.css";

interface MessageSelectionBarProps {
  readonly count: number;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}

export default function MessageSelectionBar({
  count,
  onDelete,
  onCancel,
}: MessageSelectionBarProps) {
  const { t } = useTranslation("chat");
  return (
    <div className={styles.bar}>
      <span className={styles.count}>{t("selection.count", { count })}</span>
      <button
        type="button"
        className={`${styles.actionBtn} ${styles.deleteBtn}`}
        onClick={onDelete}
        disabled={count === 0}
      >
        <TrashIcon width={14} height={14} />
        {t("selection.deleteButton", { count })}
      </button>
      <button
        type="button"
        className={`${styles.actionBtn} ${styles.cancelBtn}`}
        onClick={onCancel}
      >
        {t("selection.cancel")}
      </button>
    </div>
  );
}
