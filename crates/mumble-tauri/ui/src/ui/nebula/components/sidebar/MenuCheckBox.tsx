import { Box } from "@mui/material";
import { CheckIcon } from "@ui/icons";
import { radius } from "../../tokens";

/**
 * The mock's tick box a menu row leads with: filled with the accent when on,
 * an empty chip when off. Shared by every sidebar menu that toggles the same
 * preference, so the setting looks the same wherever it is reached from.
 */
export function MenuCheckBox({ checked }: Readonly<{ checked: boolean }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        width: 15,
        height: 15,
        borderRadius: radius("sm"),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        color: "#fff",
        background: checked ? theme.palette.nebula.accent : theme.palette.nebula.card2,
        border: `1px solid ${checked ? theme.palette.nebula.accent : theme.palette.nebula.line2}`,
      })}
    >
      {checked && <CheckIcon width={9} height={9} strokeWidth={3} />}
    </Box>
  );
}
