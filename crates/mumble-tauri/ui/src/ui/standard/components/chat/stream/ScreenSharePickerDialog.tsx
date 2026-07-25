/**
 * In-app screen/window/camera source picker for the Rust-native share.
 *
 * Replaces the browser's `getDisplayMedia` OS picker: sources are enumerated
 * and thumbnailed by the `fancy-screenshare` crate (`list_capture_sources` /
 * `capture_source_thumbnail`) and the chosen sources are captured natively,
 * so the whole flow stays inside the app (and can be driven by the e2e suite
 * through the stable testids below).
 *
 * Selection model: ONE display source (a screen or a window) and ONE device
 * (webcam) can be selected together - confirming shares both as one
 * broadcast (screen track + camera track). Selecting within a group
 * replaces that group's pick; clicking a selected card deselects it.
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
  CloseIcon,
  MonitorIcon,
  SettingsIcon,
  VolumeOffIcon,
  WebcamIcon,
} from "../../../icons";
import { TID, STREAM_SOURCE_TITLE_ATTR } from "@core/testids";
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
} from "@core/features/chat/stream/streamSettings";
import styles from "./ScreenSharePickerDialog.module.css";

/** Kind discriminator; wire format of the crate's `SourceKind` serde form. */
export type CaptureSourceKind = "screen" | "window" | "device";

/** One capturable source as returned by `list_capture_sources`. */
export interface CaptureSource {
  readonly id: number;
  readonly kind: CaptureSourceKind;
  readonly title: string;
  readonly width: number;
  readonly height: number;
}

/** A source chosen for broadcast (what `start_screen_broadcast` needs). */
export interface SourceSelection {
  readonly kind: CaptureSourceKind;
  readonly id: number;
}

/** The picker's three tabs (values are part of the e2e contract). */
type PickerTab = "screens" | "windows" | "devices";

/** Longer edge of the JPEG preview requested per card. */
const THUMBNAIL_MAX_DIM = 320;

const sourceKey = (kind: CaptureSourceKind, id: number): string => `${kind}:${id}`;

const KIND_BY_TAB: Record<PickerTab, CaptureSourceKind> = {
  screens: "screen",
  windows: "window",
  devices: "device",
};

const TAB_ICONS: Record<PickerTab, typeof MonitorIcon> = {
  screens: MonitorIcon,
  windows: AppWindowIcon,
  devices: WebcamIcon,
};

const KIND_ICONS: Record<CaptureSourceKind, typeof MonitorIcon> = {
  screen: MonitorIcon,
  window: AppWindowIcon,
  device: WebcamIcon,
};

const TAB_LABEL_KEYS = {
  screens: "screenShare.picker.tabScreens",
  windows: "screenShare.picker.tabWindows",
  devices: "screenShare.picker.tabDevices",
} as const;

interface ScreenSharePickerDialogProps {
  /** Start broadcasting the chosen sources at the chosen settings (closes
   *  the dialog). Order matters: display source first, then the camera -
   *  it defines the broadcast's track (mid) order. */
  readonly onConfirm: (sources: readonly SourceSelection[], settings: StreamSettings) => void;
  readonly onCancel: () => void;
  /** Encoder settings preselected in the footer (defaults to HD). */
  readonly initialSettings?: StreamSettings;
  /** Sources preselected when the picker opens (the ACTIVE broadcast's,
   *  when one is running) - so confirming a newly picked source ADDS it to
   *  the live share instead of silently replacing everything. Entries whose
   *  source no longer exists are dropped. */
  readonly initialSelection?: readonly SourceSelection[];
  /** Camera-only mode (GNOME portal flow): the screen/window tabs are
   *  hidden - the compositor's own dialog picks those - and a seeded
   *  display source is carried through untouched (its advisory id never
   *  matches the source list), so confirming edits only the camera. */
  readonly deviceOnly?: boolean;
}

export default function ScreenSharePickerDialog({
  onConfirm,
  onCancel,
  initialSettings = QUALITY_PRESETS.hd,
  initialSelection,
  deviceOnly = false,
}: ScreenSharePickerDialogProps) {
  const { t } = useTranslation("chat");
  const [tab, setTab] = useState<PickerTab>(deviceOnly ? "devices" : "screens");
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  /** Selected screen OR window (they replace each other). */
  const [selectedDisplay, setSelectedDisplay] = useState<CaptureSource | null>(null);
  /** Selected camera; combinable with a display source. */
  const [selectedDevice, setSelectedDevice] = useState<CaptureSource | null>(null);
  const [settings, setSettings] = useState<StreamSettings>(initialSettings);

  useEffect(() => {
    let cancelled = false;
    invoke<CaptureSource[]>("list_capture_sources")
      .then((list) => {
        if (cancelled) return;
        // Camera-only mode never shows (or thumbnails) screens/windows.
        const usable = deviceOnly ? list.filter((s) => s.kind === "device") : list;
        setSources(usable);
        // Seed the selection from the active broadcast (once, on load):
        // match each seeded source against the fresh list so vanished
        // sources are silently dropped rather than re-shared blind.
        for (const seed of initialSelection ?? []) {
          if (deviceOnly && seed.kind !== "device") {
            // Portal-picked display source: its advisory id is not in the
            // list, but it must survive the confirm so adding a camera keeps
            // the live screen track. Represent it as a synthetic card-less
            // selection (chip only).
            setSelectedDisplay(
              (prev) =>
                prev ?? {
                  id: seed.id,
                  kind: seed.kind,
                  title: t("screenShare.picker.systemPickedDisplay"),
                  width: 0,
                  height: 0,
                },
            );
            continue;
          }
          const live = usable.find((s) => s.kind === seed.kind && s.id === seed.id);
          if (!live) continue;
          if (live.kind === "device") {
            setSelectedDevice((prev) => prev ?? live);
          } else {
            setSelectedDisplay((prev) => prev ?? live);
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // Mount-only load; the initial selection is seeded once from the snapshot.
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

  const activeKind: CaptureSourceKind = KIND_BY_TAB[tab];
  const visibleSources = sources?.filter((s) => s.kind === activeKind) ?? null;

  /** Current picks in broadcast track order: display first, then camera. */
  const selections: SourceSelection[] = [
    ...(selectedDisplay ? [{ kind: selectedDisplay.kind, id: selectedDisplay.id }] : []),
    ...(selectedDevice ? [{ kind: selectedDevice.kind, id: selectedDevice.id }] : []),
  ];

  const toggleSelect = (src: CaptureSource) => {
    if (src.kind === "device") {
      setSelectedDevice((prev) => (prev !== null && prev.id === src.id ? null : src));
    } else {
      setSelectedDisplay((prev) =>
        prev !== null && prev.kind === src.kind && prev.id === src.id ? null : src,
      );
    }
  };

  /** Double-click quick-share: this card plus the other group's pick. */
  const confirmWith = (src: CaptureSource) => {
    const display = src.kind === "device" ? selectedDisplay : src;
    const device = src.kind === "device" ? src : selectedDevice;
    onConfirm(
      [
        ...(display ? [{ kind: display.kind, id: display.id }] : []),
        ...(device ? [{ kind: device.kind, id: device.id }] : []),
      ],
      settings,
    );
  };

  const renderStatus = (): string | null => {
    if (loadError !== null) return t("screenShare.picker.loadFailed", { detail: loadError });
    if (visibleSources === null) return t("screenShare.picker.loading");
    if (visibleSources.length === 0) {
      return tab === "devices" ? t("screenShare.picker.emptyDevices") : t("screenShare.picker.empty");
    }
    return null;
  };
  const status = renderStatus();
  const activePreset = presetOf(settings);

  /** Whether a tab holds a current selection (dot marker on inactive tabs). */
  const tabHasSelection = (p: PickerTab): boolean =>
    p === "devices" ? selectedDevice !== null : selectedDisplay?.kind === KIND_BY_TAB[p];

  return (
    <Modal onClose={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-labelledby="screen-share-picker-title"
        data-testid={TID.screenSharePicker}
      >
        <h3 id="screen-share-picker-title" className={styles.title}>
          {deviceOnly ? t("screenShare.picker.cameraTitle") : t("screenShare.picker.title")}
        </h3>

        {!deviceOnly && (
          <div className={styles.tabs} role="tablist">
            {(["screens", "windows", "devices"] as const).map((p) => {
              const Icon = TAB_ICONS[p];
              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={tab === p}
                  className={`${styles.tab} ${tab === p ? styles.tabActive : ""}`}
                  onClick={() => setTab(p)}
                  data-testid={TID.screenSharePickerTab}
                  data-tab={p}
                >
                  <Icon width={15} height={15} aria-hidden="true" />
                  {t(TAB_LABEL_KEYS[p])}
                  {tab !== p && tabHasSelection(p) && <span className={styles.tabDot} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}

        <div className={styles.grid}>
          {status !== null ? (
            <div className={styles.status}>{status}</div>
          ) : (
            visibleSources?.map((src) => {
              const isSelected =
                src.kind === "device"
                  ? selectedDevice?.id === src.id
                  : selectedDisplay?.kind === src.kind && selectedDisplay.id === src.id;
              const thumb = thumbs.get(sourceKey(src.kind, src.id));
              const cardAttrs = { [STREAM_SOURCE_TITLE_ATTR]: src.title };
              const KindIcon =
                src.kind === "screen" ? MonitorIcon : src.kind === "window" ? AppWindowIcon : WebcamIcon;
              return (
                <button
                  key={sourceKey(src.kind, src.id)}
                  type="button"
                  className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`}
                  onClick={() => toggleSelect(src)}
                  onDoubleClick={() => confirmWith(src)}
                  aria-pressed={isSelected}
                  data-testid={TID.screenShareSource}
                  data-source-id={src.id}
                  data-source-kind={src.kind}
                  {...cardAttrs}
                >
                  <span className={styles.thumb} aria-hidden="true">
                    {thumb ? <img src={thumb} alt="" /> : <KindIcon width={32} height={32} />}
                  </span>
                  <span className={styles.cardLabel}>
                    <KindIcon width={15} height={15} aria-hidden="true" />
                    <span className={styles.cardTitle} title={src.title}>
                      {src.title}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Selection summary: the picks live on different tabs, so without
            this row a screen+camera combination is invisible (and users never
            discover they can share both at once). */}
        {(selectedDisplay !== null || selectedDevice !== null) && (
          <div className={styles.selection}>
            <span className={styles.selectionLabel}>{t("screenShare.picker.sharingLabel")}</span>
            {[selectedDisplay, selectedDevice].map((src) => {
              if (src === null) return null;
              const ChipIcon = KIND_ICONS[src.kind];
              const clear = () =>
                src.kind === "device" ? setSelectedDevice(null) : setSelectedDisplay(null);
              return (
                <span
                  key={sourceKey(src.kind, src.id)}
                  className={styles.selectionChip}
                  data-testid={TID.screenShareSelectionChip}
                  data-chip-kind={src.kind}
                >
                  <ChipIcon width={13} height={13} aria-hidden="true" />
                  <span className={styles.chipTitle} title={src.title}>
                    {src.title}
                  </span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    onClick={clear}
                    aria-label={t("screenShare.picker.removeSource", { title: src.title })}
                  >
                    <CloseIcon width={12} height={12} />
                  </button>
                </span>
              );
            })}
            {selectedDevice === null && !deviceOnly && (
              <span className={styles.selectionHint}>{t("screenShare.picker.addCameraHint")}</span>
            )}
            {selectedDisplay === null && !deviceOnly && (
              <span className={styles.selectionHint}>{t("screenShare.picker.addDisplayHint")}</span>
            )}
          </div>
        )}

        <div className={styles.actions}>
          <div className={styles.quality} role="group" aria-label={t("screenShare.picker.qualityLabel")}>
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
            disabled={selections.length === 0}
            onClick={() => {
              if (selections.length > 0) onConfirm(selections, settings);
            }}
            data-testid={TID.screenShareConfirm}
          >
            {selections.length === 2 ? t("screenShare.picker.shareBoth") : t("screenShare.picker.share")}
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
            <span className={styles.modeRowValue}>{t(`screenShare.picker.res_${resKey}`, resKey)}</span>
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
                <span className={styles.modeRowName}>{t("screenShare.mode.fpsValue", { fps: f })}</span>
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
