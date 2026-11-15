import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "@ui/icons";
import { Stack } from "../../primitives";
import { radius } from "../../../tokens";
import { AddChip, PillMenu, PlainInput, SectionLabel, ToggleRow, useScrollGuard } from "../nodes";
import {
  ALIGNABLE,
  ALIGNMENTS,
  BAND_TONES,
  PICTURES,
  SECTION_FIELDS,
  SECTION_KINDS,
  TONEABLE,
  isWebUrl,
  makeCard,
  makeSection,
  type Align,
  type BandTone,
  type Picture,
  type Section,
} from "./layout";
import { RichTextField } from "../../primitives";
import { MAX_BODY } from "./markup";

/**
 * The welcome screen, as a list of bands to fill in.
 *
 * A list and not a canvas-inside-a-canvas. What an operator decides here is
 * *what each part is and in what order* - there is nothing to arrange in two
 * dimensions, because the client owns the layout, and a drag-around editor
 * would be offering control over something that is not theirs to set.
 *
 * Every band shows only the fields its own kind uses (`SECTION_FIELDS`), so a
 * divider is a row with nothing in it and a hero is three lines. The
 * alternative - one form with every field, greyed out - teaches an operator
 * that a screen has eleven settings when it has two.
 */
export function ScreenEditor({
  sections,
  onChange,
}: Readonly<{
  sections: readonly Section[];
  onChange: (next: Section[]) => void;
}>) {
  const { t } = useTranslation("nebulaWelcome");
  const guard = useScrollGuard<HTMLDivElement>();

  const patch = (id: string, fields: Partial<Section>) =>
    onChange(sections.map((section) => (section.id === id ? { ...section, ...fields } : section)));

  const move = (index: number, by: number) => {
    const next = [...sections];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };

  return (
    <Box ref={guard} sx={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <Stack gap={0.75}>
        {sections.map((section, index) => (
          <Band
            key={section.id}
            section={section}
            first={index === 0}
            last={index === sections.length - 1}
            onPatch={(fields) => patch(section.id, fields)}
            onRemove={() => onChange(sections.filter((entry) => entry.id !== section.id))}
            onMove={(by) => move(index, by)}
          />
        ))}
      </Stack>

      <Stack direction="row" gap={0.5} sx={{ flexWrap: "wrap" }}>
        <AddChip
          label={t("screen.addBand")}
          options={SECTION_KINDS.map((kind) => t(`bands.${kind}.label`))}
          onAdd={(label) => {
            const kind = SECTION_KINDS.find((candidate) => t(`bands.${candidate}.label`) === label);
            if (kind) onChange([...sections, makeSection(kind)]);
          }}
        />
      </Stack>

      {sections.length === 0 && (
        <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
          {t("screen.noBands")}
        </Typography>
      )}
    </Box>
  );
}

function Band({
  section,
  first,
  last,
  onPatch,
  onRemove,
  onMove,
}: Readonly<{
  section: Section;
  first: boolean;
  last: boolean;
  onPatch: (fields: Partial<Section>) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
}>) {
  const { t } = useTranslation("nebulaWelcome");
  const fields = SECTION_FIELDS[section.kind];
  const name = t(`bands.${section.kind}.label`);

  return (
    <Box
      sx={(theme) => ({
        px: "9px",
        py: "8px",
        borderRadius: radius("sm"),
        background: theme.palette.nebula.card2,
        border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
      })}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap={0.5}
        sx={{ mb: fields.length > 0 ? "7px" : 0, flexWrap: "wrap" }}
      >
        <SectionLabel>{name}</SectionLabel>
        <Box sx={{ flex: 1 }} />
        {/* Order is the whole layout decision an operator makes here, so it is
            two buttons on every band rather than a drag nobody discovers. */}
        {ALIGNABLE.includes(section.kind) && (
          <PillMenu
            value={section.align}
            options={ALIGNMENTS.map((align) => ({ id: align, label: t(`screen.align.${align}`) }))}
            onChange={(align) => onPatch({ align: align as Align })}
          />
        )}
        {/* A tone, never a colour: what an operator picks here is what the
            band is *for*, and every client maps that onto its own palette in
            whichever theme the person reading it is running. */}
        {TONEABLE.includes(section.kind) && (
          <PillMenu
            value={section.tone}
            options={BAND_TONES.map((tone) => ({ id: tone, label: t(`screen.tones.${tone}`) }))}
            onChange={(tone) => onPatch({ tone: tone as BandTone })}
          />
        )}
        <Nudge label={t("screen.moveUp")} disabled={first} onClick={() => onMove(-1)} up />
        <Nudge label={t("screen.moveDown")} disabled={last} onClick={() => onMove(1)} />
        <Box
          component="button"
          type="button"
          aria-label={t("screen.remove", { label: name })}
          onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
          onClick={onRemove}
          sx={(theme) => ({
            all: "unset",
            display: "flex",
            ml: "2px",
            cursor: "pointer",
            color: theme.palette.nebula.dim,
            "&:hover": { color: theme.palette.nebula.text },
          })}
        >
          <CloseIcon width={9} height={9} />
        </Box>
      </Stack>

      {fields.includes("picture") && (
        <PillMenu
          value={section.picture}
          options={PICTURES.map((picture) => ({ id: picture, label: t(`screen.pictures.${picture}`) }))}
          onChange={(picture) => onPatch({ picture: picture as Picture })}
        />
      )}
      {fields.includes("compact") && (
        <ToggleRow
          checked={section.compact}
          label={t("screen.compact")}
          onChange={() => onPatch({ compact: !section.compact })}
        />
      )}
      {fields.includes("glyph") && (
        <PlainInput
          value={section.glyph}
          placeholder={t("screen.glyph")}
          ariaLabel={t("screen.glyphLabel")}
          maxLength={2}
          onChange={(glyph) => onPatch({ glyph })}
        />
      )}
      {fields.includes("title") && (
        <PlainInput
          value={section.title}
          placeholder={section.kind === "action" ? t("screen.buttonTitle") : t("screen.title")}
          ariaLabel={t("screen.titleLabel", { label: name })}
          onChange={(title) => onPatch({ title })}
        />
      )}
      {fields.includes("url") && (
        <>
          <PlainInput
            value={section.url}
            placeholder="https://…"
            ariaLabel={t("screen.buttonLink")}
            onChange={(url) => onPatch({ url })}
          />
          {/* Said the moment it is typed rather than at save: the server
              refuses the whole document over one bad link, and an operator who
              learns that from a rejected save has to find which. */}
          {section.url !== "" && !isWebUrl(section.url) && (
            <Typography sx={(theme) => ({ fontSize: 9.5, color: theme.palette.nebula.warn })}>
              {t("screen.webOnly")}
            </Typography>
          )}
        </>
      )}
      {fields.includes("subtitle") && (
        <PlainInput
          value={section.subtitle}
          placeholder={section.kind === "action" ? t("screen.buttonSubtitle") : t("screen.subtitle")}
          ariaLabel={t("screen.subtitleLabel", { label: name })}
          onChange={(subtitle) => onPatch({ subtitle })}
        />
      )}
      {fields.includes("primary") && (
        <ToggleRow
          checked={section.primary}
          label={t("screen.primary")}
          onChange={() => onPatch({ primary: !section.primary })}
        />
      )}
      {fields.includes("html") && (
        <RichTextField
          value={section.html}
          onChange={(html) => onPatch({ html })}
          ariaLabel={t("screen.paragraph")}
          placeholder={t("screen.paragraphPlaceholder")}
          preset="document"
          maxLength={MAX_BODY}
          tools={["bold", "italic", "underline", "lists", "align", "colour"]}
          minHeight={64}
          maxHeight={200}
        />
      )}
      {fields.includes("cards") && <Cards section={section} onPatch={onPatch} />}
    </Box>
  );
}

function Cards({
  section,
  onPatch,
}: Readonly<{ section: Section; onPatch: (fields: Partial<Section>) => void }>) {
  const { t } = useTranslation("nebulaWelcome");
  const patch = (index: number, fields: Partial<Section["cards"][number]>) =>
    onPatch({
      cards: section.cards.map((card, at) => (at === index ? { ...card, ...fields } : card)),
    });

  return (
    <Stack gap={0.75}>
      {section.cards.map((card, index) => (
        <Stack
          key={index}
          gap={0.25}
          sx={(theme) => ({ pl: "8px", borderLeft: `2px solid ${theme.palette.nebula.line2}` })}
        >
          <Stack direction="row" alignItems="center" gap={0.5}>
            <PlainInput
              value={card.eyebrow}
              placeholder={t("screen.eyebrow")}
              ariaLabel={t("screen.eyebrowLabel")}
              maxLength={24}
              onChange={(eyebrow) => patch(index, { eyebrow })}
            />
            <Box
              component="button"
              type="button"
              aria-label={t("screen.removeCard")}
              onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
              onClick={() => onPatch({ cards: section.cards.filter((_, at) => at !== index) })}
              sx={(theme) => ({
                all: "unset",
                display: "flex",
                cursor: "pointer",
                color: theme.palette.nebula.dim,
                "&:hover": { color: theme.palette.nebula.text },
              })}
            >
              <CloseIcon width={9} height={9} />
            </Box>
          </Stack>
          <PlainInput
            value={card.label}
            placeholder={t("screen.cardPlaceholder")}
            ariaLabel={t("screen.cardLabel")}
            onChange={(label) => patch(index, { label })}
          />
          <PlainInput
            value={card.url}
            placeholder="https://…"
            ariaLabel={t("screen.cardLink")}
            onChange={(url) => patch(index, { url })}
          />
        </Stack>
      ))}
      <Box>
        <AddChip
          label={t("screen.addCard")}
          options={[t("screen.anotherLink")]}
          onAdd={() => onPatch({ cards: [...section.cards, makeCard()] })}
        />
      </Box>
    </Stack>
  );
}

/** The two order buttons a band carries. */
function Nudge({
  label,
  disabled,
  up,
  onClick,
}: Readonly<{ label: string; disabled: boolean; up?: boolean; onClick: () => void }>) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        display: "flex",
        px: "2px",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.25 : 1,
        color: theme.palette.nebula.dim,
        "&:hover": { color: disabled ? theme.palette.nebula.dim : theme.palette.nebula.text },
      })}
    >
      <Box
        component="svg"
        width={9}
        height={9}
        viewBox="0 0 10 10"
        sx={{ fill: "none", transform: up ? "rotate(180deg)" : "none" }}
      >
        <path d="M2 3.5L5 6.5 8 3.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      </Box>
    </Box>
  );
}
