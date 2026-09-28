import { useState, useEffect } from "react";
import type { DateFormat } from "@core/types";
import { datePlaceholder, formatDateText, parseDateText } from "@core/features/chat/calendar/calendarInputs";
import styles from "./EventDialog.module.css";

interface DateInputProps {
  readonly value: string; // ISO format YYYY-MM-DD
  readonly onChange: (value: string) => void;
  readonly dateFormat: DateFormat;
  readonly testId?: string;
}

/**
 * Date input that displays and accepts input in the user's preferred format.
 * Internally stores/exchanges ISO format (YYYY-MM-DD).
 */
export function DateInput({ value, onChange, dateFormat, testId }: DateInputProps) {
  const [inputValue, setInputValue] = useState("");

  // Update display when prop value changes (from outside)
  useEffect(() => {
    setInputValue(formatDateText(value, dateFormat));
  }, [value, dateFormat]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setInputValue(newVal);
    const parsed = parseDateText(newVal, dateFormat);
    if (parsed) {
      onChange(parsed);
    }
  };

  return (
    <input
      type="text"
      className={styles.input}
      value={inputValue}
      placeholder={datePlaceholder(dateFormat)}
      onChange={handleChange}
      data-testid={testId}
    />
  );
}
