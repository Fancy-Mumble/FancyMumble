import { ChevronLeftIcon } from "../../icons";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./TabbedPage.module.css";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: string;
}

interface TabbedPageProps<T extends string> {
  heading: string;
  tabs: readonly TabDef<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  onBack: () => void;
  /** Extra CSS class applied to `.mainArea` (e.g. grid layout for preview pane). */
  mainAreaClassName?: string;
  children: ReactNode;
}

const BackIcon = <ChevronLeftIcon width={18} height={18} />;

export function TabbedPage<T extends string>({
  heading,
  tabs,
  activeTab,
  onTabChange,
  onBack,
  mainAreaClassName,
  children,
}: Readonly<TabbedPageProps<T>>) {
  const { t } = useTranslation("common");
  const mainCls = mainAreaClassName
    ? `${styles.mainArea} ${mainAreaClassName}`
    : styles.mainArea;

  return (
    <div className={styles.page}>
      <nav className={styles.sidebar}>
        <button
          className={styles.backBtn}
          onClick={onBack}
          aria-label={t("tabbedPage.backAriaLabel")}
        >
          {BackIcon}
          <span>{t("tabbedPage.back")}</span>
        </button>

        <h2 className={styles.sidebarHeading}>{heading}</h2>

        <ul className={styles.tabList}>
          {tabs.map((t) => (
            <li key={t.id}>
              <button
                className={`${styles.tabBtn} ${activeTab === t.id ? styles.tabBtnActive : ""}`}
                onClick={() => onTabChange(t.id)}
              >
                <span className={styles.tabIcon}>{t.icon}</span>
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className={mainCls}>
        {children}
      </div>
    </div>
  );
}
