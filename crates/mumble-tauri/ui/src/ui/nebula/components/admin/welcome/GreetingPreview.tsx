import { useMemo } from "react";
import { Box, Button, Typography } from "@mui/material";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { opaque, radius } from "../../../tokens";
import { LinkGuard, Stack } from "../../primitives";
import type { NodeId } from "../nodes";
import { describeVisitor, type Conflicts } from "./solver";
import { WelcomeScreen } from "./WelcomeScreen";
import {
  describeGreeting,
  isLegacy,
  previewMarkup,
  previewText,
  sectionsOf,
  type PreviewSubject,
  type WelcomeGraph,
} from "./model";

/**
 * One greeting as the person on the other end will read it.
 *
 * Attached to its greeting node rather than pinned to a corner of the pane,
 * because it is a property of *that* node: a canvas with two greetings on it
 * needs two previews, and one floating panel would have to pick a winner and
 * then explain which node it was showing. Which is why `greeting` is a prop -
 * everything shown here is asked about that id, not about the graph.
 *
 * It states the match in the same words the status bar does. An operator
 * looking at a preview asks two questions - what does it say, and who gets it -
 * and a preview that answered only the first would send them back to the wires
 * to work out the second. When the solver has found that nobody will ever get
 * it, that is the answer to the second question, and it is said here rather
 * than in a panel somewhere else on the page.
 *
 * Where any part of the greeting carries markup, this renders that markup
 * through the same allow-list every surface in this client renders untrusted
 * HTML through. So it is not an impression of the welcome screen - it *is*
 * what will be shown, and anything the sanitiser drops is missing here too,
 * which is worth learning before saving rather than after.
 */
export function GreetingPreview({
  graph,
  greeting,
  subject,
  conflicts,
}: Readonly<{
  graph: WelcomeGraph;
  greeting: NodeId;
  subject: PreviewSubject;
  conflicts: Conflicts;
}>) {
  const node = graph.nodes.find((candidate) => candidate.id === greeting);

  const condition = describeGreeting(graph, greeting);
  const plain = previewText(graph, subject, greeting);
  const markup = previewMarkup(graph, subject, greeting);
  // Only when the server will actually send the markup half. A server with
  // `allow_html` off hands a client tags it renders literally, so it sends the
  // plain form instead - and a preview showing headings on such a server would
  // be showing a document nobody receives.
  const html = useMemo(
    () => (markup !== null && subject.allowHtml ? sanitizeHtml(markup) : ""),
    [markup, subject.allowHtml],
  );

  // A legacy greeting is previewed as its *markup*, not through the native
  // renderer - because markup is exactly what those clients are sent, and a
  // preview that drew it natively would be showing the one thing the operator
  // wrote this greeting to avoid relying on.
  const legacy = node !== undefined && isLegacy(node);
  const sections = node && !legacy ? sectionsOf(node) : [];
  const shadow = conflicts.shadowed.find((entry) => entry.greeting === greeting);
  const clash = conflicts.overlaps.find((entry) => entry.second === greeting);

  if (!node || node.kind !== "greeting") return null;

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
          border: `1px solid ${shadow ? theme.palette.nebula.warn : theme.palette.nebula.line2}`,
          // A greeting nobody will see is drawn as the draft it effectively is.
          opacity: shadow ? 0.6 : 1,
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

        {/* A screen is drawn by the same component that will draw it for the
            person arriving, in the same type scale and with the same buttons -
            so this is the welcome screen, not a picture of one. A greeting
            written as prose falls through to the markup below. */}
        {sections.length > 0 ? (
          <WelcomeScreen sections={sections} artwork={{ icon: subject.icon, banner: subject.banner }} />
        ) : html ? (
          <LinkGuard>
            <Box
              sx={(theme) => ({
                fontSize: 12,
                lineHeight: 1.55,
                wordBreak: "break-word",
                "& > *:first-of-type": { marginTop: 0 },
                "& p": { margin: "0 0 0.5em" },
                "& h1, & h2, & h3, & h4, & h5, & h6": {
                  margin: "0.5em 0 0.3em",
                  lineHeight: 1.25,
                  fontWeight: 700,
                },
                "& h1": { fontSize: "1.5em" },
                "& h2": { fontSize: "1.3em" },
                "& h3": { fontSize: "1.12em" },
                "& ul, & ol": { margin: "0.35em 0", paddingLeft: "1.4em" },
                "& li": { margin: "0.1em 0" },
                "& li > p": { margin: 0 },
                "& blockquote": {
                  margin: "0.5em 0",
                  paddingLeft: "0.8em",
                  borderLeft: `2px solid ${theme.palette.nebula.line2}`,
                  color: theme.palette.nebula.muted,
                },
                "& hr": {
                  border: 0,
                  borderTop: `1px solid ${theme.palette.nebula.line2}`,
                  margin: "0.7em 0",
                },
                "& table": { borderCollapse: "collapse", margin: "0.5em 0" },
                "& td, & th": { border: `1px solid ${theme.palette.nebula.line2}`, padding: "3px 6px" },
                "& a": { color: theme.palette.nebula.accent, textDecoration: "underline" },
                "& img": { maxWidth: "100%" },
              })}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </LinkGuard>
        ) : (
          <Typography sx={{ fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {plain || "…"}
          </Typography>
        )}

        <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "12px" }}>
          <Typography sx={(theme) => ({ flex: 1, fontSize: 10, color: theme.palette.nebula.dim })}>
            {node.once ? "Dismissed for good" : "Shown on every connect"}
          </Typography>
          <Button variant="contained" size="small" sx={{ flex: "none" }} disabled>
            Got it
          </Button>
        </Stack>
      </Box>

      {/* Said only when it changes what is on screen: an operator who has just
          formatted a greeting on a server that will not send the formatting is
          otherwise looking at their own plain text with no idea why. */}
      {legacy && (
        <Note tone="dim">
          Drawn as Mumble 1.5 and older will: tables, inline colour, square corners. Their rich text is a
          subset of HTML 4, so this is close to what Qt renders rather than to this client.
        </Note>
      )}

      {markup !== null && !subject.allowHtml && (
        <Note tone="warn">
          This server has allow_html switched off, so it sends the plain half of every greeting. The
          formatting is kept, and starts being sent the moment the setting is on.
        </Note>
      )}

      {/* The quietest failure this canvas has, and the reason for the solver:
          the server shows the first greeting whose condition holds, so a
          greeting behind one that covers it is drawn, complete, enabled and
          seen by nobody. */}
      {shadow && (
        <Note tone="warn">
          {shadow.behind.length === 0
            ? "No visitor can match this condition, so this greeting shows to nobody."
            : "This greeting shows to nobody: every visitor it matches is taken by a greeting the server " +
              "reaches first. Drag it above that one, or narrow the other's condition."}
        </Note>
      )}

      {!shadow && clash && (
        <Note tone="dim">
          {`Overlaps with the greeting before it — ${describeVisitor(clash.example)} matches both, and the ` +
            "earlier one wins. Deliberate if this is the general case behind a specific one."}
        </Note>
      )}

      {!conflicts.decided && (
        <Note tone="dim">Too many combinations of conditions to check whether the greetings overlap.</Note>
      )}
    </Box>
  );
}

/** A line under the preview, in the two weights the previews need. */
function Note({ tone, children }: Readonly<{ tone: "warn" | "dim"; children: React.ReactNode }>) {
  return (
    <Typography
      sx={(theme) => ({
        mt: "7px",
        fontSize: 10,
        lineHeight: 1.45,
        color: tone === "warn" ? theme.palette.nebula.warn : theme.palette.nebula.dim,
      })}
    >
      {children}
    </Typography>
  );
}
