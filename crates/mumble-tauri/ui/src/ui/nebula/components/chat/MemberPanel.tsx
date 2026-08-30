import { Box, IconButton, Typography } from "@mui/material";
import type { UserEntry } from "@core/types";
import { CloseIcon, InfoIcon } from "@ui/icons";
import { SearchBox, TalkingBars, UserAvatar, Stack } from "../primitives";
import { radius } from "../../tokens";

interface MemberPanelProps {
  members: readonly UserEntry[];
  scope: "channel" | "server";
  onScopeChange: (scope: "channel" | "server") => void;
  query: string;
  onQueryChange: (query: string) => void;
  talkingSessions: ReadonlySet<number>;
  ownSession: number | null;
  onSelect: (session: number, event: React.MouseEvent) => void;
  onHover: (session: number, event: React.MouseEvent) => void;
  onLeave: () => void;
  /** Right-click on a member row. */
  onContextMenu?: (user: UserEntry, event: React.MouseEvent) => void;
  /** The (i) at the end of every row: open the User Information sheet. */
  onInfo?: (session: number) => void;
  onClose: () => void;
}

/** The optional right-hand roster, opened from the channel menu. */
export function MemberPanel({
  members,
  scope,
  onScopeChange,
  query,
  onQueryChange,
  talkingSessions,
  ownSession,
  onSelect,
  onHover,
  onLeave,
  onContextMenu,
  onInfo,
  onClose,
}: Readonly<MemberPanelProps>) {
  return (
    <Stack
      component="aside"
      aria-label="Members"
      sx={(theme) => ({
        width: 260,
        flex: "none",
        minHeight: 0,
        borderLeft: `1px solid ${theme.palette.nebula.line}`,
        background: theme.palette.nebula.panel,
      })}
    >
      <Stack direction="row" alignItems="center" sx={{ px: "14px", pt: "14px", pb: "8px" }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Members</Typography>
        <IconButton size="small" aria-label="Close members" sx={{ ml: "auto" }} onClick={onClose}>
          <CloseIcon width={13} height={13} />
        </IconButton>
      </Stack>

      <Stack direction="row" gap={0.5} sx={{ px: "12px", pb: "8px" }}>
        {(["channel", "server"] as const).map((option) => (
          <Box
            key={option}
            component="button"
            onClick={() => onScopeChange(option)}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              flex: 1,
              textAlign: "center",
              py: "5px",
              borderRadius: radius("md"),
              fontSize: 11.5,
              fontWeight: 500,
              color: scope === option ? theme.palette.nebula.text : theme.palette.nebula.muted,
              background: scope === option ? theme.palette.nebula.card2 : "transparent",
              "&:hover": { background: theme.palette.nebula.hover },
            })}
          >
            {option === "channel" ? "This channel" : "Server"}
          </Box>
        ))}
      </Stack>

      <Box sx={{ px: "12px", pb: "6px" }}>
        <SearchBox value={query} onChange={onQueryChange} placeholder="Find a member" />
      </Box>

      <Box
        component="ul"
        sx={{ flex: 1, overflowY: "auto", listStyle: "none", m: 0, p: "4px 8px", minHeight: 0 }}
      >
        {members.map((member) => (
          <Stack
            component="li"
            key={member.session}
            direction="row"
            alignItems="center"
            gap={1.125}
            onClick={(event) => onSelect(member.session, event)}
            onMouseEnter={(event) => onHover(member.session, event)}
            onMouseLeave={onLeave}
            onContextMenu={onContextMenu ? (event) => onContextMenu(member, event) : undefined}
            sx={(theme) => ({
              px: "8px",
              py: "6px",
              borderRadius: radius("md"),
              cursor: "pointer",
              opacity: member.session < 0 ? 0.6 : 1,
              "&:hover": { background: theme.palette.nebula.hover },
            })}
          >
            <UserAvatar
              name={member.name}
              session={member.session}
              textureSize={member.texture_size}
              size={24}
              talking={talkingSessions.has(member.session)}
            />
            <Typography sx={{ fontSize: 12.5 }} noWrap>
              {member.name}
            </Typography>
            {member.session === ownSession ? (
              <Typography sx={(theme) => ({ ml: "auto", fontSize: 9.5, color: theme.palette.nebula.dim })}>
                you
              </Typography>
            ) : (
              <Box sx={{ ml: "auto", display: "flex" }}>
                <TalkingBars talking={talkingSessions.has(member.session)} />
              </Box>
            )}
            {onInfo && (
              <IconButton
                size="small"
                aria-label={`Information about ${member.name}`}
                // The row itself opens the card; this opens the sheet instead.
                onClick={(event) => {
                  event.stopPropagation();
                  onInfo(member.session);
                }}
                sx={(theme) => ({ p: "2px", color: theme.palette.nebula.dim, flex: "none" })}
              >
                <InfoIcon width={13} height={13} />
              </IconButton>
            )}
          </Stack>
        ))}
      </Box>
    </Stack>
  );
}
