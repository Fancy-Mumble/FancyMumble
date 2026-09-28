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
