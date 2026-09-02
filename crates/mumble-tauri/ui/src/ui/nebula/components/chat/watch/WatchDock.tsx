import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";

import { useAppStore } from "@core/store";
import { useWatchCard, type WatchCardView } from "@core/features/chat/watch/useWatchCard";
import { getCachedUserAvatar } from "@core/lazyBlobs";
import { CloseIcon, PauseIcon, PlayIcon } from "@ui/icons";
import { Stack, UserAvatar } from "../../primitives";
import { radius } from "../../../tokens";
import {
  clock,
  iconBtn,
  iconBtnGlass,
  pill,
  SeekBar,
  SpeedMenu,
  SPEEDS,
  useSlotRect,
  VolumeControl,
} from "./watchChrome";

/**
 * The watch-together session, floating over the conversation.
 *
 * Standard puts the player in the message that started it, so the session
 * scrolls away mid-film and takes its controls with it. This hangs in the
 * corner instead - the message keeps a marker, this is where the session
 * lives - and expands to a theater over the whole pane.
 *
 * It follows the channel you are *in*, not the one you are reading: a player
 * that vanished because you went to look something up in another channel would
 * be the same problem in a different place.
 *
 * **The player never moves in the DOM.** Mini and theater are different trees,
 * so rendering the video inside either would tear the adapter down on every
 * switch - a black iframe, a lost position, and every guest resynced. Instead
 * one fixed surface holds the player for the session's whole life and is
 * positioned over whichever layout's slot is on screen.
 */

const DOCK_MOUNT_KEY = "nebula-dock";
type Mode = "mini" | "theater";

export function WatchDock() {
  const sessions = useAppStore((state) => state.watchSessions);
  const currentChannel = useAppStore((state) => state.currentChannel);

  // The first session in the channel wins the dock. Two at once is rare, and a
  // stack of floating players is worse than making the second wait.
  const active = useMemo(() => {
    if (currentChannel == null) return null;
    for (const session of sessions.values()) {
      if (session.channelId === currentChannel) return session.sessionId;
    }
    return null;
  }, [sessions, currentChannel]);

  if (active === null) return null;
  return <Dock key={active} sessionId={active} />;
}

function Dock({ sessionId }: Readonly<{ sessionId: string }>) {
  const { t } = useTranslation(["chat", "common", "nebulaChat"]);
  const [mode, setMode] = useState<Mode>("mini");
  const [collapsed, setCollapsed] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const rect = useSlotRect(slot);

  const card = useWatchCard(sessionId, {
    mountKey: DOCK_MOUNT_KEY,
    trackProgress: true,
    // The dock draws its own transport, so the player's would be a second set
    // of controls disagreeing with it about who is in charge.
    nativeControls: false,
  });
  const { session, owns, explicitlyLeft, isHost, hostName } = card;

  if (!session) return null;

  const watching = t("chat:watch.watching", { count: session.participants.size });
  const playing = session.state === "playing";
  const live = owns && !explicitlyLeft;

  if (collapsed) {
    return (
      <Box
        component="button"
        type="button"
        onClick={() => setCollapsed(false)}
        sx={(theme) => ({
          all: "unset",
          position: "absolute",
          right: 18,
          bottom: 72,
          zIndex: 6,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          p: "8px 12px",
          borderRadius: radius("lg"),
          cursor: "pointer",
          color: theme.palette.nebula.text,
          border: "1px solid " + theme.palette.nebula.line2,
          background: theme.palette.nebula.tint + "," + theme.palette.nebula.bg0,
          boxShadow: theme.palette.nebula.shadow,
        })}
      >
        <PlayIcon width={12} height={12} />
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
          {t("chat:contextMenu.watchTogether")}
        </Typography>
        <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.nebula.muted })}>
          {"· " + watching}
        </Typography>
      </Box>
    );
  }

  const shared = {
    card,
    speedOpen,
    setSpeedOpen,
    onMode: () => setMode(mode === "mini" ? "theater" : "mini"),
    setSlot,
    watching,
    playing,
    live,
  };

  return (
    <>
      {mode === "mini" ? (
        <MiniPanel {...shared} onClose={() => setCollapsed(true)} isHost={isHost} />
      ) : (
        <TheaterPanel {...shared} hostName={hostName} />
      )}
      {live && rect && (
        <PlayerSurface mode={mode} rect={rect} {...shared} isHost={isHost} hostName={hostName} />
      )}
    </>
  );
}

/** Shared shape of what the two layouts and the surface are handed. */
interface Chrome {
  card: WatchCardView;
  speedOpen: boolean;
  setSpeedOpen: (next: boolean) => void;
  onMode: () => void;
  setSlot: (el: HTMLElement | null) => void;
  watching: string;
  playing: boolean;
  live: boolean;
}

/**
 * The video and everything drawn on top of it, in one element that outlives
 * every layout change. Positioned over the active layout's slot.
 */
function PlayerSurface({
  mode,
  rect,
  card,
  speedOpen,
  setSpeedOpen,
  onMode,
  playing,
  watching,
  isHost,
  hostName,
}: Readonly<Chrome & { mode: Mode; rect: DOMRect; isHost: boolean; hostName: string | null }>) {
  const { t } = useTranslation(["chat", "common", "nebulaChat"]);
  const { containerRef, playback, canPlay, play, pause, seek, nudge, session } = card;
  const glass = mode === "theater";

  return (
    <Box
      sx={{
        position: "fixed",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        zIndex: glass ? 23 : 7,
        borderRadius: glass ? "11px" : 0,
        overflow: "hidden",
        background: "#05070c",
        // Clicks fall through to the slot underneath, which toggles playback -
        // only the controls drawn here take the pointer back.
        pointerEvents: "none",
      }}
    >
      <Box
        ref={containerRef}
        // The identity a test can hold on to: this node surviving a mode
        // switch is what keeps playback from restarting.
        data-wt-player=""
        sx={{
          position: "absolute",
          inset: 0,
          "& video, & iframe": {
            width: "100%",
            height: "100%",
            maxHeight: "none",
            border: 0,
            display: "block",
            objectFit: "contain",
            background: "#05070c",
          },
        }}
      />

      {canPlay && (
        <Box
          component="button"
          type="button"
          aria-label={playing ? t("nebulaChat:dock.pause") : t("chat:linkPreview.playVideo")}
          onClick={() => void (playing ? pause() : play())}
          sx={{
            all: "unset",
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            width: glass ? 56 : 44,
            height: glass ? 56 : 44,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            pointerEvents: "auto",
            color: "#fff",
            background: "rgba(10,12,24,.55)",
            backdropFilter: "blur(8px)",
            // Out of the way while it plays, back on hover - the point of the
            // picture is the picture.
            opacity: playing ? 0 : 1,
            transition: "opacity .15s ease",
            "&:hover, &:focus-visible": { opacity: 1 },
          }}
        >
          {playing ? (
            <PauseIcon width={glass ? 20 : 16} height={glass ? 20 : 16} />
          ) : (
            <PlayIcon width={glass ? 20 : 16} height={glass ? 20 : 16} />
          )}
        </Box>
      )}

      {glass ? (
        <>
          <Box
            sx={{
              position: "absolute",
              inset: "0 0 auto 0",
              height: 52,
              background: "linear-gradient(180deg,rgba(6,9,16,.62),transparent)",
            }}
          />
          <Box
            sx={{
              position: "absolute",
              inset: "auto 0 0 0",
              height: 80,
              background: "linear-gradient(0deg,rgba(6,9,16,.72),transparent)",
            }}
          />
          <Stack
            direction="row"
            alignItems="center"
            gap="8px"
            sx={{ position: "absolute", left: 9, right: 9, top: 8 }}
          >
            <Box
              sx={{
                flex: "none",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                p: "2px 7px 2px 5px",
                borderRadius: "6px",
                background: "rgba(52,168,235,.22)",
                border: "1px solid rgba(52,168,235,.4)",
                color: "#a9d8f5",
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: ".04em",
                backdropFilter: "blur(8px)",
              }}
            >
              <Box sx={{ width: 5, height: 5, borderRadius: "50%", background: "#4fb0ea" }} />
              {t("nebulaChat:dock.party")}
            </Box>
            <Typography
              sx={{
                fontSize: 11,
                color: "#e9ecf3",
                fontWeight: 500,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textShadow: "0 1px 3px rgba(0,0,0,.5)",
              }}
            >
              {session?.title ?? session?.sourceUrl}
            </Typography>
            <Typography
              sx={{
                ml: "auto",
                flex: "none",
                fontSize: 10,
                color: "#aeb6c4",
                whiteSpace: "nowrap",
                textShadow: "0 1px 3px rgba(0,0,0,.5)",
              }}
            >
              {watching + (playback.quality ? " · " + playback.quality : "")}
            </Typography>
          </Stack>

          <Box sx={{ position: "absolute", left: 9, right: 9, bottom: 8, pointerEvents: "auto" }}>
            <SeekBar
              current={playback.current}
              total={playback.total}
              buffered={playback.buffered}
              glass
              onSeek={canPlay ? (s) => void seek(s) : undefined}
              label={t("nebulaChat:dock.seek")}
            />
            <Transport
              card={card}
              glass
              nudge={nudge}
              speedOpen={speedOpen}
              setSpeedOpen={setSpeedOpen}
              onMode={onMode}
              modeLabel={t("nebulaChat:dock.mini")}
              isHost={isHost}
            />
          </Box>
        </>
      ) : (
        <>
          {playback.quality && (
            <Typography
              sx={{
                position: "absolute",
                left: 9,
                top: 9,
                p: "2px 6px",
                borderRadius: "5px",
                background: "rgba(10,12,24,.6)",
                fontFamily: "var(--nebula-mono, ui-monospace), monospace",
                fontSize: 9.5,
                fontWeight: 500,
                color: "#fff",
              }}
            >
              {playback.quality}
            </Typography>
          )}
          <SyncChip card={card} />
        </>
      )}

      {speedOpen && (
        <Box sx={{ pointerEvents: "auto" }}>
          <SpeedMenu
            rates={SPEEDS}
            current={playback.rate}
            glass={glass}
            heading={t("nebulaChat:dock.speedHeading")}
            onPick={(rate) => {
              card.setRate(rate);
              setSpeedOpen(false);
            }}
          />
        </Box>
      )}
      <span hidden>{hostName}</span>
    </Box>
  );
}

/** The lock that says whether this viewer is still following the host. */
function SyncChip({ card }: Readonly<{ card: WatchCardView }>) {
  const { t } = useTranslation("nebulaChat");
  const { followHost, toggleFollowHost, isHost } = card;
  if (isHost) return null;
  return (
    <Box
      component="button"
      type="button"
      onClick={toggleFollowHost}
      aria-pressed={followHost}
      sx={{
        all: "unset",
        position: "absolute",
        right: 9,
        top: 9,
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        height: 20,
        px: "7px",
        borderRadius: "6px",
        cursor: "pointer",
        pointerEvents: "auto",
        fontSize: 9.5,
        fontWeight: 600,
        color: followHost ? "#a9d8f5" : "#f0c69a",
        background: "rgba(10,12,24,.6)",
        border: "1px solid " + (followHost ? "rgba(52,168,235,.4)" : "rgba(236,186,85,.45)"),
        backdropFilter: "blur(8px)",
        "&:hover": { opacity: 0.85 },
      }}
    >
      <svg width="9" height="9" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        {followHost ? (
          <path d="M4.2 6.2V4.5a2.8 2.8 0 0 1 5.6 0v1.7" />
        ) : (
          <path d="M4.2 6.2V4.5a2.8 2.8 0 0 1 5.3-.9" />
        )}
        <rect x="2.8" y="6.2" width="8.4" height="6" rx="2" />
      </svg>
      {t(followHost ? "dock.synced" : "dock.free")}
    </Box>
  );
}

/** The control row, on the panel in mini and on glass in theater. */
function Transport({
  card,
  glass,
  nudge,
  speedOpen,
  setSpeedOpen,
  onMode,
  modeLabel,
  isHost,
}: Readonly<{
  card: WatchCardView;
  glass: boolean;
  nudge: (seconds: number) => Promise<void>;
  speedOpen: boolean;
  setSpeedOpen: (next: boolean) => void;
  onMode: () => void;
  modeLabel: string;
  isHost: boolean;
}>) {
  const { t } = useTranslation(["chat", "common", "nebulaChat"]);
  const { playback, canPlay, play, pause, requestState, end, leave, session } = card;
  const playing = session?.state === "playing";
  const btn = (theme: Parameters<typeof iconBtn>[0], active = false) =>
    glass ? iconBtnGlass(active) : iconBtn(theme, active);

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={glass ? "5px" : "3px"}
      flexWrap="wrap"
      sx={{ mt: "7px", rowGap: "6px", minWidth: 0 }}
    >
      {canPlay && (
        <>
          <Box
            component="button"
            type="button"
            aria-label={playing ? t("nebulaChat:dock.pause") : t("chat:linkPreview.playVideo")}
            onClick={() => void (playing ? pause() : play())}
            sx={(theme) => btn(theme)}
          >
            {playing ? <PauseIcon width={13} height={13} /> : <PlayIcon width={13} height={13} />}
          </Box>
          <Box
            component="button"
            type="button"
            aria-label={t("nebulaChat:dock.back10")}
            onClick={() => void nudge(-10)}
            sx={(theme) => btn(theme)}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3.2A4.3 4.3 0 1 1 2.9 6.3" />
              <path d="M4.6 1.3L2.7 3.3l2.1 1.7" />
            </svg>
          </Box>
          <Box
            component="button"
            type="button"
            aria-label={t("nebulaChat:dock.forward10")}
            onClick={() => void nudge(10)}
            sx={(theme) => btn(theme)}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3.2A4.3 4.3 0 1 0 11.1 6.3" />
              <path d="M9.4 1.3l1.9 2-2.1 1.7" />
            </svg>
          </Box>
        </>
      )}

      {glass && (
        <VolumeControl
          volume={playback.volume}
          muted={playback.muted}
          glass
          onToggleMute={card.toggleMute}
          onSetVolume={card.setVolume}
          muteLabel={t("nebulaChat:dock.mute")}
          volumeLabel={t("nebulaChat:dock.volume")}
        />
      )}

      <Typography
        sx={(theme) => ({
          ml: glass ? "6px" : "5px",
          mr: "4px",
          fontFamily: "var(--nebula-mono, ui-monospace), monospace",
          fontSize: 10.5,
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          color: glass ? "#dfe4ec" : theme.palette.nebula.muted,
        })}
      >
        {clock(playback.current) + " / " + clock(playback.total)}
      </Typography>

      <Box
        component="button"
        type="button"
        aria-label={t("nebulaChat:dock.resync")}
        onClick={() => void requestState()}
        sx={(theme) => btn(theme)}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 7a5 5 0 1 1-1.5-3.5" />
          <path d="M12.2 1.6v2.9H9.3" />
        </svg>
      </Box>

      <Stack direction="row" alignItems="center" gap={glass ? "5px" : "3px"} sx={{ ml: "auto", flex: "none" }}>
        <Box
          component="button"
          type="button"
          aria-label={t("nebulaChat:dock.speed")}
          onClick={() => setSpeedOpen(!speedOpen)}
          sx={(theme) => pill(theme, glass, speedOpen)}
        >
          {playback.rate === 1 ? "1×" : `${playback.rate}×`}
        </Box>
        <Box
          component="button"
          type="button"
          aria-label={modeLabel}
          onClick={onMode}
          sx={(theme) => (glass ? pill(theme, true) : btn(theme))}
        >
          {glass ? (
            <>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="1.4" y="2.6" width="11.2" height="8.8" rx="2" />
                <rect x="6.8" y="6.6" width="5" height="4" rx="1.2" fill="currentColor" stroke="none" opacity=".55" />
              </svg>
              {modeLabel}
            </>
          ) : (
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.8 5V2.4c0-.3.3-.6.6-.6H5M9 1.8h2.6c.3 0 .6.3.6.6V5M12.2 9v2.6c0 .3-.3.6-.6.6H9M5 12.2H2.4a.6.6 0 0 1-.6-.6V9" />
            </svg>
          )}
        </Box>
        <Box
          component="button"
          type="button"
          onClick={() => void (isHost ? end() : leave())}
          sx={
            glass
              ? {
                  all: "unset",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  px: "9px",
                  height: 26,
                  borderRadius: "7px",
                  cursor: "pointer",
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: "#f0b0b0",
                  background: "rgba(217,87,87,.2)",
                  border: "1px solid rgba(217,87,87,.42)",
                  backdropFilter: "blur(10px)",
                  "&:hover": { background: "rgba(217,87,87,.3)" },
                }
              : (theme) => ({
                  all: "unset",
                  display: "inline-flex",
                  alignItems: "center",
                  px: "9px",
                  height: 26,
                  borderRadius: "7px",
                  cursor: "pointer",
                  fontSize: 11,
                  color: theme.palette.nebula.bad,
                  border: "1px solid " + theme.palette.nebula.line2,
                  "&:hover": { background: theme.palette.nebula.card2 },
                })
          }
        >
          {isHost ? t("nebulaChat:dock.end") : t("chat:watch.card.leave")}
        </Box>
      </Stack>
    </Stack>
  );
}

/** The corner panel. */
function MiniPanel({
  card,
  speedOpen,
  setSpeedOpen,
  onMode,
  setSlot,
  watching,
  live,
  onClose,
  isHost,
}: Readonly<Chrome & { onClose: () => void; isHost: boolean }>) {
  const { t } = useTranslation(["chat", "common", "nebulaChat"]);
  const { playback, canPlay, seek, nudge, session, adapterError, outOfSync, owns, explicitlyLeft, rejoin } =
    card;

  return (
    <Box
      sx={(theme) => ({
        position: "absolute",
        right: 18,
        bottom: 72,
        width: 440,
        maxWidth: "calc(100% - 36px)",
        zIndex: 6,
        borderRadius: radius("lg"),
        overflow: "hidden",
        color: theme.palette.nebula.text,
        border: "1px solid " + theme.palette.nebula.line2,
        background: theme.palette.nebula.tint + "," + theme.palette.nebula.bg0,
        boxShadow: theme.palette.nebula.shadow,
        backdropFilter: "blur(20px) saturate(1.2)",
      })}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap="7px"
        sx={(theme) => ({
          p: "9px 10px 9px 12px",
          borderBottom: "1px solid " + theme.palette.nebula.line,
        })}
      >
        {isHost && (
          <Typography
            sx={(theme) => ({
              flex: "none",
              p: "1px 6px",
              borderRadius: "5px",
              background: theme.palette.nebula.accentSoft,
              border: "1px solid " + theme.palette.nebula.accentLine,
              color: theme.palette.nebula.accent,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: ".04em",
            })}
          >
            {t("chat:watch.card.hostBadge")}
          </Typography>
        )}
        <Typography sx={{ fontWeight: 600, fontSize: 12, whiteSpace: "nowrap", flex: "none" }}>
          {t("chat:contextMenu.watchTogether")}
        </Typography>
        <Typography
          sx={(theme) => ({
            fontSize: 10.5,
            color: theme.palette.nebula.muted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          })}
        >
          {"· " + watching}
        </Typography>
        <Stack direction="row" alignItems="center" gap="3px" sx={{ ml: "auto", flex: "none" }}>
          <VolumeControl
            volume={playback.volume}
            muted={playback.muted}
            glass={false}
            onToggleMute={card.toggleMute}
            onSetVolume={card.setVolume}
            muteLabel={t("nebulaChat:dock.mute")}
            volumeLabel={t("nebulaChat:dock.volume")}
          />
          <Box
            component="button"
            type="button"
            aria-label={t("nebulaChat:dock.theater")}
            onClick={onMode}
            sx={(theme) => pill(theme, false)}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="1.4" y="2.6" width="11.2" height="8.8" rx="2" />
              <path d="M4.6 5.4h4.8v3.2H4.6z" />
            </svg>
            {t("nebulaChat:dock.theater")}
          </Box>
          <Box
            component="button"
            type="button"
            aria-label={t("common:actions.collapse")}
            onClick={onClose}
            sx={(theme) => iconBtn(theme)}
          >
            <CloseIcon width={11} height={11} />
          </Box>
        </Stack>
      </Stack>

      <Typography
        sx={(theme) => ({
          px: "12px",
          pt: "7px",
          fontSize: 11.5,
          color: theme.palette.nebula.dim,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        })}
      >
        {session?.title ?? session?.sourceUrl}
      </Typography>

      {/* The slot the player hovers over. Clicking it is clicking the video. */}
      <Box
        ref={setSlot}
        onClick={canPlay ? () => void (session?.state === "playing" ? card.pause() : card.play()) : undefined}
        sx={(theme) => ({
          mt: "7px",
          height: 200,
          cursor: canPlay ? "pointer" : "default",
          background: `repeating-linear-gradient(45deg,${theme.palette.nebula.card2} 0 12px,transparent 12px 24px)`,
        })}
      />

      {!owns && <Notice>{t("chat:watch.card.openElsewhere")}</Notice>}
      {explicitlyLeft && (
        <Box sx={{ p: "9px 11px 0" }}>
          <Box
            component="button"
            type="button"
            onClick={rejoin}
            sx={(theme) => pill(theme, false)}
          >
            {t("chat:watch.card.rejoin")}
          </Box>
        </Box>
      )}
      {adapterError && <Notice tone="bad">{adapterError}</Notice>}
      {outOfSync && <Notice tone="warn">{t("chat:watch.card.outOfSync")}</Notice>}

      {live && (
        <Box sx={{ p: "9px 11px 10px" }}>
          <SeekBar
            current={playback.current}
            total={playback.total}
            buffered={playback.buffered}
            glass={false}
            onSeek={canPlay ? (s) => void seek(s) : undefined}
            label={t("nebulaChat:dock.seek")}
          />
          <Transport
            card={card}
            glass={false}
            nudge={nudge}
            speedOpen={speedOpen}
            setSpeedOpen={setSpeedOpen}
            onMode={onMode}
            modeLabel={t("nebulaChat:dock.theater")}
            isHost={isHost}
          />
        </Box>
      )}
    </Box>
  );
}

/** The theater: the pane goes dark and the session takes the middle. */
function TheaterPanel({
  card,
  onMode,
  setSlot,
  hostName,
}: Readonly<Chrome & { hostName: string | null }>) {
  const { t } = useTranslation(["chat", "common", "nebulaChat"]);
  const { session, canPlay } = card;
  const users = useAppStore((state) => state.users);
  const ownSession = useAppStore((state) => state.ownSession);

  const watchers = useMemo(() => {
    if (!session) return [];
    return [...session.participants].map((participant) => {
      const user = users.find((entry) => entry.session === participant);
      return {
        session: participant,
        name: user?.name ?? (participant === ownSession ? "" : `#${participant}`),
        avatar: user ? getCachedUserAvatar(user.session, user.texture_size) : null,
        host: participant === session.hostSession,
      };
    });
  }, [session, users, ownSession]);

  return (
    <Box
      onClick={(event) => {
        // The backdrop takes you back to the corner; the panel does not.
        if (event.target === event.currentTarget) onMode();
      }}
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: "22px",
        background: "rgba(6,9,16,.55)",
        backdropFilter: "blur(6px)",
      }}
    >
      <Box
        sx={(theme) => ({
          width: "100%",
          maxWidth: 1000,
          p: "6px",
          borderRadius: radius("lg"),
          border: "1px solid " + theme.palette.nebula.line2,
          background: "rgba(110,165,255,.05)",
          backdropFilter: "blur(18px)",
          display: "grid",
          gridTemplateColumns: "1fr 176px",
          gap: "6px",
        })}
      >
        <Box
          ref={setSlot}
          onClick={canPlay ? () => void (session?.state === "playing" ? card.pause() : card.play()) : undefined}
          sx={{
            position: "relative",
            minWidth: 0,
            width: "100%",
            height: "min(52vh, 420px)",
            minHeight: 300,
            borderRadius: "11px",
            background: "#05070c",
            cursor: canPlay ? "pointer" : "default",
          }}
        />

        <Stack sx={{ gap: "6px", minHeight: 0 }}>
          <Stack direction="row" alignItems="center" gap="6px" sx={{ p: "2px 4px" }}>
            <Typography
              sx={(theme) => ({
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: ".07em",
                color: theme.palette.nebula.dim,
              })}
            >
              {t("nebulaChat:dock.watching")}
            </Typography>
            <Typography
              sx={(theme) => ({
                ml: "auto",
                fontFamily: "var(--nebula-mono, ui-monospace), monospace",
                fontSize: 10,
                fontWeight: 500,
                color: theme.palette.nebula.muted,
              })}
            >
              {watchers.length}
            </Typography>
          </Stack>
          {watchers.map((watcher) => (
            <Stack
              key={watcher.session}
              direction="row"
              alignItems="center"
              gap="8px"
              sx={(theme) => ({
                p: "6px 8px",
                borderRadius: "9px",
                background: theme.palette.nebula.card,
              })}
            >
              <UserAvatar size={20} name={watcher.name} src={watcher.avatar} />
              <Typography
                sx={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {watcher.name || hostName}
              </Typography>
              {watcher.host && (
                <Typography
                  sx={(theme) => ({
                    ml: "auto",
                    flex: "none",
                    fontSize: 9,
                    fontWeight: 700,
                    color: theme.palette.nebula.accent,
                  })}
                >
                  {t("chat:watch.card.hostBadge")}
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

function Notice({ children, tone }: Readonly<{ children: React.ReactNode; tone?: "bad" | "warn" }>) {
  return (
    <Typography
      sx={(theme) => ({
        px: "12px",
        pt: "8px",
        fontSize: 11.5,
        color:
          tone === "bad"
            ? theme.palette.nebula.bad
            : tone === "warn"
              ? theme.palette.nebula.warn
              : theme.palette.nebula.muted,
      })}
    >
      {children}
    </Typography>
  );
}

export default WatchDock;
