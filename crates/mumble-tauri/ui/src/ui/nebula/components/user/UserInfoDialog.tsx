import { useEffect, useMemo, useState } from "react";
import { Alert, Dialog, Snackbar } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUserAvatar, useUserComment } from "@core/lazyBlobs";
import { parseComment } from "@core/profileFormat";
import { useAppStore } from "@core/store";
import type { BanEntry, UserEntry } from "@core/types";
import { useAclGroups } from "@ui/standard/hooks/useAclGroups";
import { userMenuActions } from "../../selectors";
import { groupsOf } from "./userCardModel";
import { describeBans, viewerIsAdmin } from "./userInfoModel";
import { useLiveUserStats } from "./useLiveUserStats";
import { useUserLocation } from "./useUserLocation";
import { UserInfoSheet } from "./UserInfoSheet";
import { invokeModeration, MoveUserDialog, type ModerationAction, type Note } from "./UserMenu";

interface UserInfoDialogProps {
  /** Whose sheet is open, or null for none. */
  session: number | null;
  onClose: () => void;
}

/**
 * The User Information sheet, over the shell.
 *
 * Opened from the (i) on a roster row or from the user menu, for anyone the
 * session knows - yourself included, since the server tells you the most
 * about your own connection. Gathers everything the sheet draws: the live
 * stats, the place behind the address, the resolver's name for it, the ban
 * list where the viewer may read one. Closes itself when the person leaves,
 * because a sheet about a session that no longer exists would only go stale.
 */
export function UserInfoDialog({ session, onClose }: Readonly<UserInfoDialogProps>) {
  const user = useAppStore((state) =>
    session === null ? undefined : state.users.find((entry) => entry.session === session),
  );

  useEffect(() => {
    if (session !== null && !user) onClose();
  }, [session, user, onClose]);

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      maxWidth={false}
      slotProps={{ paper: { sx: { m: "16px", overflow: "hidden" } } }}
    >
      {user && <UserInfoContent user={user} onClose={onClose} />}
    </Dialog>
  );
}

function UserInfoContent({ user, onClose }: Readonly<{ user: UserEntry; onClose: () => void }>) {
  const channels = useAppStore((state) => state.channels);
  const ownSession = useAppStore((state) => state.ownSession);
  const currentChannel = useAppStore((state) => state.currentChannel);
  const talking = useAppStore((state) => state.talkingSessions.has(user.session));
  const streamerMode = useAppStore((state) => state.streamerMode);
  const channel = channels.find((entry) => entry.id === user.channel_id);

  const avatar = useUserAvatar(user.session, user.texture_size);
  const liveComment = useUserComment(user.session, user.comment_size);
  const { profile, bio } = useMemo(() => {
    const comment = user.comment || liveComment;
    return comment ? parseComment(comment) : { profile: null, bio: "" };
  }, [user.comment, liveComment]);

  const actions = useMemo(
    () => userMenuActions({ user, channels, ownSession, currentChannel }),
    [user, channels, ownSession, currentChannel],
  );
  const admin = viewerIsAdmin(channels);
  const aclGroups = useAclGroups();
  const groups = useMemo(
    () => groupsOf(aclGroups, user.user_id).map((group) => group.name),
    [aclGroups, user.user_id],
  );

  const { stats, samples } = useLiveUserStats(user.session, true);
  const location = useUserLocation(stats?.address);
  const reverseDns = useReverseDns(stats?.address, !streamerMode);
  const bans = useBansAgainst(user, stats?.address, actions.canBan);

  const [moving, setMoving] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const moderate = (action: ModerationAction) => {
    void invokeModeration(action, user).catch((error: unknown) => {
      console.error(`user action "${action}" failed:`, error);
      setNote({ severity: "error", message: `Could not ${action} ${user.name}.` });
    });
  };

  return (
    <>
      <UserInfoSheet
        user={user}
        avatar={avatar}
        profile={profile}
        bio={bio}
        channelName={channel?.name ?? null}
        talking={talking}
        stats={stats}
        samples={samples}
        location={location}
        reverseDns={reverseDns}
        groups={groups}
        bans={bans}
        admin={admin}
        streamerMode={streamerMode}
        actions={actions}
        onClose={onClose}
        onModerate={moderate}
        onMove={() => setMoving(true)}
      />
      {moving && (
        <MoveUserDialog
          user={user}
          onClose={() => setMoving(false)}
          onDone={(done) => {
            setMoving(false);
            setNote(done);
          }}
        />
      )}
      <Snackbar
        open={note !== null}
        autoHideDuration={4000}
        onClose={() => setNote(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {note ? (
          <Alert severity={note.severity} variant="filled" onClose={() => setNote(null)}>
            {note.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}

/**
 * The resolver's name for the address, or null.
 *
 * Skipped in streamer mode along with everything else that names the person:
 * the lookup would put the address on the wire, and the row would be masked
 * anyway.
 */
function useReverseDns(address: string | null | undefined, enabled: boolean): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(null);
    if (!address || !enabled) return;
    let cancelled = false;
    void invoke<string | null>("reverse_dns", { address })
      .then((resolved) => {
        if (!cancelled) setName(resolved ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [address, enabled]);
  return name;
}

/**
 * What the ban list holds against this person, for a viewer who may read it.
 *
 * The list is asked for once per sheet rather than kept: it is an admin's
 * document, and the sheet is the only thing here reading it.
 */
function useBansAgainst(
  user: UserEntry,
  address: string | null | undefined,
  allowed: boolean,
): { count: number; note: string } | null {
  const [bans, setBans] = useState<BanEntry[] | null>(null);

  useEffect(() => {
    if (!allowed) {
      setBans(null);
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const off = await listen<BanEntry[]>("ban-list", (event) => {
        if (!cancelled) setBans(event.payload);
      });
      if (cancelled) {
        off();
        return;
      }
      unlisten = off;
      void invoke("request_ban_list").catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [allowed]);

  return useMemo(() => (bans ? describeBans(bans, user, address, Date.now()) : null), [bans, user, address]);
}
