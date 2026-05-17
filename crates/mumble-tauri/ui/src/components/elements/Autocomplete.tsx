import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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

export interface AutocompleteProps<T> {
  /** The currently selected option, or `null` for no selection. */
  readonly value: AutocompleteOption<T> | null;
  /** Full list of options that can be searched and selected. */
  readonly options: readonly AutocompleteOption<T>[];
  readonly onChange: (option: AutocompleteOption<T> | null) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Label shown in the dropdown when no options match the query. */
  readonly noOptionsText?: string;
  /** Accessible label for the input (use when no visible label is nearby). */
  readonly label?: string;
  /** Ref forwarded to the underlying `<input>` element. */
  readonly inputRef?: React.RefObject<HTMLInputElement | null>;
}

const MAX_VISIBLE = 100;

/**
 * Single-select autocomplete combobox.
 *
 * Keyboard behaviour mirrors Material UI Autocomplete:
 * - ArrowDown / ArrowUp: cycle through options
 * - Enter: confirm highlighted option
 * - Escape: close the dropdown (or clear the input when already closed)
 * - Backspace on empty input: clear selection
 */
export function Autocomplete<T>({
  value,
  options,
  onChange,
  placeholder = "Search...",
  disabled = false,
  noOptionsText = "No options",
  label,
  inputRef: externalRef,
}: Readonly<AutocompleteProps<T>>) {
  const instanceId = useId();
  const listboxId = `autocomplete-listbox-${instanceId}`;
  const internalRef = useRef<HTMLInputElement>(null);
  const inputEl = externalRef ?? internalRef;
  const listboxRef = useRef<HTMLUListElement>(null);

  const [inputValue, setInputValue] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const ignoreBlur = useRef(false);

  // Keep the text input in sync when the controlled value changes externally.
  useEffect(() => {
    setInputValue(value?.label ?? "");
  }, [value]);

  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_VISIBLE) as AutocompleteOption<T>[];
    const results: AutocompleteOption<T>[] = [];
    for (const opt of options) {
      if (opt.label.toLowerCase().includes(q)) {
        results.push(opt);
        if (results.length >= MAX_VISIBLE) break;
      }
    }
    return results;
  }, [inputValue, options]);

  const scrollOptionIntoView = useCallback((index: number) => {
    const listbox = listboxRef.current;
    if (!listbox) return;
    const item = listbox.children[index] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, []);

  const selectOption = useCallback(
    (opt: AutocompleteOption<T>) => {
      onChange(opt);
      setInputValue(opt.label);
      setOpen(false);
      setHighlightedIndex(0);
    },
    [onChange],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setHighlightedIndex(0);
    setOpen(true);
    if (value !== null) onChange(null);
  };

  const handleFocus = () => {
    setOpen(true);
  };

  const handleBlur = () => {
    if (ignoreBlur.current) {
      ignoreBlur.current = false;
      inputEl.current?.focus();
      return;
    }
    setOpen(false);
    // Restore the label of the committed value on blur (snap-back).
    setInputValue(value?.label ?? "");
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
      setInputValue(value?.label ?? "");
    } else if (e.key === "Backspace" && inputValue === "" && value !== null) {
      onChange(null);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setInputValue("");
    setOpen(false);
    inputEl.current?.focus();
  };

  return (
    <div className={styles.root} role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-owns={listboxId}>
      <div className={styles.inputWrapper}>
        <input
          ref={inputEl}
          type="text"
          className={styles.input}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={open && filtered[highlightedIndex] ? `${listboxId}-opt-${highlightedIndex}` : undefined}
          aria-label={label}
          placeholder={placeholder}
          value={inputValue}
          disabled={disabled}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {(value !== null || inputValue !== "") && !disabled && (
          <button
            type="button"
            className={styles.clearBtn}
            tabIndex={-1}
            aria-label="Clear selection"
            onMouseDown={() => { ignoreBlur.current = true; }}
            onClick={handleClear}
          >
            &times;
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listboxId}
          ref={listboxRef}
          className={styles.listbox}
          role="listbox"
          aria-label={label ?? placeholder}
          onMouseDown={() => { ignoreBlur.current = true; }}
        >
          {filtered.length === 0 ? (
            <li className={styles.noOptions} role="option" aria-selected={false}>{noOptionsText}</li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt.key}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={value?.key === opt.key}
                className={[
                  styles.option,
                  i === highlightedIndex ? styles.highlighted : "",
                  value?.key === opt.key ? styles.selected : "",
                ].filter(Boolean).join(" ")}
                onMouseEnter={() => setHighlightedIndex(i)}
                onMouseDown={() => { ignoreBlur.current = true; }}
                onClick={() => selectOption(opt)}
              >
                {opt.startAdornment}
                {opt.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
