/**
 * Player adapter interface.
 *
 * A player adapter is the glue between the watch-together state
 * machine (which knows about play/pause/seek and a host's
 * authoritative state) and a concrete underlying player implementation
 * (HTML5 `<video>`, YouTube IFrame, ...).
 *
 * Adapters are mounted into a host DOM element by the
 * `WatchTogetherCard` component and report local user-initiated
 * playback events back via `onLocalEvent`.  They are explicitly
 * designed to be pure DOM (no React) so that the host component can
 * remain lightweight and the adapter can be swapped without remount.
 */

/** Local event the adapter reports back to the controller. */
export interface LocalPlayerEvent {
  /** Current playback state inferred from the underlying player. */
  state: "playing" | "paused" | "ended";
  /** Position in seconds. */
  currentTime: number;
}

/** Constructor arguments shared by every adapter. */
export interface PlayerAdapterArgs {
  /** DOM container the adapter mounts its <video>/iframe into. */
  container: HTMLElement;
  /** Source URL (direct media or canonical YouTube watch URL). */
  sourceUrl: string;
  /** Notification callback for any locally-originated event (host only). */
  onLocalEvent?: (event: LocalPlayerEvent) => void;
  /**
   * Draw the player's own transport controls. Default true.
   *
   * A surface that draws its own progress bar passes false, so the reader is
   * not given two scrubbers that disagree about who is in charge.
   */
  controls?: boolean;
}

/** Common adapter API. */
export interface PlayerAdapter {
  /** Begin playback at the given position. */
  play(at: number): Promise<void>;
  /** Pause playback at the given position. */
  pause(at: number): Promise<void>;
  /** Seek to the given position without changing play/pause state. */
  seek(at: number): Promise<void>;
  /** Read the current playback position in seconds. */
  currentTime(): number;
  /**
   * Length of the source in seconds, or 0 where it is not known yet.
   *
   * Metadata arrives after the player mounts, and a live stream has no
   * length at all, so a caller drawing a progress bar has to treat 0 as
   * "not yet" rather than as the start of a zero-length video.
   */
  duration(): number;
  /**
   * Seconds buffered from the start, or 0 when nothing is known.
   *
   * What a progress bar draws behind the played part. Every player reports
   * this differently (ranges here, a loaded fraction there), so the adapter
   * answers in the one unit the caller can draw with.
   */
  buffered(): number;
  /** Playback volume, 0 to 1, independent of mute. */
  volume(): number;
  setVolume(value: number): void;
  muted(): boolean;
  setMuted(value: boolean): void;
  /** Playback rate, 1 being normal speed. */
  rate(): number;
  setRate(value: number): void;
  /**
   * A short label for what is being played back, `"1080p"` and the like, or
   * null where the player will not say. Never a promise about bandwidth - it
   * is what the player reports it is currently showing.
   */
  quality(): string | null;
  /** Replace (or clear) the local-event callback after construction. */
  setOnLocalEvent(cb: ((event: LocalPlayerEvent) => void) | undefined): void;
  /** Tear down the underlying player and remove DOM nodes. */
  destroy(): void;
}
