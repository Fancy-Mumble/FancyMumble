/**
 * Last round-trip time of the Mumble control channel, in milliseconds.
 *
 * The native stream viewer has no RTT of its own to report: `webrtc-rs`
 * declares `currentRoundTripTime` on the selected ICE pair but never
 * measures it (it is 0.0 for the life of the connection), and nothing in
 * either direction carries RFC 3611 DLRR, so a receiver cannot compute one.
 * The server's SFU runs in the same process as the Mumble control channel,
 * so that channel's own ping traverses the same path to the same host and
 * is the honest stand-in. The panel labels it as such rather than passing
 * it off as an ICE measurement.
 */
import { listen } from "@tauri-apps/api/event";

let latest: number | null = null;
let listening = false;

/** The most recent server ping, or `null` before the first one lands. */
export function lastServerPingMs(): number | null {
  if (!listening) {
    listening = true;
    void listen<{ rtt_ms: number }>("ping-latency", (event) => {
      latest = event.payload.rtt_ms;
    }).catch(() => {
      listening = false; // let a later call try again
    });
  }
  return latest;
}
