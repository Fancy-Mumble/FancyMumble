import { loadPersonalization } from "./personalizationStorage";
import { applyColorMode, applyTheme, DEFAULT_THEME } from "./themes";
import { applyFont } from "@core/utils/fonts";
import { detectBackdropFilterSupport, isMobile } from "@core/utils/platform";

let initialized = false;

/** Applies appearance concerns owned by the legacy UI. The bootstrap and the
 * new UI stay free of legacy CSS, themes, and personalization behavior. */
export function initializeStandardAppearance(): void {
  if (initialized) return;
  initialized = true;

  if (isMobile) {
    document.documentElement.style.setProperty("--titlebar-height", "0px");
  }
  detectBackdropFilterSupport();
  void loadPersonalization()
    .then((personalization) => {
      applyTheme(personalization.theme);
      applyColorMode(personalization.colorMode);
      applyFont(personalization.fontFamily);
    })
    .catch(() => applyTheme(DEFAULT_THEME));
}
