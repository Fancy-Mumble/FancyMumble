import { useEffect, useCallback } from "react";
import type { ShortcutBindings } from "../pages/settings/shortcutHelpers";

export interface InAppShortcutHandlers {
  onToggleActivationMode?: () => void;
  onMoveChannelUp?: () => void;
  onMoveChannelDown?: () => void;
  onJumpToRootChannel?: () => void;
  onToggleChannelSidebar?: () => void;
  onToggleMemberPanel?: () => void;
  onOpenQuickSearch?: () => void;
  onOpenQuickSwitcher?: () => void;
  onOpenSettings?: () => void;
  onToggleFullscreen?: () => void;
  onToggleDevOverlay?: () => void;
}

function shortcutMatchesEvent(
  shortcut: string,
  e: KeyboardEvent,
): boolean {
  if (!shortcut) return false;
  const parts = shortcut.split("+");
  const modifiers = new Set(parts.slice(0, -1));
  const key = parts[parts.length - 1];

  if (modifiers.has("Ctrl") !== e.ctrlKey) return false;
  if (modifiers.has("Alt") !== e.altKey) return false;
  if (modifiers.has("Shift") !== e.shiftKey) return false;
  if (modifiers.has("Super") !== e.metaKey) return false;

  const eventKey = e.key;
  if (key === eventKey) return true;
  if (key.length === 1 && key.toLowerCase() === eventKey.toLowerCase()) return true;
  return false;
}

/** Attach a global keydown listener for all in-app shortcuts.
 *
 *  In-app shortcuts only fire when the window is focused (the browser
 *  handles that naturally).  Global (OS-level) shortcuts are registered
 *  separately via tauri-plugin-global-shortcut in shortcutHelpers.ts.
 */
export function useInAppShortcuts(
  shortcuts: ShortcutBindings,
  handlers: InAppShortcutHandlers,
): void {
  const {
    onToggleActivationMode,
    onMoveChannelUp,
    onMoveChannelDown,
    onJumpToRootChannel,
    onToggleChannelSidebar,
    onToggleMemberPanel,
    onOpenQuickSearch,
    onOpenQuickSwitcher,
    onOpenSettings,
    onToggleFullscreen,
    onToggleDevOverlay,
  } = handlers;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isComposer =
        target.tagName === "TEXTAREA" ||
        (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "checkbox") ||
        target.isContentEditable;

      const match = (shortcut: string, handler?: () => void): boolean => {
        if (handler && shortcutMatchesEvent(shortcut, e)) {
          e.preventDefault();
          handler();
          return true;
        }
        return false;
      };

      // These shortcuts must intercept even when a text composer has focus so
      // that WebView's built-in Ctrl+F find-bar and Ctrl+Shift+F are suppressed.
      if (match(shortcuts.openQuickSearch, onOpenQuickSearch)) return;
      if (match(shortcuts.openQuickSwitcher, onOpenQuickSwitcher)) return;

      if (isComposer) return;

      if (match(shortcuts.toggleActivationMode, onToggleActivationMode)) return;
      if (match(shortcuts.moveChannelUp, onMoveChannelUp)) return;
      if (match(shortcuts.moveChannelDown, onMoveChannelDown)) return;
      if (match(shortcuts.jumpToRootChannel, onJumpToRootChannel)) return;
      if (match(shortcuts.toggleChannelSidebar, onToggleChannelSidebar)) return;
      if (match(shortcuts.toggleMemberPanel, onToggleMemberPanel)) return;
      if (match(shortcuts.openSettings, onOpenSettings)) return;
      if (match(shortcuts.toggleFullscreen, onToggleFullscreen)) return;
      if (match(shortcuts.toggleDevOverlay, onToggleDevOverlay)) return;
    },
    [
      shortcuts,
      onToggleActivationMode,
      onMoveChannelUp,
      onMoveChannelDown,
      onJumpToRootChannel,
      onToggleChannelSidebar,
      onToggleMemberPanel,
      onOpenQuickSearch,
      onOpenQuickSwitcher,
      onOpenSettings,
      onToggleFullscreen,
      onToggleDevOverlay,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [handleKeyDown]);
}
