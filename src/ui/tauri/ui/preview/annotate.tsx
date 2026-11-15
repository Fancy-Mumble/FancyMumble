/**
 * Scratch preview: the share stage with the annotation canvas on.
 * Not part of the app build - see preview/vite.config.mts.
 */
(globalThis as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: () => Promise.resolve(null),
  transformCallback: () => 0,
  metadata: { currentWindow: { label: "main" } },
};

import { createRoot } from "react-dom/client";
import { createRef } from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import "@standard/theme.css";
import "@standard/global.css";
import "@core/i18n";
import { initializeStandardAppearance } from "@standard/appearance";
import { useAppStore } from "@core/store";
import { createNebulaTheme } from "@nebula/theme";
import { ScreenShareStage } from "@nebula/components/chat/share/ScreenShareStage";
import type { StreamFeed } from "@nebula/components/chat/share/feeds";
import type { ScreenShareHook } from "@standard/components/chat/stream/useScreenShare";
// Registers the webview strategy, which the stage asks for its surface kind.
import "@standard/components/chat/stream/useScreenShare";

initializeStandardAppearance();

const CHANNEL = 4;
const OWN = 11;

/** A test pattern, as a live MediaStream - so the glass has a real picture
 *  under it rather than the well's near-black. */
function pattern(): { stream: MediaStream; still: string } {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 1600, 900);
  sky.addColorStop(0, "#2b4a7a");
  sky.addColorStop(0.5, "#7d5aa0");
  sky.addColorStop(1, "#c98a5b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1600, 900);
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  for (let x = 0; x <= 1600; x += 100) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 900);
    ctx.stroke();
  }
  for (let y = 0; y <= 900; y += 100) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1600, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.font = "600 64px sans-serif";
  ctx.fillText("shared screen 1600x900", 90, 480);
  return { stream: canvas.captureStream(10), still: canvas.toDataURL() };
}

const { stream, still } = pattern();
// Headless Edge never advances the captured stream, so the poster is what
// actually stands in for the picture under the glass.
setTimeout(() => {
  for (const video of document.querySelectorAll("video")) video.poster = still;
}, 200);

const feed = (over: Partial<StreamFeed>): StreamFeed => ({
  key: "11:display",
  session: OWN,
  slot: "display",
  kind: "screen",
  name: "You",
  own: true,
  stream,
  canvasRef: createRef<HTMLCanvasElement>(),
  live: true,
  failed: false,
  ...over,
});

const feeds: StreamFeed[] = [
  feed({}),
  feed({ key: "12:camera", session: 12, slot: "camera", kind: "camera", name: "Mira", own: false }),
];

const share = {
  isBroadcasting: true,
  isBroadcastingFromOtherTab: false,
  broadcastingSessions: new Set([OWN]),
  watchingSession: null,
  localStream: stream,
  pickerOpen: false,
  portalPicker: false,
  pickerDeviceOnly: false,
  settings: {},
  activeSources: null,
  startSharing: () => {},
  startCameraSharing: () => {},
  cancelPicker: () => {},
  confirmSource: async () => {},
  changeSettings: () => {},
  stopSharing: () => {},
  watchBroadcast: () => {},
  stopWatching: () => {},
} as unknown as ScreenShareHook;

useAppStore.setState({
  currentChannel: CHANNEL,
  ownSession: OWN,
  activeServerId: "preview",
  drawingActiveChannels: new Set([CHANNEL]),
  broadcastingSessions: new Set([OWN]),
} as never);

// Pointer capture rejects a pointerId no real device owns, and the overlay
// takes it on pointerdown - so the synthetic stroke below would die there.
Element.prototype.setPointerCapture = () => {};

/** Draw a loop on the canvas the way a user would, to prove the pointer ->
 *  content-rect -> ink path end to end rather than just its layout. */
function scribble(): void {
  const canvas = document.querySelector("canvas");
  if (!canvas) return;
  const box = canvas.getBoundingClientRect();
  const at = (t: number) => ({
    clientX: box.left + box.width * (0.34 + 0.13 * Math.cos(t) + 0.1 * t),
    clientY: box.top + box.height * (0.5 + 0.3 * Math.sin(t)),
  });
  const send = (type: string, point: { clientX: number; clientY: number }) =>
    canvas.dispatchEvent(new PointerEvent(type, { ...point, pointerId: 1, bubbles: true, isPrimary: true }));
  send("pointerdown", at(0));
  for (let t = 0.1; t < 6.3; t += 0.1) send("pointermove", at(t));
  send("pointerup", at(6.3));
}

/** `?fit=Fill` / `?fit=1:1` picks the scaling mode before scribbling, so the
 *  measured-rect path can be eyeballed as well as the contain one. */
setTimeout(() => {
  const want = new URLSearchParams(location.search).get("fit");
  if (want) {
    for (const button of document.querySelectorAll("button")) {
      if (button.textContent?.trim() === want) button.click();
    }
  }
}, 250);

setTimeout(scribble, 500);

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#141d33" }}>
      <ScreenShareStage feeds={feeds} share={share} onOpenQuality={() => {}} />
      <div style={{ flex: 1 }} />
    </div>
  </ThemeProvider>,
);
