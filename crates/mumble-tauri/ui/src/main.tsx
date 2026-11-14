import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import UiRoot from "@ui/UiRoot";
import "@core/i18n";
import { bootstrapCustomTranslations } from "@core/translations/storage";

// Fire-and-forget: register any saved user-authored language bundles with
// i18next so they become switchable.  Failures only mean the user-side UI
// will fall back to the bundled languages.
bootstrapCustomTranslations().catch(() => undefined);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <UiRoot />
    </BrowserRouter>
  </React.StrictMode>,
);
