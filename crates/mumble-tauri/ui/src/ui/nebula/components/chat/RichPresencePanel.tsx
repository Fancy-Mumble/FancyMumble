import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";

import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import type { PresenceEntry } from "@core/types";
import { radius } from "../../tokens";
import { LinkGuard, Stack } from "../primitives";

/**
 * What the applications on this machine say they are doing.
 *
 * Nebula shipped the Privacy switch that turns the listener on, and the copy
 * that explains which of Discord's IPC slots it ended up in - and nothing that
 * shows a single thing it heard. The switch was the whole feature from this
 * pack's side: you could turn presence on, read that it was working, and never
 * see it.
 *
 * The reading itself is pack-agnostic: the backend hosts Discord's local IPC
 * endpoint and forwards every frame on to a running Discord client, so this
 * shows exactly what Discord shows. See `crates/fancy-presence` for how that
 * coexistence works.
 */
export function RichPresencePanel() {
  const { t } = useTranslation("chat");
  const entries = useAppStore((state) => state.richPresence);
  const status = useAppStore((state) => state.richPresenceStatus);

  const now = useSecondTicker(entries.some(hasTimer));

  const timerLabel = (entry: PresenceEntry): string | null => {
    const stamps = entry.activity.timestamps;
    if (!stamps) return null;
    if (stamps.end != null && stamps.end > now)
      return t("richPresence.remaining", { time: formatDuration(stamps.end - now) });
    if (stamps.start != null && stamps.start <= now)
      return t("richPresence.elapsed", { time: formatDuration(now - stamps.start) });
    return null;
  };

  const partyLabel = (entry: PresenceEntry): string | null => {
    const size = entry.activity.party?.size;
    if (!size || size.length < 2) return null;
    return t("richPresence.party", { current: size[0], max: size[1] });
  };

  // An empty panel has three quite different causes, and the one the user can
  // actually act on - Discord won the race for the socket, so start this first
  // next time - is indistinguishable from the other two without saying so.
  const notice = !status.enabled
    ? t("richPresence.disabled")
    : status.bridgeState === "blocked"
      ? t("richPresence.blocked")
      : entries.length === 0
        ? t("richPresence.empty")
        : null;

  return (
    <Stack gap={1.5} data-testid={TID.richPresencePanel}>
      <Stack direction="row" alignItems="baseline" gap={1}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{t("richPresence.title")}</Typography>
        {entries.length > 0 && (
          <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.dim })}>
            {entries.length}
          </Typography>
        )}
      </Stack>

      {notice && (
        <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
          {notice}
        </Typography>
      )}

      {entries.length > 0 && (
        <Stack gap={1}>
          {entries.map((entry) => (
            <PresenceRow key={entry.id} entry={entry} party={partyLabel(entry)} timer={timerLabel(entry)} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** One application's activity: its artwork, what it says, and its buttons. */
function PresenceRow({
  entry,
  party,
  timer,
}: Readonly<{ entry: PresenceEntry; party: string | null; timer: string | null }>) {
  const buttons = entry.activity.buttons ?? [];
  const meta = [party, timer].filter(Boolean).join(" · ");

  return (
    <Stack
      direction="row"
      gap={1.5}
      data-testid={TID.richPresenceEntry}
      data-application-id={entry.applicationId}
      sx={(theme) => ({
        padding: "11px 13px",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Artwork entry={entry} />
      <Stack gap={0.25} sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{entry.displayName}</Typography>
        {entry.activity.details && <Typography sx={{ fontSize: 12.5 }}>{entry.activity.details}</Typography>}
        {entry.activity.state && (
          <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
            {entry.activity.state}
          </Typography>
        )}
        {meta && (
          <Typography
            sx={(theme) => ({
              fontSize: 11.5,
              color: theme.palette.nebula.dim,
              fontVariantNumeric: "tabular-nums",
            })}
          >
            {meta}
          </Typography>
        )}
        {buttons.length > 0 && (
          // One guard around the group, not one per button: it works by
          // intercepting `data-external` anchors inside its subtree, and the
          // URLs come from whatever application published them.
          <LinkGuard>
            <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ marginTop: "4px" }}>
              {buttons.map((button) =>
                button.url ? (
                  <Box
                    key={`${button.label}:${button.url}`}
                    component="a"
                    href={button.url}
                    data-external
                    title={button.url}
                    sx={(theme) => ({
                      fontSize: 11.5,
                      padding: "3px 9px",
                      borderRadius: 999,
                      cursor: "pointer",
                      textDecoration: "none",
                      color: theme.palette.nebula.accent,
                      background: theme.palette.nebula.accentSoft,
                      border: `1px solid ${theme.palette.nebula.accentLine}`,
                    })}
                  >
                    {button.label}
                  </Box>
                ) : (
                  // A button with no URL is Discord's way of saying "this app
                  // offered a label and nothing to open": shown, not clickable.
                  <Box
                    key={button.label}
                    component="span"
                    sx={(theme) => ({
                      fontSize: 11.5,
                      padding: "3px 9px",
                      borderRadius: 999,
                      color: theme.palette.nebula.dim,
                      background: theme.palette.nebula.card2,
                      border: `1px solid ${theme.palette.nebula.line}`,
                    })}
                  >
                    {button.label}
                  </Box>
                ),
              )}
            </Stack>
          </LinkGuard>
        )}
      </Stack>
    </Stack>
  );
}

/**
 * The application's artwork, with its small badge over the corner.
 *
 * Falls back to the first letter of the name rather than to a placeholder
 * image: plenty of applications publish activity with no assets at all, and a
 * row of identical grey squares says less than a row of initials.
 */
function Artwork({ entry }: Readonly<{ entry: PresenceEntry }>) {
  const assets = entry.activity.assets;
  return (
    <Box sx={{ position: "relative", flex: "none", width: 52, height: 52 }}>
      {entry.largeImageUrl ? (
        <Box
          component="img"
          src={entry.largeImageUrl}
          alt={assets?.large_text ?? ""}
          title={assets?.large_text ?? undefined}
          loading="lazy"
          sx={(theme) => ({
            width: 52,
            height: 52,
            objectFit: "cover",
            borderRadius: radius("md"),
            border: `1px solid ${theme.palette.nebula.line}`,
          })}
        />
      ) : (
        <Box
          aria-hidden
          sx={(theme) => ({
            display: "grid",
            placeItems: "center",
            width: 52,
            height: 52,
            fontSize: 19,
            fontWeight: 600,
            borderRadius: radius("md"),
            color: theme.palette.nebula.muted,
            background: theme.palette.nebula.card2,
            border: `1px solid ${theme.palette.nebula.line}`,
          })}
        >
          {initialOf(entry.displayName)}
        </Box>
      )}
      {entry.smallImageUrl && (
        <Box
          component="img"
          src={entry.smallImageUrl}
          alt={assets?.small_text ?? ""}
          title={assets?.small_text ?? undefined}
          loading="lazy"
          sx={(theme) => ({
            position: "absolute",
            right: -3,
            bottom: -3,
            width: 21,
            height: 21,
            objectFit: "cover",
            borderRadius: "50%",
            border: `2px solid ${theme.palette.nebula.panel}`,
          })}
        />
      )}
    </Box>
  );
}

/**
 * A clock, but only while something is counting.
 *
 * Presence rows are mostly static; the timers are the one part that has to
 * move. Ticking unconditionally would re-render every row once a second for
 * the common case where nothing is timed at all.
 */
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

/** First glyph of the label, for entries whose artwork did not resolve. */
function initialOf(label: string): string {
  return [...label][0]?.toUpperCase() ?? "?";
}

function hasTimer(entry: PresenceEntry): boolean {
  const stamps = entry.activity.timestamps;
  return stamps != null && (stamps.start != null || stamps.end != null);
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
