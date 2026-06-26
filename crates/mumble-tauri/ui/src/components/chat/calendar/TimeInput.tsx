import { useState, useEffect } from "react";
import type { TimeFormat } from "../../../types";
import styles from "./EventDialog.module.css";

interface TimeInputProps {
  readonly value: string; // ISO format HH:mm
  readonly onChange: (value: string) => void;
  readonly timeFormat: TimeFormat;
}

/**
 * Time input that displays and accepts input in the user's preferred format.
 * Internally stores/exchanges ISO format (HH:mm in 24h).
 */
export function TimeInput({ value, onChange, timeFormat }: TimeInputProps) {
  const [inputValue, setInputValue] = useState("");

  // Update display when prop value changes (from outside)
  useEffect(() => {
    const [h, m] = value.split(":").map((s) => Number.parseInt(s, 10));
    const validH = Number.isFinite(h) ? h : 0;
    const validM = Number.isFinite(m) ? m : 0;

    let displayValue: string;

    if (timeFormat === "12h") {
      const hour12 = validH % 12 || 12;
      const ampm = validH < 12 ? "AM" : "PM";
      displayValue = `${String(hour12).padStart(2, "0")}:${String(validM).padStart(2, "0")} ${ampm}`;
    } else {
      displayValue = `${String(validH).padStart(2, "0")}:${String(validM).padStart(2, "0")}`;
    }

    setInputValue(displayValue);
  }, [value, timeFormat]);

  let placeholder: string;
  if (timeFormat === "12h") {
    placeholder = "HH:MM AM/PM";
  } else {
    placeholder = "HH:MM";
  }

  const parseInput = (input: string): string | null => {
    if (!input.trim()) return null;

    let parsedH: number, parsedM: number;

    if (timeFormat === "12h") {
      // Match "HH:MM AM/PM" or "H:MM AM/PM"
      const match = input.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
      if (!match) return null;

      parsedH = Number.parseInt(match[1], 10);
      parsedM = Number.parseInt(match[2], 10);
      const meridiem = match[3].toUpperCase();

      // Convert 12h to 24h
      if (parsedH === 12) {
        parsedH = meridiem === "PM" ? 12 : 0;
      } else if (meridiem === "PM") {
        parsedH += 12;
      }
    } else {
      // Match "HH:MM" or "H:MM"
      const match = input.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;

      parsedH = Number.parseInt(match[1], 10);
      parsedM = Number.parseInt(match[2], 10);
    }

    if (!Number.isFinite(parsedH) || !Number.isFinite(parsedM)) {
      return null;
    }

    if (parsedH < 0 || parsedH > 23 || parsedM < 0 || parsedM > 59) {
      return null;
    }

    return `${String(parsedH).padStart(2, "0")}:${String(parsedM).padStart(2, "0")}`;
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
