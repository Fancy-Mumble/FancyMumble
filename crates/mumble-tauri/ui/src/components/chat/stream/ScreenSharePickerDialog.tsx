/**
 * In-app screen/window source picker for the Rust-native screen share.
 *
 * Replaces the browser's `getDisplayMedia` OS picker: sources are enumerated
 * and thumbnailed by the `fancy-screenshare` crate (`list_capture_sources` /
 * `capture_source_thumbnail`) and the chosen source is captured natively, so
 * the whole flow stays inside the app (and can be driven by the e2e suite
 * through the stable testids below).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../../elements/Modal";
import {
  AppWindowIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDotIcon,
  CircleIcon,
  MonitorIcon,
  SettingsIcon,
  VolumeOffIcon,
} from "../../../icons";
import { TID, STREAM_SOURCE_TITLE_ATTR } from "../../../testids";
import {
  FRAME_RATES,
  MODE_PRESETS,
  QUALITY_PRESETS,
  RESOLUTIONS,
  modeOf,
  presetOf,
  resolutionKeyOf,
  type QualityPreset,
  type StreamSettings,
} from "./streamSettings";
import styles from "./ScreenSharePickerDialog.module.css";

/** Kind discriminator; wire format of the crate's `SourceKind` serde form. */
export type CaptureSourceKind = "screen" | "window";

/** One capturable source as returned by `list_capture_sources`. */
export interface CaptureSource {
  readonly id: number;
  readonly kind: CaptureSourceKind;
  readonly title: string;
  readonly width: number;
  readonly height: number;
}

/** The picker's two tabs (values are part of the e2e contract). */
type PickerTab = "screens" | "windows";

/** Longer edge of the JPEG preview requested per card. */
const THUMBNAIL_MAX_DIM = 320;

const sourceKey = (kind: CaptureSourceKind, id: number): string => `${kind}:${id}`;

interface ScreenSharePickerDialogProps {
  /** Start broadcasting the chosen source at the chosen settings (closes the dialog). */
  readonly onConfirm: (kind: CaptureSourceKind, id: number, settings: StreamSettings) => void;
  readonly onCancel: () => void;
  /** Encoder settings preselected in the footer (defaults to HD). */
  readonly initialSettings?: StreamSettings;
}

export default function ScreenSharePickerDialog({
  onConfirm,
  onCancel,
  initialSettings = QUALITY_PRESETS.hd,
}: ScreenSharePickerDialogProps) {
  const { t } = useTranslation("chat");
  const [tab, setTab] = useState<PickerTab>("screens");
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  const [selected, setSelected] = useState<CaptureSource | null>(null);
  const [settings, setSettings] = useState<StreamSettings>(initialSettings);

  useEffect(() => {
    let cancelled = false;
    invoke<CaptureSource[]>("list_capture_sources")
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch previews one at a time (each is a real capture of that source) and
  // fill the cards in as they arrive; a source that vanished between listing
  // and capture simply keeps its placeholder icon.
  useEffect(() => {
    if (!sources || sources.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const src of sources) {
        if (cancelled) return;
        try {
          const url = await invoke<string>("capture_source_thumbnail", {
            kind: src.kind,
            id: src.id,
            maxDim: THUMBNAIL_MAX_DIM,
          });
          if (cancelled) return;
          setThumbs((prev) => new Map(prev).set(sourceKey(src.kind, src.id), url));
        } catch {
          /* keep the placeholder */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sources]);

  const activeKind: CaptureSourceKind = tab === "screens" ? "screen" : "window";
  const visibleSources = sources?.filter((s) => s.kind === activeKind) ?? null;

  const selectTab = (next: PickerTab) => {
    if (next === tab) return;
    setTab(next);
    // A selection hidden behind the other tab would make "Share" act on
    // something the user no longer sees.
    setSelected(null);
  };

  const renderStatus = (): string | null => {
    if (loadError !== null) return t("screenShare.picker.loadFailed", { detail: loadError });
    if (visibleSources === null) return t("screenShare.picker.loading");
    if (visibleSources.length === 0) return t("screenShare.picker.empty");
    return null;
  };
  const status = renderStatus();
  const activePreset = presetOf(settings);

  return (
    <Modal onClose={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-labelledby="screen-share-picker-title"
        data-testid={TID.screenSharePicker}
      >
        <h3 id="screen-share-picker-title" className={styles.title}>
          {t("screenShare.picker.title")}
        </h3>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "screens"}
            className={`${styles.tab} ${tab === "screens" ? styles.tabActive : ""}`}
            onClick={() => selectTab("screens")}
            data-testid={TID.screenSharePickerTab}
            data-tab="screens"
          >
            <MonitorIcon width={15} height={15} aria-hidden="true" />
            {t("screenShare.picker.tabScreens")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "windows"}
            className={`${styles.tab} ${tab === "windows" ? styles.tabActive : ""}`}
            onClick={() => selectTab("windows")}
            data-testid={TID.screenSharePickerTab}
            data-tab="windows"
          >
            <AppWindowIcon width={15} height={15} aria-hidden="true" />
            {t("screenShare.picker.tabWindows")}
          </button>
        </div>

        <div className={styles.grid}>
          {status !== null ? (
            <div className={styles.status}>{status}</div>
          ) : (
            visibleSources?.map((src) => {
              const isSelected =
                selected?.kind === src.kind && selected.id === src.id;
              const thumb = thumbs.get(sourceKey(src.kind, src.id));
              const cardAttrs = { [STREAM_SOURCE_TITLE_ATTR]: src.title };
              return (
                <button
                  key={sourceKey(src.kind, src.id)}
                  type="button"
                  className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`}
                  onClick={() => setSelected(src)}
                  onDoubleClick={() => onConfirm(src.kind, src.id, settings)}
                  aria-pressed={isSelected}
                  data-testid={TID.screenShareSource}
                  data-source-id={src.id}
                  data-source-kind={src.kind}
                  {...cardAttrs}
                >
                  <span className={styles.thumb} aria-hidden="true">
                    {thumb ? (
                      <img src={thumb} alt="" />
                    ) : src.kind === "screen" ? (
                      <MonitorIcon width={32} height={32} />
                    ) : (
                      <AppWindowIcon width={32} height={32} />
                    )}
                  </span>
                  <span className={styles.cardLabel}>
                    {src.kind === "screen" ? (
                      <MonitorIcon width={15} height={15} aria-hidden="true" />
                    ) : (
                      <AppWindowIcon width={15} height={15} aria-hidden="true" />
                    )}
                    <span className={styles.cardTitle} title={src.title}>
                      {src.title}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className={styles.actions}>
          <div
            className={styles.quality}
            role="group"
            aria-label={t("screenShare.picker.qualityLabel")}
          >
            {(["sd", "hd", "source"] as const).map((q) => (
              <button
                key={q}
                type="button"
                className={`${styles.qualityBtn} ${activePreset === q ? styles.qualityBtnActive : ""}`}
                aria-pressed={activePreset === q}
                onClick={() => setSettings(QUALITY_PRESETS[q])}
                title={t(`screenShare.picker.quality_${q}_hint`)}
              >
                {t(`screenShare.picker.quality_${q}`)}
              </button>
            ))}
          </div>

          <StreamModeButton settings={settings} onChange={setSettings} />

          <div className={styles.spacer} />
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            {t("screenShare.picker.cancel")}
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            disabled={selected === null}
            onClick={() => {
              if (selected) onConfirm(selected.kind, selected.id, settings);
            }}
            data-testid={TID.screenShareConfirm}
          >
            {t("screenShare.picker.share")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Gear button + "Stream Mode" popover (presets + resolution/fps submenus). */
function StreamModeButton({
  settings,
  onChange,
}: {
  readonly settings: StreamSettings;
  readonly onChange: (s: StreamSettings) => void;
}) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<"res" | "fps" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const mode = modeOf(settings);
  const resKey = resolutionKeyOf(settings);
  const Radio = ({ on }: { on: boolean }) =>
    on ? (
      <CircleDotIcon width={16} height={16} className={styles.radioOn} />
    ) : (
      <CircleIcon width={16} height={16} className={styles.radioOff} />
    );

  return (
    <div className={styles.modeRoot} ref={rootRef}>
      <button
        type="button"
        className={`${styles.gearBtn} ${open ? styles.gearBtnActive : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("screenShare.mode.title")}
        aria-label={t("screenShare.mode.title")}
        data-testid={TID.screenShareSettings}
      >
        <SettingsIcon width={16} height={16} />
      </button>

      {open && (
        <div className={styles.modeMenu} role="menu">
          <div className={styles.modeHeader}>{t("screenShare.mode.title")}</div>

          <button
            type="button"
            className={styles.modeItem}
            role="menuitemradio"
            aria-checked={mode === "gaming"}
            onClick={() => {
              onChange(MODE_PRESETS.gaming);
              setSub(null);
            }}
          >
            <div className={styles.modeText}>
              <span className={styles.modeName}>{t("screenShare.mode.gaming")}</span>
              <span className={styles.modeHint}>{t("screenShare.mode.gamingHint")}</span>
            </div>
            <Radio on={mode === "gaming"} />
          </button>

          <button
            type="button"
            className={styles.modeItem}
            role="menuitemradio"
            aria-checked={mode === "screenshare"}
            onClick={() => {
              onChange(MODE_PRESETS.screenshare);
              setSub(null);
            }}
          >
            <div className={styles.modeText}>
              <span className={styles.modeName}>{t("screenShare.mode.screenshare")}</span>
              <span className={styles.modeHint}>{t("screenShare.mode.screenshareHint")}</span>
            </div>
            <Radio on={mode === "screenshare"} />
          </button>

          <button
            type="button"
            className={styles.modeItem}
            role="menuitemradio"
            aria-checked={mode === "custom"}
            onClick={() => setSub((s) => (s === null ? "res" : s))}
          >
            <div className={styles.modeText}>
              <span className={styles.modeName}>{t("screenShare.mode.custom")}</span>
            </div>
            <Radio on={mode === "custom"} />
          </button>

          <div className={styles.modeSeparator} role="separator" />

          <button
            type="button"
            className={styles.modeRow}
            aria-haspopup="menu"
            aria-expanded={sub === "res"}
            onClick={() => setSub((s) => (s === "res" ? null : "res"))}
          >
            <span className={styles.modeRowName}>{t("screenShare.mode.resolution")}</span>
            <span className={styles.modeRowValue}>
              {t(`screenShare.picker.res_${resKey}`, resKey)}
            </span>
            <ChevronRightIcon width={14} height={14} className={sub === "res" ? styles.chevronOpen : ""} />
          </button>
          {sub === "res" &&
            RESOLUTIONS.map((r) => (
              <button
                key={r.key}
                type="button"
                className={`${styles.modeRow} ${styles.subRow}`}
                role="menuitemradio"
                aria-checked={settings.maxDimension === r.maxDimension}
                onClick={() => onChange({ ...settings, maxDimension: r.maxDimension })}
              >
                <span className={styles.check}>
                  {settings.maxDimension === r.maxDimension && <CheckIcon width={14} height={14} />}
                </span>
                <span className={styles.modeRowName}>{t(`screenShare.picker.res_${r.key}`, r.key)}</span>
              </button>
            ))}

          <button
            type="button"
            className={styles.modeRow}
            aria-haspopup="menu"
            aria-expanded={sub === "fps"}
            onClick={() => setSub((s) => (s === "fps" ? null : "fps"))}
          >
            <span className={styles.modeRowName}>{t("screenShare.mode.frameRate")}</span>
            <span className={styles.modeRowValue}>
              {t("screenShare.mode.fpsValue", { fps: settings.maxFps })}
            </span>
            <ChevronRightIcon width={14} height={14} className={sub === "fps" ? styles.chevronOpen : ""} />
          </button>
          {sub === "fps" &&
            FRAME_RATES.map((f) => (
              <button
                key={f}
                type="button"
                className={`${styles.modeRow} ${styles.subRow}`}
                role="menuitemradio"
                aria-checked={settings.maxFps === f}
                onClick={() => onChange({ ...settings, maxFps: f })}
              >
                <span className={styles.check}>
                  {settings.maxFps === f && <CheckIcon width={14} height={14} />}
                </span>
                <span className={styles.modeRowName}>
                  {t("screenShare.mode.fpsValue", { fps: f })}
                </span>
              </button>
            ))}

          <div className={styles.modeSeparator} role="separator" />

          <div className={`${styles.modeRow} ${styles.modeDisabled}`} aria-disabled="true">
            <VolumeOffIcon width={15} height={15} />
            <span className={styles.modeRowName}>{t("screenShare.mode.muteAudio")}</span>
            <span className={styles.modeRowValue}>{t("screenShare.config.comingSoon")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export type { StreamSettings, QualityPreset };
