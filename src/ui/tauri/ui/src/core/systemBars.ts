/**
 * The phone's status and gesture bars, told what the page paints behind them.
 *
 * The app is drawn edge to edge on Android, so the page is what shows through
 * both bars - and the bars' icons stay white unless told otherwise, which over
 * a light theme is a clock and a battery nobody can see. The native side
 * (`SystemBarsPlugin`) flips them dark on request, and sends the page its
 * inset variables again with every answer, so the first call after a load is
 * also how the page learns where the bars are.
 *
 * Pack-neutral, like `windowIcon`: a pack says whether its surface is light.
 */
import { invoke } from "@tauri-apps/api/core";
import { isMobile } from "@core/utils/platform";

/** Dark bar icons over a light page, light ones over a dark page. */
export async function applySystemBarStyle(light: boolean): Promise<void> {
  // A desktop window has no system bars; the command answers Ok there, but
  // there is no reason to cross the IPC boundary to hear it.
  if (!isMobile) return;
  try {
    await invoke("set_system_bar_style", { light });
  } catch {
    // Decoration: a build without the plugin keeps white icons, which is what
    // it had before, and there is nothing a caller could do about it.
  }
}

/** Whether a CSS colour string is closer to white than to black. */
export function isLightColor(color: string): boolean | null {
  const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/.exec(color);
  // Transparent says nothing about what shows through it.
  if (!match || match[4] === "0") return null;
  const [r, g, b] = match.slice(1, 4).map(Number);
  // Rec. 709 luma: good enough to pick between two icon colours.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

/**
 * For a pack that themes through CSS rather than a JS theme object: read the
 * colour the page actually paints and keep the bar icons in step with it,
 * re-reading when the root's theme attributes or the OS scheme change.
 */
export function followPageSystemBars(): void {
  if (!isMobile) return;
  let last: boolean | null = null;
  const sync = () => {
    const light = isLightColor(getComputedStyle(document.body).backgroundColor);
    if (light === null || light === last) return;
    last = light;
    void applySystemBarStyle(light);
  };
  const schedule = () => requestAnimationFrame(sync);
  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-color-mode", "class", "style"],
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", schedule);
  if (document.body) schedule();
  else document.addEventListener("DOMContentLoaded", schedule, { once: true });
}
