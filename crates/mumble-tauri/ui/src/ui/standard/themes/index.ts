export type ThemeId =
  | "dark"
  | "light"
  | "apprentice"
  | "mobel"
  | "rose"
  | "inversa"
  | "hearth"
  | "macchiato"
  | "midnight-pretenders"
  | "ply"
  | "guardbase"
  | "aurora";

export interface ThemeOption {
  readonly id: ThemeId;
  readonly label: string;
  readonly swatches: readonly string[];
}

export const THEMES: readonly ThemeOption[] = [
  { id: "dark", label: "Dark", swatches: ["#0e0e16", "#1a1a2e", "#2aabee", "#7c3aed"] },
  { id: "light", label: "Light", swatches: ["#f5f5f9", "#eaeaf0", "#1a8cd8", "#6d28d9"] },
  { id: "apprentice", label: "Apprentice", swatches: ["#1c1c1c", "#303030", "#468CDC", "#E04848"] },
  { id: "mobel", label: "Mobel", swatches: ["#F2F2F2", "#293940", "#F2CB57", "#F21905"] },
  { id: "rose", label: "Rose", swatches: ["#1a0f14", "#30202a", "#f472b6", "#e879f9"] },
  { id: "inversa", label: "Inversa", swatches: ["#F5F6EF", "#1A2611", "#A2A633", "#93AEBF"] },
  { id: "hearth", label: "Hearth", swatches: ["#20111B", "#382830", "#EAA549", "#426A79"] },
  { id: "macchiato", label: "Macchiato", swatches: ["#1E2030", "#363A4F", "#8AADF4", "#F5BDE6"] },
  {
    id: "midnight-pretenders",
    label: "Midnight Pretenders",
    swatches: ["#0d0d1a", "#1a1a35", "#F21B7F", "#0C87F2"],
  },
  { id: "ply", label: "Ply", swatches: ["#F2F2F2", "#0D0D0D", "#93ABBF", "#F20505"] },
  { id: "guardbase", label: "Guardbase", swatches: ["#0E1826", "#012340", "#2E4959", "#687E8C"] },
  { id: "aurora", label: "Aurora", swatches: ["#0a0f1c", "#1c2740", "#7fb0ff", "#b795ff"] },
];

export const DEFAULT_THEME: ThemeId = "dark";

export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute("data-theme", id);
}

/**
 * Which scheme the chosen theme is worn in.
 *
 * A second attribute rather than a second set of theme ids: the design sheet
 * draws each theme in both light and dark, so the scheme is orthogonal to the
 * brand. Stamped on `<html>` exactly as the theme is, which is what lets the
 * pack observe one attribute filter and pick both changes up.
 */
export function applyColorMode(mode: "system" | "light" | "dark"): void {
  if (mode === "system") document.documentElement.removeAttribute("data-color-mode");
  else document.documentElement.setAttribute("data-color-mode", mode);
}

export function getCurrentColorMode(): "system" | "light" | "dark" {
  const value = document.documentElement.getAttribute("data-color-mode");
  return value === "light" || value === "dark" ? value : "system";
}

export function getCurrentTheme(): ThemeId {
  return (document.documentElement.getAttribute("data-theme") as ThemeId) ?? DEFAULT_THEME;
}
