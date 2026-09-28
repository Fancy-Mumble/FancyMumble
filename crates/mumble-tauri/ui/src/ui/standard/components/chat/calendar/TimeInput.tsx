import { useState, useEffect } from "react";
import type { TimeFormat } from "@core/types";
import { formatTimeText, parseTimeText, timePlaceholder } from "@core/features/chat/calendar/calendarInputs";
import styles from "./EventDialog.module.css";

interface TimeInputProps {
  readonly value: string; // ISO format HH:mm
  readonly onChange: (value: string) => void;
  readonly timeFormat: TimeFormat;
  readonly testId?: string;
}

/**
 * Time input that displays and accepts input in the user's preferred format.
 * Internally stores/exchanges ISO format (HH:mm in 24h).
 */
export function TimeInput({ value, onChange, timeFormat, testId }: TimeInputProps) {
  const [inputValue, setInputValue] = useState("");

  // Update display when prop value changes (from outside)
  useEffect(() => {
    setInputValue(formatTimeText(value, timeFormat));
  }, [value, timeFormat]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setInputValue(newVal);
    const parsed = parseTimeText(newVal, timeFormat);
    if (parsed) {
      onChange(parsed);
    }
  };

  return (
    <input
      type="text"
      className={styles.input}
      value={inputValue}
      placeholder={timePlaceholder(timeFormat)}
      onChange={handleChange}
      data-testid={testId}
    />
  );
}
