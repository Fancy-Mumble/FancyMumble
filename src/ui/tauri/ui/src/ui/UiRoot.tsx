import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { UserPreferences, UiDesignId } from "@core/types";
import { resolveUiDesign, UI_PACK_LOADERS } from "./registry";
import { getSelectedUiDesign, getUiDesignOverride } from "./selection";

export default function UiRoot() {
  const override = getUiDesignOverride();
  const [design, setDesign] = useState<UiDesignId | null>(override);

  useEffect(() => {
    if (override) return;
    let active = true;
    void getSelectedUiDesign()
      .catch((e) => {
        // A window that cannot read preferences still has to render. The read
        // goes through the store plugin, which is per-window ACL'd, so a window
        // whose capability forgets `store:default` used to sit here forever and
        // paint an empty page - a blank overlay with no error anywhere.
        console.warn("UiRoot: preferences unreadable, falling back to the default design", e);
        return resolveUiDesign(globalThis.location.search);
      })
      .then((selected) => {
        if (active) setDesign(selected);
      });
    return () => {
      active = false;
    };
  }, [override]);

  useEffect(() => {
    if (override) return;
    const onPreferencesChanged = (event: Event) => {
      const preferences = (event as CustomEvent<UserPreferences>).detail;
      setDesign(resolveUiDesign(globalThis.location.search, preferences?.uiDesign));
    };
    globalThis.addEventListener("preferences-changed", onPreferencesChanged);
    return () => {
      globalThis.removeEventListener("preferences-changed", onPreferencesChanged);
    };
  }, [override]);

  useLayoutEffect(() => {
    if (!design) return;
    document.documentElement.dataset.uiDesign = design;
  }, [design]);

  const SelectedUi = useMemo(() => (design ? lazy(UI_PACK_LOADERS[design]) : null), [design]);

  if (!SelectedUi) return null;

  return (
    <Suspense fallback={null}>
      <SelectedUi />
    </Suspense>
  );
}
