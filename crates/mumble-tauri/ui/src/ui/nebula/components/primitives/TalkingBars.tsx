import { Box } from "@mui/material";

const HEIGHTS = [4, 9, 6];

/**
 * The three-bar voice meter beside a speaking member.
 *
 * Idle rows keep the meter's width so nothing shifts when someone starts
 * talking, but draw nothing: three grey pips on every member read as content
 * rather than as an inactive indicator.
 */
export function TalkingBars({ talking }: { talking: boolean }) {
  return (
    <Box
      aria-hidden
      sx={{
        display: "flex",
        gap: "2px",
        alignItems: "flex-end",
        height: 9,
        flex: "none",
        opacity: talking ? 1 : 0,
        transition: "opacity 120ms ease",
      }}
    >
      {HEIGHTS.map((height, index) => (
        <Box
          key={index}
          sx={(theme) => ({
            width: 3,
            height,
            borderRadius: "999px",
            background: theme.palette.nebula.ok,
          })}
        />
      ))}
    </Box>
  );
}
