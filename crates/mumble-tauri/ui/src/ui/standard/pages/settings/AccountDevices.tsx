/**
 * The account's devices, for the Standard Account panel: where it is signed
 * in, which are online, and a way to rename or sign out each of them.
 *
 * Renaming needs no password - it takes nothing away. Signing out does, like
 * every other change here that could lock the owner out.
 */

import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  MAX_DEVICE_NAME,
  deviceStatus,
  orderedDevices,
  useDeviceEditor,
  type DeviceStatus,
} from "@core/features/settings/accountDevices";
import { ACCOUNT_ACTION_IDS, type AccountAction, type AccountSettings } from "@core/types";
import { DEVICE_ID_ATTR, TID } from "@core/testids";
import styles from "./SettingsPage.module.css";

export function AccountDevices({
  snapshot,
  busy,
  blocked,
  lastSuccessAction,
  send,
  feedbackFor,
}: Readonly<{
  snapshot: AccountSettings;
  busy: boolean;
  /** Busy, or a password is needed and not typed yet. */
  blocked: boolean;
  lastSuccessAction: number | null;
  send: (action: AccountAction, value: string | undefined, device: { id: string }) => void;
  feedbackFor: (action: AccountAction) => ReactNode;
}>) {
  const { t } = useTranslation("settings");
  const editor = useDeviceEditor();
  const { cancel } = editor;

  // Close whatever was open once its action has actually landed.
  useEffect(() => {
    if (
      lastSuccessAction === ACCOUNT_ACTION_IDS.rename_device ||
      lastSuccessAction === ACCOUNT_ACTION_IDS.remove_device
    ) {
      cancel();
    }
  }, [lastSuccessAction, cancel]);

  const devices = orderedDevices(snapshot);
  const statusText = (status: DeviceStatus): string => {
    switch (status.key) {
      case "thisDevice":
        return t("account.devices.thisDevice");
      case "online":
        return t("account.devices.online");
      case "neverSeen":
        return t("account.devices.neverSeen");
      case "lastSeen":
        return t("account.devices.lastSeen", { when: status.when ?? "" });
    }
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("account.devices.title")}</h3>
      <p className={styles.fieldHint}>{t("account.devices.hint")}</p>
      {snapshot.devices_locked && <p className={styles.fieldHint}>{t("account.devices.locked")}</p>}
      {devices.length === 0 ? (
        <p className={styles.fieldHint}>{t("account.devices.empty")}</p>
      ) : (
        <div data-testid={TID.accountDevices}>
          {devices.map((device) => {
            const status = deviceStatus(device, snapshot.this_device);
            const own = status.key === "thisDevice";
            return (
              <div
                key={device.id}
                className={styles.field}
                data-testid={TID.accountDevice}
                {...{ [DEVICE_ID_ATTR]: device.id }}
              >
                <div className={styles.fieldRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label className={styles.fieldLabel}>{device.name || t("account.devices.unnamed")}</label>
                    <p className={styles.fieldHint}>{statusText(status)}</p>
                  </div>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    data-testid={TID.accountDeviceRename}
                    disabled={busy}
                    onClick={() => editor.startRename(device)}
                  >
                    {t("account.devices.rename")}
                  </button>
                  {!own && (
                    <button
                      type="button"
                      className={styles.dangerBtn}
                      data-testid={TID.accountDeviceSignOut}
                      disabled={busy}
                      onClick={() => editor.startSignOut(device)}
                    >
                      {t("account.devices.signOut")}
                    </button>
                  )}
                </div>

                {editor.renaming === device.id && (
                  <div className={styles.fieldRow}>
                    <input
                      className={styles.input}
                      type="text"
                      aria-label={t("account.devices.rename")}
                      data-testid={TID.accountDeviceNameInput}
                      value={editor.draft}
                      onChange={(e) => editor.setDraft(e.target.value.slice(0, MAX_DEVICE_NAME))}
                    />
                    <button type="button" className={styles.ghostBtn} onClick={editor.cancel}>
                      {t("account.devices.cancel")}
                    </button>
                    <button
                      type="button"
                      className={styles.applyBtn}
                      data-testid={TID.accountDeviceNameSave}
                      disabled={busy || !editor.draft.trim() || editor.draft.trim() === device.name}
                      onClick={() => send("rename_device", editor.draft.trim(), { id: device.id })}
                    >
                      {t("account.devices.save")}
                    </button>
                  </div>
                )}

                {editor.signingOut === device.id && (
                  <div className={styles.confirmBox}>
                    <p className={styles.confirmText}>
                      {t("account.devices.signOutConfirm", { name: device.name })}
                    </p>
                    <p className={styles.fieldHint}>
                      {snapshot.has_password
                        ? t("account.devices.signOutPasswordPara")
                        : t("account.devices.signOutPara")}
                    </p>
                    <div className={styles.confirmBtns}>
                      <button type="button" className={styles.ghostBtn} onClick={editor.cancel}>
                        {t("account.devices.cancel")}
                      </button>
                      <button
                        type="button"
                        className={styles.dangerBtn}
                        data-testid={TID.accountDeviceSignOutConfirm}
                        disabled={blocked}
                        onClick={() => send("remove_device", undefined, { id: device.id })}
                      >
                        {t("account.devices.signOut")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {feedbackFor("rename_device")}
      {feedbackFor("remove_device")}
    </section>
  );
}
