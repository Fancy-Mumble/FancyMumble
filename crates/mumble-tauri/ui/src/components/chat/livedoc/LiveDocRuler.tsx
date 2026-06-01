/**
 * LiveDocRuler - Word-style horizontal and vertical rulers that frame the
 * editor page.
 *
 * Purely decorative (aria-hidden): each ruler is a full-bleed strip pinned
 * to the document-view edge (horizontal at the very top, vertical at the
 * very left) wrapping an inner element that is centred to match the page.
 * The inner element renders evenly spaced tick marks (drawn via repeating
 * gradients in CSS), a shaded band over the page margins, numeric labels,
 * and small triangular margin-boundary markers.  Everything is keyed to the
 * shared `--ld-pad-x` / `--ld-pad-y` / `--ld-major` custom properties set on
 * `.editorScroll`, so the markers always line up with the page padding.
 */

import styles from "./LiveDocRuler.module.css";

/** Number of major-tick labels to render on each axis.  Extra labels past
 *  the page edge are clipped by the ruler's `overflow: hidden`. */
const H_LABEL_COUNT = 8;
const V_LABEL_COUNT = 14;

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

export function LiveDocRulerHorizontal() {
  return (
    <div className={styles.rulerHWrap} aria-hidden="true">
      <div className={styles.rulerH}>
        <div className={styles.marginBandH} />
        {range(H_LABEL_COUNT).map((n) => (
          <span
            key={n}
            className={styles.labelH}
            style={{ left: `calc(var(--ld-pad-x) + ${n} * var(--ld-major))` }}
          >
            {n}
          </span>
        ))}
        <span className={styles.handleH} style={{ left: "var(--ld-pad-x)" }} />
        <span
          className={styles.handleH}
          style={{ left: "calc(100% - var(--ld-pad-x))" }}
        />
      </div>
    </div>
  );
}

export function LiveDocRulerVertical() {
  return (
    <div className={styles.rulerVWrap} aria-hidden="true">
      <div className={styles.rulerV}>
        <div className={styles.marginBandV} />
        {range(V_LABEL_COUNT).map((n) => (
          <span
            key={n}
            className={styles.labelV}
            style={{ top: `calc(var(--ld-pad-y) + ${n} * var(--ld-major))` }}
          >
            {n}
          </span>
        ))}
        <span className={styles.handleV} style={{ top: "var(--ld-pad-y)" }} />
        <span
          className={styles.handleV}
          style={{ top: "calc(100% - var(--ld-pad-y))" }}
        />
      </div>
    </div>
  );
}
