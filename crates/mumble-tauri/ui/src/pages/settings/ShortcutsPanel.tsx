import type { ShortcutBindings } from "./shortcutHelpers";
import { ShortcutRecorder } from "./SharedControls";
import styles from "./SettingsPage.module.css";

interface Props {
  shortcuts: ShortcutBindings;
  onChangeShortcut: (key: keyof ShortcutBindings, value: string) => void;
  isExpert?: boolean;
}

function ShortcutGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.shortcutList}>{children}</div>
    </section>
  );
}

export function ShortcutsPanel({ shortcuts, onChangeShortcut, isExpert }: Props) {
  return (
    <>
      <h2 className={styles.panelTitle}>Shortcuts</h2>
      <p className={styles.fieldHint}>
        Shortcuts marked <strong>global</strong> work even when the app is in
        the background. In-app shortcuts only fire while the window is focused.
      </p>

      <ShortcutGroup title="Voice — global">
        <ShortcutRecorder
          label="Push to talk"
          value={shortcuts.pushToTalk}
          onChange={(v) => onChangeShortcut("pushToTalk", v)}
        />
        <ShortcutRecorder
          label="Toggle mute"
          value={shortcuts.toggleMute}
          onChange={(v) => onChangeShortcut("toggleMute", v)}
        />
        <ShortcutRecorder
          label="Toggle deafen"
          value={shortcuts.toggleDeafen}
          onChange={(v) => onChangeShortcut("toggleDeafen", v)}
        />
        <ShortcutRecorder
          label="Voice priority (hold to override)"
          value={shortcuts.voicePriority}
          onChange={(v) => onChangeShortcut("voicePriority", v)}
        />
      </ShortcutGroup>

      <ShortcutGroup title="Voice — in-app">
        <ShortcutRecorder
          label="Toggle activation mode"
          value={shortcuts.toggleActivationMode}
          onChange={(v) => onChangeShortcut("toggleActivationMode", v)}
        />
      </ShortcutGroup>

      <ShortcutGroup title="Channel and navigation">
        <ShortcutRecorder
          label="Move to channel above"
          value={shortcuts.moveChannelUp}
          onChange={(v) => onChangeShortcut("moveChannelUp", v)}
        />
        <ShortcutRecorder
          label="Move to channel below"
          value={shortcuts.moveChannelDown}
          onChange={(v) => onChangeShortcut("moveChannelDown", v)}
        />
        <ShortcutRecorder
          label="Jump to root channel"
          value={shortcuts.jumpToRootChannel}
          onChange={(v) => onChangeShortcut("jumpToRootChannel", v)}
        />
        <ShortcutRecorder
          label="Toggle channel sidebar"
          value={shortcuts.toggleChannelSidebar}
          onChange={(v) => onChangeShortcut("toggleChannelSidebar", v)}
        />
        <ShortcutRecorder
          label="Toggle member panel"
          value={shortcuts.toggleMemberPanel}
          onChange={(v) => onChangeShortcut("toggleMemberPanel", v)}
        />
        <ShortcutRecorder
          label="Quick Channel Search"
          value={shortcuts.openQuickSearch}
          onChange={(v) => onChangeShortcut("openQuickSearch", v)}
        />
        <ShortcutRecorder
          label="Open Quick Switcher"
          value={shortcuts.openQuickSwitcher}
          onChange={(v) => onChangeShortcut("openQuickSwitcher", v)}
        />
      </ShortcutGroup>

      <ShortcutGroup title="Window">
        <ShortcutRecorder
          label="Open Settings"
          value={shortcuts.openSettings}
          onChange={(v) => onChangeShortcut("openSettings", v)}
        />
        <ShortcutRecorder
          label="Toggle fullscreen"
          value={shortcuts.toggleFullscreen}
          onChange={(v) => onChangeShortcut("toggleFullscreen", v)}
        />
        {isExpert && (
          <ShortcutRecorder
            label="Toggle developer overlay"
            value={shortcuts.toggleDevOverlay}
            onChange={(v) => onChangeShortcut("toggleDevOverlay", v)}
          />
        )}
      </ShortcutGroup>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Chat — built-in (not configurable)</h3>
        <p className={styles.fieldHint}>
          These shortcuts are always active inside the message composer.
        </p>
        <table className={styles.builtinTable}>
          <tbody>
            <tr><td>Focus composer</td><td><kbd>Tab</kbd></td></tr>
            <tr><td>Send message</td><td><kbd>Enter</kbd></td></tr>
            <tr><td>New line</td><td><kbd>Shift+Enter</kbd></td></tr>
            <tr><td>Edit last message</td><td><kbd>ArrowUp</kbd> (empty composer)</td></tr>
            <tr><td>Bold</td><td><kbd>Ctrl+B</kbd></td></tr>
            <tr><td>Italic</td><td><kbd>Ctrl+I</kbd></td></tr>
            <tr><td>Inline code</td><td><kbd>Ctrl+E</kbd></td></tr>
            <tr><td>Emoji picker</td><td>Type <kbd>:</kbd> then search</td></tr>
            <tr><td>Mention picker</td><td>Type <kbd>@</kbd> then search</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
