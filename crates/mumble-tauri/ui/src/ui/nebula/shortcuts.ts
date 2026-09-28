/**
 * Nebula's half of the configurable shortcuts.
 *
 * The bindings themselves are the client's, not the pack's: the Shortcuts page
 * writes one `shortcuts.json` that every design reads, and Standard's matcher
 * decides what a binding string means - re-deciding that here would let the
 * same key do different things in two windows of the same client. What belongs
 * to Nebula is the actions column, which of this window's surfaces each binding
 * reaches, and the label the chrome prints when it advertises one.
 */
import { useEffect, useState } from "react";
import {
  DEFAULT_SHORTCUTS,
  loadShortcuts,
  type ShortcutBindings,
} from "@core/features/settings/shortcutHelpers";
import { isApple } from "@core/utils/platform";
import { useInAppShortcuts, type InAppShortcutHandlers } from "@standard/hooks/useInAppShortcuts";

/** How Apple platforms write the modifiers bindings are stored with. */
const APPLE_MODIFIERS: Readonly<Record<string, string>> = {
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Super: "⌘",
};

/**
 * A binding as a hint chip should print it.
 *
 * The stored form is what the matcher compares against, so the chip is derived
 * from it rather than written beside it: a rebound key changes the hint at the
 * same moment it changes what the window answers to, and the corner of a search
 * box can never advertise a combination that does nothing.
 */
export function shortcutLabel(binding: string): string {
  if (!binding) return "";
  const parts = binding.split("+");
  return isApple ? parts.map((part) => APPLE_MODIFIERS[part] ?? part).join("") : parts.join("+");
}

/**
 * The bindings as they stand, kept current while the client runs.
 *
 * Re-reading on the Shortcuts page's event, rather than only at mount, is what
 * stops a rebind from taking effect at the next launch instead of at the next
 * keypress. Loading is allowed to fail - the store is a Tauri plugin, and the
 * defaults are a working keymap - so a failure leaves the shortcuts on their
 * defaults instead of leaving the window with none.
 */
export function useShortcutBindings(): ShortcutBindings {
  const [bindings, setBindings] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);

  useEffect(() => {
    let active = true;
    const reload = () =>
      void loadShortcuts()
        .then((loaded) => {
          if (active) setBindings(loaded);
        })
        .catch(() => undefined);
    reload();
    globalThis.addEventListener("shortcuts-changed", reload);
    return () => {
      active = false;
      globalThis.removeEventListener("shortcuts-changed", reload);
    };
  }, []);

  return bindings;
}

/**
 * Bind the in-app shortcuts to Nebula's actions.
 *
 * Returns the bindings so the chrome can print the key it actually answers to.
 */
export function useNebulaShortcuts(handlers: InAppShortcutHandlers): ShortcutBindings {
  const bindings = useShortcutBindings();
  useInAppShortcuts(bindings, handlers);
  return bindings;
}
