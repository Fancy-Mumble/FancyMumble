//! Manages the Vite dev server when the app is run via plain `cargo run`.
//!
//! `cargo tauri dev` starts the dev server (its `beforeDevCommand`) and kills
//! it when the app exits. A plain `cargo run` of a dev build (anything without
//! the `custom-protocol` feature, e.g. profiling with `--features dhat-heap`)
//! loads the same dev URL but does NOT manage the server, leaving a stray Vite
//! holding the port. This module starts Vite on launch and tears it down on
//! exit so the dev server's lifetime follows the app. It is compiled only into
//! dev builds (`cfg(dev)`), so it is absent from production binaries.

use std::net::{SocketAddr, TcpStream};
use std::process::Child;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The dev-server port (must match `build.devUrl` in `tauri.conf.json`).
const DEV_PORT: u16 = 1420;

/// Holds the spawned Vite child so [`stop`] can terminate it on exit.
static DEV_SERVER: Mutex<Option<Child>> = Mutex::new(None);

/// Whether something is already serving the dev URL.
fn port_in_use() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], DEV_PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// Spawn the Vite dev server unless one is already running on the port
/// (e.g. under `cargo tauri dev`, which owns its own server).
pub(crate) fn start() {
    if port_in_use() {
        tracing::info!("dev server already on :{DEV_PORT}; leaving it to its owner");
        return;
    }
    let ui_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("ui");
    // `npm` is `npm.cmd` on Windows, which is only resolvable through the
    // shell, so route the command through `cmd /C` there.
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("cmd");
        let _ = c.args(["/C", "npm", "run", "dev"]);
        c
    } else {
        let mut c = std::process::Command::new("npm");
        let _ = c.args(["run", "dev"]);
        c
    };
    let _ = cmd.current_dir(&ui_dir);
    match cmd.spawn() {
        Ok(child) => {
            tracing::info!(pid = child.id(), "started Vite dev server");
            if let Ok(mut guard) = DEV_SERVER.lock() {
                *guard = Some(child);
            }
            wait_until_ready();
        }
        Err(e) => tracing::warn!("failed to start Vite dev server: {e}"),
    }
}

/// Block (briefly) until the dev server accepts connections so the webview
/// does not load before Vite is ready (which shows `ERR_CONNECTION_REFUSED`).
fn wait_until_ready() {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if port_in_use() {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    tracing::warn!("Vite dev server did not come up within 30s");
}

/// Terminate the spawned dev server (and its `node` child) if we started it.
pub(crate) fn stop() {
    let child = DEV_SERVER.lock().ok().and_then(|mut g| g.take());
    if let Some(mut child) = child {
        let pid = child.id();
        // `cmd /C npm run dev` spawns a `node` grandchild; kill the whole
        // tree, otherwise Vite keeps holding the port after the app exits.
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output();
        }
        let _ = child.kill();
        let _ = child.wait();
        tracing::info!(pid, "stopped Vite dev server");
    }
}
