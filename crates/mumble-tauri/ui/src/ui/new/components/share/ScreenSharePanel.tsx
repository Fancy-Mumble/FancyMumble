import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import { AppWindowIcon, CheckIcon, MonitorIcon, SparklesIcon, TrashIcon, WebcamIcon } from "@ui/icons";
import styles from "../../NewClientSurfaces.module.css";
import { Button, ModalSurface } from "../primitives";

type CaptureSourceKind = "screen" | "window" | "device";
type CaptureSource = { id: number; kind: CaptureSourceKind; title: string; width: number; height: number };

const tabs: Array<{ kind: CaptureSourceKind; label: string; Icon: typeof MonitorIcon }> = [
  { kind: "screen", label: "Screens", Icon: MonitorIcon },
  { kind: "window", label: "Windows", Icon: AppWindowIcon },
  { kind: "device", label: "Cameras", Icon: WebcamIcon },
];

const sourceKey = (source: CaptureSource) => `${source.kind}:${source.id}`;
const iconFor = (kind: CaptureSourceKind) => kind === "screen" ? MonitorIcon : kind === "window" ? AppWindowIcon : WebcamIcon;
const sharePayload = (source: CaptureSource) => JSON.stringify({ v: 1, tracks: [{ mid: "0", content: source.kind === "device" ? "camera" : "screen" }] });

function SourceCard({ source, thumbnail, selected, onSelect }: { source: CaptureSource; thumbnail?: string; selected: boolean; onSelect: () => void }) {
  const SourceIcon = iconFor(source.kind);
  return <Button variant="bare" wrapLabel={false} className={`${styles.shareSourceCard} ${selected ? styles.shareSourceSelected : ""}`} aria-pressed={selected} onClick={onSelect} title={source.title}>
    <span className={styles.shareThumbnail}>{thumbnail ? <img src={thumbnail} alt="" /> : <span><SourceIcon /><small>Preview unavailable</small></span>}{selected && <i><CheckIcon /></i>}</span>
    <span className={styles.shareSourceMeta}><SourceIcon /><span><strong>{source.title}</strong><small>{source.width > 0 && source.height > 0 ? `${source.width} × ${source.height}` : source.kind === "device" ? "Camera device" : "Size unavailable"}</small></span></span>
  </Button>;
}

export default function ScreenSharePanel({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [tab, setTab] = useState<CaptureSourceKind>("screen");
  const [selected, setSelected] = useState<CaptureSource | null>(null);
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSharing = useAppStore((state) => state.isSharingOwn);
  const broadcastingSessions = useAppStore((state) => state.broadcastingSessions);
  const broadcasters = useMemo(() => [...broadcastingSessions], [broadcastingSessions]);
  const users = useAppStore((state) => state.users);

  useEffect(() => {
    let cancelled = false;
    void invoke<CaptureSource[]>("list_capture_sources").then((items) => {
      if (cancelled) return;
      setSources(items);
      const first = items.find((item) => item.kind === "screen") ?? items[0] ?? null;
      setSelected(first);
      if (first) setTab(first.kind);
    }).catch((reason) => { if (!cancelled) { setSources([]); setError(String(reason)); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sources?.length) return;
    let cancelled = false;
    void (async () => {
      for (const source of sources) {
        if (cancelled) return;
        try {
          const thumbnail = await invoke<string>("capture_source_thumbnail", { kind: source.kind, id: source.id, maxDim: 420 });
          if (!cancelled) setThumbnails((current) => new Map(current).set(sourceKey(source), thumbnail));
        } catch { /* The card keeps its source-type placeholder. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [sources]);

  const visibleSources = sources?.filter((source) => source.kind === tab) ?? [];
  const EmptyIcon = iconFor(tab);
  const SelectedIcon = selected ? iconFor(selected.kind) : null;
  const start = async () => {
    if (!selected) return;
    setBusy(true); setError(null);
    const state = useAppStore.getState();
    try {
      await state.sendWebRtcSignal(0, 0, sharePayload(selected), state.activeServerId);
      await invoke("start_screen_broadcast", { sources: [{ kind: selected.kind, id: selected.id }], serverId: state.activeServerId, maxDimension: 1920, maxFps: 60, reusePortalSource: false });
      useAppStore.setState((current) => ({ isSharingOwn: true, broadcastingOwnSession: current.ownSession, broadcastingSessions: new Set(current.ownSession == null ? current.broadcastingSessions : [...current.broadcastingSessions, current.ownSession]) }));
      onClose();
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const stop = async () => {
    const state = useAppStore.getState();
    await invoke("stop_screen_broadcast");
    await state.sendWebRtcSignal(0, 1, "", state.activeServerId);
    useAppStore.setState((current) => { const next = new Set(current.broadcastingSessions); if (current.ownSession != null) next.delete(current.ownSession); return { isSharingOwn: false, broadcastingOwnSession: null, broadcastingSessions: next }; });
    onClose();
  };

  return <ModalSurface title="Share your screen" eyebrow="SCREEN & CAMERA" onClose={onClose} className={styles.shareSurface}>
    <div className={styles.sharePicker}>
      {broadcasters.length > 0 && <div className={styles.liveStrip}><span><SparklesIcon /></span><div><strong>{broadcasters.length} live share{broadcasters.length === 1 ? "" : "s"}</strong><small>{broadcasters.map((session) => users.find((user) => user.session === session)?.name ?? "A member").join(", ")}</small></div></div>}
      <div className={styles.shareTabs} role="tablist" aria-label="Capture source type">{tabs.map(({ kind, label, Icon }) => <Button key={kind} variant="bare" role="tab" aria-selected={tab === kind} className={tab === kind ? styles.shareTabActive : styles.shareTab} leadingIcon={<Icon />} onClick={() => setTab(kind)}>{label}<small>{sources?.filter((source) => source.kind === kind).length ?? 0}</small></Button>)}</div>
      <div className={styles.shareSourceGrid}>{sources === null ? Array.from({ length: 6 }, (_, index) => <div className={styles.shareSourceSkeleton} key={index}><span /><i /></div>) : visibleSources.length > 0 ? visibleSources.map((source) => <SourceCard key={sourceKey(source)} source={source} thumbnail={thumbnails.get(sourceKey(source))} selected={selected?.kind === source.kind && selected.id === source.id} onSelect={() => setSelected(source)} />) : <div className={styles.shareEmpty}><span><EmptyIcon /></span><strong>No {tabs.find((item) => item.kind === tab)?.label.toLowerCase()} found</strong><small>Try another source category.</small></div>}</div>
      {error && <div className={styles.error}>{error}</div>}
      <footer className={styles.shareFooter}><div className={styles.shareSelection}>{selected && SelectedIcon ? <><span><SelectedIcon /></span><div><small>READY TO SHARE</small><strong title={selected.title}>{selected.title}</strong></div><em>1080p · 60 FPS</em></> : <span>Select a source to continue</span>}</div><Button onClick={onClose}>Cancel</Button>{isSharing ? <Button variant="danger" leadingIcon={<TrashIcon />} onClick={() => void stop()}>Stop sharing</Button> : <Button variant="primary" leadingIcon={<SparklesIcon />} disabled={!selected || busy} onClick={() => void start()}>{busy ? "Starting…" : "Go live"}</Button>}</footer>
    </div>
  </ModalSurface>;
}
