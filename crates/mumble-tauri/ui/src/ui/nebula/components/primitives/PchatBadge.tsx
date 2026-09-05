import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { PchatProtocol } from "@core/types";
import { radius } from "../../tokens";

/** What a protocol is called and how it is toned. `title` is the long form. */
const BADGES = {
  fancy_v1_full_archive: { labelKey: "pchatBadge.labelFancy", titleKey: "pchatBadge.titleFancy" },
  signal_v1: { labelKey: "pchatBadge.labelSignal", titleKey: "pchatBadge.titleSignal" },
} as const;

/**
 * The mark on a channel row saying its history is kept, and under which
 * protocol.
 *
 * The wording is Standard's - the two protocols are the same two things in
 * either design, and a second set of names for them would be a second thing to
 * translate. What is redrawn is the pill: Standard paints it in a fixed
 * `--color-badge-*` (a hot pink for Fancy), which a server's livery would sit
 * a whole page of its own colour behind. Here Fancy takes the window's accent,
 * being the house protocol, and Signal the "ok" tone - two hues that both move
 * with the theme and still read apart at 9.5px.
 */
export function PchatBadge({ protocol }: Readonly<{ protocol: PchatProtocol | undefined }>) {
  const { t } = useTranslation("sidebar");
  if (!protocol || protocol === "none") return null;
  const badge = BADGES[protocol as keyof typeof BADGES];
  if (!badge) return null;

  const fancy = protocol === "fancy_v1_full_archive";
  return (
    <Box
      component="span"
      title={t(badge.titleKey)}
      data-pchat-protocol={protocol}
      sx={(theme) => {
        const { nebula } = theme.palette;
        return {
          display: "inline-flex",
          alignItems: "center",
          flex: "none",
          px: "5px",
          py: "1px",
          borderRadius: radius("sm"),
          fontSize: 9.5,
          fontWeight: 600,
          lineHeight: 1.5,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: fancy ? nebula.accent : nebula.ok,
          background: fancy ? nebula.accentSoft : `${nebula.ok}24`,
          border: `1px solid ${fancy ? nebula.accentLine : `${nebula.ok}55`}`,
        };
      }}
    >
      {t(badge.labelKey)}
    </Box>
  );
}
