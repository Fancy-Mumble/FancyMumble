import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { offloadSkeletonHeight } from "@core/messageOffload";
import { radius } from "../../tokens";

/**
 * What a message looks like while its body is in cold storage.
 *
 * A heavy body - a pasted screenshot, a photograph typed into the river - is
 * written to an encrypted temp file once it has been out of view for a while,
 * and read back before the reader returns to it. This is what stands in the
 * meantime, and its whole job is to be the right *size*: the block holds the
 * height the picture had, so a river full of them scrolls the way it did when
 * they were all still in memory, and nothing jumps when one lands.
 *
 * It says which of the two states it is in, because the wait is visible on a
 * slow disk and an unlabelled grey block reads as a message that failed.
 */
export function OffloadedBody({
  contentLength,
  restoring,
}: Readonly<{
  /** Bytes the original body ran to, as recorded in the placeholder. */
  contentLength: number;
  /** The read is in flight, rather than the body merely being away. */
  restoring: boolean;
}>) {
  const { t } = useTranslation("chat");
  const label = restoring ? t("dates.decrypting") : t("dates.contentOffloaded");

  return (
    <Box sx={{ mt: "2px", maxWidth: "min(420px, 100%)" }}>
      <Box
        role="img"
        aria-label={label}
        sx={(theme) => ({
          minHeight: offloadSkeletonHeight(contentLength),
          borderRadius: radius("lg"),
          background: theme.palette.nebula.card2,
          border: `1px solid ${theme.palette.nebula.line}`,
          // Only while it is actually being fetched: a body that is simply
          // away is at rest, and a river of pulsing blocks would read as a
          // page that never finished loading.
          ...(restoring
            ? {
                animation: "nebula-offload-pulse 1.4s ease-in-out infinite",
                "@keyframes nebula-offload-pulse": { "50%": { opacity: 0.45 } },
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }
            : {}),
        })}
      />
      <Typography sx={(theme) => ({ mt: "4px", fontSize: 10.5, color: theme.palette.nebula.dim })}>
        {label}
      </Typography>
    </Box>
  );
}
