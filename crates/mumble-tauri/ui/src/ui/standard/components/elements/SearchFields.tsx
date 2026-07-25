/**
 * Positional search presets.
 *
 * There is exactly one search control - {@link ./TextInput!SearchInput} - which
 * owns the magnifier, its padding and any trailing adornment. The app uses it
 * in four distinct positions, and each position previously re-derived its own
 * look at the call site (which is how eleven copies of the same field drifted
 * apart). Those positions are named here instead, so a call site picks *where*
 * the search lives and never *how* it looks:
 *
 *   SidebarSearch   sidebars, settings and menu pickers - compact and
 *                   self-drawing (their surrounding row is layout only), takes
 *                   a trailing shortcut hint or close button
 *   ToolbarSearch   admin panel toolbars and list filters - the input is the
 *                   field and draws its own chrome
 *   PickerSearch    popovers and pickers (GIF, emote, livedoc insert) whose
 *                   own bar already draws the field, so this is bare
 *   PaletteSearch   the command palette - bare, larger type
 *
 * If a new position appears, add a preset here rather than restyling a search
 * locally; that keeps the magnifier/padding pairing in one place.
 */

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { SearchInput } from "./TextInput";

type BaseProps = Omit<ComponentPropsWithoutRef<typeof SearchInput>, "variant" | "size">;

/**
 * Sidebar / settings / menu search: compact, and it draws its own field.
 *
 * These rows are layout only - the sidebar's `.searchBar` is a plain flex row
 * and the settings search lost its bordered wrapper during the migration - so
 * a bare variant here would render a search with no border at all.
 */
export const SidebarSearch = forwardRef<HTMLInputElement, BaseProps>(function SidebarSearch(props, ref) {
  return <SearchInput ref={ref} variant="field" size="small" {...props} />;
});

/** Admin toolbars and list filters: the input is the field. */
export const ToolbarSearch = forwardRef<HTMLInputElement, BaseProps>(function ToolbarSearch(props, ref) {
  return <SearchInput ref={ref} variant="field" size="medium" {...props} />;
});

/** Pickers and popovers whose surrounding bar already draws the field. */
export const PickerSearch = forwardRef<HTMLInputElement, BaseProps>(function PickerSearch(props, ref) {
  return <SearchInput ref={ref} variant="bar" size="small" {...props} />;
});

/** Command palette: bare, set in larger type. */
export const PaletteSearch = forwardRef<HTMLInputElement, BaseProps>(function PaletteSearch(props, ref) {
  return <SearchInput ref={ref} variant="palette" size="medium" {...props} />;
});
