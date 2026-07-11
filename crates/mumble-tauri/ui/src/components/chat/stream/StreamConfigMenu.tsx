/**
 * Burger/kebab menu for configuring the OWN screen broadcast, sitting next to
 * the stop-stream (×) button on the broadcast panel. Mirrors the Discord
 * "Go Live" config menu: stop, change source, change quality, (audio).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  KebabMenuIcon,
  ShuffleIcon,
  SlidersIcon,
  VolumeIcon,
} from "../../../icons";
import { TID } from "../../../testids";
import { QUALITY_PRESETS, presetOf, type StreamSettings } from "./streamSettings";
import styles from "./StreamConfigMenu.module.css";

interface StreamConfigMenuProps {
  readonly settings: StreamSettings;
  readonly onStop: () => void;
  readonly onChangeSource: () => void;
  readonly onSetSettings: (settings: StreamSettings) => void;
}

export default function StreamConfigMenu({
  settings,
  onStop,
  onChangeSource,
  onSetSettings,
}: StreamConfigMenuProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQualityOpen(false);
  }, []);

  const activePreset = presetOf(settings);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("screenShare.config.menuLabel")}
        aria-label={t("screenShare.config.menuLabel")}
        data-testid={TID.streamConfigMenu}
      >
        <KebabMenuIcon width={16} height={16} />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            className={`${styles.item} ${styles.itemDanger}`}
            role="menuitem"
            onClick={() => {
              close();
              onStop();
            }}
          >
            <CloseIcon width={15} height={15} />
            <span>{t("screenShare.config.stop")}</span>
          </button>

          <button
            type="button"
            className={styles.item}
            role="menuitem"
            onClick={() => {
              close();
              onChangeSource();
            }}
          >
            <ShuffleIcon width={15} height={15} />
            <span>{t("screenShare.config.changeSource")}</span>
          </button>

          <button
            type="button"
            className={styles.item}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={qualityOpen}
            onClick={() => setQualityOpen((v) => !v)}
          >
            <SlidersIcon width={15} height={15} />
            <span>{t("screenShare.config.quality")}</span>
            <span className={styles.itemValue}>
              {activePreset ? t(`screenShare.picker.quality_${activePreset}`) : t("screenShare.config.custom")}
            </span>
            <ChevronRightIcon
              width={14}
              height={14}
              className={qualityOpen ? styles.chevronOpen : ""}
            />
          </button>
          {qualityOpen &&
            (["hd", "sd", "source"] as const).map((q) => (
              <button
                key={q}
                type="button"
                className={`${styles.item} ${styles.subItem}`}
                role="menuitemradio"
                aria-checked={activePreset === q}
                onClick={() => {
                  close();
                  onSetSettings(QUALITY_PRESETS[q]);
                }}
              >
                <span className={styles.check}>
                  {activePreset === q && <CheckIcon width={14} height={14} />}
                </span>
                <span>{t(`screenShare.picker.quality_${q}`)}</span>
                <span className={styles.itemValue}>{t(`screenShare.picker.quality_${q}_hint`)}</span>
              </button>
            ))}

          <div className={styles.separator} role="separator" />

          <div className={`${styles.item} ${styles.itemDisabled}`} aria-disabled="true">
            <VolumeIcon width={15} height={15} />
            <span>{t("screenShare.config.shareAudio")}</span>
            <span className={styles.itemValue}>{t("screenShare.config.comingSoon")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
