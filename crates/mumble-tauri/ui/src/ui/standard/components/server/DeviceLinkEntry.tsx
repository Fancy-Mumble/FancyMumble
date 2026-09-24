/**
 * "Link from another device", for the Standard connect page: paste the link
 * a signed-in device shows under Account → Devices, and this one signs in as
 * the same account.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { followDeviceLink, isDeviceLink } from "@core/features/devices/deviceLink";
import { TID } from "@core/testids";
import styles from "../../pages/ConnectPage.module.css";

export function DeviceLinkEntry() {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className={styles.buttonGhost} onClick={() => setOpen(true)}>
        {t("account.devices.link.followTitle")}
      </button>
    );
  }

  const follow = async () => {
    setBusy(true);
    setError(null);
    try {
      await followDeviceLink(link.trim());
    } catch (e) {
      setError(t("account.devices.link.followFailed", { reason: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p>{t("account.devices.link.followHint")}</p>
      <input
        className={styles.input}
        type="text"
        value={link}
        placeholder={t("account.devices.link.followPlaceholder")}
        aria-label={t("account.devices.link.followTitle")}
        data-testid={TID.connectDeviceLinkInput}
        onChange={(e) => setLink(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className={styles.button}
        data-testid={TID.connectDeviceLinkSubmit}
        disabled={busy || !isDeviceLink(link)}
        onClick={() => void follow()}
      >
        {busy ? t("account.devices.link.following") : t("account.devices.link.follow")}
      </button>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
