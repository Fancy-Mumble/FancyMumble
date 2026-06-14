/**
 * SettingsSearch - a search box for the settings sidebar.  Matches the
 * self-registered settings index (see {@link getSettingsSearchIndex}) against
 * the query and lists each matching tab with its result count
 * ("Shortcuts - 3 results").  Selecting a result jumps to that tab and asks the
 * page to highlight the matching settings.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchIcon } from "../../icons";
import { getSettingsSearchIndex } from "./settingsSearchRegistry";
import styles from "./SettingsSearch.module.css";

interface TabInfo {
  readonly id: string;
  readonly label: string;
}

export function SettingsSearch({
  tabs,
  onSelect,
}: {
  readonly tabs: readonly TabInfo[];
  /** Navigate to `tabId` and highlight settings matching `term`. */
  readonly onSelect: (tabId: string, term: string) => void;
}) {
  const { t } = useTranslation("settings");
  const tStr = t as unknown as (key: string, opts?: Record<string, unknown>) => string;
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const available = new Set(tabs.map((tab) => tab.id));
    const counts = new Map<string, number>();
    for (const entry of getSettingsSearchIndex()) {
      if (!available.has(entry.tab)) continue;
      const label = tStr(entry.titleKey, { defaultValue: entry.titleKey });
      const hay = `${label} ${entry.keywords?.join(" ") ?? ""}`.toLowerCase();
      if (hay.includes(q)) counts.set(entry.tab, (counts.get(entry.tab) ?? 0) + 1);
    }
    // Keep the sidebar's tab order.
    return tabs
      .filter((tab) => counts.has(tab.id))
      .map((tab) => ({ id: tab.id, label: tab.label, count: counts.get(tab.id) ?? 0 }));
  }, [query, tabs, tStr]);

  const select = (tabId: string) => {
    onSelect(tabId, query.trim());
    setQuery("");
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.inputWrap}>
        <SearchIcon className={styles.icon} width={14} height={14} />
        <input
          className={styles.input}
          type="search"
          value={query}
          placeholder={tStr("search.placeholder", { defaultValue: "Search settings…" })}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results.length > 0) select(results[0].id);
            else if (e.key === "Escape") setQuery("");
          }}
        />
      </div>

      {query.trim() && (
        <div className={styles.results}>
          {results.length === 0 ? (
            <div className={styles.noResults}>{tStr("search.noResults", { defaultValue: "No matching settings" })}</div>
          ) : (
            results.map((r) => (
              <button key={r.id} type="button" className={styles.resultItem} onClick={() => select(r.id)}>
                <span className={styles.resultTab}>{r.label}</span>
                <span className={styles.resultCount}>
                  {tStr("search.results", { count: r.count, defaultValue: "{{count}} results" })}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
