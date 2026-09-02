import { useMemo, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { isFriendChatOpen } from "../../friends";
import { useFriends } from "../../useFriends";
import { SearchBox } from "../primitives";
import { FriendList } from "./FriendList";
import { SidebarShell } from "./SidebarShell";

interface FriendsPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  /** Right-click a friend who is here: the client's one user menu. */
  onContextMenuUser?: (session: number, event: React.MouseEvent) => void;
  onHoverUser?: (session: number, event: React.MouseEvent) => void;
  onLeaveUser?: () => void;
}

/**
 * The Friends screen's left column.
 *
 * This is the whole screen as far as the shell is concerned - the conversation
 * beside it is the same pane the chat screen uses, because a friend chat is a
 * conversation like any other once it is open.
 *
 * It is a component rather than markup in `NebulaClientApp` so that its work is
 * scoped to it being on screen: resolving where a friend is asks the backend
 * once per friend per refresh, and there is no reason for that to run while the
 * user is reading a channel.
 */
export function FriendsPanel({
  query,
  onQueryChange,
  searchRef,
  onContextMenuUser,
  onHoverUser,
  onLeaveUser,
}: Readonly<FriendsPanelProps>) {
  const { t } = useTranslation(["nebulaSidebar", "common", "server"]);
  const friends = useFriends(query);
  const selectedDmUser = useAppStore((state) => state.selectedDmUser);
  const selectedChannel = useAppStore((state) => state.selectedChannel);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const channels = useAppStore((state) => state.channels);
  const users = useAppStore((state) => state.users);
  const ownSession = useAppStore((state) => state.ownSession);

  const activeId = useMemo(() => {
    const ownUserId = users.find((user) => user.session === ownSession)?.user_id ?? null;
    const state = { selectedDmUser, selectedChannel, activeServerId, channels, ownUserId };
    for (const group of friends.groups) {
      const open = group.entries.find((entry) => isFriendChatOpen(entry, state));
      if (open) return open.friend.id;
    }
    return null;
  }, [activeServerId, channels, friends.groups, ownSession, selectedChannel, selectedDmUser, users]);

  const pending = friends.pendingConnect;

  return (
    <>
      <SidebarShell
        title={t("server:tabsBar.friends")}
        search={
          <SearchBox
            value={query}
            onChange={onQueryChange}
            placeholder={t("nebulaSidebar:friends.search")}
            inputRef={searchRef}
          />
        }
      >
        <FriendList
          groups={friends.groups}
          activeId={activeId}
          onOpen={friends.open}
          onRemove={friends.remove}
          onContextMenu={onContextMenuUser}
          onHover={onHoverUser}
          onLeave={onLeaveUser}
          empty={
            friends.filtered
              ? t("nebulaSidebar:friends.noMatch")
              : t("nebulaSidebar:friends.empty")
          }
        />
      </SidebarShell>

      {/* A friend on a server that is not open cannot simply be clicked into:
          the connection has to be made first, and making one on the user's
          behalf is a decision rather than a side effect. */}
      <Dialog open={pending !== null} onClose={friends.cancelConnect} maxWidth="xs" fullWidth>
        <DialogContent data-testid={TID.friendsConnectPrompt}>
          <Typography sx={{ fontWeight: 600, fontSize: 14, mb: "6px" }}>
            {t("nebulaSidebar:friends.connectTitle")}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
            {pending
              ? t("nebulaSidebar:friends.connectBody", {
                  name: pending.userName,
                  server:
                    pending.serverLabel ??
                    pending.serverHost ??
                    t("nebulaSidebar:friends.anotherServer"),
                })
              : ""}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={friends.cancelConnect}>{t("common:actions.cancel")}</Button>
          <Button onClick={friends.confirmConnect} variant="contained" data-testid={TID.friendsConnect}>
            {t("server:password.connect")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
