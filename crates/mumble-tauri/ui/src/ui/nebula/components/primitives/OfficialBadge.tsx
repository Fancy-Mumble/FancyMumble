import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import { ShieldCheckIcon } from "@ui/icons";
import { radius } from "../../tokens";

/**
 * The mark beside a first-party plugin's name.
 *
 * Standard's badge is a fixed blue; here it is the window's accent, because a
 * server's livery repaints the page around it and one hardcoded blue chip in a
 * green list reads as a rendering fault rather than as a stamp of origin.
 */
export function OfficialBadge() {
  const { t } = useTranslation("common");
  return (
    <Box
      component="span"
      title={t("officialBadge.title")}
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        flex: "none",
        verticalAlign: "middle",
        px: "6px",
        py: "2px",
        borderRadius: radius("sm"),
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: theme.palette.nebula.accent,
        background: theme.palette.nebula.accentSoft,
        border: `1px solid ${theme.palette.nebula.accentLine}`,
      })}
    >
      <ShieldCheckIcon width={11} height={11} />
      {t("officialBadge.label")}
    </Box>
  );
}
