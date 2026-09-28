import { Box, Typography, type TypographyProps } from "@mui/material";
import { useTheme } from "@mui/material/styles";

/**
 * The mock's tracked-out group heading: "JOIN AS", "SETTINGS", "ADMIN".
 *
 * A stencil skin sets these as italic caps and runs a dashed rule out to the
 * edge of the column, which is how that kind of design separates a section
 * without drawing a box around it. Every other skin gets the plain overline it
 * always had.
 */
export function SectionLabel(props: TypographyProps) {
  const stencil = useTheme().palette.nebulaSkin.chrome === "stencil";
  if (!stencil) return <Typography variant="overline" component="div" {...props} />;
  const { sx, children, ...rest } = props;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
      <Typography
        variant="overline"
        component="div"
        sx={[
          {
            fontStyle: "italic",
            fontWeight: 700,
            letterSpacing: ".18em",
            flex: "none",
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...rest}
      >
        {children}
      </Typography>
      <Box
        aria-hidden
        sx={(theme) => ({
          flex: 1,
          height: "var(--nebula-line-width, 1px)",
          minWidth: 12,
          background: `repeating-linear-gradient(90deg, ${theme.palette.nebula.line2} 0 6px, transparent 6px 10px)`,
        })}
      />
    </Box>
  );
}
