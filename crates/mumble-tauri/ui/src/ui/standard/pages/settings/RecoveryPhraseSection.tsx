/**
 * The recovery phrase of an identity, for the Standard Identities panel: the
 * 24 words that bring its encrypted conversations back on a new install, and
 * the box to type them into there.
 */

import { useTranslation } from "react-i18next";
import { useRecoveryPhrase } from "@core/features/identity/useRecoveryPhrase";
import { TID } from "@core/testids";
import styles from "./SettingsPage.module.css";

export function RecoveryPhraseSection({
  identities,
  preferred,
}: Readonly<{ identities: readonly string[]; preferred: string | null }>) {
  const { t } = useTranslation("settings");
  const recovery = useRecoveryPhrase(identities, preferred);
  if (identities.length === 0) return null;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("identities.recovery.title")}</h3>
      <p className={styles.fieldHint}>{t("identities.recovery.hint")}</p>
      {identities.length > 1 && (
        <div className={styles.field}>
          <label className={styles.fieldLabel}>{t("identities.recovery.identity")}</label>
          <select
            className={styles.select}
            value={recovery.label}
            onChange={(e) => recovery.choose(e.target.value)}
          >
            {identities.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {recovery.phrase ? (
        <div className={styles.enrolCard} data-testid={TID.recoveryPhrase}>
          <div className={styles.warningBanner}>
            <span>{t("identities.recovery.warning")}</span>
          </div>
          <ol style={{ columns: 3, fontFamily: "monospace" }}>
            {recovery.phrase.split(" ").map((word, index) => (
              <li key={index}>{word}</li>
            ))}
          </ol>
          <button type="button" className={styles.ghostBtn} onClick={recovery.hide}>
            {t("identities.recovery.hide")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.ghostBtn}
          data-testid={TID.recoveryPhraseShow}
          onClick={() => void recovery.show()}
        >
          {t("identities.recovery.show")}
        </button>
      )}

      <div className={styles.field}>
        <label className={styles.fieldLabel}>{t("identities.recovery.restoreTitle")}</label>
        <p className={styles.fieldHint}>{t("identities.recovery.restoreHint")}</p>
        <textarea
          className={styles.input}
          rows={3}
          value={recovery.draft}
          placeholder={t("identities.recovery.restorePlaceholder")}
          aria-label={t("identities.recovery.restoreTitle")}
          data-testid={TID.recoveryPhraseInput}
          onChange={(e) => recovery.setDraft(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className={styles.fieldRow}>
          <button
            type="button"
            className={styles.dangerBtn}
            data-testid={TID.recoveryPhraseRestore}
            disabled={recovery.wordCount !== 24}
            onClick={() => void recovery.restore()}
          >
            {t("identities.recovery.restore")}
          </button>
          <span className={styles.fieldHint}>
            {t("identities.recovery.words", { count: recovery.wordCount })}
          </span>
        </div>
      </div>
      {recovery.restored && <p className={styles.fieldHint}>{t("identities.recovery.restored")}</p>}
      {recovery.error && <p className={styles.error}>{recovery.error}</p>}
    </section>
  );
}
