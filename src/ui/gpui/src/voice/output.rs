//! Where a voice message being played goes: the system's speakers, or,
//! kept silent, nowhere at the pace it would be heard.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use rodio::Source as _;
use rodio::queue::SourcesQueueOutput;

/// How much is pulled at a time when nothing is listening: what a device
/// asks for in one go.
const SLICE: Duration = Duration::from_millis(20);

/// The way out, open for as long as this is held: a thread of its own owns
/// it and closes it when this goes.
#[derive(Debug)]
pub(super) struct Output {
    /// Dropped, it tells the thread to close the way out.
    _open: std::sync::mpsc::Sender<()>,
    /// Set where no way out could be opened.
    failed: Arc<AtomicBool>,
}

impl Output {
    /// Play what `out` puts out: on the speakers, or with `silent`
    /// nowhere.
    pub(super) fn open(out: SourcesQueueOutput, silent: bool) -> Self {
        let (open, closed) = std::sync::mpsc::channel::<()>();
        let failed = Arc::new(AtomicBool::new(false));
        let failing = Arc::clone(&failed);
        let spawned = std::thread::Builder::new()
            .name("voice-message".to_owned())
            .spawn(move || {
                if silent {
                    drain(out, &closed);
                } else if let Err(error) = speak(out, &closed) {
                    tracing::debug!(%error, "a voice message could not be played");
                    failing.store(true, Ordering::Relaxed);
                }
            });
        if let Err(error) = spawned {
            tracing::debug!(%error, "no thread to play a voice message on");
            failed.store(true, Ordering::Relaxed);
        }
        Self {
            _open: open,
            failed,
        }
    }

    /// Whether no way out could be opened.
    pub(super) fn failed(&self) -> bool {
        self.failed.load(Ordering::Relaxed)
    }
}

/// Play `out` on the system's speakers until told to stop.
fn speak(
    out: SourcesQueueOutput,
    closed: &std::sync::mpsc::Receiver<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut sink = rodio::DeviceSinkBuilder::open_default_sink()?;
    sink.log_on_drop(false);
    sink.mixer().add(out);
    // Nothing is ever sent: this returns when the sender goes.
    let _ = closed.recv();
    Ok(())
}

/// Pull `out` at the pace a device would, and throw it away, until told to
/// stop: playing as if heard, with nothing heard.
fn drain(mut out: SourcesQueueOutput, closed: &std::sync::mpsc::Receiver<()>) {
    while let Err(std::sync::mpsc::RecvTimeoutError::Timeout) = closed.recv_timeout(SLICE) {
        // Asked each time: what is queued says its own rate.
        let rate = u64::from(out.sample_rate().get()) * u64::from(out.channels().get());
        let slice = rate * u64::try_from(SLICE.as_millis()).unwrap_or(20) / 1000;
        for _ in out.by_ref().take(usize::try_from(slice).unwrap_or(960)) {}
    }
}
