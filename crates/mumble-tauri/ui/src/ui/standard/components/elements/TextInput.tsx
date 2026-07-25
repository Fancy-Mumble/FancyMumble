/**
 * Shared form controls: `TextInput`, `TextArea`, `SelectInput` and the `Field`
 * wrapper that labels them.
 *
 * These exist because every feature used to hand-roll its own input, leaving
 * the app with a dozen border-radii and four different focus treatments. Reach
 * for these instead of styling a bare `<input>`; if something genuinely needs a
 * new look, extend `TextInput.module.css` so every surface moves together.
 *
 * `Field` publishes its generated id, describedby and invalid state through
 * context, so wrapping a control is all that's needed to get a properly
 * associated `<label>` and `aria-describedby` - no manual id plumbing:
 *
 * ```tsx
 * <Field label="Actor" hint="name or id">
 *   <TextInput value={actor} onChange={e => setActor(e.target.value)} />
 * </Field>
 * ```
 *
 * All native props pass straight through, so `type`, `disabled`, `data-testid`
 * and friends work as usual.
 */

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { CloseIcon, SearchIcon } from "../../icons";
import styles from "./TextInput.module.css";

/**
 * Control density, named as Material UI names it so the whole family reads the
 * same: `size="small"` for toolbars/rails, `size="medium"` (default) elsewhere.
 * The native numeric `size` attribute is omitted on each control, exactly as
 * MUI does, so this name is free.
 */
export type FieldSize = "small" | "medium";

/** Density -> CSS modifier. */
const SIZE_CLASS: Record<FieldSize, string> = { small: styles.sm, medium: styles.md };

interface FieldContextValue {
  readonly id: string;
  readonly describedBy?: string;
  readonly invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

interface SharedProps {
  /** Marks the control invalid; inherited from a surrounding `Field` error. */
  readonly invalid?: boolean;
  readonly size?: FieldSize;
  /** Render in the monospace face (query editors, hashes, code). */
  readonly mono?: boolean;
}

/** Merge explicit props with whatever the surrounding `Field` provides. */
function useControlProps(id: string | undefined, invalid: boolean | undefined) {
  const ctx = useContext(FieldContext);
  const resolvedInvalid = invalid ?? ctx?.invalid ?? false;
  return {
    id: id ?? ctx?.id,
    "aria-describedby": ctx?.describedBy,
    "aria-invalid": resolvedInvalid || undefined,
    invalid: resolvedInvalid,
  };
}

type TextInputProps = Omit<ComponentPropsWithoutRef<"input">, "size"> & SharedProps;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid, size = "medium", mono, className, id, ...rest },
  ref,
) {
  const c = useControlProps(id, invalid);
  return (
    <input
      ref={ref}
      id={c.id}
      aria-describedby={c["aria-describedby"]}
      aria-invalid={c["aria-invalid"]}
      className={cx(
        styles.control,
        SIZE_CLASS[size],
        mono && styles.mono,
        c.invalid && styles.invalid,
        className,
      )}
      {...rest}
    />
  );
});

type TextAreaProps = Omit<ComponentPropsWithoutRef<"textarea">, "size"> & SharedProps;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { invalid, size = "medium", mono, className, id, ...rest },
  ref,
) {
  const c = useControlProps(id, invalid);
  return (
    <textarea
      ref={ref}
      id={c.id}
      aria-describedby={c["aria-describedby"]}
      aria-invalid={c["aria-invalid"]}
      className={cx(
        styles.control,
        SIZE_CLASS[size],
        styles.textarea,
        mono && styles.mono,
        c.invalid && styles.invalid,
        className,
      )}
      {...rest}
    />
  );
});

type SelectInputProps = Omit<ComponentPropsWithoutRef<"select">, "size"> & SharedProps;

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(function SelectInput(
  { invalid, size = "medium", className, id, children, ...rest },
  ref,
) {
  const c = useControlProps(id, invalid);
  return (
    // The native chevron is kept on purpose: suppressing it means shipping and
    // theming a replacement, which is how selects drifted apart in the first place.
    <select
      ref={ref}
      id={c.id}
      aria-describedby={c["aria-describedby"]}
      aria-invalid={c["aria-invalid"]}
      className={cx(styles.control, SIZE_CLASS[size], c.invalid && styles.invalid, className)}
      {...rest}
    >
      {children}
    </select>
  );
});

/**
 * Where the search sits, which decides whether it draws its own chrome.
 *
 *  - `field`   the input *is* the field (lists, admin toolbars)
 *  - `bar`     an outer element already draws the field, so this is bare
 *              (pickers, the settings search wrap, the sidebar bar)
 *  - `palette` bar, in larger type, for the command palette
 */
export type SearchVariant = "field" | "bar" | "palette";

type SearchInputProps = Omit<ComponentPropsWithoutRef<"input">, "type" | "size"> &
  SharedProps & {
    readonly variant?: SearchVariant;
    /** Renders a clear button while there is a value; called when pressed. */
    readonly onClear?: () => void;
    /** Accessible name for the clear button. */
    readonly clearLabel?: string;
    /**
     * Content pinned inside the field's right edge - a shortcut hint, a close
     * button, and so on. Keeping it in here (rather than as a sibling) is what
     * stops it drifting outside the box, and reserves the padding it needs.
     */
    readonly trailing?: ReactNode;
  };

/**
 * Search field: the magnifier and the input's left padding are one unit here,
 * so they can't drift apart the way they did when every feature rebuilt this
 * pairing by hand. Wraps the same base styles as {@link TextInput}.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    invalid,
    size = "medium",
    variant = "field",
    mono,
    className,
    id,
    onClear,
    clearLabel = "Clear search",
    trailing,
    value,
    ...rest
  },
  ref,
) {
  const c = useControlProps(id, invalid);
  const showClear = Boolean(onClear) && value !== undefined && value !== "";
  const hasTrailing = Boolean(trailing) || showClear;
  return (
    <div className={cx(styles.searchWrap, size === "small" && styles.searchWrapSm)}>
      <SearchIcon className={styles.searchIcon} width={14} height={14} aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        id={c.id}
        value={value}
        aria-describedby={c["aria-describedby"]}
        aria-invalid={c["aria-invalid"]}
        className={cx(
          styles.control,
          SIZE_CLASS[size],
          styles.search,
          variant !== "field" && styles.searchBare,
          variant === "palette" && styles.searchPalette,
          hasTrailing && styles.hasTrailing,
          mono && styles.mono,
          c.invalid && styles.invalid,
          className,
        )}
        {...rest}
      />
      {trailing && <span className={styles.searchTrailing}>{trailing}</span>}
      {showClear && (
        <button type="button" className={styles.searchClear} aria-label={clearLabel} onClick={onClear}>
          <CloseIcon width={12} height={12} />
        </button>
      )}
    </div>
  );
});

interface FieldProps {
  readonly label?: ReactNode;
  /** Helper text; replaced by `error` when one is present. */
  readonly hint?: ReactNode;
  /** Validation message. Its presence marks the wrapped control invalid. */
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/** Labelled wrapper: renders the label, the control, and a hint or error. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const uid = useId();
  const id = `field-${uid}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  // The error wins when both exist, so a screen reader isn't read stale help.
  const describedBy = errorId ?? hintId;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={cx(styles.field, className)}>
        {label && (
          <label className={styles.label} htmlFor={id}>
            {label}
            {required && (
              <span className={styles.required} aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        {children}
        {error ? (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        ) : (
          hint && (
            <p id={hintId} className={styles.hint}>
              {hint}
            </p>
          )
        )}
      </div>
    </FieldContext.Provider>
  );
}
