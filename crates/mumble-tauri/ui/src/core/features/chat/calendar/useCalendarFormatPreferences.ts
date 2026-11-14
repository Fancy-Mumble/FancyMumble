import { useEffect, useState } from "react";
import type { TimeFormat, DateFormat } from "../../../types";
import { getPreferences } from "../../../preferencesStorage";

interface FormatPreferences {
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
  convertToLocalTime: boolean;
  loading: boolean;
}

/**
 * Hook to access the user's time/date format preferences for the calendar.
 * Loads preferences on mount and caches them.
 */
export function useCalendarFormatPreferences(): FormatPreferences {
  const [prefs, setPrefs] = useState<FormatPreferences>({
    timeFormat: "auto",
    dateFormat: "auto",
    convertToLocalTime: true,
    loading: true,
  });

  useEffect(() => {
    void getPreferences().then((p) => {
      setPrefs({
        timeFormat: p.timeFormat,
        dateFormat: p.dateFormat ?? "auto",
        convertToLocalTime: p.convertToLocalTime,
        loading: false,
      });
    });
  }, []);

  return prefs;
}
