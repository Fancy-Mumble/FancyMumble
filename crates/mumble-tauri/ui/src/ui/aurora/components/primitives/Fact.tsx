import styles from "../../AuroraClientSurfaces.module.css";

/** One label/value pair in a details grid. */
export default function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
