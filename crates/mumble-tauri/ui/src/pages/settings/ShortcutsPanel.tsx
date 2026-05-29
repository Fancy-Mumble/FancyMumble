import { useTranslation } from "react-i18next";
import type { ShortcutBindings } from "./shortcutHelpers";
import { ShortcutRecorder } from "./SharedControls";
import UserShortcutsSection from "./UserShortcutsSection";
import styles from "./SettingsPage.module.css";
import panelStyles from "./ShortcutsPanel.module.css";

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
  const { t } = useTranslation("settings");

  return (
    <>
      <h2 className={styles.panelTitle}>{t("shortcuts.panelTitle")}</h2>
      <p
        className={styles.fieldHint}
        dangerouslySetInnerHTML={{ __html: t("shortcuts.globalHint") }}
      />

      <ShortcutGroup title={t("shortcuts.groupVoiceGlobal")}>
        <ShortcutRecorder
          label={t("shortcuts.pushToTalk")}
          value={shortcuts.pushToTalk}
          onChange={(v) => onChangeShortcut("pushToTalk", v)}
        />
        <ShortcutRecorder
          label={t("shortcuts.toggleMute")}
          value={shortcuts.toggleMute}
          onChange={(v) => onChangeShortcut("toggleMute", v)}
        />
        <ShortcutRecorder
          label={t("shortcuts.toggleDeafen")}
          value={shortcuts.toggleDeafen}
          onChange={(v) => onChangeShortcut("toggleDeafen", v)}
        />
        <ShortcutRecorder
          label={t("shortcuts.voicePriority")}
          value={shortcuts.voicePriority}
          onChange={(v) => onChangeShortcut("voicePriority", v)}
        />
      </ShortcutGroup>

      <ShortcutGroup title={t("shortcuts.groupVoiceApp")}>
        <ShortcutRecorder
          label={t("shortcuts.toggleActivationMode")}
          value={shortcuts.toggleActivationMode}
          onChange={(v) => onChangeShortcut("toggleActivationMode", v)}
        />
      </ShortcutGroup>

      <ShortcutGroup title={t("shortcuts.groupNavigation")}>
        <ShortcutRecorder
          label={t("shortcuts.moveChannelUp")}
          value={shortcuts.moveChannelUp}
          onChange={(v) => onChangeShortcut("moveChannelUp", v)}
        />
        <ShortcutRecorder
          label={t("shortcuts.moveChannelDown")}
          value={shortcuts.moveChannelDown}
          onChange={(v) => onChangeShortcut("moveChannelDown", v)}
        />
        <ShortcutRecorder
          label={t("shortcuts.jumpToRootChannel")}
          value={shortcuts.jumpToRootChannel}
          onChange={(v) => onChangeShortcut("jumpToRootChannel", v)}
        />
        <ShortcutRecorder
          label={t("shortcuts.toggleChannelSidebar")}
          value={shortcuts.toggleChannelSidebar}
          onChange={(v) => onChangeShortcut("toggleChannelSidebar", v)}
        />
        <ShortcutRecorder
          label={t("shortcuts.toggleMemberPanel")}
          value={shortcuts.toggleMemberPanel}
          onChange={(v) => onChangeShortcut("toggleMemberPanel", v)}
        />
        <ShortcutRecorder
          label={t("shortcuts.quickChannelSearch")}
          value={shortcuts.openQuickSearch}
          onChange={(v) => onChangeShortcut("openQuickSearch", v)}
        />
        <ShortcutRecorder
          label={t("shortcuts.openQuickSwitcher")}
          value={shortcuts.openQuickSwitcher}
          onChange={(v) => onChangeShortcut("openQuickSwitcher", v)}
        />
      </ShortcutGroup>

      <ShortcutGroup title={t("shortcuts.groupWindow")}>
        <ShortcutRecorder
          label={t("shortcuts.openSettings")}
          value={shortcuts.openSettings}
          onChange={(v) => onChangeShortcut("openSettings", v)}
        />
        <ShortcutRecorder
          label={t("shortcuts.toggleFullscreen")}
          value={shortcuts.toggleFullscreen}
          onChange={(v) => onChangeShortcut("toggleFullscreen", v)}
        />
        {isExpert && (
          <ShortcutRecorder
            label={t("shortcuts.toggleDevOverlay")}
            value={shortcuts.toggleDevOverlay}
            onChange={(v) => onChangeShortcut("toggleDevOverlay", v)}
          />
        )}
      </ShortcutGroup>

      <UserShortcutsSection />

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("shortcuts.builtinTitle")}</h3>
        <p className={styles.fieldHint}>{t("shortcuts.builtinHint")}</p>
        <table className={panelStyles.builtinTable}>
          <tbody>
            <tr><td>{t("shortcuts.builtinFocusComposer")}</td><td><kbd>Tab</kbd></td></tr>
            <tr><td>{t("shortcuts.builtinSendMessage")}</td><td><kbd>Enter</kbd></td></tr>
            <tr><td>{t("shortcuts.builtinNewLine")}</td><td><kbd>Shift+Enter</kbd></td></tr>
            <tr><td>{t("shortcuts.builtinEditLast")}</td><td><kbd>ArrowUp</kbd> {t("shortcuts.builtinEditLastHint")}</td></tr>
            <tr><td>{t("shortcuts.builtinBold")}</td><td><kbd>Ctrl+B</kbd></td></tr>
            <tr><td>{t("shortcuts.builtinItalic")}</td><td><kbd>Ctrl+I</kbd></td></tr>
            <tr><td>{t("shortcuts.builtinInlineCode")}</td><td><kbd>Ctrl+E</kbd></td></tr>
            <tr><td>{t("shortcuts.builtinEmojiPicker")}</td><td>Type <kbd>:</kbd> {t("shortcuts.builtinEmojiHint")}</td></tr>
            <tr><td>{t("shortcuts.builtinMentionPicker")}</td><td>Type <kbd>@</kbd> {t("shortcuts.builtinMentionHint")}</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}

