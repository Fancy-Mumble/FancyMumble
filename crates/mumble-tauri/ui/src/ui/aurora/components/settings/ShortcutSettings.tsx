import { useEffect, useState, type KeyboardEvent } from "react";
import {
  DEFAULT_SHORTCUTS,
  applyChangedShortcut,
  eventToShortcut,
  loadShortcuts,
  saveShortcuts,
  type ShortcutBindings,
} from "@core/features/settings/shortcutHelpers";
import { Button, TextField } from "../primitives";
import styles from "./ShortcutSettings.module.css";

const LABELS: Record<keyof ShortcutBindings, { label: string; group: string }> = {
  pushToTalk: { label: "Push to talk", group: "Global voice" },
  toggleMute: { label: "Toggle mute", group: "Global voice" },
  toggleDeafen: { label: "Toggle deafen", group: "Global voice" },
  voicePriority: { label: "Priority voice", group: "Global voice" },
  toggleActivationMode: { label: "Toggle activation mode", group: "In-app voice" },
  moveChannelUp: { label: "Previous channel", group: "Navigation" },
  moveChannelDown: { label: "Next channel", group: "Navigation" },
  jumpToRootChannel: { label: "Jump to root channel", group: "Navigation" },
  toggleChannelSidebar: { label: "Toggle channel sidebar", group: "Navigation" },
  toggleMemberPanel: { label: "Toggle member panel", group: "Navigation" },
  openQuickSearch: { label: "Search messages", group: "Navigation" },
  openQuickSwitcher: { label: "Quick switcher", group: "Navigation" },
  openSettings: { label: "Open settings", group: "Window" },
  toggleFullscreen: { label: "Toggle fullscreen", group: "Window" },
  toggleDevOverlay: { label: "Developer tools", group: "Window" },
};

export default function ShortcutSettings() {
  const [bindings, setBindings] = useState<ShortcutBindings | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    void loadShortcuts().then(setBindings);
  }, []);

  const update = async (key: keyof ShortcutBindings, next: string) => {
    if (!bindings || bindings[key] === next) return;
    const previous = bindings[key];
    const updated = { ...bindings, [key]: next };
    setBindings(updated);
    try {
      await applyChangedShortcut(key, previous, next);
      await saveShortcuts(updated);
      globalThis.dispatchEvent(new CustomEvent("shortcuts-changed", { detail: updated }));
      setStatus(next ? `${LABELS[key].label} is now ${next}.` : `${LABELS[key].label} cleared.`);
    } catch (reason) {
      setBindings(bindings);
      setStatus(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const capture = (key: keyof ShortcutBindings, event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape") {
      void update(key, "");
      return;
    }
    const shortcut = eventToShortcut(event);
    if (shortcut) void update(key, shortcut);
  };
  const reset = async () => {
    if (!bindings) return;
    for (const key of Object.keys(bindings) as Array<keyof ShortcutBindings>)
      await applyChangedShortcut(key, bindings[key], DEFAULT_SHORTCUTS[key]);
    await saveShortcuts(DEFAULT_SHORTCUTS);
    setBindings(DEFAULT_SHORTCUTS);
    globalThis.dispatchEvent(new CustomEvent("shortcuts-changed", { detail: DEFAULT_SHORTCUTS }));
    setStatus("Default shortcuts restored.");
  };

  if (!bindings) return <div className={styles.loading}>Loading shortcuts…</div>;
  const groups = [...new Set(Object.values(LABELS).map((entry) => entry.group))];
  return (
    <div className={styles.root}>
      <header>
        <p>Focus a field and press the desired key combination. Backspace clears it.</p>
        <Button onClick={() => void reset()}>Restore defaults</Button>
      </header>
      {status && <div className={styles.status}>{status}</div>}
      {groups.map((group) => (
        <section key={group}>
          <h4>{group}</h4>
          <div className={styles.grid}>
            {(Object.keys(bindings) as Array<keyof ShortcutBindings>)
              .filter((key) => LABELS[key].group === group)
              .map((key) => (
                <div key={key} className={styles.row}>
                  <TextField
                    label={LABELS[key].label}
                    value={bindings[key]}
                    readOnly
                    placeholder="Not assigned"
                    onKeyDown={(event) => capture(key, event)}
                  />
                  <Button onClick={() => void update(key, "")} disabled={!bindings[key]}>
                    Clear
                  </Button>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
