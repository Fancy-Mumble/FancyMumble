/**
 * Burger/kebab menu for configuring the OWN screen broadcast, sitting next to
 * the stop-stream (×) button on the broadcast panel. Mirrors the Discord
 * "Go Live" config menu: stop, change source, change quality, (audio).
 *
 * The item list is exported separately as {@link StreamConfigItems}: surfaces
 * that already own a container (Nebula's quality dialog) render it inline.
 * Putting the popup component in such a container yielded a stray kebab
 * button and a menu absolutely positioned out of its host's box.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  EyeOffIcon,
  KebabMenuIcon,
  ShuffleIcon,
  SlidersIcon,
  VolumeIcon,
} from "../../../icons";
import { TID } from "@core/testids";
import { QUALITY_PRESETS, presetOf, type StreamSettings } from "@core/features/chat/stream/streamSettings";
import { useCaptureExclusion } from "./useCaptureExclusion";
import { isLinux } from "@core/utils/platform";
import styles from "./StreamConfigMenu.module.css";

interface StreamConfigMenuProps {
  readonly settings: StreamSettings;
  readonly onStop: () => void;
  readonly onChangeSource: () => void;
  readonly onSetSettings: (settings: StreamSettings) => void;
}

interface StreamConfigItemsProps extends StreamConfigMenuProps {
  /** Called after an item that finishes the interaction; the popup closes
   *  itself, a dialog host closes its dialog. */
  readonly onDismiss?: () => void;
  /** Layout of the item list: `menu` inside the popup, `panel` when a host
   *  container (dialog) provides the surface. */
  readonly layout?: "menu" | "panel";
}

/** The configuration items themselves, without any popup chrome. */
export function StreamConfigItems({
  settings,
  onStop,
  onChangeSource,
  onSetSettings,
  onDismiss,
  layout = "menu",
}: StreamConfigItemsProps) {
  const { t } = useTranslation("chat");
  const [qualityOpen, setQualityOpen] = useState(layout === "panel");
  const capture = useCaptureExclusion();

  const activePreset = presetOf(settings);
  const dismiss = () => onDismiss?.();

  return (
    <div
      className={layout === "panel" ? styles.panel : styles.list}
      // In panel mode this list IS the menu; inside the popup the wrapper
      // above already carries that role.
      role={layout === "panel" ? "menu" : "none"}
    >
      <button
        type="button"
        className={`${styles.item} ${styles.itemDanger}`}
        role="menuitem"
        onClick={() => {
          dismiss();
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
          dismiss();
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
        <ChevronRightIcon width={14} height={14} className={qualityOpen ? styles.chevronOpen : ""} />
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
              dismiss();
              onSetSettings(QUALITY_PRESETS[q]);
            }}
          >
            <span className={styles.check}>{activePreset === q && <CheckIcon width={14} height={14} />}</span>
            <span>{t(`screenShare.picker.quality_${q}`)}</span>
            <span className={styles.itemValue}>{t(`screenShare.picker.quality_${q}_hint`)}</span>
          </button>
        ))}

      <div className={styles.separator} role="separator" />

      {/* X11 has no equivalent of WDA_EXCLUDEFROMCAPTURE, so the backend
          never hides anything there and the switch would be a lie. */}
      {!isLinux && (
        <button
          type="button"
          className={styles.item}
          role="menuitemcheckbox"
          aria-checked={capture.hidden}
          onClick={() => capture.setHidden(!capture.hidden)}
          title={t("screenShare.config.hideSelfHint")}
          data-testid={TID.streamHideSelfToggle}
        >
          <EyeOffIcon width={15} height={15} />
          <span>{t("screenShare.config.hideSelf")}</span>
          <span className={styles.check}>{capture.hidden && <CheckIcon width={14} height={14} />}</span>
        </button>
      )}

      <div className={styles.separator} role="separator" />

      <button
        type="button"
        className={styles.item}
        role="menuitemcheckbox"
        aria-checked={settings.shareAudio === true}
        onClick={() => onSetSettings({ ...settings, shareAudio: !settings.shareAudio })}
        data-testid={TID.streamShareAudioToggle}
      >
        <VolumeIcon width={15} height={15} />
        <span>{t("screenShare.config.shareAudio")}</span>
        <span className={styles.check}>
          {settings.shareAudio === true && <CheckIcon width={14} height={14} />}
        </span>
      </button>
    </div>
  );
}

export default function StreamConfigMenu({
  settings,
  onStop,
  onChangeSource,
  onSetSettings,
}: StreamConfigMenuProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
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

  const close = useCallback(() => setOpen(false), []);

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
          <StreamConfigItems
            settings={settings}
            onStop={onStop}
            onChangeSource={onChangeSource}
            onSetSettings={onSetSettings}
            onDismiss={close}
          />
        </div>
      )}
    </div>
  );
}
