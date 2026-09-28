/**
 * TextField - one control for every text-entry surface, modelled on Material
 * UI's `TextField` but drawn with our own tokens.
 *
 * MUI's insight is that a form control is a *unit*: label, control and helper
 * text belong together, and splitting them is what lets them drift. One
 * component therefore covers what used to be five, driven by props rather than
 * by picking a different component:
 *
 *   <TextField label="Actor" helperText="name or id" value={v} onChange={…} />
 *   <TextField label="Reason" multiline rows={4} />
 *   <TextField label="Source" select>{options}</TextField>
 *   <TextField startAdornment={<SearchIcon />} endAdornment={<kbd>Ctrl+K</kbd>} />
 *
 * Adornments live inside the field and reserve their own padding, so an icon
 * can never end up sitting on top of the text - the failure that motivated
 * this. Prefer this over styling a bare <input>; if a surface needs a new
 * look, extend the variants here so every field moves together.
 */

import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import styles from "./TextInput.module.css";

/** Visual treatment. `outlined` is our default; `filled` drops the border. */
export type TextFieldVariant = "outlined" | "filled";
/** Density. Re-exported from the shared primitives so there is one definition. */
export type { FieldSize as TextFieldSize } from "./TextInput";

/** Join truthy class names. Takes `unknown` because `node && styles.x` guards
 *  can yield any falsy value, not just `false`/`undefined`. */
function cx(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
}

type NativeProps = Omit<ComponentPropsWithoutRef<"input">, "size" | "type">;

export interface TextFieldProps extends NativeProps {
  readonly label?: ReactNode;
  /** Helper text under the field; replaced by `error` when that is a string. */
  readonly helperText?: ReactNode;
  /** `true` marks the field invalid; a string also renders as the message. */
  readonly error?: boolean | string;
  readonly required?: boolean;
  readonly variant?: TextFieldVariant;
  readonly size?: "small" | "medium";
  /** Stretch to the container (the default; set false to size intrinsically). */
  readonly fullWidth?: boolean;
  /** Render a <textarea>. */
  readonly multiline?: boolean;
  readonly rows?: number;
  /** Render a <select>; pass <option>s as children. */
  readonly select?: boolean;
  readonly children?: ReactNode;
  readonly type?: string;
  /** Content pinned inside the field's leading edge (usually an icon). */
  readonly startAdornment?: ReactNode;
  /** Content pinned inside the trailing edge (shortcut hint, clear button). */
  readonly endAdornment?: ReactNode;
  /** Monospace face, for query editors and hashes. */
  readonly mono?: boolean;
  /**
   * Applied to the *control*. `className` goes to the root wrapper, matching
   * MUI, so a call site's layout class keeps working when its old
   * `<div class="field">` is replaced by this component.
   */
  readonly inputClassName?: string;
}

export const TextField = forwardRef<HTMLElement, TextFieldProps>(function TextField(
  {
    label,
    helperText,
    error,
    required,
    variant = "outlined",
    size = "medium",
    fullWidth = true,
    multiline,
    rows,
    select,
    children,
    type = "text",
    startAdornment,
    endAdornment,
    mono,
    className,
    inputClassName,
    id,
    ...rest
  },
  ref,
) {
  const uid = useId();
  const fieldId = id ?? `tf-${uid}`;
  const invalid = Boolean(error);
  const message = typeof error === "string" ? error : helperText;
  const messageId = message ? `${fieldId}-msg` : undefined;

  const controlClass = cx(
    styles.control,
    size === "small" ? styles.sm : styles.md,
    variant === "filled" && styles.filled,
    multiline && styles.textarea,
    mono && styles.mono,
    invalid && styles.invalid,
    startAdornment && (size === "small" ? styles.hasStartSm : styles.hasStart),
    endAdornment && styles.hasTrailing,
    inputClassName,
  );

  const shared = {
    id: fieldId,
    "aria-describedby": messageId,
    "aria-invalid": invalid || undefined,
    className: controlClass,
  };

  let control: ReactNode;
  if (select) {
    control = (
      <select
        ref={ref as React.Ref<HTMLSelectElement>}
        {...shared}
        {...(rest as ComponentPropsWithoutRef<"select">)}
      >
        {children}
      </select>
    );
  } else if (multiline) {
    control = (
      <textarea
        ref={ref as React.Ref<HTMLTextAreaElement>}
        rows={rows}
        {...shared}
        {...(rest as ComponentPropsWithoutRef<"textarea">)}
      />
    );
  } else {
    control = <input ref={ref as React.Ref<HTMLInputElement>} type={type} {...shared} {...rest} />;
  }

  return (
    <div className={cx(styles.field, fullWidth && styles.fullWidth, className)}>
      {label && (
        <label className={styles.label} htmlFor={fieldId}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div className={cx(styles.controlWrap, size === "small" && styles.searchWrapSm)}>
        {startAdornment && (
          <span className={styles.searchIcon} aria-hidden="true">
            {startAdornment}
          </span>
        )}
        {control}
        {endAdornment && <span className={styles.searchTrailing}>{endAdornment}</span>}
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
});
