/**
 * WelcomeMessageModal - shows the server's welcome message as a modal right
 * after connecting, gated by the `welcomeMessageDisplay` preference
 * ("hide" / "once" / "always").  Mount once near the app root; it listens for
 * the `server-connected` signal emitted by the store on a completed join.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Modal } from "../elements/Modal";
import { SafeHtml } from "../elements/SafeHtml";
import {
  getPreferences,
  updatePreferences,
  hasShownWelcome,
  markWelcomeShown,
} from "@core/preferencesStorage";
import styles from "./WelcomeMessageModal.module.css";

/** Fetch the welcome text, retrying briefly since the ServerSync that carries
 *  it can land a beat after the "connected" transition. */
async function fetchWelcomeWithRetry(): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const txt = await invoke<string | null>("get_welcome_text").catch(() => null);
    if (txt && txt.trim()) return txt;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

export default function WelcomeMessageModal() {
  const { t } = useTranslation("server");
  const [html, setHtml] = useState<string | null>(null);
  // The opt-out is only meaningful when the message currently shows on every
  // connect ("always"): checking it downgrades to "show once".  When already
  // at "show once" the checkbox is hidden (there is nothing to opt out of).
  const [canSwitchToOnce, setCanSwitchToOnce] = useState(false);
  /** What to record once the reader has actually dismissed it. */
  const [shownFor, setShownFor] = useState<{ serverKey: string; text: string } | null>(null);
  const [switchToOnce, setSwitchToOnce] = useState(false);

  useEffect(() => {
    const onConnected = (e: Event) => {
      const serverKey = (e as CustomEvent<{ serverKey?: string }>).detail?.serverKey;
      void (async () => {
        const prefs = await getPreferences().catch(() => null);
        const mode = prefs?.welcomeMessageDisplay ?? "once";
        if (mode === "hide") return;
        // Fetched before the check, not after: whether this has been shown
        // is a question about the *text*, so there is nothing to ask until
        // the text is in hand.
        const text = await fetchWelcomeWithRetry();
        if (!text) return;
        if (mode === "once" && serverKey && (await hasShownWelcome(serverKey, text))) {
          return;
        }
        setCanSwitchToOnce(mode === "always");
        setSwitchToOnce(false);
        setShownFor(mode === "once" && serverKey ? { serverKey, text } : null);
        setHtml(text);
      })();
    };
    window.addEventListener("server-connected", onConnected);
    return () => window.removeEventListener("server-connected", onConnected);
  }, []);

  const close = useCallback(() => {
    if (switchToOnce) {
      void updatePreferences({ welcomeMessageDisplay: "once" });
    }
    // Recorded on dismissal rather than before the dialog renders. It used
    // to be marked on the way in, so a message the user never actually saw
    // - the window closed, the app quit, the connection dropped - counted
    // as read and was never shown again.
    if (shownFor) void markWelcomeShown(shownFor.serverKey, shownFor.text);
    setShownFor(null);
    setHtml(null);
  }, [switchToOnce, shownFor]);

  if (html == null) return null;

  return (
    <Modal onClose={close} zIndex={1100}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t("welcomeModal.title", { defaultValue: "Welcome" })}
      >
        <h2 className={styles.title}>{t("welcomeModal.title", { defaultValue: "Welcome" })}</h2>
        <div className={styles.body}>
          <SafeHtml html={html} className={styles.welcomeText} />
        </div>
        {canSwitchToOnce && (
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={switchToOnce}
              onChange={(e) => setSwitchToOnce(e.target.checked)}
            />
            <span>{t("welcomeModal.onlyShowOnce", { defaultValue: "Only show this once per server" })}</span>
          </label>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.closeBtn} onClick={close}>
            {t("welcomeModal.close", { defaultValue: "Close" })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
