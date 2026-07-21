import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { UserPreferences, UiDesignId } from "@core/types";
import {
  resolveUiDesign,
  UI_PACK_LOADERS,
} from "./registry";
import { getSelectedUiDesign, getUiDesignOverride } from "./selection";

export default function UiRoot() {
  const override = getUiDesignOverride();
  const [design, setDesign] = useState<UiDesignId | null>(override);

  useEffect(() => {
    if (override) return;
    let active = true;
    void getSelectedUiDesign().then((selected) => {
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

  const SelectedUi = useMemo(
    () => (design ? lazy(UI_PACK_LOADERS[design]) : null),
    [design],
  );

  if (!SelectedUi) return null;

  return (
    <Suspense fallback={null}>
      <SelectedUi />
    </Suspense>
  );
}
