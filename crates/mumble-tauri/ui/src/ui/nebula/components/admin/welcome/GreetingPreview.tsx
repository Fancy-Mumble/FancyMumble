import { Box, Button, Typography } from "@mui/material";
import { opaque, radius } from "../../../tokens";
import { Stack } from "../../primitives";
import { describe, previewText, greetingOf, type PreviewSubject, type WelcomeGraph } from "./model";

/**
 * The greeting as the person on the other end will read it.
 *
 * Attached to the greeting node rather than pinned to a corner of the pane,
 * because it is a property of *that* node: a canvas with two greetings on it
 * needs two previews, and one floating panel would have to pick a winner and
 * then explain which node it was showing.
 *
 * It states the match in the same words the status bar does. An operator
 * looking at a preview asks two questions - what does it say, and who gets it -
 * and a preview that answered only the first would send them back to the wires
 * to work out the second.
 */
export function GreetingPreview({
  graph,
  subject,
}: Readonly<{ graph: WelcomeGraph; subject: PreviewSubject }>) {
  const greeting = greetingOf(graph);
  if (!greeting || greeting.kind !== "greeting") return null;

  const condition = describe(graph);
  const body = previewText(graph, subject);

  return (
    <Box sx={{ mt: "16px" }}>
      <Typography
        sx={(theme) => ({
          mb: "7px",
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: "0.1em",
          color: theme.palette.nebula.dim,
        })}
      >
        PREVIEW · WHAT THEY SEE
      </Typography>

      <Box
        sx={(theme) => ({
          p: "13px",
          borderRadius: radius("md"),
          // Opaque for the same reason the node above it is: the preview hangs
          // over the canvas and other nodes pass behind it.
          background: opaque(theme.palette.nebula.card, theme.palette.nebula.bg0),
          border: `1px solid ${theme.palette.nebula.line2}`,
        })}
      >
        <Stack direction="row" gap={1} sx={{ mb: "10px" }}>
          <Box
            sx={(theme) => ({
              width: 30,
              height: 30,
              flex: "none",
              borderRadius: radius("sm"),
              background: theme.palette.nebula.accentSoft,
              border: `1px solid ${theme.palette.nebula.accentLine}`,
            })}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{subject.server}</Typography>
            <Typography
              sx={(theme) => ({ fontSize: 9.5, lineHeight: 1.45, color: theme.palette.nebula.dim })}
            >
              {condition ? `matches ${condition}` : "nothing is wired to WHEN — shown to nobody"}
            </Typography>
          </Box>
        </Stack>

        <Typography sx={{ fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{body || "…"}</Typography>

        <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "12px" }}>
          <Typography sx={(theme) => ({ flex: 1, fontSize: 10, color: theme.palette.nebula.dim })}>
            {greeting.once ? "Dismissed for good" : "Shown on every connect"}
          </Typography>
          <Button variant="contained" size="small" sx={{ flex: "none" }} disabled>
            Got it
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
