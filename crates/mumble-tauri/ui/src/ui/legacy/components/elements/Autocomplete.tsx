import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import styles from "./Autocomplete.module.css";

export interface AutocompleteOption<T> {
  /** Stable key used for React reconciliation and equality checks. */
  readonly key: string | number;
  /** Display label shown in the input and in the dropdown. */
  readonly label: string;
  /** The underlying value; returned via `onChange`. */
  readonly value: T;
  /** Optional adornment rendered to the left of the label inside each option row. */
  readonly startAdornment?: ReactNode;
}

/** Props shared between single-select and multiple-select modes. */
interface CommonAutocompleteProps<T> {
  readonly options: readonly AutocompleteOption<T>[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly noOptionsText?: string;
  readonly label?: string;
  readonly inputRef?: React.RefObject<HTMLInputElement | null>;
}

/** Single-select Autocomplete (the original behaviour). */
export interface SingleAutocompleteProps<T> extends CommonAutocompleteProps<T> {
  readonly multiple?: false;
  readonly value: AutocompleteOption<T> | null;
  readonly onChange: (option: AutocompleteOption<T> | null) => void;
}

/** Multiple-select Autocomplete, MUI-style: chips inline with the input. */
export interface MultipleAutocompleteProps<T> extends CommonAutocompleteProps<T> {
  readonly multiple: true;
  readonly value: readonly AutocompleteOption<T>[];
  readonly onChange: (options: readonly AutocompleteOption<T>[]) => void;
}

export type AutocompleteProps<T> =
  | SingleAutocompleteProps<T>
  | MultipleAutocompleteProps<T>;

const MAX_VISIBLE = 200;

/**
 * Autocomplete combobox.  Supports single-select (default) and
 * multiple-select via `multiple={true}`.
 *
 * Keyboard behaviour mirrors Material UI Autocomplete:
 * - ArrowDown / ArrowUp: cycle through options
 * - Enter: confirm / toggle the highlighted option
 * - Escape: close the dropdown
 * - Backspace on empty input: clear the last selected value (or pop the
 *   last chip in multiple mode)
 *
 * Multiple mode keeps the dropdown open after a selection and never
 * hides already-selected options - they stay in the list with a
 * check-mark adornment so the user can both add and remove from the
 * same dropdown.
 */
export function Autocomplete<T>(props: Readonly<AutocompleteProps<T>>) {
  const { options, placeholder, disabled = false, noOptionsText, label, inputRef: externalRef } = props;
  const multiple = props.multiple === true;
  const { t } = useTranslation("common");
  const displayPlaceholder = placeholder ?? t("autocomplete.placeholder");
  const displayNoOptions = noOptionsText ?? t("autocomplete.noOptions");
  const instanceId = useId();
  const listboxId = `autocomplete-listbox-${instanceId}`;
  const internalRef = useRef<HTMLInputElement>(null);
  const inputEl = externalRef ?? internalRef;
  const listboxRef = useRef<HTMLUListElement>(null);
  /** Wrapper around the input + chips - used as the popper's anchor. */
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [popperRect, setPopperRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // Snapshot the current selection so we don't have to repeatedly
  // narrow the discriminated union at every use site below.
  const singleValue = multiple ? null : props.value;
  const multipleValue = multiple ? props.value : EMPTY_ARRAY;

  // Stable Set of selected keys for O(1) "is this already chosen?" lookups.
  const selectedKeys = useMemo(() => {
    if (multiple) return new Set(multipleValue.map((v) => v.key));
    if (singleValue) return new Set([singleValue.key]);
    return new Set<string | number>();
  }, [multiple, multipleValue, singleValue]);

  // The input value is the user's free-text filter.  In single-select
  // mode it doubles as the display string for the committed value and
  // snaps back to that label on blur - multi-select never does this
  // because the chips already show what's chosen.
  const [inputValue, setInputValue] = useState(
    multiple ? "" : props.value?.label ?? "",
  );
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const ignoreBlur = useRef(false);

  // Single mode: keep the text input in sync when the controlled value
  // changes externally (e.g. parent resets to null).  Multi mode keeps
  // the input as the live filter so we never overwrite it.
  useEffect(() => {
    if (!multiple) setInputValue(singleValue?.label ?? "");
  }, [multiple, singleValue]);

  // Track the wrapper's viewport rect so the portaled listbox can
  // position itself underneath it.  Portaling sidesteps `overflow:
  // hidden` / stacking-context bugs that would otherwise hide or clip
  // the dropdown - fixed-position relative to the viewport plus a
  // sufficiently-high z-index always wins.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = wrapperRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopperRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    // Reposition on every scroll *anywhere* (capture: true catches
    // ancestor scrolling) plus window resize.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && wrapperRef.current) {
      ro = new ResizeObserver(update);
      ro.observe(wrapperRef.current);
    }
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    // Single-select: when the input still shows the current selection's
    // label verbatim (i.e. the user just opened the dropdown without
    // typing) show all options instead of filtering to the single
    // selected item.  Multi-select never collapses to one item like
    // that, so this branch is single-only.
    const showingSelectedLabel =
      !multiple && singleValue !== null && q === singleValue.label.toLowerCase();
    if (!q || showingSelectedLabel) {
      return options.slice(0, MAX_VISIBLE) as AutocompleteOption<T>[];
    }
    const results: AutocompleteOption<T>[] = [];
    for (const opt of options) {
      if (opt.label.toLowerCase().includes(q)) {
        results.push(opt);
        if (results.length >= MAX_VISIBLE) break;
      }
    }
    return results;
  }, [inputValue, options, multiple, singleValue]);

  const scrollOptionIntoView = useCallback((index: number) => {
    const listbox = listboxRef.current;
    if (!listbox) return;
    const item = listbox.children[index] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, []);

  const selectOption = useCallback(
    (opt: AutocompleteOption<T>) => {
      if (multiple) {
        const next = selectedKeys.has(opt.key)
          ? multipleValue.filter((v) => v.key !== opt.key)
          : [...multipleValue, opt];
        props.onChange(next);
        setInputValue("");
        setHighlightedIndex(0);
        // Keep the dropdown open so the user can pick / unpick several
        // in a row - that's the whole point of multiple mode.
        inputEl.current?.focus();
      } else {
        props.onChange(opt);
        setInputValue(opt.label);
        setOpen(false);
        setHighlightedIndex(0);
      }
    },
    [multiple, multipleValue, selectedKeys, props, inputEl],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setHighlightedIndex(0);
    setOpen(true);
    // Single mode: typing implicitly clears the committed selection so
    // the parent's `value` matches the visible state.  Multi mode keeps
    // the chips around because typing only filters.
    if (!multiple && singleValue !== null) props.onChange(null);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setOpen(true);
    // Single mode pre-selects the existing text so the user can type to
    // replace it.  In multi mode there is no "current text" - chips
    // hold the state - so leave the caret where it is.
    if (!multiple) e.target.select();
  };

  const handleBlur = () => {
    if (ignoreBlur.current) {
      ignoreBlur.current = false;
      inputEl.current?.focus();
      return;
    }
    setOpen(false);
    // Single mode snaps the text back to the committed label on blur.
    // Multi mode just clears the filter - chips are already visible.
    if (multiple) setInputValue("");
    else setInputValue(singleValue?.label ?? "");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(highlightedIndex + 1, filtered.length - 1);
      setHighlightedIndex(next);
      scrollOptionIntoView(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(highlightedIndex - 1, 0);
      setHighlightedIndex(next);
      scrollOptionIntoView(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightedIndex]) selectOption(filtered[highlightedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      if (!multiple) setInputValue(singleValue?.label ?? "");
    } else if (e.key === "Backspace" && inputValue === "") {
      if (multiple) {
        if (multipleValue.length > 0) {
          props.onChange(multipleValue.slice(0, -1));
        }
      } else if (singleValue !== null) {
        props.onChange(null);
      }
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (multiple) props.onChange([]);
    else props.onChange(null);
    setInputValue("");
    setOpen(false);
    inputEl.current?.focus();
  };

  const removeChip = useCallback(
    (opt: AutocompleteOption<T>) => {
      if (!multiple) return;
      props.onChange(multipleValue.filter((v) => v.key !== opt.key));
    },
    [multiple, multipleValue, props],
  );

  const hasSelection = multiple ? multipleValue.length > 0 : singleValue !== null;
  const showClearBtn = hasSelection || inputValue !== "";

  return (
    <div className={styles.root} role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-owns={listboxId}>
      <div
        ref={wrapperRef}
        className={`${styles.inputWrapper} ${multiple ? styles.inputWrapperMulti : ""}`}
        // Clicking anywhere in the wrapper focuses the input - important
        // in multi-select where the chips occupy most of the row.
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            ignoreBlur.current = true;
            inputEl.current?.focus();
          }
        }}
      >
        {!multiple && singleValue?.startAdornment && (
          <span className={styles.startAdornment} aria-hidden="true">{singleValue.startAdornment}</span>
        )}

        {multiple && multipleValue.map((opt) => (
          <span key={opt.key} className={styles.chip}>
            {opt.startAdornment}
            <span className={styles.chipLabel}>{opt.label}</span>
            <button
              type="button"
              className={styles.chipClose}
              tabIndex={-1}
              aria-label={t("autocomplete.removeChipAriaLabel", { name: opt.label })}
              onMouseDown={() => { ignoreBlur.current = true; }}
              onClick={(e) => {
                e.stopPropagation();
                removeChip(opt);
              }}
            >
              &times;
            </button>
          </span>
        ))}

        <input
          ref={inputEl}
          type="text"
          className={[
            styles.input,
            !multiple && singleValue?.startAdornment ? styles.inputWithAdornment : "",
            multiple ? styles.inputMulti : "",
          ].filter(Boolean).join(" ")}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={open && filtered[highlightedIndex] ? `${listboxId}-opt-${highlightedIndex}` : undefined}
          aria-label={label}
          placeholder={multiple && multipleValue.length > 0 ? "" : displayPlaceholder}
          value={inputValue}
          disabled={disabled}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {showClearBtn && !disabled && (
          <button
            type="button"
            className={styles.clearBtn}
            tabIndex={-1}
            aria-label={t("autocomplete.clearSelectionAriaLabel")}
            onMouseDown={() => { ignoreBlur.current = true; }}
            onClick={handleClear}
          >
            &times;
          </button>
        )}
      </div>

      {open && popperRect && createPortal(
        <ul
          id={listboxId}
          ref={listboxRef}
          className={`${styles.listbox} ${styles.listboxPortaled}`}
          role="listbox"
          aria-label={label ?? displayPlaceholder}
          aria-multiselectable={multiple || undefined}
          // Match the anchor's viewport position.
          style={{
            top: popperRect.top,
            left: popperRect.left,
            width: popperRect.width,
          }}
          onMouseDown={() => { ignoreBlur.current = true; }}
        >
          {filtered.length === 0 ? (
            <li className={styles.noOptions} role="option" aria-selected={false}>{displayNoOptions}</li>
          ) : (
            filtered.map((opt, i) => {
              const isSelected = selectedKeys.has(opt.key);
              return (
                <li
                  key={opt.key}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  className={[
                    styles.option,
                    i === highlightedIndex ? styles.highlighted : "",
                    isSelected ? styles.selected : "",
                  ].filter(Boolean).join(" ")}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  onMouseDown={() => { ignoreBlur.current = true; }}
                  onClick={() => selectOption(opt)}
                >
                  {multiple && (
                    <span className={styles.checkbox} aria-hidden="true">
                      {isSelected ? "✓" : ""}
                    </span>
                  )}
                  {opt.startAdornment}
                  {opt.label}
                </li>
              );
            })
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}

const EMPTY_ARRAY: readonly never[] = [];
