import type { ComponentType } from "react";
import type { UiDesignId } from "@core/types";

export const DEFAULT_UI_DESIGN: UiDesignId = "legacy";
export const UI_DESIGN_QUERY_PARAMETER = "ui";

export interface UiPackModule {
  default: ComponentType;
}

/** Each design is a separate lazy entry point. Adding a UI must not require
 * changing the legacy application or another pack. */
export const UI_PACK_LOADERS: Record<
  UiDesignId,
  () => Promise<UiPackModule>
> = {
  legacy: () => import("@legacy/index"),
  new: () => import("@new/index"),
};

export function isUiDesignId(value: unknown): value is UiDesignId {
  return value === "legacy" || value === "new";
}

/** URL selection deliberately wins over persistence so development and E2E
 * can launch a deterministic UI without modifying the user's preferences. */
export function resolveUiDesign(
  search: string,
  persisted?: unknown,
): UiDesignId {
  const requested = new URLSearchParams(search).get(UI_DESIGN_QUERY_PARAMETER);
  if (isUiDesignId(requested)) return requested;
  if (isUiDesignId(persisted)) return persisted;
  return DEFAULT_UI_DESIGN;
}
