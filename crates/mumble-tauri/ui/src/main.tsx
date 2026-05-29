import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { isMobile } from "./utils/platform";
import { detectBackdropFilterSupport } from "./utils/platform";
import { loadPersonalization } from "./personalizationStorage";
import { applyTheme, DEFAULT_THEME } from "./themes";
import { applyFont } from "./utils/fonts";
import "./i18n";
import { bootstrapCustomTranslations } from "./translations/storage";
import "./global.css";
import "katex/dist/katex.min.css";

if (isMobile) {
  document.documentElement.style.setProperty("--titlebar-height", "0px");
}

detectBackdropFilterSupport();

loadPersonalization()
  .then((p) => {
    applyTheme(p.theme);
    applyFont(p.fontFamily);
  })
  .catch(() => applyTheme(DEFAULT_THEME));

// Fire-and-forget: register any saved user-authored language bundles with
// i18next so they become switchable.  Failures only mean the user-side UI
// will fall back to the bundled languages.
bootstrapCustomTranslations().catch(() => undefined);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
