import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Box, IconButton, MenuItem, Slider, Switch, TextField, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { eventToShortcut } from "@core/features/settings/shortcutHelpers";
import { CloseIcon } from "@ui/icons";
import { NEBULA_MONO, radius } from "../../tokens";
import { Stack } from "../primitives";

/**
 * A settings page's title, one line of context, and anything the page as a
 * whole is switched by - which is the only thing that belongs beside a title
 * rather than under a heading.
 */
export function PageTitle({
  title,
  hint,
  action,
}: Readonly<{ title: string; hint?: string; action?: ReactNode }>) {
  return (
    <Stack direction="row" alignItems="flex-start" gap={2} sx={{ mb: "18px" }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 600 }}>{title}</Typography>
        {hint && (
          <Typography sx={(theme) => ({ mt: "4px", fontSize: 12, color: theme.palette.nebula.muted })}>
            {hint}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ flex: "none" }}>{action}</Box>}
    </Stack>
  );
}

/**
 * A heading between groups of controls inside one page.
 *
 * `space="wide"` is the mock's chapter break, twice the ordinary gap. A page
 * long enough to have chapters - Voice runs from the microphone to the wire -
 * needs the eye to see where one ends; a page of six related switches does not,
 * and would only end up with holes in it.
 */
export function GroupTitle({
  children,
  hint,
  space,
}: Readonly<{ children: ReactNode; hint?: string; space?: "wide" }>) {
  return (
    <Box sx={{ mt: space === "wide" ? "52px" : "26px" }}>
      <Typography sx={{ fontSize: 13, fontWeight: 600, mb: hint ? "3px" : "10px" }}>{children}</Typography>
      {hint && (
        <Typography sx={(theme) => ({ mb: "12px", fontSize: 11.5, color: theme.palette.nebula.muted })}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

/** A labelled control. The mock labels above, never beside. */
export function Field({
  label,
  children,
  sx,
}: Readonly<{ label: string; children: ReactNode; sx?: object }>) {
  return (
    <Box sx={{ ...sx }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, mb: "7px" }}>{label}</Typography>
      {children}
    </Box>
  );
}

/**
 * A row of mutually exclusive pills.
 *
 * The mock uses this shape for every small enumerated choice - noise
 * suppression, decorations, message style - so it is one component rather than
 * six near-identical `map`s.
 */
export function PillGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: Readonly<{
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}>) {
  return (
    <Stack direction="row" gap={0.875} flexWrap="wrap" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Box
            key={option.id}
            component="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              px: "13px",
              py: "7px",
              borderRadius: radius("md"),
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              color: active ? theme.palette.nebula.text : theme.palette.nebula.muted,
              background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
              border: `1px solid ${active ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
            })}
          >
            {option.label}
          </Box>
        );
      })}
    </Stack>
  );
}

/** The mock's inline segmented control - a tighter PillGroup inside one track. */
export function SegmentedGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: Readonly<{
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}>) {
  return (
    <Stack
      direction="row"
      gap={0.375}
      role="radiogroup"
      aria-label={ariaLabel}
      sx={(theme) => ({
        display: "inline-flex",
        p: "3px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Box
            key={option.id}
            component="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              px: "15px",
              py: "6px",
              borderRadius: radius("md"),
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              color: active ? theme.palette.nebula.text : theme.palette.nebula.muted,
              background: active ? theme.palette.nebula.card2 : "transparent",
            })}
          >
            {option.label}
          </Box>
        );
      })}
    </Stack>
  );
}

/**
 * The mock's label-on-the-left, current-value-on-the-right header.
 *
 * Shared rather than restated because it heads three different controls - a
 * slider, a pill row and a segmented track - and the value is the thing they
 * have in common, not the control under it.
 */
export function ValueHeader({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      gap={2}
      sx={(theme) => ({ mb: "3px", fontSize: 11, color: theme.palette.nebula.muted })}
    >
      <span>{label}</span>
      <Box
        component="span"
        sx={(theme) => ({ color: theme.palette.nebula.text, fontWeight: 500, flex: "none" })}
      >
        {value}
      </Box>
    </Stack>
  );
}

/**
 * A row of cards, each naming a choice and what it does.
 *
 * The mock uses this shape wherever the options are modes rather than values -
 * activation, the voice gate - because the difference between them is a
 * sentence, not a word, and a pill has nowhere to put the sentence. Distinct
 * from `OptionCardGrid`, whose second line demonstrates a format rather than
 * explaining a choice.
 */
export function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: Readonly<{
  options: readonly { id: T; label: string; hint: string }[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}>) {
  return (
    <Stack direction="row" gap={1.125} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Box
            key={option.id}
            component="button"
            role="radio"
            aria-checked={active}
            // Named by the choice, not by the choice plus its explanation: the
            // hint is a whole sentence, and the default accessible name would
            // read it out as part of the option every time.
            aria-label={option.label}
            onClick={() => onChange(option.id)}
            sx={(theme) => ({
              all: "unset",
              boxSizing: "border-box",
              cursor: "pointer",
              flex: 1,
              px: "13px",
              py: "12px",
              borderRadius: radius("md"),
              background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
              border: `1px solid ${active ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
              "&:hover": { borderColor: active ? undefined : theme.palette.nebula.line2 },
            })}
          >
            <Typography sx={{ mb: "3px", fontSize: 12.5, fontWeight: active ? 600 : 500 }}>
              {option.label}
            </Typography>
            <Typography
              sx={(theme) => ({ fontSize: 11, lineHeight: 1.5, color: theme.palette.nebula.muted })}
            >
              {option.hint}
            </Typography>
          </Box>
        );
      })}
    </Stack>
  );
}

/** A slider with the mock's label/value header above it. */
export function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
}: Readonly<{
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
}>) {
  return (
    <Box sx={{ flex: 1 }}>
      <ValueHeader label={label} value={display} />
      <Slider
        size="small"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(_, next) => onChange(next as number)}
        onChangeCommitted={(_, next) => onCommit?.(next as number)}
      />
    </Box>
  );
}

/** The read-only "current value" box the mock uses for text fields. */
export function ValueBox({ children, muted }: Readonly<{ children: ReactNode; muted?: boolean }>) {
  return (
    <Box
      sx={(theme) => ({
        px: "13px",
        py: "9px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        color: muted ? theme.palette.nebula.muted : theme.palette.nebula.text,
        fontSize: 12.5,
      })}
    >
      {children}
    </Box>
  );
}

/**
 * A setting that is on or off.
 *
 * By far the most repeated shape in Standard's settings - a heading, a line of
 * explanation, and a switch - so it is one component here rather than the
 * `toggleRow`/`toggleInfo`/`sectionTitle` div sandwich restated at every call
 * site. `children` renders under the row, which is where the panels hang a
 * dependent control or a `Banner` that only makes sense while the switch is in
 * one position.
 */
export function ToggleRow({
  title,
  hint,
  checked,
  onChange,
  disabled,
  children,
}: Readonly<{
  title: string;
  hint?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children?: ReactNode;
}>) {
  return (
    <Box sx={{ mb: "14px" }}>
      <Stack direction="row" alignItems="flex-start" gap={2}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h3" sx={{ fontSize: 12.5, fontWeight: 600 }}>
            {title}
          </Typography>
          {hint && (
            <Typography
              sx={(theme) => ({
                mt: "3px",
                fontSize: 11.5,
                lineHeight: 1.5,
                color: theme.palette.nebula.muted,
              })}
            >
              {hint}
            </Typography>
          )}
        </Box>
        <Switch
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          slotProps={{ input: { "aria-label": title } }}
          sx={{ flex: "none", mt: "1px" }}
        />
      </Stack>
      {children}
    </Box>
  );
}

/**
 * A switch that stands alone, boxed the way the mock boxes one.
 *
 * Not a `ToggleRow` in a card: the mock draws these differently - the title is
 * medium rather than semibold, the switch is centred against the whole block
 * rather than aligned to the first line - because a lone switch is read as one
 * object, while a run of them is read as a list with a heading. `children`
 * hangs a dependent control under the row, inside the same box.
 */
export function ToggleCard({
  title,
  hint,
  checked,
  onChange,
  disabled,
  children,
  sx,
}: Readonly<{
  title: string;
  hint?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children?: ReactNode;
  sx?: object;
}>) {
  return (
    <Box
      sx={(theme) => ({
        px: "14px",
        py: "12px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
        ...sx,
      })}
    >
      <Stack direction="row" alignItems="center" gap={1.5}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h3" sx={{ fontSize: 12.5, fontWeight: 500 }}>
            {title}
          </Typography>
          {hint && (
            <Typography
              sx={(theme) => ({
                mt: "2px",
                fontSize: 11,
                lineHeight: 1.5,
                color: theme.palette.nebula.muted,
              })}
            >
              {hint}
            </Typography>
          )}
        </Box>
        <Switch
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          slotProps={{ input: { "aria-label": title } }}
          sx={{ flex: "none" }}
        />
      </Stack>
      {children}
    </Box>
  );
}

/** A setting whose control is a button rather than a switch. */
export function ActionRow({
  title,
  hint,
  action,
  children,
}: Readonly<{ title: string; hint?: string; action: ReactNode; children?: ReactNode }>) {
  return (
    <Box sx={{ mb: "14px" }}>
      <Stack direction="row" alignItems="center" gap={2}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h3" sx={{ fontSize: 12.5, fontWeight: 600 }}>
            {title}
          </Typography>
          {hint && (
            <Typography
              sx={(theme) => ({
                mt: "3px",
                fontSize: 11.5,
                lineHeight: 1.5,
                color: theme.palette.nebula.muted,
              })}
            >
              {hint}
            </Typography>
          )}
        </Box>
        <Box sx={{ flex: "none" }}>{action}</Box>
      </Stack>
      {children}
    </Box>
  );
}

export type BannerTone = "info" | "warn" | "danger" | "ok";

/**
 * The consequence of a setting, stated where the setting is.
 *
 * Standard draws four of these (`warningBanner`, `…Muted`, `…Danger`, …) as
 * separate classes; here the tone is a prop, because what changes between them
 * is only which palette entry tints the rule and the wash.
 */
export function Banner({
  tone = "info",
  title,
  children,
}: Readonly<{ tone?: BannerTone; title?: string; children?: ReactNode }>) {
  return (
    <Box
      sx={(theme) => {
        const { nebula } = theme.palette;
        const key = { info: nebula.accent, warn: nebula.warn, danger: nebula.bad, ok: nebula.ok }[tone];
        return {
          mt: "10px",
          px: "12px",
          py: "10px",
          borderRadius: radius("md"),
          borderLeft: `2px solid ${key}`,
          background: alpha(key, theme.palette.mode === "dark" ? 0.1 : 0.07),
          fontSize: 11.5,
          lineHeight: 1.55,
          color: nebula.muted,
        };
      }}
    >
      {title && (
        <Typography sx={{ fontSize: 11.5, fontWeight: 600, mb: children ? "3px" : 0, color: "inherit" }}>
          {title}
        </Typography>
      )}
      {children}
    </Box>
  );
}

/** A labelled dropdown. Thin wrapper so panels do not restate the select props. */
export function SelectField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
  sx,
}: Readonly<{
  label: string;
  hint?: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
  sx?: object;
}>) {
  return (
    <Field label={label} sx={{ mb: "14px", ...sx }}>
      {hint && (
        <Typography
          sx={(theme) => ({ mt: "-3px", mb: "7px", fontSize: 11.5, color: theme.palette.nebula.muted })}
        >
          {hint}
        </Typography>
      )}
      <TextField
        select
        fullWidth
        size="small"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        slotProps={{ htmlInput: { "aria-label": label } }}
      >
        {options.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    </Field>
  );
}

/** A labelled single-line text input. */
export function TextRow({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type,
  disabled,
  sx,
  testId,
}: Readonly<{
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  sx?: object;
  testId?: string;
}>) {
  return (
    <Field label={label} sx={{ mb: "14px", ...sx }}>
      {hint && (
        <Typography
          sx={(theme) => ({ mt: "-3px", mb: "7px", fontSize: 11.5, color: theme.palette.nebula.muted })}
        >
          {hint}
        </Typography>
      )}
      <TextField
        fullWidth
        size="small"
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{ htmlInput: { "aria-label": label, "data-testid": testId } }}
      />
    </Field>
  );
}

/**
 * A rule between groups of settings.
 *
 * Standard gives every `<section>` a bottom border and strips it from the last
 * one. Drawing the rule as its own element instead means a panel that ends on a
 * conditional group cannot leave a rule hanging under nothing.
 */
export function GroupRule() {
  return <Box sx={(theme) => ({ my: "20px", borderTop: `1px solid ${theme.palette.nebula.line}` })} />;
}

/** What a list says when it has nothing in it. */
export function EmptyState({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Box
      sx={(theme) => ({
        px: "16px",
        py: "28px",
        textAlign: "center",
        borderRadius: radius("lg"),
        border: `1px dashed ${theme.palette.nebula.line2}`,
        color: theme.palette.nebula.muted,
        fontSize: 12,
      })}
    >
      {children}
    </Box>
  );
}

/** A card that groups related rows, used where a page lists many of one thing. */
export function SettingsCard({
  children,
  sx,
  testId,
}: Readonly<{ children: ReactNode; sx?: object; testId?: string }>) {
  return (
    <Box
      data-testid={testId}
      sx={(theme) => ({
        p: "14px 16px",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
        ...sx,
      })}
    >
      {children}
    </Box>
  );
}

/**
 * A grid of choices where each choice can show what it *does*.
 *
 * The date and time pickers are the reason this is not a `PillGroup`: "DD/MM/
 * YYYY" names a format, but "23/08/2026" is the thing being chosen, and a pill
 * has no room for both. The preview line is optional so the same grid serves
 * the choices that need no demonstration.
 */
export function OptionCardGrid<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  columns = 3,
}: Readonly<{
  options: readonly { id: T; label: string; preview?: string }[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  columns?: number;
}>) {
  return (
    <Box
      role="radiogroup"
      aria-label={ariaLabel}
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit,minmax(${Math.floor(560 / columns)}px,1fr))`,
        gap: "8px",
      }}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Box
            key={option.id}
            component="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              boxSizing: "border-box",
              px: "13px",
              py: "10px",
              borderRadius: radius("md"),
              background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
              border: `1px solid ${active ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
              "&:hover": {
                background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover,
              },
            })}
          >
            <Typography sx={{ fontSize: 12.5, fontWeight: active ? 600 : 500 }}>{option.label}</Typography>
            {option.preview && (
              <Typography
                sx={(theme) => ({
                  mt: "3px",
                  fontFamily: NEBULA_MONO,
                  fontSize: 11,
                  color: theme.palette.nebula.muted,
                })}
              >
                {option.preview}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * A key combination, recorded by pressing it.
 *
 * The field is `readOnly` and the handler calls `preventDefault`, because while
 * recording, every key belongs to the binding rather than to the page - without
 * that, recording Ctrl+F opens the browser's find bar and records nothing.
 * Blurring cancels, so there is always a way out that does not bind something.
 */
export function ShortcutRecorder({
  label,
  value,
  placeholder,
  clearTitle,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  placeholder: string;
  clearTitle: string;
  onChange: (shortcut: string) => void;
}>) {
  const [recording, setRecording] = useState(false);
  return (
    <Stack direction="row" alignItems="center" gap={1.25} sx={{ py: "5px" }}>
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: 12.5 }} noWrap>
        {label}
      </Typography>
      {recording ? (
        <Box
          component="input"
          autoFocus
          readOnly
          placeholder={placeholder}
          aria-label={label}
          onBlur={() => setRecording(false)}
          onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const shortcut = eventToShortcut(event);
            if (shortcut) {
              onChange(shortcut);
              setRecording(false);
            }
          }}
          sx={(theme) => ({
            flex: "none",
            width: 168,
            px: "11px",
            py: "6px",
            borderRadius: radius("md"),
            fontFamily: NEBULA_MONO,
            fontSize: 11.5,
            color: theme.palette.nebula.text,
            background: theme.palette.nebula.accentSoft,
            border: `1px solid ${theme.palette.nebula.accentLine}`,
            outline: "none",
          })}
        />
      ) : (
        <Box
          component="button"
          onClick={() => setRecording(true)}
          sx={(theme) => ({
            all: "unset",
            cursor: "pointer",
            boxSizing: "border-box",
            flex: "none",
            width: 168,
            px: "11px",
            py: "6px",
            borderRadius: radius("md"),
            textAlign: "center",
            fontFamily: value ? NEBULA_MONO : "inherit",
            fontSize: 11.5,
            color: value ? theme.palette.nebula.text : theme.palette.nebula.dim,
            background: theme.palette.nebula.card,
            border: `1px solid ${theme.palette.nebula.line2}`,
            "&:hover": { background: theme.palette.nebula.hover },
          })}
        >
          {value || placeholder}
        </Box>
      )}
      <IconButton
        size="small"
        title={clearTitle}
        aria-label={clearTitle}
        disabled={!value}
        onClick={() => onChange("")}
        // Kept in the layout rather than removed, so the rows above and below
        // a cleared binding do not shift when it is cleared.
        sx={{ flex: "none", visibility: value ? "visible" : "hidden" }}
      >
        <CloseIcon width={13} height={13} />
      </IconButton>
    </Stack>
  );
}
