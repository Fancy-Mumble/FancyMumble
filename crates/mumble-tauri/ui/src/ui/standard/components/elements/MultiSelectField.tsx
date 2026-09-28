/**
 * MultiSelectField - a labelled multi-select built on the shared field chrome.
 *
 * Pairs {@link ./Autocomplete!Autocomplete} in `multiple` mode with the same
 * label / helper-text / error scaffolding {@link ./TextField!TextField} uses,
 * so a dropdown multi-select is just another field rather than its own
 * bespoke widget. The chrome itself comes from `TextInput.module.css` via
 * `composes`, so radius, border, background and focus move with every other
 * input in the app instead of drifting.
 *
 *   <MultiSelectField
 *     label="Channels"
 *     helperText="Members are added to these on join"
 *     options={channelOptions}
 *     value={selected}
 *     onChange={setSelected}
 *   />
 *
 * For a single-value picker use `Autocomplete` directly; this component exists
 * for the multi case, which is where the label/error scaffolding was being
 * hand-rolled at each call site.
 */

import { useId, type ReactNode } from "react";
import { Autocomplete, type AutocompleteOption } from "./Autocomplete";
import styles from "./TextInput.module.css";

function cx(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
}

export interface MultiSelectFieldProps<T> {
  readonly label?: ReactNode;
  /** Helper text under the field; replaced by `error` when that is a string. */
  readonly helperText?: ReactNode;
  /** `true` marks the field invalid; a string also renders as the message. */
  readonly error?: boolean | string;
  readonly required?: boolean;
  readonly options: readonly AutocompleteOption<T>[];
  readonly value: readonly AutocompleteOption<T>[];
  readonly onChange: (value: readonly AutocompleteOption<T>[]) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Empty-state text for the dropdown. */
  readonly noOptionsText?: string;
  /** Applied to the root wrapper, matching TextField. */
  readonly className?: string;
}

export function MultiSelectField<T>({
  label,
  helperText,
  error,
  required,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  noOptionsText,
  className,
}: Readonly<MultiSelectFieldProps<T>>) {
  const uid = useId();
  const id = `msf-${uid}`;
  const invalid = Boolean(error);
  const message = typeof error === "string" ? error : helperText;
  const messageId = message ? `${id}-msg` : undefined;

  return (
    <div className={cx(styles.field, styles.fullWidth, className)}>
      {label && (
        // The control is a composite (chips + a text input), so the label
        // points at the group rather than a single element.
        <span className={styles.label} id={`${id}-label`}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          )}
        </span>
      )}

      <div aria-labelledby={label ? `${id}-label` : undefined} aria-describedby={messageId}>
        <Autocomplete<T>
          multiple
          options={options}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          noOptionsText={noOptionsText}
        />
      </div>

      {message && (
        <p
          id={messageId}
          className={invalid ? styles.error : styles.hint}
          role={invalid ? "alert" : undefined}
        >
          {message}
        </p>
      )}
    </div>
  );
}
