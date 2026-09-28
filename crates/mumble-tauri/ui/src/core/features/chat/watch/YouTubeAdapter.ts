import type { LocalPlayerEvent, PlayerAdapter, PlayerAdapterArgs } from "./PlayerAdapter";

/**
 * Player adapter for a YouTube video, using the IFrame Player API.
 *
 * The IFrame API script is loaded lazily on first construction and
 * shared across all adapter instances.  Video IDs are derived from
 * watch / shorts / `youtu.be` URLs at construction time.
 *
 * The user must opt in to YouTube playback via the
 * `enableExternalEmbeds` preference; the controller is responsible
 * for refusing to instantiate this adapter otherwise.
 */
export class YouTubeAdapter implements PlayerAdapter {
  private readonly mountId: string;
  private readonly videoId: string;
  private onLocalEvent?: (event: LocalPlayerEvent) => void;
  private readonly controls: boolean;
  private readonly mountDiv: HTMLDivElement;
  private player: YTPlayer | null = null;
  private suppressEvents = false;
  private readyPromise: Promise<void>;

  constructor(args: PlayerAdapterArgs) {
    this.onLocalEvent = args.onLocalEvent;
    this.controls = args.controls !== false;
    this.videoId = extractYouTubeId(args.sourceUrl);
    this.mountId = `yt-${Math.random().toString(36).slice(2)}`;
    this.mountDiv = document.createElement("div");
    this.mountDiv.id = this.mountId;
    this.mountDiv.style.width = "100%";
    this.mountDiv.style.aspectRatio = "16 / 9";
    args.container.appendChild(this.mountDiv);
    this.readyPromise = this.bootstrap();
  }

  async play(at: number): Promise<void> {
    await this.readyPromise;
    if (!this.player) return;
    this.suppressEvents = true;
    this.player.seekTo(at, true);
    this.player.playVideo();
    this.suppressEvents = false;
  }

  async pause(at: number): Promise<void> {
    await this.readyPromise;
    if (!this.player) return;
    this.suppressEvents = true;
    this.player.pauseVideo();
    this.player.seekTo(at, true);
    this.suppressEvents = false;
  }

  async seek(at: number): Promise<void> {
    await this.readyPromise;
    if (!this.player) return;
    this.suppressEvents = true;
    this.player.seekTo(at, true);
    this.suppressEvents = false;
  }

  currentTime(): number {
    return this.player?.getCurrentTime?.() ?? 0;
  }

  duration(): number {
    // 0 before the video is cued, which is the same answer we want.
    return this.player?.getDuration?.() ?? 0;
  }

  buffered(): number {
    // YouTube reports a fraction of the whole, not a position.
    const fraction = this.player?.getVideoLoadedFraction?.() ?? 0;
    return fraction * this.duration();
  }

  volume(): number {
    return (this.player?.getVolume?.() ?? 100) / 100;
  }

  setVolume(value: number): void {
    this.player?.setVolume?.(Math.round(Math.min(1, Math.max(0, value)) * 100));
  }

  muted(): boolean {
    return this.player?.isMuted?.() ?? false;
  }

  setMuted(value: boolean): void {
    if (value) this.player?.mute?.();
    else this.player?.unMute?.();
  }

  rate(): number {
    return this.player?.getPlaybackRate?.() ?? 1;
  }

  setRate(value: number): void {
    this.player?.setPlaybackRate?.(value);
  }

  quality(): string | null {
    // `hd1080` and friends; `auto` and `unknown` mean it will not say yet.
    const raw = this.player?.getPlaybackQuality?.();
    if (!raw || raw === "auto" || raw === "unknown") return null;
    const lines: Record<string, string> = {
      tiny: "144p",
      small: "240p",
      medium: "360p",
      large: "480p",
      hd720: "720p",
      hd1080: "1080p",
      hd1440: "1440p",
      hd2160: "2160p",
      highres: "4320p",
    };
    return lines[raw] ?? null;
  }

  setOnLocalEvent(cb: ((event: LocalPlayerEvent) => void) | undefined): void {
    this.onLocalEvent = cb;
  }

  destroy(): void {
    try {
      this.player?.destroy?.();
    } catch {
      /* ignore */
    }
    this.player = null;
    this.mountDiv.remove();
  }

  private async bootstrap(): Promise<void> {
    await loadYouTubeApi();
    const YT = window.YT;
    if (!YT) return;
    await new Promise<void>((resolve) => {
      this.player = new YT.Player(this.mountId, {
        videoId: this.videoId,
        playerVars: { playsinline: 1, rel: 0, controls: this.controls ? 1 : 0 },
        events: {
          onReady: () => resolve(),
          onStateChange: this.handleStateChange,
        },
      });
    });
  }

  private readonly handleStateChange = (e: YTStateChangeEvent): void => {
    if (this.suppressEvents || !this.player) return;
    const YT = window.YT;
    if (!YT) return;
    let state: LocalPlayerEvent["state"] | null = null;
    if (e.data === YT.PlayerState.PLAYING) state = "playing";
    else if (e.data === YT.PlayerState.PAUSED) state = "paused";
    else if (e.data === YT.PlayerState.ENDED) state = "ended";
    if (state == null) return;
    this.onLocalEvent?.({ state, currentTime: this.player.getCurrentTime() });
  };
}

// --- IFrame API loader (singleton) ---------------------------------

const YOUTUBE_API_URL = "https://www.youtube.com/iframe_api";
let apiLoadPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise<void>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = YOUTUBE_API_URL;
    script.async = true;
    document.head.appendChild(script);
  });
  return apiLoadPromise;
}

function extractYouTubeId(url: string): string {
  const m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i.exec(url);
  return m?.[1] ?? "";
}

// --- Minimal YouTube IFrame API typings ----------------------------

interface YTStateChangeEvent {
  data: number;
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  getVolume(): number;
  setVolume(volume: number): void;
  isMuted(): boolean;
  mute(): void;
  unMute(): void;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackQuality(): string;
  destroy(): void;
}

interface YTPlayerStatic {
  Player: new (
    elementId: string,
    options: {
      videoId: string;
      playerVars?: Record<string, unknown>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: YTStateChangeEvent) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: {
    PLAYING: number;
    PAUSED: number;
    ENDED: number;
  };
}

declare global {
  interface Window {
    YT?: YTPlayerStatic;
    onYouTubeIframeAPIReady?: () => void;
  }
}
