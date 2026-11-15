import { useTranslation } from "react-i18next";
import { Box, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useAppStore } from "@core/store";
import { Stack } from "./Stack";
import type { UserEntry } from "@core/types";
import { HeadphonesOffIcon, MicOffIcon, PriorityIcon, ScreenShareIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { voiceContextKind } from "@core/store/slices/voice";

/**
 * What a member's voice flags say about them, split by who set them.
 *
 * The distinction is the whole point of showing these: a server mute is
 * something that was done to you and that you cannot undo, a self mute is a
 * choice. The mock colours them accordingly - `bad` for the former, `dim` for
 * the latter - so they cannot be read as the same state.
 *
 * `suppress` counts as a server mute: the server is refusing to relay the
 * user's audio, which is what a listener needs to know, and Mumble has no
 * separate glyph for it.
 */
export function speakerState(user: UserEntry) {
  return {
    priority: user.priority_speaker,
    serverMuted: user.mute || user.suppress,
    serverDeafened: user.deaf,
    // Deafening implies muting, and the server flags win: a user who is both
    // server-muted and self-muted has one badge, the one they cannot lift.
    selfMuted: user.self_mute && !(user.mute || user.suppress),
    selfDeafened: user.self_deaf && !user.deaf,
  };
}

/**
 * The priority-speaker bolt.
 *
 * Sits directly after the name rather than out in the trailing group: it says
 * something about the person, not about the state of their microphone, and the
 * mock groups it with the name accordingly.
 */
export function PriorityBadge({ user }: Readonly<{ user: UserEntry }>) {
  const { t } = useTranslation("sidebar");
  if (!user.priority_speaker) return null;
  return (
    <Badge label={t("userListItem.prioritySpeakerTitle")} tone="warn">
      <PriorityIcon width={10} height={10} fill="currentColor" stroke="none" />
    </Badge>
  );
}

/**
 * Sharing their screen, and by which route.
 *
 * Standard's two words: "Live" where the server relays the stream, "P2P" where
 * viewers connect to the sharer directly. The route is the server's, not the
 * sharer's, so it is read off the server config. P2P keeps Standard's amber.
 */
export function LiveBadge({
  session,
  sessions,
}: Readonly<{
  /** One person, on their own row. */
  session?: number;
  /** A room, where its people are not listed one by one: live if any of them is. */
  sessions?: readonly number[];
}>) {
  const { t } = useTranslation("sidebar");
  const live = useAppStore((state) =>
    session !== undefined
      ? state.broadcastingSessions.has(session)
      : (sessions ?? []).some((each) => state.broadcastingSessions.has(each)),
  );
  const relayed = useAppStore((state) => !!state.serverConfig.webrtc_sfu_available);
  if (!live) return null;
  return (
    <Tooltip title={relayed ? t("userListItem.sharingScreenSfuTitle") : t("userListItem.sharingScreenP2PTitle")}>
      <Box
        component="span"
        data-live-badge={relayed ? "relayed" : "p2p"}
        sx={(theme) => {
          const tone = relayed ? theme.palette.nebula.bad : theme.palette.nebula.warn;
          return {
            display: "inline-flex",
            alignItems: "center",
            gap: "3px",
            flex: "none",
            height: 16,
            px: "5px",
            borderRadius: radius("sm"),
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: tone,
            background: alpha(tone, 0.15),
          };
        }}
      >
        <ScreenShareIcon width={10} height={10} />
        {relayed ? t("userListItem.liveBadge") : t("userListItem.liveBadgeP2P")}
      </Box>
    </Tooltip>
  );
}

/**
 * The mute and deafen badges.
 *
 * They sit beside the name, next to the priority bolt, rather than out at the
 * row's right edge: they qualify the person you are reading, and the trailing
 * slot belongs to the volume meter and the "you" marker, which are about the
 * row rather than about them.
 *
 * Renders nothing at all when the user is plain: a row of empty slots would
 * make every member look like they had a state worth reading.
 */
export function VoiceStateBadges({ user }: Readonly<{ user: UserEntry }>) {
  const { t } = useTranslation("sidebar");
  const state = speakerState(user);
  if (!state.serverMuted && !state.serverDeafened && !state.selfMuted && !state.selfDeafened) return null;
  return (
    <Stack direction="row" alignItems="center" gap="4px" sx={{ flex: "none" }}>
      {state.serverMuted && (
        <Badge label={t("userListItem.serverMutedTitle")} tone="bad">
          <MicOffIcon width={11} height={11} />
        </Badge>
      )}
      {state.serverDeafened && (
        <Badge label={t("userListItem.serverDeafenedTitle")} tone="bad">
          <HeadphonesOffIcon width={11} height={11} />
        </Badge>
      )}
      {state.selfMuted && (
        <Badge label={t("userListItem.selfMutedTitle")} tone="dim">
          <MicOffIcon width={11} height={11} />
        </Badge>
      )}
      {state.selfDeafened && (
        <Badge label={t("userListItem.selfDeafenedTitle")} tone="dim">
          <HeadphonesOffIcon width={11} height={11} />
        </Badge>
      )}
    </Stack>
  );
}

function Badge({
  label,
  tone,
  children,
}: Readonly<{ label: string; tone: "warn" | "bad" | "dim"; children: React.ReactNode }>) {
  return (
    <Tooltip title={label}>
      <Box
        component="span"
        role="img"
        aria-label={label}
        sx={(theme) => ({ display: "inline-flex", flex: "none", color: theme.palette.nebula[tone] })}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

/**
 * Says how a talking user reaches you when it is not the ordinary way.
 *
 * A whisper and a shout sound like everything else; without a mark the only
 * way to learn you were whispered to is to answer in front of the channel.
 */
export function VoiceContextBadge({ session }: Readonly<{ session: number }>) {
  const { t } = useTranslation("sidebar");
  const kind = useAppStore((state) =>
    state.talkingSessions.has(session) ? voiceContextKind(state.voiceContexts.get(session)) : null,
  );
  if (!kind) return null;
  return (
    <Tooltip title={kind === "whisper" ? t("userListItem.whisperingTitle") : t("userListItem.shoutingTitle")}>
      <Box
        component="span"
        data-voice-context-badge={kind}
        sx={(theme) => ({
          display: "inline-flex",
          alignItems: "center",
          flex: "none",
          height: 16,
          px: "5px",
          borderRadius: radius("sm"),
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: ".04em",
          textTransform: "uppercase",
          color: theme.palette.nebula.accent,
          background: theme.palette.nebula.accentSoft,
          border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.accentLine}`,
        })}
      >
        {kind === "whisper" ? t("userListItem.whisperBadge") : t("userListItem.shoutBadge")}
      </Box>
    </Tooltip>
  );
}
