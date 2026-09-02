import type { LocalPlayerEvent, PlayerAdapter, PlayerAdapterArgs } from "./PlayerAdapter";

/**
 * Player adapter for a direct media URL backed by an HTML5
 * `<video>` element.
 *
 * Forwards user-initiated `play`, `pause` and `seeked` events to the
 * controller via `onLocalEvent` (only when the host is driving - the
 * controller is responsible for ignoring inbound events from
 * non-hosts).
 *
 * Programmatic state changes set `suppressEvents` so they are not
 * mistaken for local-user events and bounced back over the wire.
 */
export class DirectMediaAdapter implements PlayerAdapter {
  private readonly video: HTMLVideoElement;
  private onLocalEvent?: (event: LocalPlayerEvent) => void;
  private suppressEvents = false;

  constructor(args: PlayerAdapterArgs) {
    this.onLocalEvent = args.onLocalEvent;
    this.video = document.createElement("video");
    this.video.src = args.sourceUrl;
    this.video.controls = args.controls !== false;
    this.video.style.width = "100%";
    this.video.style.maxHeight = "60vh";
    this.video.style.background = "#000";
    args.container.appendChild(this.video);

    this.video.addEventListener("play", this.handlePlay);
    this.video.addEventListener("pause", this.handlePause);
    this.video.addEventListener("seeked", this.handleSeeked);
    this.video.addEventListener("ended", this.handleEnded);
  }

  async play(at: number): Promise<void> {
    this.suppressEvents = true;
    if (Math.abs(this.video.currentTime - at) > 0.5) {
      this.video.currentTime = at;
    }
    try {
      await this.video.play();
    } finally {
      this.suppressEvents = false;
    }
  }

  async pause(at: number): Promise<void> {
    this.suppressEvents = true;
    this.video.pause();
    if (Math.abs(this.video.currentTime - at) > 0.5) {
      this.video.currentTime = at;
    }
    this.suppressEvents = false;
  }

  async seek(at: number): Promise<void> {
    this.suppressEvents = true;
    this.video.currentTime = at;
    this.suppressEvents = false;
  }

  currentTime(): number {
    return this.video.currentTime;
  }

  duration(): number {
    // NaN until the browser has the metadata, Infinity for a live stream.
    const value = this.video.duration;
    return Number.isFinite(value) ? value : 0;
  }

  buffered(): number {
    // The ranges are not ordered by position and a seek can leave gaps, so the
    // furthest end is the only honest answer to "buffered up to where".
    const ranges = this.video.buffered;
    let furthest = 0;
    for (let i = 0; i < ranges.length; i++) {
      furthest = Math.max(furthest, ranges.end(i));
    }
    return furthest;
  }

  volume(): number {
    return this.video.volume;
  }

  setVolume(value: number): void {
    this.video.volume = Math.min(1, Math.max(0, value));
  }

  muted(): boolean {
    return this.video.muted;
  }

  setMuted(value: boolean): void {
    this.video.muted = value;
  }

  rate(): number {
    return this.video.playbackRate;
  }

  setRate(value: number): void {
    this.video.playbackRate = value;
  }

  quality(): string | null {
    // Zero until the metadata lands, which reads the same as "will not say".
    return this.video.videoHeight > 0 ? `${this.video.videoHeight}p` : null;
  }

  setOnLocalEvent(cb: ((event: LocalPlayerEvent) => void) | undefined): void {
    this.onLocalEvent = cb;
  }

  destroy(): void {
    this.video.removeEventListener("play", this.handlePlay);
    this.video.removeEventListener("pause", this.handlePause);
    this.video.removeEventListener("seeked", this.handleSeeked);
    this.video.removeEventListener("ended", this.handleEnded);
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
  }

  private readonly handlePlay = (): void => {
    if (this.suppressEvents) return;
    this.onLocalEvent?.({ state: "playing", currentTime: this.video.currentTime });
  };

  private readonly handlePause = (): void => {
    if (this.suppressEvents) return;
    this.onLocalEvent?.({ state: "paused", currentTime: this.video.currentTime });
  };

  private readonly handleSeeked = (): void => {
    if (this.suppressEvents) return;
    const state = this.video.paused ? "paused" : "playing";
    this.onLocalEvent?.({ state, currentTime: this.video.currentTime });
  };

  private readonly handleEnded = (): void => {
    if (this.suppressEvents) return;
    this.onLocalEvent?.({ state: "ended", currentTime: this.video.currentTime });
  };
}
