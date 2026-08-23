import { Typography, type TypographyProps } from "@mui/material";

/** The mock's tracked-out group heading: "JOIN AS", "SETTINGS", "ADMIN". */
export function SectionLabel(props: TypographyProps) {
  return <Typography variant="overline" component="div" {...props} />;
}
