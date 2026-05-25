import { CloseIcon } from "../../icons";
import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { KeyTrustLevel, KeyFingerprints, PersistenceMode } from "../../types";
import styles from "./KeyVerificationDialog.module.css";

type FingerprintTab = "emoji" | "words" | "hex";

interface KeyVerificationDialogProps {
  readonly channelId: number;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onVerify: () => Promise<void>;
  readonly trustLevel: KeyTrustLevel;
  readonly channelName: string;
  readonly mode: PersistenceMode;
  readonly distributorName: string;
  readonly distributorHash: string;
}

function trustStatusClass(level: KeyTrustLevel): string {
  switch (level) {
    case "ManuallyVerified":
    case "Verified":
      return styles.trustVerified;
    case "Unverified":
      return styles.trustUnverified;
    case "Disputed":
      return styles.trustDisputed;
  }
}

function trustStatusText(level: KeyTrustLevel, t: (key: string) => string): string {
  switch (level) {
    case "ManuallyVerified": return t("keyVerification.trustManuallyVerified");
    case "Verified": return t("keyVerification.trustVerified");
    case "Unverified": return t("keyVerification.trustUnverified");
    case "Disputed": return t("keyVerification.trustDisputed");
  }
}

const SHORT_COUNT = 8;

function FingerprintDisplay({
  fingerprints,
  tab,
  showFull,
  onShowFull,
}: Readonly<{
  fingerprints: KeyFingerprints | null;
  tab: FingerprintTab;
  showFull: boolean;
  onShowFull: () => void;
}>) {
  const { t } = useTranslation(["sidebar", "common"]);
  if (!fingerprints) {
    return (
      <div className={styles.fingerprint}>
        <span>{t("keyVerification.loadingFingerprint")}</span>
      </div>
    );
  }

  return (
    <div className={styles.fingerprint}>
      {tab === "emoji" && (
        <div className={styles.emojiFingerprint}>
          {(showFull ? fingerprints.emoji : fingerprints.emoji.slice(0, SHORT_COUNT)).join(" ")}
        </div>
      )}
      {tab === "words" && (
        <div className={styles.wordFingerprint}>
          {(showFull ? fingerprints.words : fingerprints.words.slice(0, SHORT_COUNT)).join(" ")}
        </div>
      )}
      {tab === "hex" && (
        <div className={styles.hexFingerprint}>
          {fingerprints.hex}
        </div>
      )}
      {!showFull && tab !== "hex" && (
        <button className={styles.showFullBtn} onClick={onShowFull}>
          {t("keyVerification.showFullFingerprint")}
        </button>
      )}
    </div>
  );
}

export default function KeyVerificationDialog({
  channelId,
  open,
  onClose,
  onVerify,
  trustLevel,
  channelName,
  mode,
  distributorName,
  distributorHash,
}: KeyVerificationDialogProps) {
  const { t } = useTranslation(["sidebar", "common"]);
  const tStr = t as (key: string) => string;
  const [tab, setTab] = useState<FingerprintTab>("emoji");
  const [showFull, setShowFull] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [fingerprints, setFingerprints] = useState<KeyFingerprints | null>(null);

  // Fetch fingerprints when dialog opens.
  useEffect(() => {
    if (!open) {
      setFingerprints(null);
      setShowFull(false);
      setConfirmed(false);
      return;
    }
    invoke<KeyFingerprints>("get_key_fingerprints", { channelId, full: false })
      .then(setFingerprints)
      .catch((e) => console.error("get_key_fingerprints error:", e));
  }, [open, channelId]);

  const handleShowFull = useCallback(() => {
    invoke<KeyFingerprints>("get_key_fingerprints", { channelId, full: true })
      .then((fp) => {
        setFingerprints(fp);
        setShowFull(true);
      })
      .catch((e) => console.error("get_key_fingerprints full error:", e));
  }, [channelId]);

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    try {
      await onVerify();
      onClose();
    } finally {
      setVerifying(false);
    }
  }, [onVerify, onClose]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const needsVerification = trustLevel === "Unverified" || trustLevel === "Disputed";

  return (
    <dialog className={styles.overlay} open aria-label={t("keyVerification.ariaLabel")}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h3 className={styles.title}>{t("keyVerification.title")}</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t("common:actions.close")}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>{t("keyVerification.channelLabel")}</span>
            <span>#{channelName}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>{t("keyVerification.modeLabel")}</span>
            <span>{mode}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>{t("keyVerification.distributorLabel")}</span>
            <span>{distributorName} ({distributorHash.slice(0, 8)}...)</span>
          </div>

          {/* Fingerprint tabs */}
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === "emoji" ? styles.tabActive : ""}`}
              onClick={() => setTab("emoji")}
            >{t("keyVerification.tabEmoji")}</button>
            <button
              className={`${styles.tab} ${tab === "words" ? styles.tabActive : ""}`}
              onClick={() => setTab("words")}
            >{t("keyVerification.tabWords")}</button>
            <button
              className={`${styles.tab} ${tab === "hex" ? styles.tabActive : ""}`}
              onClick={() => setTab("hex")}
            >{t("keyVerification.tabHex")}</button>
          </div>

          <FingerprintDisplay
            fingerprints={fingerprints}
            tab={tab}
            showFull={showFull}
            onShowFull={handleShowFull}
          />

          <p className={styles.instructions}>
            {t("keyVerification.instructions")}
          </p>

          {/* Current trust status */}
          <div className={`${styles.trustStatus} ${trustStatusClass(trustLevel)}`}>
            {t("keyVerification.currentTrust", { status: trustStatusText(trustLevel, tStr) })}
          </div>
        </div>

        {/* Verify footer */}
        <div className={styles.footer}>
          <input
            type="checkbox"
            id="verify-confirm"
            className={styles.checkbox}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <label htmlFor="verify-confirm" className={styles.checkboxLabel}>
            {t("keyVerification.confirmLabel")}
          </label>
          <button
            className={styles.verifyBtn}
            disabled={!confirmed || verifying || !needsVerification}
            onClick={handleVerify}
          >
            {verifying ? t("keyVerification.verifyingButton") : t("keyVerification.verifyButton")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
