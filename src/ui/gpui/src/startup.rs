//! How long starting took, step by step.
//!
//! One line in the log once the window has shown its first frame, so that a
//! slow start can be read afterwards rather than guessed at. `STARTUP.md`
//! says how the whole start was measured from outside.

use std::fmt;
use std::time::{Duration, Instant};

use gpui::Window;

/// The steps of the start so far, each with how long it took.
#[derive(Debug)]
pub(crate) struct Startup {
    began: Instant,
    last: Instant,
    steps: Vec<(&'static str, Duration)>,
}

impl Startup {
    /// Start counting now.
    pub(crate) fn begin() -> Self {
        let now = Instant::now();
        Self {
            began: now,
            last: now,
            steps: Vec::new(),
        }
    }

    /// `step` has just finished.
    pub(crate) fn done(&mut self, step: &'static str) {
        let now = Instant::now();
        self.steps.push((step, now - self.last));
        self.last = now;
    }

    /// Write the steps into the log once `window` has drawn its first
    /// frame: a callback for the next frame runs as that frame begins, so
    /// the first one is drawn when the second begins.
    pub(crate) fn report_after_first_frame(mut self, window: &Window) {
        window.on_next_frame(move |window, _| {
            self.done("waiting for the first frame");
            window.on_next_frame(move |_, _| {
                self.done("drawing it");
                tracing::info!("{self}");
            });
        });
    }
}

impl fmt::Display for Startup {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let ms = |took: Duration| took.as_secs_f64() * 1000.0;
        write!(f, "started in {:.1} ms:", ms(self.last - self.began))?;
        for (step, took) in &self.steps {
            write!(f, " {step} {:.1},", ms(*took))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_steps_add_up_to_the_whole() {
        let mut startup = Startup::begin();
        startup.done("one");
        startup.done("two");
        let said = startup.to_string();
        assert!(said.starts_with("started in "), "{said}");
        assert!(said.contains(" one ") && said.contains(" two "), "{said}");
        let whole: Duration = startup.steps.iter().map(|(_, took)| *took).sum();
        assert_eq!(whole, startup.last - startup.began);
    }
}
