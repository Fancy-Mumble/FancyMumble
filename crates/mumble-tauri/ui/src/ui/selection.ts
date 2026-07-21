import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import type { UiDesignId } from "@core/types";
import {
  isUiDesignId,
  resolveUiDesign,
  UI_DESIGN_QUERY_PARAMETER,
} from "./registry";

export function getUiDesignOverride(
  search = globalThis.location?.search ?? "",
): UiDesignId | null {
  const value = new URLSearchParams(search).get(UI_DESIGN_QUERY_PARAMETER);
  return isUiDesignId(value) ? value : null;
}

export async function getSelectedUiDesign(
  search = globalThis.location?.search ?? "",
): Promise<UiDesignId> {
  const preferences = await getPreferences();
  return resolveUiDesign(search, preferences.uiDesign);
}

/** Persists a user's design choice. UiRoot observes the standard preferences
 * event, so callers do not need a second UI-specific global store. */
export async function setSelectedUiDesign(uiDesign: UiDesignId): Promise<void> {
  await updatePreferences({ uiDesign });
}
