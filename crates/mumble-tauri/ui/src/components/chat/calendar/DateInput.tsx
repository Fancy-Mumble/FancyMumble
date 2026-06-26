import { useState, useEffect } from "react";
import type { DateFormat } from "../../../types";
import styles from "./EventDialog.module.css";

interface DateInputProps {
  readonly value: string; // ISO format YYYY-MM-DD
  readonly onChange: (value: string) => void;
  readonly dateFormat: DateFormat;
}

/**
 * Date input that displays and accepts input in the user's preferred format.
 * Internally stores/exchanges ISO format (YYYY-MM-DD).
 */
export function DateInput({ value, onChange, dateFormat }: DateInputProps) {
  const [inputValue, setInputValue] = useState("");

  // Update display when prop value changes (from outside)
  useEffect(() => {
    const dateObj = new Date(value + "T00:00:00Z");
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getUTCDate()).padStart(2, "0");

    let displayValue = `${y}-${m}-${d}`;
    if (dateFormat === "dmy") {
      displayValue = `${d}/${m}/${y}`;
    } else if (dateFormat === "mdy") {
      displayValue = `${m}/${d}/${y}`;
    }
    setInputValue(displayValue);
  }, [value, dateFormat]);

  let placeholder = "YYYY-MM-DD";
  if (dateFormat === "dmy") {
    placeholder = "DD/MM/YYYY";
  } else if (dateFormat === "mdy") {
    placeholder = "MM/DD/YYYY";
  }

  const parseInput = (input: string): string | null => {
    if (!input.trim()) return null;

    let parsedY: number, parsedM: number, parsedD: number;

    if (dateFormat === "dmy") {
      const parts = input.split("/");
      if (parts.length !== 3) return null;
      parsedD = Number.parseInt(parts[0], 10);
      parsedM = Number.parseInt(parts[1], 10);
      parsedY = Number.parseInt(parts[2], 10);
    } else if (dateFormat === "mdy") {
      const parts = input.split("/");
      if (parts.length !== 3) return null;
      parsedM = Number.parseInt(parts[0], 10);
      parsedD = Number.parseInt(parts[1], 10);
      parsedY = Number.parseInt(parts[2], 10);
    } else {
      // ymd or auto - try ISO format
      const parts = input.split("-");
      if (parts.length !== 3) return null;
      parsedY = Number.parseInt(parts[0], 10);
      parsedM = Number.parseInt(parts[1], 10);
      parsedD = Number.parseInt(parts[2], 10);
    }

    if (!Number.isFinite(parsedY) || !Number.isFinite(parsedM) || !Number.isFinite(parsedD)) {
      return null;
    }

    // Validate date range
    const testDate = new Date(Date.UTC(parsedY, parsedM - 1, parsedD));
    if (
      testDate.getUTCFullYear() !== parsedY ||
      testDate.getUTCMonth() + 1 !== parsedM ||
      testDate.getUTCDate() !== parsedD
    ) {
      return null;
    }

    const isoYear = String(parsedY).padStart(4, "0");
    const isoMonth = String(parsedM).padStart(2, "0");
    const isoDay = String(parsedD).padStart(2, "0");
    return `${isoYear}-${isoMonth}-${isoDay}`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setInputValue(newVal);
    const parsed = parseInput(newVal);
    if (parsed) {
      onChange(parsed);
    }
  };

  return (
    <input
      type="text"
      className={styles.input}
      value={inputValue}
      placeholder={placeholder}
      onChange={handleChange}
    />
  );
}
