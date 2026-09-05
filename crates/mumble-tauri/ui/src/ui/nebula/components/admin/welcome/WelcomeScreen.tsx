import { Box, Button, Typography, alpha } from "@mui/material";
import { WelcomeMarkup } from "../../welcome/WelcomeMarkup";
import { radius, type NebulaTokens } from "../../../tokens";
import { LinkGuard, Stack } from "../../primitives";
import { isWebUrl, type Align, type BandTone, type Section } from "./layout";

/**
 * A welcome screen, drawn from its bands.
 *
 * This is the reason bands exist rather than markup: every measurement here is
 * the client's, not the operator's. The title is the client's display size,
 * the button is the client's button, the cards are its cards - so a screen
 * written once looks like part of the application on every platform it is read
 * on, including the ones built after it was written.
 *
 * Nothing here is styled by the document. A band says *what a part is*, and an
 * operator who could set a font size here would be setting it for a window
 * they have never seen, in a theme they do not know, on a phone they do not
 * own.
 *
 * Links are drawn as links and go through the guard every other link in this
 * client goes through: a server is not trusted to send somewhere, however
 * pretty the button around it is. Anything that is not http(s) is drawn as
 * plain text, so a refused link is visibly a label rather than a button that
 * silently does nothing.
 */
export function WelcomeScreen({
  sections,
  artwork,
}: Readonly<{
  sections: readonly Section[];
  /** The server's own livery, for the bands that draw it. */
  artwork?: { icon?: string | null; banner?: string | null };
}>) {
  return (
    <LinkGuard>
      <Stack gap={0}>
        {sections.map((section) => (
          <Painted key={section.id} section={section}>
            <Band section={section} artwork={artwork} />
          </Painted>
        ))}
      </Stack>
    </LinkGuard>
  );
}

/**
 * A band's background, drawn full width behind it.
 *
 * Full width and edge to edge, which is what makes a title bar a bar rather
 * than a rounded box floating in a column - and what the design this exists to
 * make possible is built out of. The negative margin is how a band escapes the
 * padding its container puts on everything else; there is no other way to get
 * a full-bleed row inside a padded column.
 */
function Painted({ section, children }: Readonly<{ section: Section; children: React.ReactNode }>) {
  if (section.tone === "none") return <>{children}</>;
  return (
    <Box
      sx={(theme) => ({
        mx: "-18px",
        px: "18px",
        py: "12px",
        background: bandBackground(theme.palette.nebula, section.tone),
        borderTop: `1px solid ${bandEdge(theme.palette.nebula, section.tone)}`,
        borderBottom: `1px solid ${bandEdge(theme.palette.nebula, section.tone)}`,
        // Runs of the same tone read as one band, not as stripes.
        "& + &": { borderTop: "none" },
      })}
    >
      {children}
    </Box>
  );
}

/**
 * A tone as a background this reader can actually read text on.
 *
 * Mapped from the client's own palette rather than carried in the document,
 * which is the entire reason a band names a *tone*: an operator picking a hex
 * colour is picking it against whichever theme they were running that
 * afternoon, and half their members are running the other one.
 */
function bandBackground(nebula: NebulaTokens, tone: BandTone): string {
  switch (tone) {
    case "accent":
      return nebula.accentSoft;
    case "muted":
      return nebula.card;
    case "warn":
      return alpha(nebula.warn, 0.14);
    case "danger":
      return alpha(nebula.bad, 0.16);
    default:
      return "transparent";
  }
}

function bandEdge(nebula: NebulaTokens, tone: BandTone): string {
  switch (tone) {
    case "accent":
      return nebula.accentLine;
    case "warn":
      return alpha(nebula.warn, 0.35);
    case "danger":
      return alpha(nebula.bad, 0.4);
    default:
      return nebula.line;
  }
}

/** What a band aligns to when it has not been told. */
const NATURAL: Partial<Record<Section["kind"], Align>> = {
  header: "center",
  hero: "center",
  image: "center",
  action: "center",
  prose: "left",
  cards: "left",
};

function alignmentOf(section: Section): "left" | "center" {
  if (section.align !== "default") return section.align;
  return NATURAL[section.kind] === "center" ? "center" : "left";
}

function Band({
  section,
  artwork,
}: Readonly<{ section: Section; artwork?: { icon?: string | null; banner?: string | null } }>) {
  const align = alignmentOf(section);
  switch (section.kind) {
    case "image": {
      const source = section.picture === "banner" ? artwork?.banner : artwork?.icon;
      if (!source) return null;
      return (
        <Box sx={{ py: "12px", textAlign: align }}>
          <Box
            component="img"
            src={source}
            alt=""
            sx={{
              // Bounded rather than natural size: a livery banner is a wide
              // image and a welcome screen is a column, so the one thing that
              // must not happen is the artwork setting the width.
              maxWidth: "100%",
              maxHeight: section.picture === "banner" ? 120 : 96,
              display: "inline-block",
            }}
          />
        </Box>
      );
    }
    case "header":
      return (
        <Typography
          sx={(theme) => ({
            px: "2px",
            pb: section.tone === "none" ? "12px" : 0,
            textAlign: align,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 10.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: theme.palette.nebula.dim,
          })}
        >
          {section.title}
        </Typography>
      );

    case "hero":
      return (
        <Stack
          alignItems={align === "center" ? "center" : "flex-start"}
          gap={1.25}
          sx={{ py: section.tone === "none" ? "18px" : "4px", textAlign: align }}
        >
          {section.glyph && (
            <Box
              sx={(theme) => ({
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 62,
                height: 62,
                borderRadius: "50%",
                fontSize: 26,
                lineHeight: 1,
                color: theme.palette.nebula.accent,
                background: theme.palette.nebula.card2,
              })}
            >
              {section.glyph}
            </Box>
          )}
          {section.title && (
            <Typography
              sx={(theme) => ({
                // The one place a serif earns its keep: a welcome screen has
                // exactly one line that is meant to be read slowly.
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: 30,
                lineHeight: 1.15,
                fontWeight: 400,
                color: theme.palette.nebula.text,
              })}
            >
              {section.title}
            </Typography>
          )}
          {section.subtitle && (
            <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.nebula.muted })}>
              {section.subtitle}
            </Typography>
          )}
        </Stack>
      );

    case "prose":
      return <Prose html={section.html} align={align} />;

    case "action":
      return (
        <Stack
          alignItems={align === "center" ? "center" : "flex-start"}
          gap={0.75}
          sx={{ py: section.tone === "none" ? "16px" : "2px" }}
        >
          <Button
            variant={section.primary ? "contained" : "outlined"}
            size="large"
            component={isWebUrl(section.url) ? "a" : "button"}
            href={isWebUrl(section.url) ? section.url : undefined}
            disabled={!isWebUrl(section.url)}
            sx={{ minWidth: 240, fontWeight: 700, textTransform: "none" }}
          >
            {section.title}
          </Button>
          {section.subtitle && (
            <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.dim })}>
              {section.subtitle}
            </Typography>
          )}
        </Stack>
      );

    case "cards":
      return (
        <Box sx={{ py: section.tone === "none" ? "10px" : 0 }}>
          {section.title && (
            <Typography
              sx={(theme) => ({
                mb: "8px",
                textAlign: align,
                fontSize: 14,
                fontWeight: 700,
                color: theme.palette.nebula.text,
              })}
            >
              {section.title}
            </Typography>
          )}
          {section.compact ? (
            // A list rather than a row of boxes. Two links under a heading are
            // a list; making them cards gives each one the visual weight of a
            // call to action, and a screen where everything is a call to
            // action has none.
            <Box
              component="ul"
              sx={{
                margin: 0,
                paddingLeft: align === "center" ? 0 : "1.2em",
                listStyle: align === "center" ? "none" : "disc",
                textAlign: align,
              }}
            >
              {section.cards.map((card, index) => (
                <Box component="li" key={`${card.label}${index}`} sx={{ margin: "0.2em 0" }}>
                  <CardLink card={card} />
                </Box>
              ))}
            </Box>
          ) : (
            <Cards section={section} />
          )}
        </Box>
      );

    case "divider":
      return <Box sx={(theme) => ({ my: "14px", height: "1px", background: theme.palette.nebula.line })} />;
  }
  return null;
}

/** One link, wherever a card row or a list needs one. */
function CardLink({ card }: Readonly<{ card: Section["cards"][number] }>) {
  const live = isWebUrl(card.url);
  return (
    <Box
      component={live ? "a" : "span"}
      href={live ? card.url : undefined}
      sx={(theme) => ({
        fontSize: 13.5,
        fontWeight: 600,
        textDecoration: "none",
        color: live ? theme.palette.nebula.accent : theme.palette.nebula.text,
      })}
    >
      {card.label}
      {live && " →"}
    </Box>
  );
}

function Cards({ section }: Readonly<{ section: Section }>) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: "12px",
        // Wraps rather than scrolls: a row of links on a phone is a column
        // of links, and a screen nobody can reach the second card of is a
        // screen with one card on it.
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
      }}
    >
      {section.cards.map((card, index) => (
        <Box
          key={`${card.label}${index}`}
          component={isWebUrl(card.url) ? "a" : "div"}
          href={isWebUrl(card.url) ? card.url : undefined}
          sx={(theme) => ({
            display: "block",
            px: "14px",
            py: "12px",
            textDecoration: "none",
            borderRadius: radius("md"),
            background: theme.palette.nebula.card,
            border: `1px solid ${theme.palette.nebula.line2}`,
            ...(isWebUrl(card.url) ? { "&:hover": { borderColor: theme.palette.nebula.accentLine } } : {}),
          })}
        >
          {card.eyebrow && (
            <Typography
              sx={(theme) => ({
                mb: "5px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 9.5,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: theme.palette.nebula.dim,
              })}
            >
              {card.eyebrow}
            </Typography>
          )}
          <Typography
            sx={(theme) => ({
              fontSize: 13.5,
              fontWeight: 600,
              color: isWebUrl(card.url) ? theme.palette.nebula.accent : theme.palette.nebula.text,
            })}
          >
            {card.label}
            {isWebUrl(card.url) && " →"}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * A prose band.
 *
 * Through the same allow-list every surface in this client renders untrusted
 * markup through. A band is written by an operator in this very editor, but
 * "written here" is not a reason to trust markup: the document is fetched from
 * a server, and a server is not this editor.
 */
function Prose({ html, align }: Readonly<{ html: string; align: "left" | "center" }>) {
  if (!html.trim()) return null;
  return (
    <WelcomeMarkup
      html={html}
      sx={(theme) => ({
        // The band's alignment is the floor, not the ceiling: a paragraph that
        // set its own inside the WYSIWYG keeps it, because that was a
        // sentence-level decision and this is a band-level one.
        textAlign: align,
        fontSize: 13,
        lineHeight: 1.7,
        color: theme.palette.nebula.muted,
        "& > *:first-of-type": { marginTop: 0 },
        "& > *:last-child": { marginBottom: 0 },
        "& p": { margin: "0 0 0.9em" },
        "& h1, & h2, & h3": { margin: "0.6em 0 0.3em", color: theme.palette.nebula.text },
        "& ul, & ol": { margin: "0.4em 0", paddingLeft: "1.4em" },
        "& li > p": { margin: 0 },
        "& a": { color: theme.palette.nebula.accent },
        "& img": { maxWidth: "100%" },
      })}
    />
  );
}
