import type { ComponentType } from "react";
import type { UiDesignId } from "@core/types";

/** The design a profile starts in when nothing is stored for it.
 *
 * Nebula is what a new user meets. It is only ever consulted when there is no
 * saved choice, so an existing profile keeps whichever pack it has been using
 * - a stored preference always wins over this. */
export const DEFAULT_UI_DESIGN: UiDesignId = "nebula";
export const UI_DESIGN_QUERY_PARAMETER = "ui";

export interface UiPackModule {
  default: ComponentType;
}

/** Each design is a separate lazy entry point. Designs ship side by side, so
 * adding or changing one pack must not require changing the standard
 * application or another pack. */
export const UI_PACK_LOADERS: Record<UiDesignId, () => Promise<UiPackModule>> = {
  standard: () => import("@standard/index"),
  aurora: () => import("@aurora/index"),
  nebula: () => import("@nebula/index"),
};

export function isUiDesignId(value: unknown): value is UiDesignId {
  return value === "standard" || value === "aurora" || value === "nebula";
}

/** URL selection deliberately wins over persistence so development and E2E
 * can launch a deterministic UI without modifying the user's preferences. */
export function resolveUiDesign(search: string, persisted?: unknown): UiDesignId {
  const requested = new URLSearchParams(search).get(UI_DESIGN_QUERY_PARAMETER);
  if (isUiDesignId(requested)) return requested;
  if (isUiDesignId(persisted)) return persisted;
  return DEFAULT_UI_DESIGN;
}
