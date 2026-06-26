import type { DateFormat, TimeFormat } from "../../../types";

interface FormatHintProps {
  dateFormat?: DateFormat;
  timeFormat?: TimeFormat;
}

/** Visual hint showing the user what date/time format is expected. */
export function FormatHint({ dateFormat = "auto", timeFormat = "auto" }: FormatHintProps) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const h = String(today.getHours()).padStart(2, "0");
  const min = String(today.getMinutes()).padStart(2, "0");

  let dateSample = `${y}-${m}-${d}`;
  if (dateFormat === "dmy") dateSample = `${d}/${m}/${y}`;
  if (dateFormat === "mdy") dateSample = `${m}/${d}/${y}`;
  if (dateFormat === "ymd") dateSample = `${y}-${m}-${d}`;

  let timeSample = `${h}:${min}`;
  if (timeFormat === "12h") {
    const hour12 = today.getHours() % 12 || 12;
    const ampm = today.getHours() < 12 ? "AM" : "PM";
    timeSample = `${String(hour12).padStart(2, "0")}:${min} ${ampm}`;
  }

  return (
    <div
      style={{
        fontSize: "0.75em",
        opacity: 0.65,
        marginTop: 4,
        fontFamily: "monospace",
      }}
    >
      {dateSample} · {timeSample}
    </div>
  );
}
