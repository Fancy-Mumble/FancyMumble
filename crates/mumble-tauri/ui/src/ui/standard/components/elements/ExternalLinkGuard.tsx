import { WarningIcon } from "../../icons";
/**
 * ExternalLinkGuard
 *
 * Wraps any content that may contain sanitized bio HTML with external links
 * (marked data-external="true" by bioSanitize).  Click events on those links
 * are intercepted and a warning dialog is shown before the browser is asked to
 * open the URL.
 *
 * Usage:
 *   <ExternalLinkGuard className={styles.bioContent}>
 *     <div dangerouslySetInnerHTML={{ __html: cleanBio }} />
 *   </ExternalLinkGuard>
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useExternalLinkGuard } from "@core/features/elements/useExternalLinkGuard";
import styles from "./ExternalLinkGuard.module.css";

// --- Warning dialog -----------------------------------------------

interface DialogProps {
  url: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ExternalLinkDialog({ url, onConfirm, onCancel }: Readonly<DialogProps>) {
  const { t } = useTranslation("common");
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Open as a modal and attach backdrop-click + Escape handling via native
  // DOM listeners so no JSX event props are needed on the dialog element.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.showModal();

    // Dismiss when the user clicks the backdrop (coords outside dialog box).
    const handleClick = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        onCancel();
      }
    };

    // Dismiss on the native Escape key (dialog fires a "cancel" event).
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };

    el.addEventListener("click", handleClick);
    el.addEventListener("cancel", handleCancel);
    return () => {
      el.removeEventListener("click", handleClick);
      el.removeEventListener("cancel", handleCancel);
    };
  }, [onCancel]);

  // Safely display the URL without trusting it.
  const displayUrl = (() => {
    try {
      const parsed = new URL(url);
      const full = parsed.hostname + parsed.pathname + parsed.search;
      return full.length > 60 ? full.slice(0, 57) + "..." : full;
    } catch {
      return url.length > 60 ? url.slice(0, 57) + "..." : url;
    }
  })();

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="ext-link-title">
      {/* Icon */}
      <div className={styles.iconRow}>
        <WarningIcon className={styles.warningIcon} aria-hidden="true" />
      </div>

      <h2 id="ext-link-title" className={styles.title}>
        {t("externalLinkGuard.title")}
      </h2>

      <p className={styles.body}>{t("externalLinkGuard.body")}</p>

      <div className={styles.urlBox} title={url}>
        {displayUrl}
      </div>

      <p className={styles.disclaimer}>{t("externalLinkGuard.disclaimer")}</p>

      <div className={styles.actions}>
        <button className={styles.cancelBtn} onClick={onCancel}>
          {t("externalLinkGuard.cancelBtn")}
        </button>
        <button className={styles.openBtn} onClick={onConfirm}>
          {t("externalLinkGuard.openBtn")}
        </button>
      </div>
    </dialog>
  );
}

// --- Guard wrapper ------------------------------------------------

interface GuardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Intercepts clicks on anchors tagged with data-external="true" inside its
 * subtree and shows a confirmation dialog before opening the URL.
 *
 * The interception, the trusted-host list and the handoff to the browser are
 * `useExternalLinkGuard`'s, shared with the other packs; what stays here is the
 * dialog, which is this design's. Standard draws no "trust this host" tick -
 * that affordance is Nebula's - but it honours a host trusted there rather than
 * asking a second time about a decision the user has already made.
 */
export function ExternalLinkGuard({ children, className, style }: Readonly<GuardProps>) {
  const { containerRef, pendingUrl, confirm, cancel } = useExternalLinkGuard();

  return (
    <>
      <div ref={containerRef} className={className} style={style}>
        {children}
      </div>
      {pendingUrl && <ExternalLinkDialog url={pendingUrl} onConfirm={confirm} onCancel={cancel} />}
    </>
  );
}
