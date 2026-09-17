import { ShieldIcon } from "../../icons";
import { useCallback, useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import type { PersistenceMode } from "@core/types";
import { getDismissedBanners, dismissBanner } from "@core/preferencesStorage";
import { InfoBanner } from "./InfoBanner";
import styles from "./InfoBanner.module.css";

interface PersistenceBannerProps {
  readonly channelId: number;
}

function modeDescription(mode: PersistenceMode, t: (key: string) => string): string {
  switch (mode) {
    case "FANCY_V1_FULL_ARCHIVE":
      return t("persistence.modeFullArchive");
    case "SIGNAL_V1":
      return t("persistence.modeSignal");
    case "SERVER_MANAGED":
      return t("persistence.modeServerManaged");
    case "NONE":
      return "";
    default: {
      const unhandled: never = mode;
      return unhandled;
    }
  }
}

function formatRetention(days: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (days <= 0) return t("persistence.retentionNoLimit");
  if (days === 1) return t("persistence.retention1Day");
  return t("persistence.retentionDays", { count: days });
}

function formatCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export default function PersistenceBanner({ channelId }: PersistenceBannerProps) {
  const { t } = useTranslation("sidebar");
  const tStr = t as (key: string, opts?: Record<string, unknown>) => string;
  const persistence = useAppStore((s) => s.channelPersistence[channelId]);
  const loadOlderMessages = useAppStore((s) => s.loadOlderMessages);
  const moreBefore = useAppStore((s) => s.messagesMoreBefore);
  const isLoadingKeys = useAppStore((s) => s.pchatHistoryLoading.has(channelId));
  const [dismissed, setDismissed] = useState(false);

  // Load persisted dismissal state on channel change.
  useEffect(() => {
    let cancelled = false;
    getDismissedBanners().then((ids) => {
      if (!cancelled) setDismissed(ids.includes(channelId));
    });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    dismissBanner(channelId);
  }, [channelId]);

  // Intersection observer for "load more" scroll-to-top trigger.
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Older messages, wherever they are: the store pages back through what the
  // backend is holding first and only asks the server once that runs out. It
  // used to go straight to the server, which fetched a page the reader
  // already had in memory but could not see.
  const handleLoadMore = useCallback(() => {
    if (persistence?.isFetching) return;
    void loadOlderMessages();
  }, [loadOlderMessages, persistence]);

  const hasMore = moreBefore || (persistence?.hasMore ?? false);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) handleLoadMore();
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, handleLoadMore]);

  const shieldIcon = <ShieldIcon aria-hidden="true" />;

  // Show loading indicator even before persistence config is known.
  if (isLoadingKeys && (!persistence || persistence.mode === "NONE")) {
    return (
      <div className={styles.loadMore}>
        <div className={styles.loadingSpinner} aria-label={t("persistence.loadingAriaLabel")} />
        <span className={styles.loadingText}>{t("persistence.loadingHistory")}</span>
      </div>
    );
  }

  if (!persistence || persistence.mode === "NONE") return null;

  return (
    <>
      {!dismissed && (
        <InfoBanner icon={shieldIcon} onDismiss={handleDismiss}>
          <p className={styles.description}>
            {modeDescription(persistence.mode, tStr as (key: string) => string)}
          </p>
          <div className={styles.meta}>
            {persistence.retentionDays > 0 && (
              <span className={styles.metaItem}>
                {t("persistence.retentionLabel", { value: formatRetention(persistence.retentionDays, tStr) })}
              </span>
            )}
            {persistence.totalStored > 0 && (
              <span className={styles.metaItem}>
                {t("persistence.storedLabel", { total: formatCount(persistence.totalStored) })}
              </span>
            )}
          </div>
        </InfoBanner>
      )}

      {/* Key exchange / initial loading indicator */}
      {isLoadingKeys && (
        <div className={styles.loadMore}>
          <div className={styles.loadingSpinner} aria-label={t("persistence.loadingAriaLabel")} />
          <span className={styles.loadingText}>{t("persistence.loadingHistory")}</span>
        </div>
      )}

      {/* Invisible sentinel for intersection-observer-based pagination */}
      {hasMore && (
        <div ref={loadMoreRef} className={styles.loadMore}>
          {persistence.isFetching && (
            <div className={styles.loadingSpinner} aria-label={t("persistence.loadingOlderAriaLabel")} />
          )}
        </div>
      )}
    </>
  );
}
