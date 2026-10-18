import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { ThemeOption } from "./themes";

const STYLE_ID = "user-theme-override";
const EVENT = "user-theme-changed";

/**
 * A theme whose colors come from a CSS file on disk (see
 * `commands/user_theme.rs`), hot-swapped when the file changes. Offered in the
 * picker only while that file exists, and kept out of `THEMES` so the bundled
 * catalogue stays the one Nebula covers.
 */
export const EXTERNAL_THEME: ThemeOption = {
  id: "omarchy",
  label: "System (external)",
  swatches: ["#1a1b26", "#24283b", "#7aa2f7", "#bb9af7"],
};

let available = false;
const subscribers = new Set<(value: boolean) => void>();

/** The file declares `--omarchy-mode: dark|light`; mirror it to an attribute
 * so the matching bundled base fills every variable the file leaves unset. */
function syncMode(): void {
  const root = document.documentElement;
  const mode = getComputedStyle(root).getPropertyValue("--omarchy-mode").trim();
  if (mode === "light") root.setAttribute("data-omarchy-mode", "light");
  else root.removeAttribute("data-omarchy-mode");
}

function setCss(css: string | null): void {
  let el = document.getElementById(STYLE_ID);
  if (!css) {
    el?.remove();
  } else {
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = css;
  }
  syncMode();
  available = css !== null;
  subscribers.forEach((notify) => notify(available));
}

export async function bootstrapExternalTheme(): Promise<void> {
  await listen<string | null>(EVENT, (e) => setCss(e.payload));
  setCss(await invoke<string | null>("get_user_theme_css"));
}

/** Whether an external theme file is currently present. */
export function useExternalThemeAvailable(): boolean {
  const [value, setValue] = useState(available);
  useEffect(() => {
    subscribers.add(setValue);
    setValue(available);
    return () => {
      subscribers.delete(setValue);
    };
  }, []);
  return value;
}
