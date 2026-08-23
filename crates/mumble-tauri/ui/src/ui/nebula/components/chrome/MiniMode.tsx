import { Box, Button, IconButton, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { selectMicLive, selectSelfDeafened } from "@core/store/voiceSelectors";
import type { UserEntry } from "@core/types";
import { HeadphonesIcon, HeadphonesOffIcon, MicIcon, MicOffIcon } from "@ui/icons";
import { NebulaSurface, TalkingBars, UserAvatar, Stack } from "../primitives";
import { radius } from "../../tokens";

interface MiniModeProps {
  serverLabel: string;
  channelName: string;
  occupants: readonly UserEntry[];
  ownSession: number | null;
  talkingSessions: ReadonlySet<number>;
  latencyMs: number | null;
  onExpand: () => void;
  /** Leave the server. Restores the full window first - see NebulaClientApp. */
  onLeave: () => void;
  /** Right-click on someone in the call - the same menu the full window opens. */
  onContextMenuUser?: (user: UserEntry, event: React.MouseEvent) => void;
}

/**
 * The compact overlay window: who is in the call and the three controls that
 * matter while you are doing something else. Everything here is a shortcut
 * into state the full window already owns - no mini-only behaviour.
 */
export function MiniMode({
  serverLabel,
  channelName,
  occupants,
  ownSession,
  talkingSessions,
  latencyMs,
  onExpand,
  onLeave,
  onContextMenuUser,
}: Readonly<MiniModeProps>) {
  const micLive = useAppStore(selectMicLive);
  const deafened = useAppStore(selectSelfDeafened);

  return (
    <NebulaSurface sx={{ width: 320, m: "80px auto", borderRadius: radius("xl") }}>
      <Stack
        direction="row"
        alignItems="center"
        gap={1.125}
        data-tauri-drag-region
        sx={(theme) => ({ px: "13px", py: "11px", borderBottom: `1px solid ${theme.palette.nebula.line}` })}
      >
        <Box
          aria-hidden
          sx={(theme) => ({
            width: 20,
            height: 20,
            borderRadius: radius("sm"),
            display: "grid",
            placeItems: "center",
            background: theme.palette.nebula.accent,
            color: "#fff",
            fontWeight: 700,
            fontSize: 11,
          })}
        >
          M
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 12.5 }} noWrap>
            {channelName}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })} noWrap>
            {serverLabel}
            {latencyMs != null && ` · ${latencyMs} ms`}
          </Typography>
        </Box>
        <IconButton size="small" aria-label="Expand window" sx={{ ml: "auto" }} onClick={onExpand}>
          ⤢
        </IconButton>
      </Stack>

      <Stack sx={{ px: "10px", py: "8px", gap: "1px" }}>
        {occupants.map((user) => (
          <Stack
            key={user.session}
            direction="row"
            alignItems="center"
            gap={1.125}
            onContextMenu={onContextMenuUser ? (event) => onContextMenuUser(user, event) : undefined}
            sx={{ px: "8px", py: "6px" }}
          >
            <UserAvatar
              name={user.name}
              session={user.session}
              textureSize={user.texture_size}
              size={22}
              talking={talkingSessions.has(user.session)}
            />
            <Typography sx={{ fontSize: 12.5 }} noWrap>
              {user.name}
            </Typography>
            {user.session === ownSession ? (
              <Typography sx={(theme) => ({ ml: "auto", fontSize: 9.5, color: theme.palette.nebula.dim })}>
                you
              </Typography>
            ) : (
              <Box sx={{ ml: "auto", display: "flex" }}>
                <TalkingBars talking={talkingSessions.has(user.session)} />
              </Box>
            )}
          </Stack>
        ))}
      </Stack>

      <Stack direction="row" gap={0.75} sx={{ px: "10px", pt: "8px", pb: "12px" }}>
        <IconButton
          aria-label={micLive ? "Mute" : "Unmute"}
          onClick={() => void useAppStore.getState().toggleMute()}
          sx={(theme) => ({
            flex: 1,
            height: 30,
            borderRadius: radius("md"),
            background: theme.palette.nebula.card2,
          })}
        >
          {micLive ? <MicIcon width={13} height={13} /> : <MicOffIcon width={13} height={13} />}
        </IconButton>
        <IconButton
          aria-label={deafened ? "Undeafen" : "Deafen"}
          onClick={() => void useAppStore.getState().toggleDeafen()}
          sx={(theme) => ({
            flex: 1,
            height: 30,
            borderRadius: radius("md"),
            background: theme.palette.nebula.card2,
          })}
        >
          {deafened ? (
            <HeadphonesOffIcon width={13} height={13} />
          ) : (
            <HeadphonesIcon width={13} height={13} />
          )}
        </IconButton>
        <Button
          variant="outlined"
          // Same meaning as the sidebar dock's: leave the server.
          onClick={onLeave}
          sx={(theme) => ({ flex: 1.8, height: 30, fontSize: 11.5, color: theme.palette.nebula.bad })}
        >
          Leave
        </Button>
      </Stack>
    </NebulaSurface>
  );
}
