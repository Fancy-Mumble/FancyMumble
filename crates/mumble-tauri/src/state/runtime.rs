//! The async runtime the engine's background tasks run on.
//!
//! The engine does not own a runtime of its own when something hosts it: the
//! application hands over the one it already runs ([`adopt`]), so engine tasks
//! and the host's own share one set of worker threads. Without a host - in a
//! unit test, or a view that has no runtime to share - tasks land on the
//! runtime of the calling thread, or failing that on one started here.

use std::future::Future;
use std::sync::OnceLock;

use tokio::runtime::{Handle, Runtime};

pub(crate) use tokio::task::JoinHandle;

static ADOPTED: OnceLock<Handle> = OnceLock::new();
static OWNED: OnceLock<Runtime> = OnceLock::new();

/// Run the engine's tasks on the host's runtime from now on.
///
/// The first caller wins; a second call is ignored, since tasks already
/// spawned stay where they are.
pub(crate) fn adopt(handle: Handle) {
    let _ = ADOPTED.set(handle);
}

#[allow(
    clippy::expect_used,
    reason = "without worker threads the engine cannot run at all; there is nothing to fall back to"
)]
fn handle() -> Handle {
    if let Some(adopted) = ADOPTED.get() {
        return adopted.clone();
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
