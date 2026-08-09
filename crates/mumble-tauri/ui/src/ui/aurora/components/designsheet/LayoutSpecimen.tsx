import { Box, Container, SPACE } from "../primitives";
import styles from "./LayoutSpecimen.module.css";

/**
 * The spacing scale and the two layout primitives.
 *
 * Documents every step so a reviewer can see the rhythm, and gives Box and
 * Container a regression surface - they carry no colour of their own, so the
 * swatches below supply it.
 */
export default function LayoutSpecimen() {
  return (
    <Box display="flex" direction="column" gap={5}>
      <Box display="flex" direction="column" gap={2}>
        <small className={styles.caption}>SPACING SCALE</small>
        <Box display="flex" align="end" gap={3}>
          {SPACE.map((px, step) => (
            <Box key={step} display="flex" direction="column" align="center" gap={1}>
              <span className={styles.bar} style={{ height: `${Math.max(px, 2)}px` }} />
              <b className={styles.step}>{step}</b>
              <small className={styles.caption}>{px}</small>
            </Box>
          ))}
        </Box>
      </Box>

      <Box display="flex" direction="column" gap={2}>
        <small className={styles.caption}>BOX - PADDING, GAP, ALIGNMENT</small>
        <Box display="flex" gap={3} wrap>
          {([2, 3, 4] as const).map((step) => (
            <Box key={step} p={step} gap={2} display="flex" align="center" className={styles.surface}>
              <span className={styles.dot} />
              <span className={styles.label}>p={step}</span>
            </Box>
          ))}
          <Box p={3} gap={2} display="flex" direction="column" className={styles.surface}>
            <span className={styles.label}>column</span>
            <span className={styles.label}>gap=2</span>
          </Box>
          <Box p={3} display="flex" justify="between" align="center" className={styles.wide}>
            <span className={styles.label}>justify</span>
            <span className={styles.label}>between</span>
          </Box>
        </Box>
      </Box>

      <Box display="flex" direction="column" gap={2}>
        <small className={styles.caption}>CONTAINER - CENTRED, UNIFORM GUTTERS</small>
        {(["sm", "md", "lg"] as const).map((width) => (
          <Container key={width} maxWidth={width} gutter={4} className={styles.container}>
            <span className={styles.label}>maxWidth={width}</span>
          </Container>
        ))}
      </Box>
    </Box>
  );
}
