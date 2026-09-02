import { Autocomplete, Chip, TextField } from "@mui/material";
import { radius } from "../../../tokens";

/** The translation function, as the onboarding pages pass it around. */
export type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** One thing an answer places the user into: a channel here, or an ACL group. */
export type Mapping =
  { kind: "channel"; id: number; label: string } | { kind: "group"; id: string; label: string };

export const groupMapping = (name: string): Mapping => ({ kind: "group", id: `g:${name}`, label: name });

/** How a mapping reads in prose and on a chip: channels keep their hash. */
export const mappingLabel = (mapping: Mapping): string =>
  mapping.kind === "channel" ? `# ${mapping.label}` : mapping.label;

/**
 * Channels and groups an answer grants, picked as one list.
 *
 * They are two different things to the server and one decision to the admin -
 * "where does this answer put someone" - so they share a picker, tinted apart
 * by their chips. Free text creates a group: the questionnaire is often written
 * before the roles it hands out exist.
 */
export function MappingPicker({
  ariaLabel,
  placeholder,
  options,
  value,
  onChange,
  dense,
  groups = true,
}: Readonly<{
  ariaLabel: string;
  placeholder: string;
  options: readonly Mapping[];
  value: Mapping[];
  onChange: (picked: readonly Mapping[]) => void;
  dense?: boolean;
  /**
   * Whether typing a name that is not on the list creates a group. Off where
   * only channels mean anything, so a typed word is refused rather than
   * accepted into a list that then drops it on the next change.
   */
  groups?: boolean;
}>) {
  return (
    <Autocomplete
      multiple
      freeSolo={groups}
      size="small"
      options={options as Mapping[]}
      value={value}
      disableClearable
      isOptionEqualToValue={(option, selected) =>
        typeof selected !== "string" && option.kind === selected.kind && option.id === selected.id
      }
      getOptionLabel={(option) =>
        typeof option === "string" ? option : `${option.kind === "channel" ? "# " : ""}${option.label}`
      }
      onChange={(_, picked) =>
        onChange(picked.map((entry) => (typeof entry === "string" ? groupMapping(entry.trim()) : entry)))
      }
      renderValue={(selected, getItemProps) =>
        selected.map((option, index) => {
          const mapping = typeof option === "string" ? groupMapping(option) : option;
          return (
            <Chip
              size="small"
              label={mappingLabel(mapping)}
              color={mapping.kind === "channel" ? "primary" : "default"}
              variant={mapping.kind === "channel" ? "outlined" : "filled"}
              {...getItemProps({ index })}
              key={mapping.id}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          placeholder={value.length > 0 ? "" : placeholder}
          slotProps={{
            ...params.slotProps,
            input: { ...params.slotProps.input, disableUnderline: true },
            // The label has to reach the `input` itself: on the field it names
            // the wrapper, and the box a screen reader lands in stays unnamed.
            htmlInput: { ...params.slotProps.htmlInput, "aria-label": ariaLabel },
          }}
          sx={(theme) => ({
            "& .MuiInputBase-root": {
              px: dense ? "6px" : "12px",
              py: dense ? "2px" : "8px",
              borderRadius: radius("md"),
              fontSize: dense ? 11 : 12,
              background: dense ? "transparent" : theme.palette.nebula.card,
              border: dense ? "none" : `1px solid ${theme.palette.nebula.line2}`,
            },
          })}
        />
      )}
    />
  );
}
