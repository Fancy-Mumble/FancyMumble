import { ChevronLeftIcon } from "../../icons";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./TabbedPage.module.css";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

interface TabbedPageProps<T extends string> {
  heading: string;
  tabs: readonly TabDef<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  onBack: () => void;
  /** Extra CSS class applied to the scrollable content area (e.g. grid
   *  layout for a preview pane). */
  mainAreaClassName?: string;
  /** Optional content rendered in the sidebar between the heading and the tab
   *  list (e.g. a settings search box). */
  sidebarExtra?: ReactNode;
  /**
   * Optional non-scrolling bar pinned to the bottom of the main area (e.g.
   * wizard step navigation, a persistent save bar). Unlike `position:
   * sticky`, this stays at the bottom of the panel even when `children`
   * don't fill the viewport - it's a fixed flex row below the scrollable
   * content, not a scroll-dependent offset.
   */
  footer?: ReactNode;
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
  sidebarExtra,
  footer,
  children,
}: Readonly<TabbedPageProps<T>>) {
  const { t } = useTranslation("common");
  const scrollCls = mainAreaClassName ? `${styles.mainScroll} ${mainAreaClassName}` : styles.mainScroll;

  return (
    <div className={styles.page}>
      <nav className={styles.sidebar}>
        <button className={styles.backBtn} onClick={onBack} aria-label={t("tabbedPage.backAriaLabel")}>
          {BackIcon}
          <span>{t("tabbedPage.back")}</span>
        </button>

        <h2 className={styles.sidebarHeading}>{heading}</h2>

        {sidebarExtra}

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

      <div className={styles.mainArea}>
        <div className={scrollCls}>{children}</div>
        {footer && <div className={styles.mainFooter}>{footer}</div>}
      </div>
    </div>
  );
}
