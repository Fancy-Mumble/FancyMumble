//! The async runtime the engine's background tasks run on.
//!
//! The engine does not own a runtime of its own when something hosts it: the
//! application hands over the one it already runs ([`adopt`]), so engine tasks
//! and the host's own share one set of worker threads. A host may hand one
//! over and later go, runtime and all, while the process goes on (an
//! embedding view's engine stopped and started again, a test starting
//! several): the latest runtime handed over that still runs is the one used,
//! and one that has stopped is let go of, and said to be. Without a host - in
//! a unit test, or a view that has no runtime to share - tasks land on the
//! runtime of the calling thread, or failing that on one started here.

use std::future::Future;
use std::sync::{Mutex, OnceLock, PoisonError};

use tokio::runtime::{Handle, Runtime};

pub(crate) use tokio::task::JoinHandle;

/// Every runtime handed over that was still running when last looked at,
/// the latest last.
static ADOPTED: Mutex<Vec<Handle>> = Mutex::new(Vec::new());
static OWNED: OnceLock<Runtime> = OnceLock::new();

/// Run the engine's tasks on the host's runtime from now on, for as long as
/// it runs.
pub(crate) fn adopt(handle: Handle) {
    ADOPTED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(handle);
}

/// Whether `handle`'s runtime still runs what is spawned on it. A runtime
/// that has shut down cancels a task the moment it is spawned, so a task
/// that never finishes by itself is finished at once there, and only there.
/// One still winding down takes it, and cancels it moments later: what is
/// spawned in that moment is lost with it, as it would be anyway.
fn runs(handle: &Handle) -> bool {
    let probe = handle.spawn(std::future::pending::<()>());
    let stopped = probe.is_finished();
    probe.abort();
    !stopped
}

/// The latest runtime handed over that still runs. One that has stopped is
/// let go of here, and said to be: a task spawned onto it would never run,
/// and nothing else would say so.
fn adopted() -> Option<Handle> {
    let mut adopted = ADOPTED.lock().unwrap_or_else(PoisonError::into_inner);
    while let Some(latest) = adopted.last() {
        if runs(latest) {
            return Some(latest.clone());
        }
        let _ = adopted.pop();
        tracing::warn!("the engine's runtime has stopped; its host is gone, and it is no longer used");
    }
    None
}

#[allow(
    clippy::expect_used,
    reason = "without worker threads the engine cannot run at all; there is nothing to fall back to"
)]
fn handle() -> Handle {
    if let Some(adopted) = adopted() {
        return adopted;
    }
    if let Ok(current) = Handle::try_current() {
        return current;
    }
    OWNED
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("the engine could not start its async runtime")
        })
        .handle()
        .clone()
}

/// Spawn `future` onto the engine's runtime.
pub(crate) fn spawn<F>(future: F) -> JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    handle().spawn(future)
}

/// Run blocking work on the runtime's blocking pool.
pub(crate) fn spawn_blocking<F, R>(work: F) -> JoinHandle<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    handle().spawn_blocking(work)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    fn runtime() -> Runtime {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .unwrap()
    }

    /// Stop `runtime`, and give its workers the moment they take to wind
    /// down: until they have, it still takes what is spawned.
    fn stop(runtime: Runtime) {
        runtime.shutdown_background();
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    /// Whether a task spawned now runs, within a second.
    fn a_task_runs() -> bool {
        let (tell, told) = std::sync::mpsc::channel();
        drop(spawn(async move {
            let _ = tell.send(());
        }));
        told.recv_timeout(std::time::Duration::from_secs(1)).is_ok()
    }

    #[test]
    fn a_stopped_runtime_is_told_from_a_running_one() {
        let running = runtime();
        assert!(runs(running.handle()));
        let handle = running.handle().clone();
        stop(running);
        assert!(!runs(&handle));
    }

    #[test]
    fn tasks_run_on_the_latest_runtime_that_still_runs() {
        // An engine, then a second while it lives: the second's is used.
        let first = runtime();
        adopt(first.handle().clone());
        assert!(a_task_runs(), "on the first engine's runtime");
        let second = runtime();
        adopt(second.handle().clone());
        assert!(a_task_runs(), "on the second's");
        // The second goes: the first's is used again.
        stop(second);
        assert!(a_task_runs(), "back on the first's, not the stopped one");
        // The first goes too, and a third engine starts.
        stop(first);
        let third = runtime();
        adopt(third.handle().clone());
        assert!(a_task_runs(), "on the third's");
        stop(third);
    }
}
