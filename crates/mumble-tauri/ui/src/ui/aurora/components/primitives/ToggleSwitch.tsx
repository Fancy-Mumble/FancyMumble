import styles from "./Primitives.module.css";

export interface ToggleSwitchProps {
  on: boolean;
}

export default function ToggleSwitch({ on }: ToggleSwitchProps) {
  return (
    <i className={on ? styles.switchOn : styles.switch}>
      <b />
    </i>
  );
}
