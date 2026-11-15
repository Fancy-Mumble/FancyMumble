import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import {
  QUALITY_PRESETS,
  RESOLUTIONS,
  FRAME_RATES,
  presetOf,
  resolutionKeyOf,
  type QualityPreset,
  type StreamSettings,
} from "@core/features/chat/stream/streamSettings";
import { AppWindowIcon, CheckIcon, MonitorIcon, SparklesIcon, TrashIcon, WebcamIcon } from "@ui/icons";
import styles from "../../AuroraClientSurfaces.module.css";
import panelStyles from "./ScreenSharePanel.module.css";
import { Button, ModalSurface } from "../primitives";

type CaptureSourceKind = "screen" | "window" | "device";
type CaptureSource = { id: number; kind: CaptureSourceKind; title: string; width: number; height: number };
type SelectedSource = Pick<CaptureSource, "id" | "kind">;

export interface ScreenShareController {
  settings: StreamSettings;
  confirmSource: (
    sources: readonly SelectedSource[],
    settings: StreamSettings,
    options?: { reuseDisplay?: boolean },
  ) => Promise<void>;
  stopSharing: () => void;
}

const tabs: Array<{ kind: CaptureSourceKind; label: string; Icon: typeof MonitorIcon }> = [
  { kind: "screen", label: "Screens", Icon: MonitorIcon },
  { kind: "window", label: "Windows", Icon: AppWindowIcon },
  { kind: "device", label: "Cameras", Icon: WebcamIcon },
];

const sourceKey = (source: CaptureSource) => `${source.kind}:${source.id}`;
const iconFor = (kind: CaptureSourceKind) =>
  kind === "screen" ? MonitorIcon : kind === "window" ? AppWindowIcon : WebcamIcon;
const sharePayload = (sources: readonly CaptureSource[]) =>
  JSON.stringify({
    v: 1,
    tracks: sources.map((source, index) => ({
      mid: String(index),
      content: source.kind === "device" ? "camera" : "screen",
    })),
  });
const STREAM_SETTINGS_KEY = "fancy-new-ui-stream-settings";
function initialStreamSettings(fallback: StreamSettings): StreamSettings {
  try {
    const parsed = JSON.parse(
      globalThis.localStorage.getItem(STREAM_SETTINGS_KEY) ?? "null",
    ) as Partial<StreamSettings> | null;
    return typeof parsed?.maxDimension === "number" && typeof parsed?.maxFps === "number"
      ? { maxDimension: parsed.maxDimension, maxFps: parsed.maxFps }
      : fallback;
  } catch {
    return fallback;
  }
}

function SourceCard({
  source,
  thumbnail,
  selected,
  onSelect,
}: {
  source: CaptureSource;
  thumbnail?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const SourceIcon = iconFor(source.kind);
  return (
    <Button
      variant="bare"
      wrapLabel={false}
      className={`${styles.shareSourceCard} ${selected ? styles.shareSourceSelected : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
      title={source.title}
    >
      <span className={styles.shareThumbnail}>
        {thumbnail ? (
          <img src={thumbnail} alt="" />
        ) : (
          <span>
            <SourceIcon />
            <small>Preview unavailable</small>
          </span>
        )}
        {selected && (
          <i>
            <CheckIcon />
          </i>
        )}
      </span>
      <span className={styles.shareSourceMeta}>
        <SourceIcon />
        <span>
          <strong>{source.title}</strong>
          <small>
            {source.width > 0 && source.height > 0
              ? `${source.width} × ${source.height}`
              : source.kind === "device"
                ? "Camera device"
                : "Size unavailable"}
          </small>
        </span>
      </span>
    </Button>
  );
}

export default function ScreenSharePanel({
  onClose,
  controller,
}: {
  onClose: () => void;
  controller?: ScreenShareController;
}) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [tab, setTab] = useState<CaptureSourceKind>("screen");
  const [selected, setSelected] = useState<CaptureSource | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CaptureSource | null>(null);
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<StreamSettings>(() =>
    initialStreamSettings(controller?.settings ?? QUALITY_PRESETS.hd),
  );
  const isSharing = useAppStore((state) => state.isSharingOwn);
  const broadcastingSessions = useAppStore((state) => state.broadcastingSessions);
  const broadcasters = useMemo(() => [...broadcastingSessions], [broadcastingSessions]);
  const users = useAppStore((state) => state.users);

  useEffect(() => {
    let cancelled = false;
    void invoke<CaptureSource[]>("list_capture_sources")
      .then((items) => {
        if (cancelled) return;
        setSources(items);
        const first = items.find((item) => item.kind === "screen") ?? items[0] ?? null;
        setSelected(first);
        if (first) setTab(first.kind);
      })
      .catch((reason) => {
        if (!cancelled) {
          setSources([]);
          setError(String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sources?.length) return;
    let cancelled = false;
    void (async () => {
      for (const source of sources) {
        if (cancelled) return;
        try {
          const thumbnail = await invoke<string>("capture_source_thumbnail", {
            kind: source.kind,
            id: source.id,
            maxDim: 420,
          });
          if (!cancelled) setThumbnails((current) => new Map(current).set(sourceKey(source), thumbnail));
        } catch {
          /* The card keeps its source-type placeholder. */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sources]);
  useEffect(() => {
    try {
      globalThis.localStorage.setItem(STREAM_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* Storage can be disabled by platform policy. */
    }
  }, [settings]);

  const visibleSources = sources?.filter((source) => source.kind === tab) ?? [];
  const EmptyIcon = iconFor(tab);
  const primarySelection = selected ?? selectedCamera;
  const SelectedIcon = primarySelection ? iconFor(primarySelection.kind) : null;
  const selectedSources = [selected, selectedCamera].filter(
    (source): source is CaptureSource =>
      source !== null && (source.kind !== "device" || selected?.kind !== "device" || source === selected),
  );
  const pickSource = (source: CaptureSource) => {
    if (source.kind === "device") {
      if (selected?.kind === "device") setSelected(null);
      setSelectedCamera((current) => (current?.id === source.id ? null : source));
    } else setSelected(source);
  };
  const start = async () => {
    if (selectedSources.length === 0) return;
    setBusy(true);
    setError(null);
    const state = useAppStore.getState();
    try {
      if (controller)
        await controller.confirmSource(
          selectedSources.map(({ kind, id }) => ({ kind, id })),
          settings,
        );
      else {
        await state.sendWebRtcSignal(0, 0, sharePayload(selectedSources), state.activeServerId);
        await invoke("start_screen_broadcast", {
          sources: selectedSources.map(({ kind, id }) => ({ kind, id })),
          serverId: state.activeServerId,
          maxDimension: settings.maxDimension,
          maxFps: settings.maxFps,
          reusePortalSource: false,
        });
        useAppStore.setState((current) => ({
          isSharingOwn: true,
          broadcastingOwnSession: current.ownSession,
          broadcastingSessions: new Set(
            current.ownSession == null
              ? current.broadcastingSessions
              : [...current.broadcastingSessions, current.ownSession],
          ),
        }));
      }
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (controller) controller.stopSharing();
    else {
      const state = useAppStore.getState();
      await invoke("stop_screen_broadcast");
      await state.sendWebRtcSignal(0, 1, "", state.activeServerId);
      useAppStore.setState((current) => {
        const next = new Set(current.broadcastingSessions);
        if (current.ownSession != null) next.delete(current.ownSession);
        return { isSharingOwn: false, broadcastingOwnSession: null, broadcastingSessions: next };
      });
    }
    onClose();
  };

  return (
    <ModalSurface
      title="Share your screen"
      eyebrow="SCREEN & CAMERA"
      onClose={onClose}
      className={styles.shareSurface}
    >
      <div className={styles.sharePicker}>
        {broadcasters.length > 0 && (
          <div className={styles.liveStrip}>
            <span>
              <SparklesIcon />
            </span>
            <div>
              <strong>
                {broadcasters.length} live share{broadcasters.length === 1 ? "" : "s"}
              </strong>
              <small>
                {broadcasters
                  .map((session) => users.find((user) => user.session === session)?.name ?? "A member")
                  .join(", ")}
              </small>
            </div>
          </div>
        )}
        <div className={styles.shareTabs} role="tablist" aria-label="Capture source type">
          {tabs.map(({ kind, label, Icon }) => (
            <Button
              key={kind}
              variant="bare"
              role="tab"
              aria-selected={tab === kind}
              className={tab === kind ? styles.shareTabActive : styles.shareTab}
              leadingIcon={<Icon />}
              onClick={() => setTab(kind)}
            >
              {label}
              <small>{sources?.filter((source) => source.kind === kind).length ?? 0}</small>
            </Button>
          ))}
        </div>
        <div className={panelStyles.shareQuality}>
          <span>
            <strong>Stream quality</strong>
            <small>Resolution and frame rate sent to viewers</small>
          </span>
          {(["sd", "hd", "source"] as QualityPreset[]).map((preset) => (
            <Button
              variant={presetOf(settings) === preset ? "secondary" : "bare"}
              key={preset}
              onClick={() => setSettings(QUALITY_PRESETS[preset])}
            >
              {preset === "source" ? "Source" : preset.toUpperCase()}
            </Button>
          ))}
          <select
            aria-label="Resolution"
            value={resolutionKeyOf(settings)}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                maxDimension:
                  RESOLUTIONS.find((item) => item.key === event.target.value)?.maxDimension ??
                  current.maxDimension,
              }))
            }
          >
            {RESOLUTIONS.map((resolution) => (
              <option value={resolution.key} key={resolution.key}>
                {resolution.key === "source" ? "Source" : resolution.key}
              </option>
            ))}
          </select>
          <select
            aria-label="Frame rate"
            value={settings.maxFps}
            onChange={(event) =>
              setSettings((current) => ({ ...current, maxFps: Number(event.target.value) }))
            }
          >
            {FRAME_RATES.map((fps) => (
              <option key={fps} value={fps}>
                {fps} FPS
              </option>
            ))}
          </select>
        </div>
        <div className={styles.shareSourceGrid}>
          {sources === null ? (
            Array.from({ length: 6 }, (_, index) => (
              <div className={styles.shareSourceSkeleton} key={index}>
                <span />
                <i />
              </div>
            ))
          ) : visibleSources.length > 0 ? (
            visibleSources.map((source) => (
              <SourceCard
                key={sourceKey(source)}
                source={source}
                thumbnail={thumbnails.get(sourceKey(source))}
                selected={
                  source.kind === "device"
                    ? selectedCamera?.id === source.id
                    : selected?.kind === source.kind && selected.id === source.id
                }
                onSelect={() => pickSource(source)}
              />
            ))
          ) : (
            <div className={styles.shareEmpty}>
              <span>
                <EmptyIcon />
              </span>
              <strong>No {tabs.find((item) => item.kind === tab)?.label.toLowerCase()} found</strong>
              <small>Try another source category.</small>
            </div>
          )}
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <footer className={styles.shareFooter}>
          <div className={styles.shareSelection}>
            {primarySelection && SelectedIcon ? (
              <>
                <span>
                  <SelectedIcon />
                </span>
                <div>
                  <small>READY TO SHARE</small>
                  <strong title={selectedSources.map((source) => source.title).join(" + ")}>
                    {selectedSources.map((source) => source.title).join(" + ")}
                  </strong>
                </div>
                <em>
                  {settings.maxDimension === 0
                    ? "Source"
                    : `${Math.round((settings.maxDimension / 16) * 9)}p`}{" "}
                  · {settings.maxFps} FPS
                </em>
              </>
            ) : (
              <span>Select a source to continue</span>
            )}
          </div>
          <Button onClick={onClose}>Cancel</Button>
          {isSharing && (
            <Button variant="danger" leadingIcon={<TrashIcon />} onClick={() => void stop()}>
              Stop sharing
            </Button>
          )}
          <Button
            variant="primary"
            leadingIcon={<SparklesIcon />}
            disabled={selectedSources.length === 0 || busy}
            onClick={() => void start()}
          >
            {busy ? "Starting…" : isSharing ? "Update share" : "Go live"}
          </Button>
        </footer>
      </div>
    </ModalSurface>
  );
}
