import { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { radius } from "../../../tokens";
import { Stack } from "../../primitives";
import type { GraphNode } from "./graph";
import type { GraphTemplate, TemplateStrings } from "./templates";

/**
 * The template gallery.
 *
 * The block browser answers "what can I add"; this answers "what am I trying to
 * build", which is a different question and the first one an operator actually
 * has. Each card is a finished rule - conditions, wires and written message -
 * and the card shows the message rather than describing it, because a gallery
 * of formatted text is picked from by eye.
 *
 * Two actions, not one. **Add** puts the template beside what is already drawn,
 * which is how a server grows a second greeting for a second audience;
 * **replace** throws the canvas away, which is what somebody means the first
 * time they open the page. Making the operator choose is cheaper than making
 * them undo: there is no undo on this canvas, and a template that silently ate
 * a graph would be the last time anyone pressed one.
 */

interface TemplatePanelProps<N extends GraphNode> {
  readonly templates: readonly GraphTemplate<N>[];
  readonly strings: TemplateStrings;
  /** What the operator typed into the bar above. Owned there, not here. */
  readonly query: string;
  /** Whether replacing would throw work away - the button says so when it would. */
  readonly occupied: boolean;
  readonly onUse: (template: GraphTemplate<N>, replace: boolean) => void;
}

export function TemplatePanel<N extends GraphNode>({
  templates,
  strings,
  query,
  occupied,
  onUse,
}: TemplatePanelProps<N>) {
  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = templates.filter(
      (template) =>
        needle === "" ||
        `${template.label} ${template.description} ${template.category} ${template.shows ?? ""}`
          .toLowerCase()
          .includes(needle),
    );
    // In the order the dialect lists them, not alphabetically: the order is
    // roughly how likely each is to be what somebody came for.
    const grouped = new Map<string, GraphTemplate<N>[]>();
    for (const template of matches) {
      const bucket = grouped.get(template.category);
      if (bucket) bucket.push(template);
      else grouped.set(template.category, [template]);
    }
    return [...grouped];
  }, [templates, query]);

  return (
    <Box
      sx={(theme) => ({
        flex: "none",
        maxHeight: "52vh",
        overflowY: "auto",
        px: "14px",
        pb: "14px",
        pt: "2px",
        background: theme.palette.nebula.panel,
        borderTop: `1px solid ${theme.palette.nebula.line}`,
        borderBottom: `1px solid ${theme.palette.nebula.line2}`,
      })}
    >
      {sections.length === 0 && (
        <Typography sx={(theme) => ({ py: "18px", fontSize: 12, color: theme.palette.nebula.dim })}>
          {strings.empty}
        </Typography>
      )}

      {sections.map(([category, entries]) => (
        <Box key={category}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "14px", mb: "9px" }}>
            <Typography
              sx={(theme) => ({
                flex: "none",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: theme.palette.nebula.dim,
              })}
            >
              {category}
            </Typography>
            <Box sx={(theme) => ({ flex: 1, height: "1px", background: theme.palette.nebula.line })} />
          </Stack>

          <Box
            sx={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              mb: "4px",
            }}
          >
            {entries.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                strings={strings}
                occupied={occupied}
                onUse={(replace) => onUse(template, replace)}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function TemplateCard<N extends GraphNode>({
  template,
  strings,
  occupied,
  onUse,
}: Readonly<{
  template: GraphTemplate<N>;
  strings: TemplateStrings;
  occupied: boolean;
  onUse: (replace: boolean) => void;
}>) {
  // Through the same allow-list every surface in this app renders untrusted
  // markup through, so the card is not an impression of the message - it is
  // the message, and anything the sanitiser drops is missing here too.
  const preview = useMemo(() => (template.preview ? sanitizeHtml(template.preview) : ""), [template]);

  return (
    <Stack
      sx={(theme) => ({
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        "&:hover": { borderColor: theme.palette.nebula.accentLine },
      })}
    >
      <Stack direction="row" alignItems="center" gap={1} sx={{ px: "14px", pt: "12px" }}>
        <Box
          sx={(theme) => ({
            width: 8,
            height: 8,
            flex: "none",
            borderRadius: "2px",
            background: theme.palette.nebula[template.tone === "muted" ? "dim" : template.tone],
          })}
        />
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }} noWrap>
          {template.label}
        </Typography>
      </Stack>

      <Typography
        sx={(theme) => ({
          px: "14px",
          py: "8px",
          fontSize: 12,
          lineHeight: 1.45,
          color: theme.palette.nebula.muted,
        })}
      >
        {template.description}
      </Typography>

      {preview && (
        <Box
          aria-hidden
          sx={(theme) => ({
            mx: "14px",
            mb: "10px",
            px: "11px",
            py: "9px",
            maxHeight: 132,
            overflow: "hidden",
            borderRadius: radius("md"),
            background: theme.palette.nebula.bg0,
            border: `1px solid ${theme.palette.nebula.line}`,
            // Small, and legible at that size: this is a thumbnail of a
            // document, so its own structure has to survive the shrinking.
            fontSize: 10.5,
            lineHeight: 1.5,
            color: theme.palette.nebula.text,
            // Faded at the bottom rather than cut off, so a message that runs
            // past the card reads as longer rather than as broken.
            maskImage: "linear-gradient(180deg,#000 72%,transparent)",
            "& > *:first-of-type": { marginTop: 0 },
            "& p": { margin: "0 0 0.35em" },
            "& h1, & h2, & h3, & h4": { margin: "0.3em 0 0.2em", fontSize: "1.2em", lineHeight: 1.25 },
            "& ul, & ol": { margin: "0.2em 0", paddingLeft: "1.2em" },
            "& li": { margin: 0 },
            "& hr": { border: 0, borderTop: `1px solid ${theme.palette.nebula.line2}`, margin: "0.5em 0" },
            "& a": { color: theme.palette.nebula.accent },
            "& img": { maxWidth: "100%" },
          })}
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      )}

      {template.shows && (
        <Typography
          sx={(theme) => ({
            px: "14px",
            pb: "10px",
            fontSize: 11,
            lineHeight: 1.45,
            color: theme.palette.nebula.dim,
          })}
        >
          {template.shows}
        </Typography>
      )}

      <Stack
        direction="row"
        alignItems="center"
        gap={1}
        sx={(theme) => ({
          mt: "auto",
          px: "14px",
          py: "10px",
          borderTop: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        <Action primary label={strings.add} onClick={() => onUse(false)} />
        <Action
          label={strings.replace}
          // Said out loud only when it would cost something: on an empty
          // canvas the two buttons do the same thing and the warning would
          // be noise.
          title={occupied ? strings.replaceHint : undefined}
          onClick={() => onUse(true)}
        />
      </Stack>
    </Stack>
  );
}

function Action({
  label,
  title,
  primary,
  onClick,
}: Readonly<{ label: string; title?: string; primary?: boolean; onClick: () => void }>) {
  return (
    <Box
      component="button"
      type="button"
      title={title}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        flex: "none",
        px: "11px",
        py: "4px",
        cursor: "pointer",
        borderRadius: radius("sm"),
        fontSize: 11.5,
        fontWeight: 600,
        color: primary ? theme.palette.nebula.accent : theme.palette.nebula.muted,
        background: primary ? theme.palette.nebula.accentSoft : "transparent",
        border: `1px solid ${primary ? theme.palette.nebula.accentLine : theme.palette.nebula.line2}`,
        "&:hover": {
          background: primary ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover,
          color: primary ? theme.palette.nebula.accent : theme.palette.nebula.text,
        },
      })}
    >
      {label}
    </Box>
  );
}
