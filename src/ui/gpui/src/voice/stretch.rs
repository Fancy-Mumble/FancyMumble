//! Speech played faster without being played higher: what a browser does
//! for the web client's `playbackRate`, which keeps the pitch.
//!
//! WSOLA: the output is laid down in steps of a fixed length, each a
//! stretch of the input taken further on than the last by the step times
//! the speed, nudged to where it best continues what was laid down before
//! and faded into it. At the speed of one the input goes through untouched.

/// A step of the output, the fade between two steps, and how far either
/// way a step is nudged to fit: 20, 10 and 5 milliseconds at 48 kHz.
const STEP: usize = 960;
const FADE: usize = 480;
const NUDGE: usize = 240;

/// Turns input at one pace into output at another, a step at a time.
#[derive(Debug, Default)]
pub(super) struct Stretch {
    /// Input not yet left behind; `input[0]` is the input's `base`th sample.
    input: Vec<f32>,
    base: u64,
    /// Where the next step is taken from, ideally.
    next: f64,
    /// The end of the step laid down last, to fade the next one into.
    tail: Vec<f32>,
}

impl Stretch {
    /// Start again at the input's `at`th sample, with nothing held.
    pub(super) fn restart(&mut self, at: u64) {
        self.input.clear();
        self.base = at;
        self.next = at as f64;
        self.tail.clear();
    }

    /// Take more input.
    pub(super) fn feed(&mut self, samples: &[f32]) {
        self.input.extend_from_slice(samples);
    }

    /// How much input a step wants beyond where it ideally starts.
    const WANTED: usize = STEP + FADE + 2 * NUDGE;

    /// Where the input is that the next step stands for.
    pub(super) fn position(&self) -> u64 {
        self.next.round().max(0.0) as u64
    }

    /// The next step of output at `speed`, if enough input is held for
    /// one; `None` asks for more input. With `ending`, what is left is let
    /// out as it is.
    pub(super) fn step(&mut self, speed: f32, ending: bool) -> Option<Vec<f32>> {
        let from = self.nudged()?;
        let start = usize::try_from(from.saturating_sub(self.base)).ok()?;
        if start + Self::WANTED > self.input.len() {
            if !ending {
                return None;
            }
            let mut rest: Vec<f32> = std::mem::take(&mut self.tail);
            rest.extend(self.input.get(start + FADE..).unwrap_or_default());
            self.input.clear();
            return (!rest.is_empty()).then_some(rest);
        }
        let piece = &self.input[start..start + STEP + FADE];
        let mut out = Vec::with_capacity(STEP);
        // Faded from the last step's end into this one's start.
        for (at, sample) in piece[..FADE].iter().enumerate() {
            let rise = (at as f32 + 0.5) / FADE as f32;
            let before = self.tail.get(at).copied().unwrap_or(*sample);
            out.push(before * (1.0 - rise) + sample * rise);
        }
        out.extend_from_slice(&piece[FADE..STEP]);
        self.tail = piece[STEP..].to_vec();
        self.next += STEP as f64 * f64::from(speed);
        self.let_go();
        Some(out)
    }

    /// Where the next step starts: near where it should, where it best
    /// continues the last step's end. `None` before the input reaches it.
    fn nudged(&self) -> Option<u64> {
        let ideal = self.next.round().max(0.0) as u64;
        if self.tail.is_empty() {
            return Some(ideal);
        }
        let lowest = ideal.saturating_sub(NUDGE as u64).max(self.base);
        let mut best = (f32::MIN, ideal);
        for from in (lowest..=ideal + NUDGE as u64).step_by(2) {
            let at = usize::try_from(from - self.base).ok()?;
            let Some(candidate) = self.input.get(at..at + FADE) else {
                break;
            };
            let likeness: f32 = candidate
                .iter()
                .zip(&self.tail)
                .step_by(2)
                .map(|(a, b)| a * b)
                .sum();
            if likeness > best.0 {
                best = (likeness, from);
            }
        }
        Some(best.1)
    }

    /// Drop the input every later step is past.
    fn let_go(&mut self) {
        let keep_from = (self.next.max(0.0) as u64).saturating_sub(NUDGE as u64);
        let gone = usize::try_from(keep_from.saturating_sub(self.base))
            .unwrap_or(0)
            .min(self.input.len());
        if gone > 0 {
            drop(self.input.drain(..gone));
            self.base += gone as u64;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A second of a 300 Hz tone.
    fn tone() -> Vec<f32> {
        (0..48_000)
            .map(|i| (i as f32 / 48_000.0 * 300.0 * std::f32::consts::TAU).sin() * 0.5)
            .collect()
    }

    fn stretched(input: &[f32], speed: f32) -> Vec<f32> {
        let mut stretch = Stretch::default();
        stretch.restart(0);
        stretch.feed(input);
        let mut out = Vec::new();
        while let Some(step) = stretch.step(speed, true) {
            out.extend(step);
        }
        out
    }

    /// How many times the signal crosses zero going up: its pitch, for a
    /// tone.
    fn rises(samples: &[f32]) -> usize {
        samples
            .windows(2)
            .filter(|pair| pair[0] < 0.0 && pair[1] >= 0.0)
            .count()
    }

    #[test]
    fn twice_as_fast_is_half_as_long_and_as_high_as_it_was() {
        let input = tone();
        let out = stretched(&input, 2.0);
        assert!((23_000..=25_500).contains(&out.len()), "{}", out.len());
        // Half the time at the same pitch: half the rises, give or take
        // the ends.
        let (before, after) = (rises(&input), rises(&out));
        assert!(after.abs_diff(before / 2) <= 4, "{before} then {after}");
    }

    #[test]
    fn one_and_a_half_times_is_two_thirds_as_long() {
        let out = stretched(&tone(), 1.5);
        assert!((31_000..=33_500).contains(&out.len()), "{}", out.len());
    }

    #[test]
    fn nothing_comes_out_before_enough_has_gone_in() {
        let mut stretch = Stretch::default();
        stretch.restart(0);
        stretch.feed(&[0.1; 100]);
        assert!(stretch.step(2.0, false).is_none());
    }
}
