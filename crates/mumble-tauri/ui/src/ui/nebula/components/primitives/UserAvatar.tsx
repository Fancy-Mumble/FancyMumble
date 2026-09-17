import { keyframes } from "@emotion/react";
import { Avatar, Box } from "@mui/material";
import { useUserAvatar } from "@core/lazyBlobs";
import { radius } from "../../tokens";
import { StatusDot, type Status } from "./StatusDot";
import { alpha, lighten, useTheme } from "@mui/material/styles";

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
   * Whether a drawn skin may hang its halo over this face.
   *
   * It normally may, and the caller does not get a say - the mark belongs to
   * the theme. The exception is a row too short to hold one: overlapped faces
   * in a call bar have the band's own rule where the halo would go, and two of
   * them side by side come out as a pair of spectacles.
   */
  halo?: boolean;
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
  halo = true,
  gradient = null,
}: Readonly<UserAvatarProps>) {
  // A halo belongs to the theme, not the caller, so it is read here.
  const stencil = useTheme().palette.nebulaSkin.chrome === "stencil";
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
          // Both shapes are the theme's, not this component's. A rail tile is
          // the one square avatar in the pack and takes the rail step; every
          // other avatar takes the avatar step, which is a circle in most skins
          // and a hard 0px in the ones that square everything off.
          borderRadius: square ? radius("rail") : radius("avatar"),
          // The stencil ring is the artboard's: every face is outlined in the
          // window's own navy, and speaking still overrides it.
          boxShadow: talking
            ? `0 0 0 2px ${theme.palette.nebula.ok},0 0 14px ${theme.palette.nebula.ok}55`
            : stencil
              ? `0 0 0 2px ${theme.palette.nebula.railLine}`
              : "none",
          transition: "box-shadow 120ms ease",
        })}
      >
        {initials(name)}
      </Avatar>
      {/* A stencil skin rings each avatar: an ellipse floating just above the
          head, which is the mark that skin is built around. Drawn here rather
          than per caller so every face in the pack gets one - but only a face:
          `square` is the server tile on the rail, and a halo over a server
          reads as a bug rather than as the mark. */}
      {stencil && !square && halo && <StencilHalo size={size} talking={talking} />}
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

/**
 * The gold ellipse a stencil skin floats above every face - the mark the skin
 * is named for, so it is lit rather than merely outlined.
 *
 * Three layers make the light. The ring itself carries a warm bloom, spilling
 * outward and back into the hole it encloses, so the halo sits in its own
 * glow instead of being a flat wire. Over it a near-white glint travels the
 * ring, which is what reads as *shine* rather than as colour: a highlight has
 * to move across a surface for the eye to call it one. And the whole thing
 * brightens for whoever is speaking, the one state the pack already lights an
 * avatar for - the green ring on the face and the halo above it lift
 * together.
 *
 * The glint is decoration, so it stops for `prefers-reduced-motion`; the
 * bloom stays, because a still glow is not motion.
 */
/**
 * The glint that travels along a stencil skin's halo.
 *
 * Declared here rather than inside the `sx` below, because `sx` is evaluated
 * and serialised for every element it is given to: written there, these four
 * lines were turned into CSS again for every face on screen, on every render
 * that reached one - and a busy channel draws a face per message block, per
 * roster row and per occupant in the tree.
 */
const HALO_GLINT = keyframes({
  // A pause between passes: the glint crosses in the first third and the halo
  // is left to simply glow for the rest.
  "0%": { backgroundPosition: "-120% 0" },
  "38%, 100%": { backgroundPosition: "220% 0" },
});

function StencilHalo({ size, talking }: Readonly<{ size: number; talking: boolean }>) {
  const height = Math.max(6, size * 0.26);
  return (
    <Box
      aria-hidden
      sx={(theme) => {
        const gold = theme.palette.nebula.accent2;
        return {
          position: "absolute",
          left: "50%",
          top: -Math.max(4, size * 0.19),
          transform: "translateX(-50%)",
          width: size * 0.85,
          height,
          borderRadius: "50%",
          border: `var(--nebula-line-width, 1px) solid ${gold}`,
          // Scaled off the ring's own thickness so a 20px avatar in a message
          // row and a 72px one on a profile card wear the same halo, rather
          // than the small one drowning in a glow sized for the large one.
          boxShadow: [
            `0 0 ${height * 0.5}px ${alpha(gold, talking ? 0.95 : 0.7)}`,
            `0 0 ${height * 1.7}px ${alpha(gold, talking ? 0.6 : 0.36)}`,
            `inset 0 0 ${height * 0.45}px ${alpha(gold, talking ? 0.55 : 0.32)}`,
          ].join(","),
          pointerEvents: "none",
          "&::after": {
            content: '""',
            position: "absolute",
            // Back out over the border, which is the surface being lit.
            inset: "calc(var(--nebula-line-width, 1px) * -1)",
            borderRadius: "50%",
            // The mask keeps the sweep on the ring: the padding box is the
            // hole, and excluding it from the border box leaves exactly the
            // stroke. Without it the highlight washes across the face below.
            padding: "var(--nebula-line-width, 1px)",
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            // Travelling left to right rather than spinning: the ring is an
            // ellipse, and rotating the box that draws it would wobble the
            // shape instead of moving light along it.
            background: `linear-gradient(90deg, transparent 34%, ${alpha(
              lighten(gold, 0.55),
              0.85,
            )} 44%, #ffffff 50%, ${alpha(lighten(gold, 0.55), 0.85)} 56%, transparent 66%)`,
            backgroundSize: "260% 100%",
            backgroundRepeat: "no-repeat",
            animation: `${HALO_GLINT} 3.4s ease-in-out infinite`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none", opacity: 0 },
          },
        };
      }}
    />
  );
}
