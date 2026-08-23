import { Avatar, Box } from "@mui/material";
import { useUserAvatar } from "@core/lazyBlobs";
import { StatusDot, type Status } from "./StatusDot";

export function initials(name: string): string {
  return name
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

interface UserAvatarProps {
  name: string;
  session?: number | null;
  textureSize?: number | null;
  /** Pre-resolved data URL, for lists that batch their avatar fetches. */
  src?: string | null;
  size?: number;
  /** Green halo the mock puts around whoever is currently speaking. */
  talking?: boolean;
  /** Presence pip in the bottom-right corner; omitted when undefined. */
  status?: Status;
  square?: boolean;
  /**
   * Colour pair to fill the initials with, for subjects the design assigns a
   * colour rather than leaving on the neutral card fill - unbranded servers.
   */
  gradient?: { from: string; to: string } | null;
}

/**
 * A member's picture with the two states the mock draws on it: the speaking
 * halo and the presence pip. Falls back to initials, which is what most Mumble
 * users actually have - avatars are optional and lazily fetched.
 */
export function UserAvatar({
  name,
  session,
  textureSize,
  src,
  size = 32,
  talking = false,
  status,
  square = false,
  gradient = null,
}: Readonly<UserAvatarProps>) {
  // `src` wins so message lists can resolve hundreds of avatars in one hook.
  const lazy = useUserAvatar(src === undefined ? session : null, src === undefined ? textureSize : null);
  const image = src ?? lazy;

  return (
    <Box sx={{ position: "relative", flex: "none", width: size, height: size }}>
      <Avatar
        src={image ?? undefined}
        alt={name}
        variant={square ? "rounded" : "circular"}
        sx={(theme) => ({
          width: size,
          height: size,
          fontSize: Math.max(9, size * 0.38),
          background: gradient
            ? `linear-gradient(135deg,${gradient.from},${gradient.to})`
            : theme.palette.nebula.card2,
          color: gradient ? "#fff" : theme.palette.nebula.muted,
          borderRadius: square ? "28%" : "50%",
          boxShadow: talking
            ? `0 0 0 2px ${theme.palette.nebula.ok},0 0 14px ${theme.palette.nebula.ok}55`
            : "none",
          transition: "box-shadow 120ms ease",
        })}
      >
        {initials(name)}
      </Avatar>
      {status && (
        <Box
          sx={(theme) => ({
            position: "absolute",
            right: -1,
            bottom: -1,
            display: "flex",
            borderRadius: "50%",
            border: `2px solid ${theme.palette.nebula.bg0}`,
          })}
        >
          <StatusDot status={status} size={Math.max(6, size * 0.24)} />
        </Box>
      )}
    </Box>
  );
}
