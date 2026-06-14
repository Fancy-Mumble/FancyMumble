import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { friendlyPluginName, PLUGIN_NAME_LIVE_DOC } from "../../constants/pluginData";
import { getLiveDocLocalSave } from "../chat/livedoc/liveDocLocalSave";
import { Modal } from "./Modal";
import styles from "./PromptDialog.module.css";

/**
 * Singleton dialog shown when a server plugin the user is actively using is
 * disabled at runtime (see `recordPluginDisabled`).  Informs the user, offers
 * to save an open Live Document locally first, then tears the view down on
 * close.  Mount once near the app root.
 */
export default function PluginDisabledDialog() {
  const { t } = useTranslation("common");
  const notice = useAppStore((s) => s.pluginDisabledNotice);
  const dismiss = useAppStore((s) => s.dismissPluginDisabledNotice);
  const [saving, setSaving] = useState(false);

  if (!notice) return null;

  const friendly = friendlyPluginName(notice.name);
  const canSaveLiveDoc = notice.name === PLUGIN_NAME_LIVE_DOC && getLiveDocLocalSave() != null;

  const onSave = async () => {
    const save = getLiveDocLocalSave();
    if (!save) return;
    setSaving(true);
    try {
      await save();
    } catch (e) {
      console.warn("live-doc local save failed:", e);
    } finally {
      setSaving(false);
    }
    // Leave the dialog open after saving so the user explicitly confirms close.
  };

  return (
    <Modal onClose={dismiss} closeOnEsc={false} closeOnOverlayClick={!saving} zIndex={9999}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="plugin-disabled-title">
        <h3 id="plugin-disabled-title" className={styles.title}>
          {t("plugins.disabledTitle", { defaultValue: "{{name}} was disabled", name: friendly })}
        </h3>
        <p className={styles.label}>
          {t("plugins.disabledBody", {
            defaultValue: "The server disabled this plugin. Any open {{name}} views will be closed.",
            name: friendly,
          })}
        </p>
        <div className={styles.actions}>
          {canSaveLiveDoc && (
            <button className={styles.cancelBtn} onClick={() => void onSave()} disabled={saving}>
              {saving
                ? t("plugins.disabledSaving", { defaultValue: "Saving…" })
                : t("plugins.disabledSave", { defaultValue: "Save a local copy" })}
            </button>
          )}
          <button className={styles.confirmBtn} onClick={dismiss} disabled={saving}>
            {t("plugins.disabledClose", { defaultValue: "Close" })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
