//! One client connection, in either of the two modes.
//!
//! **Standalone** - no Discord client is running, so we answer the handshake
//! and every command ourselves. The application sees a working Discord.
//!
//! **Bridged** - Discord is running on another slot. We open our own
//! connection to it, replay the client's handshake, and forward frames both
//! ways verbatim while reading `SET_ACTIVITY` as it passes. The application
//! and Discord both behave exactly as if we were not here.
//!
//! A connection can move between the two while it is open: Discord can start
//! or stop at any time, and [`Connection::retarget_upstream`] attaches or
//! detaches without disturbing the client.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{ReadHalf, WriteHalf};
use tokio::sync::{mpsc, watch};

use crate::codec::{self, IpcFrame, Opcode};
use crate::protocol::{self, Activity, Handshake, RpcRequest};
use crate::service::{Inner, PresenceEvent};
use crate::store::{ConnectionId, PresenceEntry};
use crate::transport::Endpoint;

/// How long a client gets to send its handshake before we hang up. Generous:
/// the cost of waiting is one idle task, and a slow start is not an error.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// Depth of the per-connection event queue. Frames are small and handled
/// promptly; this only absorbs bursts.
const EVENT_QUEUE_DEPTH: usize = 64;

/// Nonce used for the activity we replay into Discord when it starts late.
/// The response to it must not reach the client, which already had an answer
/// to the original nonce - see [`Connection::should_swallow`].
const REPLAY_NONCE: &str = "fancy-presence-replay";

/// Close code sent when we reject a connection during the handshake.
const CLOSE_INVALID_HANDSHAKE: i32 = 4000;

/// Something that happened on one of a connection's two sockets.
enum ConnectionEvent {
    /// A frame from the application (or the read failing, ending the connection).
    FromClient(std::io::Result<IpcFrame>),
    /// A frame from Discord, tagged with the upstream generation that read it
    /// so frames from a detached upstream can be discarded.
    FromUpstream(u64, std::io::Result<IpcFrame>),
}

/// Serve one accepted client connection until it closes.
pub(crate) async fn serve(
    endpoint: Endpoint,
    id: ConnectionId,
    inner: Arc<Inner>,
    shutdown: watch::Receiver<bool>,
) {
    let (mut reader, mut writer) = tokio::io::split(endpoint);

    let handshake = match read_handshake(&mut reader).await {
        Ok(frame) => frame,
        Err(reason) => {
            tracing::debug!(id, reason, "rejected presence client");
            let frame = IpcFrame::from_json(
                Opcode::Close,
                &protocol::close_payload(CLOSE_INVALID_HANDSHAKE, reason),
            );
            let _ = codec::write_frame(&mut writer, &frame).await;
            return;
        }
    };

    let parsed: Handshake = handshake
        .to_json()
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    let Some(application_id) = parsed.application_id() else {
        let frame = IpcFrame::from_json(
            Opcode::Close,
            &protocol::close_payload(CLOSE_INVALID_HANDSHAKE, "handshake carried no client_id"),
        );
        let _ = codec::write_frame(&mut writer, &frame).await;
        return;
    };

    tracing::info!(id, application_id, "presence client connected");
    let mut connection = Connection {
        id,
        inner,
        application_id,
        pid: None,
        handshake,
        writer,
        upstream: None,
        upstream_generation: 0,
        last_activity: None,
        suppress_ready: false,
        suppress_nonce: None,
    };
    connection.run(reader, shutdown).await;
    connection.finish();
}

async fn read_handshake(
    reader: &mut ReadHalf<Endpoint>,
) -> Result<IpcFrame, &'static str> {
    let frame = match tokio::time::timeout(HANDSHAKE_TIMEOUT, codec::read_frame(reader)).await {
        Err(_elapsed) => return Err("handshake timed out"),
        Ok(Err(_)) => return Err("connection closed during handshake"),
        Ok(Ok(frame)) => frame,
    };
    if frame.opcode != Opcode::Handshake {
        return Err("first frame was not a handshake");
    }
    Ok(frame)
}

struct Connection {
    id: ConnectionId,
    inner: Arc<Inner>,
    application_id: String,
    pid: Option<u32>,
    /// Kept so it can be replayed into Discord if it starts up later.
    handshake: IpcFrame,
    writer: WriteHalf<Endpoint>,
    upstream: Option<WriteHalf<Endpoint>>,
    /// Incremented on every attach and detach, so a reader task belonging to
    /// a previous upstream can be recognised and ignored rather than raced with.
    upstream_generation: u64,
    /// The most recent `SET_ACTIVITY` frame, replayed on a late attach.
    last_activity: Option<IpcFrame>,
    /// Drop the next `READY` from upstream: the client already got ours.
    suppress_ready: bool,
    /// Drop the upstream response carrying this nonce.
    suppress_nonce: Option<String>,
}

impl Connection {
    async fn run(&mut self, reader: ReadHalf<Endpoint>, mut shutdown: watch::Receiver<bool>) {
        let (sender, mut events) = mpsc::channel(EVENT_QUEUE_DEPTH);
        let mut upstream_changed = self.inner.upstream.subscribe();

        let target = self.inner.upstream.borrow().clone();
        if !self.open_upstream(target.as_deref(), &sender).await {
            // Nobody else is going to answer the handshake, so we do. In
            // bridged mode Discord's own READY passes through instead.
            let ready = IpcFrame::from_json(Opcode::Frame, &protocol::ready_dispatch());
            if !self.send_client(&ready).await {
                return;
            }
        }

        let _reader_task = tokio::spawn(pump_client(reader, sender.clone()));

        loop {
            tokio::select! {
                _ = shutdown.changed() => break,
                changed = upstream_changed.changed() => {
                    if changed.is_err() {
                        break;
                    }
                    let target = self.inner.upstream.borrow().clone();
                    self.retarget_upstream(target.as_deref(), &sender).await;
                }
                event = events.recv() => {
                    let Some(event) = event else { break };
                    if !self.handle(event).await {
                        break;
                    }
                }
            }
        }
    }

    /// Apply a change in where Discord is (or whether it is there at all).
    async fn retarget_upstream(
        &mut self,
        target: Option<&Path>,
        sender: &mpsc::Sender<ConnectionEvent>,
    ) {
        match (target, self.upstream.is_some()) {
            (Some(path), false) => {
                // Discord started after this client connected, so the client
                // has already seen our synthetic READY and must not see a
                // second one.
                self.suppress_ready = true;
                if self.open_upstream(Some(path), sender).await {
                    self.replay_activity().await;
                } else {
                    self.suppress_ready = false;
                }
            }
            (None, true) => self.detach_upstream(),
            _ => {}
        }
    }

    /// Connect to Discord and replay this client's handshake into it.
    async fn open_upstream(
        &mut self,
        target: Option<&Path>,
        sender: &mpsc::Sender<ConnectionEvent>,
    ) -> bool {
        if !self.inner.config.bridge_to_discord {
            return false;
        }
        let Some(path) = target else {
            return false;
        };
        let Ok(endpoint) = crate::transport::connect(path).await else {
            tracing::debug!(id = self.id, path = %path.display(), "could not reach Discord");
            return false;
        };

        let (upstream_reader, mut upstream_writer) = tokio::io::split(endpoint);
        if codec::write_frame(&mut upstream_writer, &self.handshake)
            .await
            .is_err()
        {
            return false;
        }

        self.upstream_generation += 1;
        let _task = tokio::spawn(pump_upstream(
            upstream_reader,
            self.upstream_generation,
            sender.clone(),
        ));
        self.upstream = Some(upstream_writer);
        tracing::info!(id = self.id, "bridging this client through to Discord");
        true
    }

    fn detach_upstream(&mut self) {
        if self.upstream.take().is_some() {
            // Orphans the reader task's in-flight frames.
            self.upstream_generation += 1;
            tracing::info!(id = self.id, "Discord went away; serving this client locally");
        }
    }

    /// Bring a late-starting Discord up to date with the current activity.
    async fn replay_activity(&mut self) {
        let Some(frame) = self.last_activity.clone() else {
            return;
        };
        let Ok(mut value) = frame.to_json() else {
            return;
        };
        if let Some(object) = value.as_object_mut() {
            let _ = object.insert(
                "nonce".to_owned(),
                serde_json::Value::String(REPLAY_NONCE.to_owned()),
            );
        }
        self.suppress_nonce = Some(REPLAY_NONCE.to_owned());
        let _ = self
            .send_upstream(&IpcFrame::from_json(Opcode::Frame, &value))
            .await;
    }

    /// Handle one event. Returns `false` to close the connection.
    async fn handle(&mut self, event: ConnectionEvent) -> bool {
        match event {
            ConnectionEvent::FromClient(Ok(frame)) => self.on_client_frame(frame).await,
            ConnectionEvent::FromClient(Err(_)) => false,
            ConnectionEvent::FromUpstream(generation, Ok(frame)) => {
                if generation != self.upstream_generation || self.should_swallow(&frame) {
                    return true;
                }
                self.send_client(&frame).await
            }
            ConnectionEvent::FromUpstream(generation, Err(_)) => {
                if generation == self.upstream_generation {
                    self.detach_upstream();
                }
                true
            }
        }
    }

    async fn on_client_frame(&mut self, frame: IpcFrame) -> bool {
        self.observe(&frame);
        if self.upstream.is_some() {
            if self.send_upstream(&frame).await {
                // Discord owns the conversation and produces every response.
                return true;
            }
            // The bridge broke mid-frame; fall through so the client still
            // gets an answer instead of hanging on its nonce.
            self.detach_upstream();
        }
        self.answer_locally(frame).await
    }

    async fn answer_locally(&mut self, frame: IpcFrame) -> bool {
        match frame.opcode {
            Opcode::Ping => {
                let pong = IpcFrame {
                    opcode: Opcode::Pong,
                    payload: frame.payload,
                };
                self.send_client(&pong).await
            }
            Opcode::Close => false,
            Opcode::Frame => self.answer_command(&frame).await,
            Opcode::Handshake | Opcode::Pong => true,
        }
    }

    async fn answer_command(&mut self, frame: &IpcFrame) -> bool {
        let Ok(value) = frame.to_json() else {
            return true;
        };
        let Some(request) = RpcRequest::from_value(&value) else {
            return true;
        };
        let response = IpcFrame::from_json(Opcode::Frame, &request.response());
        self.send_client(&response).await
    }

    /// Whether an upstream frame is one of ours and must not reach the client.
    fn should_swallow(&mut self, frame: &IpcFrame) -> bool {
        if frame.opcode != Opcode::Frame {
            return false;
        }
        let Ok(value) = frame.to_json() else {
            return false;
        };
        if self.suppress_ready
            && value.get("evt").and_then(serde_json::Value::as_str) == Some("READY")
        {
            self.suppress_ready = false;
            return true;
        }
        if let Some(nonce) = self.suppress_nonce.as_deref() {
            if value.get("nonce").and_then(serde_json::Value::as_str) == Some(nonce) {
                self.suppress_nonce = None;
                return true;
            }
        }
        false
    }

    /// Read a client frame for its presence content. Runs in both modes -
    /// this is the whole point of the exercise.
    fn observe(&mut self, frame: &IpcFrame) {
        if frame.opcode != Opcode::Frame {
            return;
        }
        let Ok(value) = frame.to_json() else {
            return;
        };
        let Some(request) = RpcRequest::from_value(&value) else {
            return;
        };
        if request.cmd != "SET_ACTIVITY" {
            return;
        }

        if let Some(pid) = request.pid() {
            self.pid = Some(pid);
        }
        self.last_activity = Some(frame.clone());

        match request.activity_value().and_then(Activity::from_value) {
            Some(activity) if !activity.is_empty() => self.publish(activity),
            // A null or empty activity is how an application clears itself.
            _ => self.withdraw(),
        }
    }

    fn publish(&self, activity: Activity) {
        let entry = PresenceEntry {
            id: self.id,
            application_id: self.application_id.clone(),
            application_name: None,
            pid: self.pid,
            process_name: self.pid.and_then(crate::process::process_name),
            activity,
        };
        if self.inner.store.upsert(entry.clone()) {
            self.inner.emit(PresenceEvent::Updated(Box::new(entry)));
        }
    }

    fn withdraw(&self) {
        if self.inner.store.remove(self.id) {
            self.inner.emit(PresenceEvent::Cleared(self.id));
        }
    }

    fn finish(&self) {
        tracing::info!(id = self.id, "presence client disconnected");
        self.withdraw();
    }

    async fn send_client(&mut self, frame: &IpcFrame) -> bool {
        codec::write_frame(&mut self.writer, frame).await.is_ok()
    }

    async fn send_upstream(&mut self, frame: &IpcFrame) -> bool {
        let Some(writer) = self.upstream.as_mut() else {
            return false;
        };
        codec::write_frame(writer, frame).await.is_ok()
    }
}

async fn pump_client(mut reader: ReadHalf<Endpoint>, sender: mpsc::Sender<ConnectionEvent>) {
    loop {
        let frame = codec::read_frame(&mut reader).await;
        let ended = frame.is_err();
        if sender
            .send(ConnectionEvent::FromClient(frame))
            .await
            .is_err()
            || ended
        {
            break;
        }
    }
}

async fn pump_upstream(
    mut reader: ReadHalf<Endpoint>,
    generation: u64,
    sender: mpsc::Sender<ConnectionEvent>,
) {
    loop {
        let frame = codec::read_frame(&mut reader).await;
        let ended = frame.is_err();
        if sender
            .send(ConnectionEvent::FromUpstream(generation, frame))
            .await
            .is_err()
            || ended
        {
            break;
        }
    }
}
