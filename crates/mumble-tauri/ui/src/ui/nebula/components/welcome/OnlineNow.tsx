/**
 * Who is on the server, right now.
 *
 * The one part of a designed greeting whose value cannot be compiled. Every
 * other block is decided when the operator saves the sheet; how many people are
 * online is only true at the moment somebody looks. A number frozen into the
 * markup would be wrong by the first join, and one substituted by the server at
 * handshake would still be stale by the time the same greeting is sitting in
 * the pinned panel an hour later.
 *
 * So the compiler leaves a marker and this is what fills it: real faces and a
 * real count, read from the client's own user list, which the store keeps in
 * step with the server for as long as the greeting is on screen.
 */
import { useMemo } from "react";
import { Box } from "@mui/material";
import { useAppStore } from "@core/store";
import { UserAvatar } from "../primitives";

/** How many faces to draw when the design does not say. */
const FACES = 3;

/** How far each disc slides under the one before it, as a share of its size. */
const OVERLAP = 0.36;

/** The ring that separates one overlapping face from the next. */
const RING = 2;

export interface OnlineNowProps {
  /** The word after the number. The operator's, so it can be theirs. */
  readonly label?: string;
  /** How many faces before the rest become a count. */
  readonly faces?: number;
  /**
   * How tall the whole row is, ring included.
   *
   * The row height rather than the disc diameter, because the row height is
   * what the design reserved for this block on the sheet: a disc drawn at the
   * reserved height would be two rings taller than the space it was given, and
   * everything below it would move by four pixels the moment the component
   * arrived.
   */
  readonly height?: number;
}

/**
 * The people to draw, and how many there are.
 *
 * Sorted by name rather than by session so the cluster does not reshuffle every
 * time somebody reconnects: a greeting that is read twice should look the same
 * both times unless the room actually changed.
 *
 * Exported for the tests, which is the only way to check the picking without
 * standing up a store.
 */
export function pickOnline<T extends { session: number; name: string }>(
  users: readonly T[],
  faces: number,
): { shown: T[]; total: number } {
  const ordered = [...users].sort((a, b) => a.name.localeCompare(b.name) || a.session - b.session);
  return { shown: ordered.slice(0, Math.max(0, faces)), total: ordered.length };
}

export function OnlineNow({ label, faces = FACES, height = 34 }: Readonly<OnlineNowProps>) {
  const users = useAppStore((state) => state.users);
  // The ring is drawn outside the disc, so it comes out of the row's height.
  const size = Math.max(8, height - RING * 2);
  const { shown, total } = useMemo(() => pickOnline(users, faces), [users, faces]);

  // Nobody online is not a state worth drawing a cluster for - and it is what
  // every surface outside a connected session sees, including the operator's
  // own preview. The words alone are the honest answer there.
  if (total === 0) {
    return (
      <Box component="span" sx={{ display: "inline-block" }}>
        {label ?? "online"}
      </Box>
    );
  }

  return (
    <Box
      component="span"
      sx={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle" }}
    >
      {shown.map((user, index) => (
        <Box
          key={user.session}
          component="span"
          sx={{
            display: "inline-flex",
            // Each disc slides under the one before it. The ring is the
            // greeting's own background, which is what separates two faces
            // that overlap - without it a cluster reads as one smear.
            ml: index === 0 ? 0 : `${-Math.round(size * OVERLAP)}px`,
            borderRadius: "50%",
            // Painted from the surface behind rather than a fixed colour, so
            // the cluster works on whatever the design put underneath it.
            border: `${RING}px solid`,
            borderColor: "background.default",
            position: "relative",
            zIndex: shown.length - index,
          }}
        >
          <UserAvatar name={user.name} session={user.session} textureSize={user.texture_size} size={size} />
        </Box>
      ))}
      <Box
        component="span"
        sx={(theme) => ({
          display: "inline-flex",
          alignItems: "center",
          height,
          ml: `${-Math.round(size * OVERLAP)}px`,
          pl: `${Math.round(size * OVERLAP) + 10}px`,
          pr: "12px",
          borderRadius: 999,
          background: theme.palette.nebula.card,
          border: `1px solid ${theme.palette.nebula.line2}`,
          color: theme.palette.nebula.muted,
          fontSize: Math.max(10, Math.round(size * 0.4)),
          fontWeight: 510,
          whiteSpace: "nowrap",
        })}
      >
        {total} {label ?? "online"}
      </Box>
    </Box>
  );
}
