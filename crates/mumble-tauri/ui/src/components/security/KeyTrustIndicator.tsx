import { LockSvg, ShieldCheckSvg, WarningSvg } from "../../icons";
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { KeyTrustLevel } from "../../types";
import styles from "./KeyTrustIndicator.module.css";

interface KeyTrustIndicatorProps {
  readonly trustLevel: KeyTrustLevel;
  readonly onVerifyClick?: () => void;
}

function trustLabelKey(level: KeyTrustLevel): string {
  switch (level) {
    case "ManuallyVerified": return "keyTrust.labelVerified";
    case "Verified": return "keyTrust.labelVerified";
    case "Unverified": return "keyTrust.labelUnverified";
    case "Disputed": return "keyTrust.labelDisputed";
  }
}

function trustDescKey(level: KeyTrustLevel): string {
  switch (level) {
    case "ManuallyVerified": return "keyTrust.descManuallyVerified";
    case "Verified": return "keyTrust.descVerified";
    case "Unverified": return "keyTrust.descUnverified";
    case "Disputed": return "keyTrust.descDisputed";
  }
}

function trustColorClass(level: KeyTrustLevel): string {
  switch (level) {
    case "ManuallyVerified": return styles.manuallyVerified;
    case "Verified": return styles.verified;
    case "Unverified": return styles.unverified;
    case "Disputed": return styles.disputed;
  }
}

function ShieldCheckIcon() {
  return <ShieldCheckSvg className={styles.icon} aria-hidden="true" />;
}

function LockIcon() {
  return <LockSvg className={styles.icon} aria-hidden="true" />;
}

function WarningIcon() {
  return <WarningSvg className={styles.icon} aria-hidden="true" />;
}

function TrustIcon({ level }: Readonly<{ level: KeyTrustLevel }>) {
  switch (level) {
    case "ManuallyVerified": return <ShieldCheckIcon />;
    case "Verified": return <LockIcon />;
    case "Unverified": return <LockIcon />;
    case "Disputed": return <WarningIcon />;
  }
}

export default function KeyTrustIndicator({ trustLevel, onVerifyClick }: KeyTrustIndicatorProps) {
  const { t } = useTranslation("sidebar");
  const [showTooltip, setShowTooltip] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close tooltip on outside click.
  useEffect(() => {
    if (!showTooltip) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowTooltip(false);
      }
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [showTooltip]);

  const colorClass = trustColorClass(trustLevel);
  const tStr = t as (k: string) => string;

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={`${styles.indicator} ${colorClass}`}
        onClick={() => setShowTooltip((v) => !v)}
        aria-label={t("keyTrust.buttonAriaLabel", { label: tStr(trustLabelKey(trustLevel)) })}
        title={t("keyTrust.buttonAriaLabel", { label: tStr(trustLabelKey(trustLevel)) })}>
        <TrustIcon level={trustLevel} />
        <span className={styles.label}>{tStr(trustLabelKey(trustLevel))}</span>
      </button>

      {showTooltip && (
        <div className={styles.tooltip}>
          <div className={styles.tooltipTitle}>{t("keyTrust.tooltipTitle")}</div>
          <p>{tStr(trustDescKey(trustLevel))}</p>
          {(trustLevel === "Unverified" || trustLevel === "Disputed") && onVerifyClick && (
            <p>
              <button className={styles.tooltipAction} onClick={() => { setShowTooltip(false); onVerifyClick(); }}>
                {trustLevel === "Disputed" ? t("keyTrust.compareFingerprints") : t("keyTrust.verifyCustodian")}
              </button>
              {" "}{t("keyTrust.turnGreenSuffix")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
