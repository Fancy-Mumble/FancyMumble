import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Popover, Typography } from "@mui/material";
import { useUserAvatars } from "@core/lazyBlobs";
import type { UserEntry } from "@core/types";
import {
  MAX_DISPLAYED_MEMBERS,
  membersForChannelMention,
  membersForRole,
  type MentionChip,
} from "@core/utils/mentions";
import { useAppStore } from "@core/store";
import { useAclGroups } from "@standard/hooks/useAclGroups";
import { Stack, UserAvatar } from "../primitives";
import { floatingSurface } from "../../theme";
import { radius } from "../../tokens";

export interface MentionTarget {
  chip: MentionChip;
  /** The chip's own bottom-left corner, so the panel hangs under the word. */
  at: { x: number; y: number };
}

interface MentionPopoverProps {
  target: MentionTarget | null;
  onClose: () => void;
}

/** Fixed, because the list inside scrolls rather than the panel growing. */
const PANEL_WIDTH = 264;

/**
 * Who a mention in a message actually stands for.
 *
 * A chip naming one person opens that person's card - the same card every
 * other surface in this window opens on them - so this panel answers the
 * chips that name a *group*: a role, `@everyone`, `@here`. It also answers the
 * one case a card cannot, a mention of somebody who has since disconnected,
 * because "@lorelando" going quietly inert reads as the chip being broken
 * rather than as the person being gone.
 *
 * The membership rules are core's, shared with Standard: a role is resolved
 * through the root channel's ACL, and `@everyone` means everyone in *this*
 * channel, which is the scope the sender's renderer used.
 */
export function MentionPopover({ target, onClose }: Readonly<MentionPopoverProps>) {
  const users = useAppStore((state) => state.users);
  const selectedChannel = useAppStore((state) => state.selectedChannel);
  const aclGroups = useAclGroups();

  const members = useMemo<readonly UserEntry[]>(() => {
    if (!target) return [];
    if (target.chip.kind === "role") return membersForRole(users, target.chip.role, aclGroups);
    if (target.chip.kind === "user") return [];
    return membersForChannelMention(users, selectedChannel);
  }, [target, users, aclGroups, selectedChannel]);

  // Only the rows the panel draws are worth a picture, and none at all while
  // it is closed: a role on a busy server can name a hundred people. Memoised
  // because the fetch hook re-runs on a fresh array rather than a fresh list.
  const { t } = useTranslation("nebulaChat");
  const shown = useMemo(() => members.slice(0, MAX_DISPLAYED_MEMBERS), [members]);
  const avatars = useUserAvatars(shown);
  const overflow = members.length - shown.length;

  if (!target) return null;

  const { chip } = target;
  const title = chip.kind === "role" ? `@${chip.role}` : chip.kind === "everyone" ? "@everyone" : "@here";
  const subtitle =
    chip.kind === "role" ? t("mention.onlineMembers") : t("mention.channelMembers");
  // The heading is the chip, enlarged, so it takes the chip's own colour -
  // `@everyone` reading in the accent while the word it came from is amber
  // makes the panel look like it belongs to a different mention.
  const headingColor = chip.kind === "role" ? "accent" : "warn";

  return (
    <Popover
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: target.at.y, left: target.at.x }}
      // The panel is a lookup, not a decision: taking focus off the message
      // would leave the reader's place behind when it closes, and locking the
      // page for it shifts the whole conversation sideways under the pointer.
      disableAutoFocus
      disableEnforceFocus
      disableScrollLock
      slotProps={{
        paper: {
          sx: (theme) => ({
            width: PANEL_WIDTH,
            maxHeight: "min(60vh, 420px)",
            display: "flex",
            flexDirection: "column",
            borderRadius: radius("lg"),
            ...floatingSurface(theme),
            backdropFilter: "blur(20px) saturate(1.2)",
          }),
        },
      }}
    >
      {chip.kind === "user" ? (
        <Typography sx={(theme) => ({ p: "16px", fontSize: 12.5, color: theme.palette.nebula.muted })}>
          {t("mention.gone")}
        </Typography>
      ) : (
        <>
          <Stack sx={{ flex: "none", px: "13px", pt: "11px", pb: "8px" }}>
            <Stack direction="row" alignItems="baseline" gap={1}>
              <Typography
                sx={(theme) => ({
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: theme.palette.nebula[headingColor],
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                })}
              >
                {title}
              </Typography>
              <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
                {members.length}
              </Typography>
            </Stack>
            <Typography
              sx={(theme) => ({
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: theme.palette.nebula.dim,
              })}
            >
              {subtitle}
            </Typography>
          </Stack>
          {members.length === 0 ? (
            <Typography
              sx={(theme) => ({
                px: "13px",
                pb: "14px",
                fontSize: 12.5,
                color: theme.palette.nebula.muted,
              })}
            >
              {t("mention.empty")}
            </Typography>
          ) : (
            <Stack gap="1px" sx={{ overflowY: "auto", px: "6px", pb: "7px" }}>
              {shown.map((member) => (
                <Stack
                  key={member.session}
                  direction="row"
                  alignItems="center"
                  gap={1}
                  sx={(theme) => ({
                    px: "7px",
                    py: "4px",
                    borderRadius: radius("sm"),
                    "&:hover": { background: theme.palette.nebula.hover },
                  })}
                >
                  <UserAvatar
                    name={member.name}
                    session={member.session}
                    src={avatars.get(member.session) ?? null}
                    size={22}
                  />
                  <Typography
                    sx={{
                      minWidth: 0,
                      fontSize: 12.5,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {member.name}
                  </Typography>
                </Stack>
              ))}
              {overflow > 0 && (
                <Typography
                  sx={(theme) => ({
                    px: "7px",
                    pt: "5px",
                    fontSize: 11.5,
                    fontStyle: "italic",
                    color: theme.palette.nebula.muted,
                  })}
                >
                  +{overflow} more
                </Typography>
              )}
            </Stack>
          )}
        </>
      )}
    </Popover>
  );
}
