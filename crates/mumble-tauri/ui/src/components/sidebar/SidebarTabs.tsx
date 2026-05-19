import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getPreferences, updatePreferences } from "../../preferencesStorage";
import styles from "./ChannelSidebar.module.css";

export type SidebarTabKey = "channels" | "members";

interface SidebarTabsProps {
  /** Channels pane element.  Always mounted. */
  readonly channelsPane: ReactNode;
  /**
   * Members pane element.  Lazily passed: the parent should provide
   * `null` until the user first opens the Members tab so we don't pay
   * the mount cost upfront.  Once non-null it should remain so for the
   * lifetime of the sidebar.
   */
  readonly membersPane: ReactNode | null;
  /**
   * Callback fired the first time the user activates the Members tab.
   * Lets the parent flip a flag so it starts rendering `membersPane`.
   */
  readonly onMembersFirstShown: () => void;
}

/**
 * Owns sidebar tab state in isolation from the much larger
 * `ChannelSidebar` parent.  A tab click only re-renders this small
 * component, leaving the parent's 25+ store subscriptions, useMemos
 * and JSX construction untouched.  Inactive panes stay mounted via
 * CSS `display: none` so subsequent switches are pure style toggles
 * with no React reconciliation in the heavy subtrees.
 */
export function SidebarTabs({ channelsPane, membersPane, onMembersFirstShown }: SidebarTabsProps) {
  const [activeTab, setActiveTab] = useState<SidebarTabKey>("channels");
  const persistTimer = useRef<number | null>(null);
  const membersOpenedRef = useRef(false);
  const { t } = useTranslation("sidebar");

  // Restore the persisted active tab on mount.
  useEffect(() => {
    let cancelled = false;
    getPreferences().then((prefs) => {
      if (cancelled) return;
      const tab = prefs.sidebarActiveTab;
      if (tab && tab !== "channels") {
        setActiveTab(tab);
        if (tab === "members" && !membersOpenedRef.current) {
          membersOpenedRef.current = true;
          onMembersFirstShown();
        }
      }
    });
    return () => { cancelled = true; };
  }, [onMembersFirstShown]);

  useEffect(() => () => {
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
  }, []);

  const handleClick = useCallback((tab: SidebarTabKey) => {
    setActiveTab(tab);
    if (tab === "members" && !membersOpenedRef.current) {
      membersOpenedRef.current = true;
      onMembersFirstShown();
    }
    // Debounce the disk write so a rapid back-and-forth tab click
    // doesn't stack synchronous Tauri-IPC + JSON-serialise + disk
    // writes on top of the React state update.
    if (persistTimer.current !== null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      updatePreferences({ sidebarActiveTab: tab }).catch(() => {});
    }, 600);
  }, [onMembersFirstShown]);

  const channelsActive = activeTab === "channels";
  const membersActive = activeTab === "members";

  return (
    <>
      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={channelsActive}
          className={`${styles.tab} ${channelsActive ? styles.tabActive : ""}`}
          onClick={() => handleClick("channels")}
        >
          {t("sidebarTabs.channels")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={membersActive}
          className={`${styles.tab} ${membersActive ? styles.tabActive : ""}`}
          onClick={() => handleClick("members")}
        >
          {t("sidebarTabs.members")}
        </button>
      </div>

      <div className={channelsActive ? styles.tabPane : styles.tabPaneHidden}>
        {channelsPane}
      </div>
      {membersPane && (
        <div className={membersActive ? styles.tabPane : styles.tabPaneHidden}>
          {membersPane}
        </div>
      )}
    </>
  );
}
