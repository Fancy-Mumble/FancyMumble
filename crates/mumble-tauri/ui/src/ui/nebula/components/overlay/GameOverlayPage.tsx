/**
 * The game overlay window's page.
 *
 * Rendered in the `game-overlay` window, which Rust builds transparent,
 * always-on-top, click-through and non-focusable, and shows and hides
 * according to what the detector makes of the foreground application.
 *
 * Two consequences shape everything here:
 *
 * - **No store.** This is a separate webview; `useAppStore` and its ~35
 *   listeners belong to the main window. The page asks once via
 *   `game_overlay_snapshot` and then follows the same events every window
 *   receives, because Tauri broadcasts `app.emit` to all of them.
 * - **Nothing is interactive.** The window ignores the cursor and cannot take
 *   focus, so there are no controls: a button here would be a lie, and the
 *   flags that make it safe are the same ones that make it unclickable.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { alpha, ThemeProvider, type Theme } from "@mui/material/styles";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TauriEvent } from "@core/constants/tauriEvents";
import { HeadphonesOffIcon, MicIcon, MicOffIcon } from "@ui/icons";
import { useNebulaTheme } from "../../useNebulaAppearance";
import { NEBULA_SANS, radius } from "../../tokens";
import { Stack, TalkingBars, UserAvatar } from "../primitives";

/** Mirrors `OverlayOccupant` in `state/types/overlay.rs`. */
interface OverlayOccupant {
  session: number;
  name: string;
  textureSize: number | null;
  selfMute: boolean;
  selfDeaf: boolean;
  mute: boolean;
}

/** Mirrors `OverlayMessage`. */
interface OverlayMessage {
  sender: string;
  text: string;
  timestamp: number | null;
}

/** Mirrors `OverlaySnapshot`. */
interface OverlaySnapshot {
  connected: boolean;
  channelName: string | null;
  occupants: OverlayOccupant[];
  ownSession: number | null;
  talkingSessions: number[];
  voiceState: "inactive" | "active" | "muted";
  selfDeaf: boolean;
  lastMessage: OverlayMessage | null;
}

/**
 * How long a message stays on the card. Matches the freshness window the
 * watcher uses to keep the overlay up, less the two seconds of fade, so the
 * text is gone by the time the window goes.
 */
const MESSAGE_LIFETIME_MS = 10_000;

/** Occupants beyond this are summarised, so a busy channel cannot grow a window
 *  tall enough to cover the game. */
const MAX_ROWS = 8;

/** How big an avatar is on a row. Square, as the rail tiles are. */
const AVATAR = 20;

/**
 * How wide the card is.
 *
 * Fixed rather than hugging its content: the talking bars, the "you" pill and
 * the mute icons all come and go, so a card sized to its content would resize
 * the window on every utterance - a moving overlay is worse than a wide one.
 * Names that outrun it are ellipsised, which is the right trade for a glance.
 */
const CARD_WIDTH = 200;

/**
 * The card's shell, shared by the roster and the error state.
 *
 * The typeface is set here rather than inherited: this window never mounts
 * `CssBaseline`, so MUI's typography never reaches the document and the card
 * would otherwise be drawn in the browser's default serif.
 */
const cardSx = (theme: Theme) => ({
  width: CARD_WIDTH,
  p: "5px",
  borderRadius: radius("lg"),
  border: `1px solid ${theme.palette.nebula.line2}`,
  // A plain dark alpha, and deliberately NOT the pack's `washPanel` glass.
  //
  // Every other floating surface in Nebula sits on the app's own dark window,
  // so it can be a pale wash and let that show through, and it can blur what
  // is behind it. Neither holds here. The window is transparent, so the game
  // is not in this webview's compositing tree at all: `backdrop-filter` has
  // nothing to sample and paints a flat grey instead of glass, and a white
  // wash over an arbitrary game is a haze rather than a surface. What does
  // work is ordinary alpha compositing, which the transparent window does for
  // free - so this is the scheme's own background, thinned.
  background: alpha(theme.palette.nebula.bg0, 0.88),
  overflow: "hidden",
  color: theme.palette.nebula.text,
  fontFamily: NEBULA_SANS,
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
});

/** A row's own panel. Only whoever is speaking gets one. */
const rowSx = (theme: Theme, active: boolean) => ({
  px: "5px",
  py: "4px",
  borderRadius: radius("md"),
  background: active ? theme.palette.nebula.card2 : "transparent",
  transition: "background 140ms ease",
});

export default function GameOverlayPage() {
  const theme = useNebulaTheme(null);
  const { t } = useTranslation(["nebulaChrome", "common"]);
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [talking, setTalking] = useState<ReadonlySet<number>>(() => new Set());
  const [messageAge, setMessageAge] = useState(0);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // The window sits over a game, so the document itself must not paint - and
  // must not scroll. This window never mounts `CssBaseline` (that lives inside
  // the client app), so the browser's own `body { margin: 8px }` applies: a
  // 320px card in a 320px window then overflows in both axes and the overlay
  // grows scrollbars over the game.
  useEffect(() => {
    const { documentElement: html, body } = document;
    const restore = [html.style.cssText, body.style.cssText] as const;
    for (const element of [html, body]) {
      element.style.background = "transparent";
      element.style.margin = "0";
      element.style.padding = "0";
      element.style.overflow = "hidden";
    }
    return () => {
      html.style.cssText = restore[0];
      body.style.cssText = restore[1];
    };
  }, []);

  const refresh = useCallback(() => {
    invoke<OverlaySnapshot>("game_overlay_snapshot")
      .then((next) => {
        setSnapshot(next);
        setError(null);
        setTalking(new Set(next.talkingSessions));
      })
      .catch((e: unknown) => {
        // A window with no chrome and no console has nowhere to report a
        // failure except onto itself. Silence here is indistinguishable from
        // a window that never opened, which is the one thing it must not be.
        setError(String(e));
      });
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = [
      // The fast path: talking edges arrive many times a second and must not
      // cost a round trip each.
      listen<[number, boolean]>(TauriEvent.UserTalking, ({ payload: [session, isTalking] }) => {
        setTalking((current) => {
          const next = new Set(current);
          if (isTalking) next.add(session);
          else next.delete(session);
          return next;
        });
      }),
      // Everything else changes the roster or the message, both of which come
      // from one cheap composite read.
      listen(TauriEvent.NewMessage, refresh),
      listen(TauriEvent.VoiceStateChanged, refresh),
      listen(TauriEvent.StateChanged, refresh),
    ];
    return () => {
      for (const pending of unlisten) void pending.then((off) => off());
    };
  }, [refresh]);

  // Say out loud what this window is drawing. A transparent window painting
  // nothing looks exactly like a window that never opened, and the settings
  // page has no other way to tell the difference.
  useEffect(() => {
    void invoke("game_overlay_page_status", {
      status: {
        connected: snapshot?.connected ?? false,
        occupants: snapshot?.occupants.length ?? 0,
        hasMessage: Boolean(snapshot?.lastMessage),
        failed: error !== null,
      },
    }).catch(() => undefined);
  }, [snapshot, error]);

  // Age the message out on its own, so it disappears even in a channel where
  // nothing else happens.
  const messageAt = snapshot?.lastMessage?.timestamp ?? null;
  useEffect(() => {
    if (messageAt == null) return;
    setMessageAge(Date.now() - messageAt);
    const timer = setInterval(() => setMessageAge(Date.now() - messageAt), 500);
    return () => clearInterval(timer);
  }, [messageAt]);

  // Tell Rust how big the card actually is, so the window is sized onto it
  // rather than leaving transparent slack over the game.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const report = () => {
      const rect = card.getBoundingClientRect();
      // `scrollWidth`/`scrollHeight` as well as the rect: a window that is
      // currently too small clips the card, and the rect of a clipped card
      // reports the truncated size, which would keep it clipped for good.
      void invoke("game_overlay_resize", {
        width: Math.ceil(Math.max(rect.width, card.scrollWidth)),
        height: Math.ceil(Math.max(rect.height, card.scrollHeight)),
      }).catch(() => {});
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(card);
    return () => observer.disconnect();
  }, [snapshot]);

  if (error) {
    return (
      <ThemeProvider theme={theme}>
        <Box ref={cardRef} sx={cardSx}>
          <Box sx={{ px: "12px", py: "10px", fontSize: 11.5 }}>{error}</Box>
        </Box>
      </ThemeProvider>
    );
  }
  // Nothing to say: no server, or not in a channel yet. The window stays up
  // but paints nothing, which is what "transparent and empty" is for.
  if (!snapshot?.connected) return null;

  const occupants = snapshot.occupants.slice(0, MAX_ROWS);
  const overflow = snapshot.occupants.length - occupants.length;
  const message =
    snapshot.lastMessage && (messageAt == null || messageAge < MESSAGE_LIFETIME_MS)
      ? snapshot.lastMessage
      : null;
  // The last two seconds of a message's life are a fade, so it leaves rather
  // than blinks out.
  const messageOpacity =
    messageAt == null ? 1 : Math.max(0, Math.min(1, (MESSAGE_LIFETIME_MS - messageAge) / 2000));

  return (
    <ThemeProvider theme={theme}>
      <Box ref={cardRef} data-testid="game-overlay-card" sx={cardSx}>
        {/* One line. The "N in voice" subtitle this used to carry counted the
            rows printed directly underneath it, which is a line of height spent
            on something the reader can already see. */}
        <Stack
          direction="row"
          alignItems="center"
          gap={0.75}
          sx={(t2) => ({
            px: "7px",
            py: "5px",
            borderRadius: radius("md"),
            background: t2.palette.nebula.card,
          })}
        >
          <Typography
            aria-hidden
            sx={(t2) => ({ fontSize: 12, lineHeight: 1, color: t2.palette.nebula.dim })}
          >
            #
          </Typography>
          <Typography sx={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 11.5 }} noWrap>
            {snapshot.channelName ?? t("common:labels.channel", { defaultValue: "Channel" })}
          </Typography>
          <Box sx={(t2) => ({ display: "flex", alignItems: "center", color: t2.palette.nebula.dim })}>
            {snapshot.selfDeaf ? (
              <HeadphonesOffIcon width={11} height={11} />
            ) : snapshot.voiceState === "muted" ? (
              <MicOffIcon width={11} height={11} />
            ) : (
              <MicIcon width={11} height={11} />
            )}
          </Box>
        </Stack>

        <Stack sx={{ mt: "4px", gap: "1px" }}>
          {occupants.map((user) => {
            const isTalking = talking.has(user.session);
            const isOwn = user.session === snapshot.ownSession;
            return (
              <Stack
                key={user.session}
                direction="row"
                alignItems="center"
                gap={0.875}
                sx={(t2) => rowSx(t2, isTalking)}
              >
                <UserAvatar
                  name={user.name}
                  session={user.session}
                  textureSize={user.textureSize}
                  size={AVATAR}
                  square
                  talking={isTalking}
                />
                <Typography
                  sx={(t2) => ({
                    fontSize: 11.5,
                    minWidth: 0,
                    fontWeight: isTalking ? 600 : 500,
                    color: isTalking ? t2.palette.nebula.text : t2.palette.nebula.muted,
                    transition: "color 140ms ease",
                  })}
                  noWrap
                >
                  {user.name}
                </Typography>
                <Box
                  sx={(t2) => ({
                    ml: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    color: t2.palette.nebula.dim,
                  })}
                >
                  {isOwn && (
                    <Typography
                      sx={(t2) => ({
                        px: "4px",
                        py: "1px",
                        borderRadius: radius("sm"),
                        background: t2.palette.nebula.card2,
                        color: t2.palette.nebula.dim,
                        fontSize: 8,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                      })}
                    >
                      {t("nebulaChrome:gameOverlay.you", { defaultValue: "YOU" })}
                    </Typography>
                  )}
                  {(user.selfMute || user.mute) && <MicOffIcon width={10} height={10} />}
                  {user.selfDeaf && <HeadphonesOffIcon width={10} height={10} />}
                  <TalkingBars talking={isTalking} />
                </Box>
              </Stack>
            );
          })}
          {overflow > 0 && (
            <Typography sx={(t2) => ({ px: "6px", py: "2px", fontSize: 10.5, color: t2.palette.nebula.dim })}>
              {t("nebulaChrome:gameOverlay.more", {
                count: overflow,
                defaultValue: "+{{count}} more",
              })}
            </Typography>
          )}
        </Stack>

        {message && (
          <Stack
            sx={(t2) => ({
              mt: "4px",
              px: "7px",
              py: "6px",
              gap: "1px",
              borderRadius: radius("md"),
              background: t2.palette.nebula.card,
              opacity: messageOpacity,
              transition: "opacity 500ms linear",
            })}
          >
            <Typography
              sx={(t2) => ({ fontSize: 9.5, fontWeight: 600, color: t2.palette.nebula.accent })}
              noWrap
            >
              {message.sender}
            </Typography>
            <Typography
              data-testid="game-overlay-message"
              sx={{
                fontSize: 10.5,
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                wordBreak: "break-word",
              }}
            >
              {message.text}
            </Typography>
          </Stack>
        )}
      </Box>
    </ThemeProvider>
  );
}
