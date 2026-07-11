//! Env-gated e2e control channel.
//!
//! When `FANCY_QT6UI_E2E_PORT` is set, the app listens on
//! `127.0.0.1:<port>` for a line-based command protocol so the e2e suite
//! (fancy-mumble-e2e) can drive this client the way a user would - every
//! command is queued onto the Qt thread and calls the *same* `Backend`
//! invokables the QML UI calls, so the tested code path is the real one.
//!
//! Protocol (one command per line, one reply line per command):
//!   `connect <host> <port> <username> [password]` -> `ok` | `err <why>`
//!   `disconnect`                                  -> `ok` | `err <why>`
//!   `status`                                      -> `status <value>` | `err <why>`
//!
//! Without the env var this module does nothing; production behaviour is
//! untouched.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::time::Duration;

use core::pin::Pin;

use cxx_qt::CxxQtThread;
use cxx_qt_lib::QString;

use crate::bridge::qobject::Backend;

/// Env var holding the localhost TCP port for the control channel.
pub const ENV_CONTROL_PORT: &str = "FANCY_QT6UI_E2E_PORT";

/// Start the control server thread when `FANCY_QT6UI_E2E_PORT` is set.
/// Called once from the `Backend`'s `e2e_start` invokable (QML
/// `Component.onCompleted`), which supplies the Qt-thread handle.
pub fn maybe_start(thread: CxxQtThread<Backend>) {
    let Ok(raw) = std::env::var(ENV_CONTROL_PORT) else { return };
    let port: u16 = match raw.trim().parse() {
        Ok(p) => p,
        Err(_) => {
            tracing::error!("{ENV_CONTROL_PORT}={raw:?} is not a valid port; e2e control disabled");
            return;
        }
    };
    let _ = std::thread::Builder::new()
        .name("e2e-control".into())
        .spawn(move || {
            if let Err(e) = serve(port, &thread) {
                tracing::error!("e2e control server failed: {e}");
            }
        });
}

/// Accept controller connections forever (one at a time - the e2e harness
/// opens a single connection per app instance).
fn serve(port: u16, thread: &CxxQtThread<Backend>) -> std::io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    tracing::info!("e2e control listening on 127.0.0.1:{port}");
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => handle_controller(stream, thread),
            Err(e) => tracing::warn!("e2e control accept failed: {e}"),
        }
    }
    Ok(())
}

/// Serve one controller connection: read command lines, write reply lines.
fn handle_controller(stream: TcpStream, thread: &CxxQtThread<Backend>) {
    let Ok(mut writer) = stream.try_clone() else { return };
    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let reply = dispatch(line, thread);
        if writeln!(writer, "{reply}").and_then(|()| writer.flush()).is_err() {
            break;
        }
    }
}

/// Execute one command on the Qt thread and produce the reply line.
fn dispatch(line: &str, thread: &CxxQtThread<Backend>) -> String {
    let mut parts = line.split_whitespace();
    match parts.next() {
        Some("connect") => {
            let (Some(host), Some(port), Some(user)) = (parts.next(), parts.next(), parts.next())
            else {
                return "err usage: connect <host> <port> <username> [password]".to_owned();
            };
            let Ok(port) = port.parse::<i32>() else {
                return "err invalid port".to_owned();
            };
            let host = host.to_owned();
            let user = user.to_owned();
            let password = parts.next().unwrap_or("").to_owned();
            queue_ok(thread, move |backend| {
                backend.connect_to_server(
                    &QString::from(host.as_str()),
                    port,
                    &QString::from(user.as_str()),
                    &QString::from(password.as_str()),
                );
            })
        }
        Some("disconnect") => queue_ok(thread, |backend| backend.disconnect_from_server()),
        Some("status") => {
            let (tx, rx) = mpsc::channel::<String>();
            let queued = thread.queue(move |backend: Pin<&mut Backend>| {
                let _ = tx.send(backend.status().to_string());
            });
            if queued.is_err() {
                return "err qt thread gone".to_owned();
            }
            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(status) => format!("status {status}"),
                Err(_) => "err status reply timed out".to_owned(),
            }
        }
        _ => "err unknown command".to_owned(),
    }
}

/// Queue `f` onto the Qt thread; `ok` when queued, `err` when the Qt event
/// loop is gone.
fn queue_ok(
    thread: &CxxQtThread<Backend>,
    f: impl FnOnce(Pin<&mut Backend>) + Send + 'static,
) -> String {
    match thread.queue(f) {
        Ok(()) => "ok".to_owned(),
        Err(_) => "err qt thread gone".to_owned(),
    }
}
