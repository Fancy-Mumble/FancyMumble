//! The meter's axis: a level from 0 to 1 placed along -60 to 0 dB, as the
//! web UI's `VuMeter` places it.

/// The quietest the axis shows; anything quieter sits at its left end.
pub(crate) const DB_LOW: f32 = -60.0;
/// The loudest: full scale.
pub(crate) const DB_HIGH: f32 = 0.0;

/// Where along the axis, 0 to 1, the level `amplitude` (0 to 1) sits.
pub(crate) fn along(amplitude: f32) -> f32 {
    if amplitude <= 0.0 {
        return 0.0;
    }
    let db = 20.0 * amplitude.log10();
    ((db - DB_LOW) / (DB_HIGH - DB_LOW)).clamp(0.0, 1.0)
}

/// The level that sits at `along` (0 to 1) on the axis.
pub(crate) fn level_at(along: f32) -> f32 {
    let db = DB_LOW + (DB_HIGH - DB_LOW) * along.clamp(0.0, 1.0);
    10f32.powf(db / 20.0)
}

/// How far the held peak falls, in parts of the axis a second.
pub(crate) const PEAK_FALLS: f32 = 0.6;

/// The peak shown: the loudest of what was shown and what is heard now,
/// having fallen for `seconds` since it was last shown.
pub(crate) fn held_peak(shown: f32, heard: f32, seconds: f32) -> f32 {
    (shown - PEAK_FALLS * seconds).max(0.0).max(along(heard))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_axis_runs_from_a_thousandth_to_full_scale() {
        assert!(along(0.0).abs() < f32::EPSILON);
        assert!(along(0.0001).abs() < f32::EPSILON, "quieter than -60 dB");
        assert!((along(0.001)).abs() < 1e-4);
        assert!((along(0.01) - 1.0 / 3.0).abs() < 1e-4, "-40 dB");
        assert!((along(1.0) - 1.0).abs() < 1e-6);
        for at in [0.0, 0.25, 0.5, 0.9, 1.0] {
            assert!((along(level_at(at)) - at).abs() < 1e-4);
        }
    }

    #[test]
    fn the_peak_falls_slowly_and_rises_at_once() {
        assert!((held_peak(0.5, 0.0, 0.5) - 0.2).abs() < 1e-6);
        assert!((held_peak(0.1, 1.0, 0.1) - 1.0).abs() < 1e-6);
    }
}
