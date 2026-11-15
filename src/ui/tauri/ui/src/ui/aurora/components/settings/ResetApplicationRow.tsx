import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@core/utils/store";
import { Button } from "../primitives";
import styles from "../../SettingsPanel.module.css";

const RESET_STORES = [
  "preferences.json",
  "servers.json",
  "shortcuts.json",
  "profile.json",
  "personalization.json",
];

export default function ResetApplicationRow() {
  const [confirm, setConfirm] = useState(false);
  const reset = async () => {
    for (const file of RESET_STORES) {
      try {
        const store = await load(file, { autoSave: false, defaults: {} });
        await store.clear();
        await store.save();
      } catch {
        /* optional stores may not exist */
      }
    }
    await invoke("reset_app_data");
    globalThis.location.replace("/");
  };
  return (
    <div className={styles.dangerZone}>
      <span>
        <strong>Reset application data</strong>
        <small>Remove saved servers, identities, preferences, shortcuts and cached profile data.</small>
      </span>
      {confirm ? (
        <>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => void reset()}>
            Confirm reset
          </Button>
        </>
      ) : (
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Reset…
        </Button>
      )}
    </div>
  );
}
