import { useTranslation } from "react-i18next";
import CN from "country-flag-icons/react/3x2/CN";
import DE from "country-flag-icons/react/3x2/DE";
import FR from "country-flag-icons/react/3x2/FR";
import GB from "country-flag-icons/react/3x2/GB";
import { BUILT_IN_LANGUAGES, type BuiltInLanguage } from "@core/i18n";
import { Button } from "../../primitives";
import styles from "./Localization.module.css";

/**
 * Always the language's own name, never a translation of it: someone who has
 * landed in a language they cannot read needs to find their own by sight.
 */
const NATIVE_NAMES: Record<BuiltInLanguage, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  zh: "中文",
};

/** Where several regions share a language, the flag is its origin country. */
const FLAGS: Record<BuiltInLanguage, typeof GB> = { en: GB, de: DE, fr: FR, zh: CN };

/** Picks the UI language, applied immediately. */
export default function LanguagePicker() {
  const { i18n } = useTranslation("settings");
  const current = (i18n.resolvedLanguage ?? "en") as BuiltInLanguage;

  return (
    <div className={styles.group}>
      <strong className={styles.groupTitle}>Language</strong>
      <small className={styles.groupHint}>The language used throughout the client.</small>
      <div className={styles.languages}>
        {BUILT_IN_LANGUAGES.map((language) => {
          const Flag = FLAGS[language];
          return (
            <Button
              key={language}
              variant="bare"
              wrapLabel={false}
              className={`${styles.language} ${language === current ? styles.languageSelected : ""}`}
              aria-pressed={language === current}
              onClick={() => void i18n.changeLanguage(language)}
            >
              <Flag className={styles.flag} title={NATIVE_NAMES[language]} />
              <span>{NATIVE_NAMES[language]}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
