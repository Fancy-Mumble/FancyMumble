import styles from "./Slider.module.css";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Renders the readout beside the track. Omit to hide it. */
  format?: (value: number) => string;
  /** Accessible name; required because the readout is not a label. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** A range input with an optional formatted readout. */
export default function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
  label,
  disabled,
  className,
}: SliderProps) {
  return (
    <span className={`${styles.slider} ${className ?? ""}`}>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {format && <b className={styles.value}>{format(value)}</b>}
    </span>
  );
}
