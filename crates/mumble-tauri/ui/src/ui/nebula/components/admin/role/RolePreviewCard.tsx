import { Box, Typography, alpha } from "@mui/material";
import { useTranslation } from "react-i18next";
import { radius } from "../../../tokens";
import { RoleChip, Stack } from "../../primitives";

export interface RolePreviewCardProps {
  readonly name: string;
  readonly color?: string | null;
  readonly icon?: number[] | null;
  /** Sample username drawn in the preview. */
  readonly sampleUsername?: string;
}

/**
 * What a role will look like once it is saved.
 *
 * Three places show a role's colour and none of them is this card: the chip in
 * a list, an author's name in the conversation, and a mention inside a message.
 * So the preview draws all three rather than a swatch - the question being
 * answered is "is this readable", and a square of colour cannot answer it.
 */
export function RolePreviewCard({ name, color, icon, sampleUsername }: RolePreviewCardProps) {
  const { t } = useTranslation("settings");
  const resolvedUsername = sampleUsername ?? t("roleDisplay.previewSampleUser");
  const label = name || t("roleDisplay.previewRoleFallback");

  return (
    <Stack
      gap={1.25}
      sx={(theme) => ({
        px: "16px",
        py: "14px",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Typography
        sx={(theme) => ({
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: theme.palette.nebula.dim,
        })}
      >
        {t("roleDisplay.previewTitle")}
      </Typography>

      <Box>
        <RoleChip name={label} color={color} icon={icon} size="large" />
      </Box>

      <Stack direction="row" alignItems="baseline" gap={0.5}>
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: color ?? "inherit" }}>
          {resolvedUsername}
        </Typography>
        <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
          {t("roleDisplay.previewOnlineStatus")}
        </Typography>
      </Stack>

      <Typography
        sx={(theme) => ({
          alignSelf: "flex-start",
          maxWidth: "100%",
          px: "10px",
          py: "6px",
          borderRadius: radius("md"),
          fontSize: 12.5,
          background: theme.palette.nebula.card2,
        })}
      >
        {t("roleDisplay.previewBubblePre")}
        <Box
          component="span"
          sx={(theme) => {
            const tint = color ?? theme.palette.nebula.accent;
            return {
              display: "inline-block",
              px: "4px",
              borderRadius: radius("sm"),
              fontWeight: 600,
              color: tint,
              background: alpha(tint, 0.2),
            };
          }}
        >
          @{label}
        </Box>
        {t("roleDisplay.previewBubblePost")}
      </Typography>
    </Stack>
  );
}
