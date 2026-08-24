/**
 * Live Discord rich presence published by other applications on this machine.
 *
 * The backend hosts Discord's local IPC endpoint and forwards everything to a
 * running Discord client, so what shows up here is exactly what Discord shows
 * — see `crates/fancy-presence` for how that coexistence works.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import type { PresenceEntry } from "@core/types";
import { ExternalLinkGuard } from "../../elements/ExternalLinkGuard";
import styles from "./RichPresencePanel.module.css";

/** Re-render once a second, but only while something is actually counting. */
function useSecondTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function hasTimer(entry: PresenceEntry): boolean {
  const stamps = entry.activity.timestamps;
  return stamps != null && (stamps.start != null || stamps.end != null);
}

/** First glyph of the label, for entries whose artwork did not resolve. */
function initialOf(label: string): string {
  return [...label][0]?.toUpperCase() ?? "?";
}

function Artwork({ entry }: { readonly entry: PresenceEntry }) {
  const assets = entry.activity.assets;
  return (
    <div className={styles.artwork}>
      {entry.largeImageUrl ? (
        <img
          src={entry.largeImageUrl}
          alt={assets?.large_text ?? ""}
          title={assets?.large_text ?? undefined}
          className={styles.largeImage}
          loading="lazy"
        />
      ) : (
        <div className={styles.artworkFallback} aria-hidden="true">
          {initialOf(entry.displayName)}
        </div>
      )}
      {entry.smallImageUrl && (
        <img
          src={entry.smallImageUrl}
          alt={assets?.small_text ?? ""}
          title={assets?.small_text ?? undefined}
          className={styles.smallImage}
          loading="lazy"
        />
      )}
    </div>
  );
}

export default function RichPresencePanel() {
  const { t } = useTranslation("chat");
  const entries = useAppStore((s) => s.richPresence);
  const status = useAppStore((s) => s.richPresenceStatus);

  const now = useSecondTicker(entries.some(hasTimer));

  const timerLabel = (entry: PresenceEntry): string | null => {
    const stamps = entry.activity.timestamps;
    if (!stamps) return null;
    if (stamps.end != null && stamps.end > now) {
      return t("richPresence.remaining", { time: formatDuration(stamps.end - now) });
    }
    if (stamps.start != null && stamps.start <= now) {
      return t("richPresence.elapsed", { time: formatDuration(now - stamps.start) });
    }
    return null;
  };

  const partyLabel = (entry: PresenceEntry): string | null => {
    const size = entry.activity.party?.size;
    if (!size || size.length < 2) return null;
    return t("richPresence.party", { current: size[0], max: size[1] });
  };

  // "Nothing here" has three quite different causes, and the one the user can
  // act on (Discord won the race for the IPC socket) is invisible otherwise.
  const notice = !status.enabled
    ? t("richPresence.disabled")
    : status.bridgeState === "blocked"
      ? t("richPresence.blocked")
      : entries.length === 0
        ? t("richPresence.empty")
        : null;

  return (
    <div className={styles.panel} data-testid={TID.richPresencePanel}>
      <div className={styles.header}>
        <span className={styles.title}>
          {t("richPresence.title")}
          {entries.length > 0 && <span className={styles.count}>{entries.length}</span>}
        </span>
        {/* Close (×) comes from ChatView's ResizableSplitPanel, like every other panel. */}
      </div>

      {notice && <div className={styles.notice}>{notice}</div>}

      {entries.length > 0 && (
        <div className={styles.list}>
          {entries.map((entry) => {
            const timer = timerLabel(entry);
            const party = partyLabel(entry);
            const buttons = entry.activity.buttons ?? [];
            return (
              <div
                key={entry.id}
                className={styles.item}
                data-testid={TID.richPresenceEntry}
                data-application-id={entry.applicationId}
              >
                <Artwork entry={entry} />
                <div className={styles.body}>
                  <span className={styles.appName}>{entry.displayName}</span>
                  {entry.activity.details && <span className={styles.details}>{entry.activity.details}</span>}
                  {entry.activity.state && <span className={styles.state}>{entry.activity.state}</span>}
                  {(party ?? timer) && (
                    <span className={styles.meta}>{[party, timer].filter(Boolean).join(" · ")}</span>
                  )}
                  {buttons.length > 0 && (
                    // Application-supplied URLs are untrusted: the guard shows
                    // the destination and asks before anything opens.
                    <ExternalLinkGuard className={styles.buttons}>
                      {buttons.map((button) =>
                        button.url ? (
                          <a
                            key={`${button.label}:${button.url}`}
                            href={button.url}
                            className={styles.linkButton}
                            title={button.url}
                          >
                            {button.label}
                          </a>
                        ) : (
                          <span key={button.label} className={styles.linkButtonDisabled}>
                            {button.label}
                          </span>
                        ),
                      )}
                    </ExternalLinkGuard>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
