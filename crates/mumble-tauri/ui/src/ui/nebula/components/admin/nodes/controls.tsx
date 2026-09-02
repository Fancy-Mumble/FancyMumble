import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Box, Button, Menu, MenuItem, Typography, alpha } from "@mui/material";
import { CloseIcon } from "@ui/icons";
import { radius } from "../../../tokens";
import { Stack } from "../../primitives";
import type { Tone } from "./spec";

/**
 * The small controls a node canvas is built out of.
 *
 * They are here rather than in either dialect because they are the mock's
 * vocabulary rather than any one page's: a node is a card with a border and a
 * caption, so the things inside it are pills and bare text, never a second
 * bordered box around the same thing.
 */

/** One choice on a `PillMenu`: what it is, and what it says. */
export interface PillOption {
  readonly id: string;
  readonly label: string;
}

/**
 * The mock's dropdown: a pill with a caret, not a form field.
 *
 * Chooses by id rather than by the words on the option, because a canvas
 * picks over things that share a name - two channels called "General" in
 * different branches of the tree are two different places to put somebody.
 */
export function PillMenu({
  value,
  options,
  placeholder,
  disabled,
  ariaLabel,
  onChange,
}: Readonly<{
  value: string | null;
  options: readonly PillOption[];
  /** What the pill says when nothing is chosen yet. */
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (next: string) => void;
}>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const chosen = options.find((option) => option.id === value);
  return (
    <>
      <Button
        disabled={disabled}
        aria-label={ariaLabel}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => setAnchor(e.currentTarget)}
        endIcon={<Caret />}
        sx={(theme) => ({
          minWidth: 0,
          maxWidth: "100%",
          px: "9px",
          py: "3px",
          borderRadius: radius("sm"),
          fontSize: 11.5,
          fontWeight: 500,
          textTransform: "none",
          color: chosen ? theme.palette.nebula.text : theme.palette.nebula.dim,
          background: theme.palette.nebula.card2,
          border: `1px solid ${theme.palette.nebula.line2}`,
          "&:hover": { background: theme.palette.nebula.hover },
          "& .MuiButton-endIcon": { flex: "none" },
        })}
      >
        <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {chosen?.label ?? placeholder ?? "…"}
        </Box>
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {options.map((option) => (
          <MenuItem
            key={option.id}
            selected={option.id === value}
            onClick={() => {
              onChange(option.id);
              setAnchor(null);
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** A `PillMenu` over plain words, where the word is the whole of the choice. */
export function PillSelect({
  value,
  options,
  disabled,
  onChange,
}: Readonly<{
  value: string;
  options: readonly string[];
  disabled?: boolean;
  onChange: (next: string) => void;
}>) {
  return (
    <PillMenu
      value={value}
      options={options.map((option) => ({ id: option, label: option }))}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function Caret() {
  return (
    <Box component="svg" width={8} height={8} viewBox="0 0 10 10" sx={{ fill: "none" }}>
      <path d="M2 3.5L5 6.5 8 3.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </Box>
  );
}

/**
 * A borderless field.
 *
 * Deliberately not a `TextField`: a node is already a card with a border and a
 * label, and a bordered input inside it draws a second box around the same
 * thing. The theme's bare-input baseline is overridden here for that reason.
 */
export function PlainInput({
  value,
  placeholder,
  multiline,
  ariaLabel,
  align,
  maxLength,
  onChange,
}: Readonly<{
  value: string;
  placeholder: string;
  multiline?: boolean;
  ariaLabel?: string;
  align?: "left" | "center";
  maxLength?: number;
  onChange: (next: string) => void;
}>) {
  return (
    <Box
      component={multiline ? "textarea" : "input"}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={maxLength}
      rows={multiline ? 3 : undefined}
      onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
      onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value)}
      sx={(theme) => ({
        width: "100%",
        boxSizing: "border-box",
        p: 0,
        border: 0,
        resize: "none",
        textAlign: align ?? "left",
        background: "transparent",
        color: theme.palette.nebula.text,
        fontFamily: "inherit",
        fontSize: 11.5,
        lineHeight: 1.5,
        outline: "none",
        "&::placeholder": { color: theme.palette.nebula.dim },
      })}
    />
  );
}

export function TagChip({
  label,
  tone = "accent",
  onRemove,
}: Readonly<{ label: string; tone?: Tone; onRemove?: () => void }>) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={0.5}
      sx={(theme) => {
        const colour = theme.palette.nebula[tone === "muted" ? "dim" : tone];
        return {
          px: "7px",
          py: "2px",
          borderRadius: radius("sm"),
          fontSize: 11,
          fontWeight: 500,
          color: colour,
          background: alpha(colour, 0.16),
          border: `1px solid ${alpha(colour, 0.4)}`,
        };
      }}
    >
      {label}
      {onRemove && (
        <Box
          component="button"
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          sx={{ all: "unset", display: "flex", cursor: "pointer", opacity: 0.7 }}
        >
          <CloseIcon width={9} height={9} />
        </Box>
      )}
    </Stack>
  );
}

/** The dashed `+ add` affordance, with the list of what may be added. */
export function AddChip({
  label = "+ add",
  options,
  onAdd,
}: Readonly<{ label?: string; options: readonly string[]; onAdd: (option: string) => void }>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Box
        component="button"
        type="button"
        onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
        onClick={(e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
        sx={(theme) => ({
          all: "unset",
          px: "7px",
          py: "2px",
          cursor: "pointer",
          borderRadius: radius("sm"),
          fontSize: 11,
          color: theme.palette.nebula.dim,
          border: `1px dashed ${theme.palette.nebula.line2}`,
          "&:hover": { color: theme.palette.nebula.muted },
        })}
      >
        {label}
      </Box>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {options.map((option) => (
          <MenuItem
            key={option}
            onClick={() => {
              onAdd(option);
              setAnchor(null);
            }}
          >
            {option}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function SectionLabel({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Typography
      sx={(theme) => ({
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: theme.palette.nebula.dim,
      })}
    >
      {children}
    </Typography>
  );
}

/**
 * The mock's switch, at the two sizes it appears in.
 *
 * Not MUI's `Switch`: the canvas's switches sit inside 11px rows, and the
 * component's own metrics are built for a settings form.
 */
export function MiniSwitch({
  checked,
  label,
  size = "sm",
  onChange,
}: Readonly<{ checked: boolean; label: string; size?: "sm" | "md"; onChange: () => void }>) {
  const width = size === "md" ? 32 : 30;
  const knob = 12;
  const inset = size === "md" ? 3 : 2.5;
  return (
    <Box
      component="button"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
      onClick={onChange}
      sx={(theme) => ({
        all: "unset",
        width,
        height: size === "md" ? 18 : 17,
        flex: "none",
        cursor: "pointer",
        borderRadius: "999px",
        position: "relative",
        background: checked ? theme.palette.nebula.accent : theme.palette.nebula.card2,
        "&::after": {
          content: '""',
          position: "absolute",
          top: inset,
          left: checked ? width - knob - inset : inset,
          width: knob,
          height: knob,
          borderRadius: "50%",
          background: checked ? "#fff" : theme.palette.nebula.dim,
          transition: "left .12s",
        },
      })}
    />
  );
}

/** A switch with its word beside it, for a node body's behaviour rows. */
export function ToggleRow({
  checked,
  label,
  onChange,
}: Readonly<{ checked: boolean; label: string; onChange: () => void }>) {
  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <MiniSwitch checked={checked} label={label} onChange={onChange} />
      <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}>{label}</Typography>
    </Stack>
  );
}

/** The two-way switch above the canvas: this drawing, or the same rule as prose. */
export function Segmented({
  value,
  options,
  onChange,
}: Readonly<{
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (id: string) => void;
}>) {
  return (
    <Stack
      direction="row"
      gap={0.25}
      sx={(theme) => ({
        flex: "none",
        p: "2px",
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
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            sx={(theme) => ({
              all: "unset",
              px: "11px",
              py: "4px",
              cursor: "pointer",
              borderRadius: radius("sm"),
              fontSize: 11.5,
              fontWeight: active ? 600 : 500,
              color: active ? theme.palette.nebula.accent : theme.palette.nebula.muted,
              background: active ? theme.palette.nebula.accentSoft : "transparent",
            })}
          >
            {option.label}
          </Box>
        );
      })}
    </Stack>
  );
}

/** One kind on the palette, marked with the tone its nodes carry. */
export function PaletteChip({
  label,
  tone,
  onAdd,
  onCarry,
}: Readonly<{
  label: string;
  tone: Tone;
  onAdd: () => void;
  /** Present where the chip may also be dragged onto a canvas. */
  onCarry?: (event: ReactPointerEvent) => void;
}>) {
  return (
    <Box
      component="button"
      type="button"
      onPointerDown={onCarry}
      onClick={onAdd}
      sx={(theme) => ({
        all: "unset",
        touchAction: onCarry ? "none" : undefined,
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        flex: "none",
        px: "10px",
        py: "5px",
        cursor: "pointer",
        borderRadius: radius("md"),
        fontSize: 11.5,
        whiteSpace: "nowrap",
        color: theme.palette.nebula.text,
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      <Box
        sx={(theme) => ({
          width: 6,
          height: 6,
          borderRadius: "2px",
          background: theme.palette.nebula[tone === "muted" ? "dim" : tone],
        })}
      />
      {label}
    </Box>
  );
}

export function SearchField({
  value,
  placeholder,
  onChange,
}: Readonly<{ value: string; placeholder: string; onChange: (next: string) => void }>) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1}
      sx={(theme) => ({
        flex: "0 1 300px",
        px: "11px",
        py: "7px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        "&:focus-within": { borderColor: theme.palette.nebula.accentLine },
      })}
    >
      <Box
        component="svg"
        width={13}
        height={13}
        viewBox="0 0 14 14"
        sx={(theme) => ({ flex: "none", fill: "none", stroke: theme.palette.nebula.dim, strokeWidth: 1.5 })}
      >
        <circle cx="6" cy="6" r="4.2" />
        <path d="M9.2 9.2L12 12" strokeLinecap="round" />
      </Box>
      <Box
        component="input"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        sx={(theme) => ({
          flex: 1,
          minWidth: 0,
          p: 0,
          border: 0,
          background: "transparent",
          color: theme.palette.nebula.text,
          fontFamily: "inherit",
          fontSize: 12,
          outline: "none",
          "&::placeholder": { color: theme.palette.nebula.dim },
        })}
      />
    </Stack>
  );
}

export function Star({
  on,
  label,
  bare,
  onClick,
}: Readonly<{ on: boolean; label: string; bare?: boolean; onClick: () => void }>) {
  return (
    <Box
      component="button"
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        display: "flex",
        flex: "none",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        ...(bare
          ? {}
          : {
              width: 30,
              height: 30,
              borderRadius: radius("md"),
              background: on ? alpha(theme.palette.nebula.warn, 0.16) : theme.palette.nebula.card,
              border: `1px solid ${on ? alpha(theme.palette.nebula.warn, 0.5) : theme.palette.nebula.line2}`,
            }),
      })}
    >
      <StarGlyph filled={on} size={13} />
    </Box>
  );
}

export function StarGlyph({ filled, size }: Readonly<{ filled: boolean; size: number }>) {
  return (
    <Box
      component="svg"
      width={size}
      height={size}
      viewBox="0 0 14 14"
      sx={(theme) => ({
        flex: "none",
        fill: filled ? theme.palette.nebula.warn : "none",
        stroke: filled ? theme.palette.nebula.warn : theme.palette.nebula.dim,
        strokeWidth: 1.3,
        strokeLinejoin: "round",
      })}
    >
      <path d="M7 1.6l1.7 3.5 3.8.5-2.8 2.7.7 3.8L7 10.3l-3.4 1.8.7-3.8L1.5 5.6l3.8-.5z" />
    </Box>
  );
}
