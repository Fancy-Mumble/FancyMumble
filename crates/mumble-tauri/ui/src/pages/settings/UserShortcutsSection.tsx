import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { ShortcutRecorder } from "./SharedControls";
import {
  applyUserShortcut,
  clearUserShortcut,
  loadUserShortcuts,
  saveUserShortcuts,
  type UserShortcut,
} from "./userShortcuts";
import styles from "./SettingsPage.module.css";

function newId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `us-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Settings section that lets the user bind global hotkeys to specific
 *  users (identified by cert hash) for one-press jump-to-DM. */
export default function UserShortcutsSection() {
  const { t } = useTranslation(["settings", "common"]);
  const sessions = useAppStore((s) => s.sessions);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const users = useAppStore((s) => s.users);
  const ownSession = useAppStore((s) => s.ownSession);

  const [shortcuts, setShortcuts] = useState<UserShortcut[]>([]);
  const [picking, setPicking] = useState(false);
  const [pickSession, setPickSession] = useState<string>("");

  useEffect(() => {
    loadUserShortcuts().then(setShortcuts).catch(console.error);
  }, []);

  const activeSession = sessions.find((s) => s.id === activeServerId);
  const candidateUsers = useMemo(
    () => users
      .filter((u) => u.session !== ownSession)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users, ownSession],
  );

  const persist = useCallback(async (next: UserShortcut[]) => {
    setShortcuts(next);
    await saveUserShortcuts(next);
  }, []);

  const handleAddConfirm = useCallback(async () => {
    if (!pickSession) return;
    const target = candidateUsers.find((u) => String(u.session) === pickSession);
    if (!target) return;
    const entry: UserShortcut = {
      id: newId(),
      hotkey: "",
      userName: target.name,
      userHash: target.hash || undefined,
      serverId: activeServerId ?? undefined,
      serverLabel: activeSession?.label || activeSession?.host || undefined,
    };
    await persist([...shortcuts, entry]);
    setPicking(false);
    setPickSession("");
  }, [activeServerId, activeSession, pickSession, candidateUsers, shortcuts, persist]);

  const handleHotkeyChange = useCallback(async (id: string, hotkey: string) => {
    const prev = shortcuts.find((s) => s.id === id);
    if (!prev) return;
    if (prev.hotkey && prev.hotkey !== hotkey) {
      await clearUserShortcut(prev.hotkey);
    }
    const next = shortcuts.map((s) => (s.id === id ? { ...s, hotkey } : s));
    await persist(next);
    const updated = next.find((s) => s.id === id);
    if (updated?.hotkey) {
      await applyUserShortcut(updated);
    }
  }, [shortcuts, persist]);

  const handleRemove = useCallback(async (id: string) => {
    const target = shortcuts.find((s) => s.id === id);
    if (target?.hotkey) await clearUserShortcut(target.hotkey);
    await persist(shortcuts.filter((s) => s.id !== id));
  }, [shortcuts, persist]);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("userShortcuts.title")}</h3>
      <p className={styles.fieldHint}>{t("userShortcuts.hint")}</p>

      <div className={styles.shortcutList}>
        {shortcuts.length === 0 && (
          <p className={styles.fieldHint}>{t("userShortcuts.empty")}</p>
        )}
        {shortcuts.map((s) => {
          const scopeLabel = (() => {
            if (s.userHash) return t("userShortcuts.anyServer");
            if (s.serverLabel) return t("userShortcuts.serverScoped", { server: s.serverLabel });
            return t("userShortcuts.serverScopedUnknown");
          })();
          return (
          <div key={s.id} className={styles.userShortcutRow}>
            <div className={styles.userShortcutMeta}>
              <span className={styles.userShortcutName}>{s.userName}</span>
              <span className={styles.userShortcutServer}>{scopeLabel}</span>
            </div>
            <ShortcutRecorder
              label={t("userShortcuts.hotkeyLabel")}
              value={s.hotkey}
              onChange={(v) => void handleHotkeyChange(s.id, v)}
            />
            <button
              type="button"
              className={styles.userShortcutRemove}
              onClick={() => void handleRemove(s.id)}
              title={t("userShortcuts.remove")}
            >
              {t("userShortcuts.remove")}
            </button>
          </div>
          );
        })}
      </div>

      {picking ? (
        <div className={styles.userShortcutPicker}>
          <label className={styles.fieldLabel} htmlFor="user-shortcut-pick">
            {t("userShortcuts.pickUser")}
          </label>
          {!activeServerId && (
            <p className={styles.fieldHint}>{t("userShortcuts.noActiveServer")}</p>
          )}
          {activeServerId && candidateUsers.length === 0 && (
            <p className={styles.fieldHint}>{t("userShortcuts.noUsersOnline")}</p>
          )}
          <select
            id="user-shortcut-pick"
            className={styles.userShortcutSelect}
            value={pickSession}
            onChange={(e) => setPickSession(e.target.value)}
            disabled={!activeServerId || candidateUsers.length === 0}
          >
            <option value="">{t("userShortcuts.selectPrompt")}</option>
            {candidateUsers.map((u) => (
              <option key={u.session} value={String(u.session)}>
                {u.name}{u.hash ? "" : ` (${t("userShortcuts.noHashBadge")})`}
              </option>
            ))}
          </select>
          <p className={styles.fieldHint}>{t("userShortcuts.noHashExplain")}</p>
          <div className={styles.userShortcutPickActions}>
            <button
              type="button"
              className={styles.userShortcutCancel}
              onClick={() => { setPicking(false); setPickSession(""); }}
            >
              {t("common:actions.cancel")}
            </button>
            <button
              type="button"
              className={styles.userShortcutSave}
              onClick={() => void handleAddConfirm()}
              disabled={!pickSession}
            >
              {t("userShortcuts.add")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.userShortcutAdd}
          onClick={() => setPicking(true)}
        >
          {t("userShortcuts.addBtn")}
        </button>
      )}
    </section>
  );
}
