import { useTranslation } from "react-i18next";
import type { PchatProtocol } from "../../types";
import styles from "./PchatBadge.module.css";

interface PchatBadgeInfo {
  label: string;
  className: string;
  title: string;
}

interface PchatBadgeProps {
  readonly protocol: PchatProtocol | undefined;
}

export function PchatBadge({ protocol }: PchatBadgeProps) {
  const { t } = useTranslation("sidebar");

  if (!protocol || protocol === "none") return null;

  const badgeMap: Record<string, PchatBadgeInfo> = {
    fancy_v1_full_archive: {
      label: t("pchatBadge.labelFancy"),
      className: styles.fancy,
      title: t("pchatBadge.titleFancy"),
    },
    signal_v1: {
      label: t("pchatBadge.labelSignal"),
      className: styles.signal,
      title: t("pchatBadge.titleSignal"),
    },
  };

  const info = badgeMap[protocol];
  if (!info) return null;

  return (
    <span className={`${styles.badge} ${info.className}`} title={info.title}>
      {info.label}
    </span>
  );
}
