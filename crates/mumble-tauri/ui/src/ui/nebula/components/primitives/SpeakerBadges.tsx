import { Box, Tooltip } from "@mui/material";
import { Stack } from "./Stack";
import type { UserEntry } from "@core/types";
import { HeadphonesOffIcon, MicOffIcon, PriorityIcon } from "@ui/icons";

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
  if (!user.priority_speaker) return null;
  return (
    <Badge label="Priority speaker" tone="warn">
      <PriorityIcon width={10} height={10} fill="currentColor" stroke="none" />
    </Badge>
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
  const state = speakerState(user);
  if (!state.serverMuted && !state.serverDeafened && !state.selfMuted && !state.selfDeafened) return null;
  return (
    <Stack direction="row" alignItems="center" gap="4px" sx={{ flex: "none" }}>
      {state.serverMuted && (
        <Badge label="Server muted" tone="bad">
          <MicOffIcon width={11} height={11} />
        </Badge>
      )}
      {state.serverDeafened && (
        <Badge label="Server deafened" tone="bad">
          <HeadphonesOffIcon width={11} height={11} />
        </Badge>
      )}
      {state.selfMuted && (
        <Badge label="Muted (self)" tone="dim">
          <MicOffIcon width={11} height={11} />
        </Badge>
      )}
      {state.selfDeafened && (
        <Badge label="Deafened (self)" tone="dim">
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
