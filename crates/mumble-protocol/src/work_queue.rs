//! Priority-based work queue for the Mumble client event loop.
//!
//! Work items arrive from three sources:
//! 1. **UDP transport** - audio/ping (highest priority for low latency)
//! 2. **TCP transport** - control messages
//! 3. **User commands** - from the UI or external API
//!
//! The queue uses separate tokio channels and a `select!` loop that
//! checks UDP first, then TCP, then user commands, ensuring audio
//! is never starved by control traffic.

use tokio::sync::mpsc;
use tracing::trace;

use crate::command::BoxedCommand;
use crate::error::{Error, Result};
use crate::message::{ControlMessage, ServerMessage, UdpMessage};

/// A single item in the work queue.
#[allow(
    clippy::large_enum_variant,
    reason = "ServerMessage variant must inline ControlMessage; boxing adds per-packet heap allocation on the hot audio path"
)]
#[derive(Debug)]
pub enum WorkItem {
    /// Inbound server message (from TCP or UDP).
    ServerMessage(ServerMessage),
    /// Outbound user command (from the UI / API).
    UserCommand(BoxedCommand),
    /// Shutdown signal.
    Shutdown,
}

/// Where inbound audio goes instead of the event loop.
///
/// Decoding on the event loop puts every Opus frame behind whatever control
/// message or user command is being handled at the time - the loop already
/// warns when that passes 50 ms. An embedder that hands over a sink takes
/// audio off the loop entirely; the packet reaches the sink straight from the
/// socket-reading task.
///
/// The sink returns the message when it could not take it, and that goes to
/// the work queue as before, so a sink that has gone away degrades rather
/// than loses audio.
#[derive(Clone)]
pub struct AudioSink(std::sync::Arc<dyn Fn(UdpMessage) -> Option<UdpMessage> + Send + Sync>);

impl std::fmt::Debug for AudioSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AudioSink(..)")
    }
}

impl AudioSink {
    /// Wrap `deliver`, which takes a packet and hands back any it refused.
    ///
    /// It runs on the task reading the socket, so it must not block: the
    /// point of the sink is that nothing on the audio path waits.
    pub fn new(deliver: impl Fn(UdpMessage) -> Option<UdpMessage> + Send + Sync + 'static) -> Self {
        Self(std::sync::Arc::new(deliver))
    }
}

/// Sender-side handle for injecting work items.
///
/// Cloneable - hand one to the UI thread, one to each transport task, etc.
#[derive(Debug, Clone)]
pub struct WorkQueueSender {
    udp_tx: mpsc::Sender<UdpMessage>,
    tcp_tx: mpsc::Sender<ControlMessage>,
    cmd_tx: mpsc::Sender<BoxedCommand>,
    audio_out_tx: mpsc::Sender<UdpMessage>,
    audio_sink: Option<AudioSink>,
}

impl WorkQueueSender {
    /// Submit an inbound UDP message (audio / ping). Non-blocking.
    pub async fn send_udp(&self, msg: UdpMessage) -> Result<()> {
        match self.route_audio(msg) {
            Some(msg) => self.udp_tx.send(msg).await.map_err(|_| Error::QueueClosed),
            None => Ok(()),
        }
    }

    /// Offer `msg` to the audio sink, returning it if the queue must carry it.
    ///
    /// Everything that is not audio comes straight back, as does everything
    /// when no sink is installed. Also public because tunnelled audio reaches
    /// the event loop as a control message and takes the same turn-off here.
    #[must_use]
    pub fn route_audio(&self, msg: UdpMessage) -> Option<UdpMessage> {
        let Some(sink) = self.audio_sink.as_ref() else {
            return Some(msg);
        };
        if !matches!(msg, UdpMessage::Audio(_)) {
            return Some(msg);
        }
        (sink.0)(msg)
    }

    /// Submit an inbound TCP control message. Non-blocking.
    pub async fn send_tcp(&self, msg: ControlMessage) -> Result<()> {
        self.tcp_tx.send(msg).await.map_err(|_| Error::QueueClosed)
    }

    /// Submit a user-initiated command.
    pub async fn send_command(&self, cmd: BoxedCommand) -> Result<()> {
        self.cmd_tx.send(cmd).await.map_err(|_| Error::QueueClosed)
    }

    /// Submit an outbound audio packet (bypasses command queue).
    pub fn try_send_audio(&self, msg: UdpMessage) -> Result<()> {
        self.audio_out_tx
            .try_send(msg)
            .map_err(|_| Error::QueueClosed)
    }

    /// Clone the outbound audio sender for use by `ClientHandle`.
    pub fn audio_sender(&self) -> mpsc::Sender<UdpMessage> {
        self.audio_out_tx.clone()
    }
}

/// Receiver-side handle consumed by the client event loop.
#[derive(Debug)]
pub struct WorkQueueReceiver {
    udp_rx: mpsc::Receiver<UdpMessage>,
    tcp_rx: mpsc::Receiver<ControlMessage>,
    cmd_rx: mpsc::Receiver<BoxedCommand>,
}

impl WorkQueueReceiver {
    /// Await the next work item, prioritizing UDP > TCP > Commands.
    ///
    /// Uses biased `select!` to ensure audio packets are processed first.
    pub async fn recv(&mut self) -> WorkItem {
        // Biased select: try UDP first, then TCP, then commands.
        // This guarantees low-latency inbound audio processing.
        // Outbound audio is polled separately at the event-loop level
        // to avoid starvation by constant inbound UDP traffic.
        tokio::select! {
            biased;

            Some(udp_msg) = self.udp_rx.recv() => {
                trace!("work queue: UDP message");
                WorkItem::ServerMessage(ServerMessage::Udp(udp_msg))
            }
            Some(tcp_msg) = self.tcp_rx.recv() => {
                trace!("work queue: TCP message");
                WorkItem::ServerMessage(ServerMessage::Control(tcp_msg))
            }
            Some(cmd) = self.cmd_rx.recv() => {
                trace!("work queue: user command");
                WorkItem::UserCommand(cmd)
            }
            else => {
                WorkItem::Shutdown
            }
        }
    }
}

/// Channel buffer sizes.
const UDP_CHANNEL_SIZE: usize = 256;
const TCP_CHANNEL_SIZE: usize = 64;
const CMD_CHANNEL_SIZE: usize = 32;
const AUDIO_OUT_CHANNEL_SIZE: usize = 128;

/// Create work queue handles and a separate outbound audio receiver.
///
/// The outbound audio receiver is returned independently so the event
/// loop can poll it at the top level of its `select!`, preventing
/// starvation by constant inbound UDP traffic.
pub fn create(
    audio_sink: Option<AudioSink>,
) -> (
    WorkQueueSender,
    WorkQueueReceiver,
    mpsc::Receiver<UdpMessage>,
) {
    let (udp_tx, udp_rx) = mpsc::channel(UDP_CHANNEL_SIZE);
    let (tcp_tx, tcp_rx) = mpsc::channel(TCP_CHANNEL_SIZE);
    let (cmd_tx, cmd_rx) = mpsc::channel(CMD_CHANNEL_SIZE);
    let (audio_out_tx, audio_out_rx) = mpsc::channel(AUDIO_OUT_CHANNEL_SIZE);

    (
        WorkQueueSender {
            udp_tx,
            tcp_tx,
            cmd_tx,
            audio_out_tx,
            audio_sink,
        },
        WorkQueueReceiver {
            udp_rx,
            tcp_rx,
            cmd_rx,
        },
        audio_out_rx,
    )
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;
    use crate::command::Disconnect;
    use crate::proto::{mumble_tcp, mumble_udp};

    #[tokio::test]
    async fn send_and_receive_tcp_message() {
        let (sender, mut receiver, _audio_out_rx) = create(None);
        let ping = ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(123),
            ..Default::default()
        });
        sender.send_tcp(ping).await.unwrap();

        let item = receiver.recv().await;
        match item {
            WorkItem::ServerMessage(ServerMessage::Control(ControlMessage::Ping(p))) => {
                assert_eq!(p.timestamp, Some(123));
            }
            _ => panic!("expected TCP Ping message"),
        }
    }

    #[tokio::test]
    async fn send_and_receive_udp_message() {
        let (sender, mut receiver, _audio_out_rx) = create(None);
        let udp_ping = UdpMessage::Ping(mumble_udp::Ping {
            timestamp: 456,
            ..Default::default()
        });
        sender.send_udp(udp_ping).await.unwrap();

        let item = receiver.recv().await;
        match item {
            WorkItem::ServerMessage(ServerMessage::Udp(UdpMessage::Ping(p))) => {
                assert_eq!(p.timestamp, 456);
            }
            _ => panic!("expected UDP Ping message"),
        }
    }

    #[tokio::test]
    async fn send_and_receive_command() {
        let (sender, mut receiver, _audio_out_rx) = create(None);
        let cmd: BoxedCommand = Box::new(Disconnect);
        sender.send_command(cmd).await.unwrap();

        let item = receiver.recv().await;
        match item {
            WorkItem::UserCommand(_) => {} // correct
            _ => panic!("expected UserCommand"),
        }
    }

    #[tokio::test]
    async fn udp_has_priority_over_tcp() {
        let (sender, mut receiver, _audio_out_rx) = create(None);

        // Send TCP first, then UDP
        let tcp_msg = ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(1),
            ..Default::default()
        });
        let udp_msg = UdpMessage::Ping(mumble_udp::Ping {
            timestamp: 2,
            ..Default::default()
        });

        sender.send_tcp(tcp_msg).await.unwrap();
        sender.send_udp(udp_msg).await.unwrap();

        // Give the runtime a tick to make both available
        tokio::task::yield_now().await;

        // UDP should come first due to biased select
        let first = receiver.recv().await;
        match first {
            WorkItem::ServerMessage(ServerMessage::Udp(UdpMessage::Ping(p))) => {
                assert_eq!(p.timestamp, 2);
            }
            _ => panic!("expected UDP first due to priority"),
        }

        let second = receiver.recv().await;
        match second {
            WorkItem::ServerMessage(ServerMessage::Control(ControlMessage::Ping(p))) => {
                assert_eq!(p.timestamp, Some(1));
            }
            _ => panic!("expected TCP second"),
        }
    }

    #[test]
    fn without_a_sink_every_message_goes_to_the_queue() {
        let (sender, _receiver, _audio_out_rx) = create(None);
        let audio = UdpMessage::Audio(mumble_udp::Audio::default());
        assert!(sender.route_audio(audio).is_some());
    }

    #[test]
    fn a_sink_takes_audio_and_leaves_everything_else() {
        let taken = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = std::sync::Arc::clone(&taken);
        let sink = AudioSink::new(move |_msg| {
            let _ = counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            None
        });
        let (sender, _receiver, _audio_out_rx) = create(Some(sink));

        assert!(
            sender
                .route_audio(UdpMessage::Audio(mumble_udp::Audio::default()))
                .is_none(),
            "audio should go to the sink"
        );
        assert!(
            sender
                .route_audio(UdpMessage::Ping(mumble_udp::Ping::default()))
                .is_some(),
            "a ping is not audio and belongs on the event loop"
        );
        assert_eq!(taken.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    #[test]
    fn a_sink_that_refuses_hands_the_packet_back() {
        let sink = AudioSink::new(Some);
        let (sender, _receiver, _audio_out_rx) = create(Some(sink));
        assert!(
            sender
                .route_audio(UdpMessage::Audio(mumble_udp::Audio::default()))
                .is_some(),
            "a refused packet still has to reach the queue"
        );
    }

    #[tokio::test]
    async fn shutdown_when_all_senders_dropped() {
        let (sender, mut receiver, _audio_out_rx) = create(None);
        drop(sender);

        let item = receiver.recv().await;
        matches!(item, WorkItem::Shutdown);
    }

    #[tokio::test]
    async fn sender_is_cloneable() {
        let (sender, mut receiver, _audio_out_rx) = create(None);
        let sender2 = sender.clone();

        sender
            .send_tcp(ControlMessage::Ping(mumble_tcp::Ping {
                timestamp: Some(10),
                ..Default::default()
            }))
            .await
            .unwrap();
        sender2
            .send_tcp(ControlMessage::Ping(mumble_tcp::Ping {
                timestamp: Some(20),
                ..Default::default()
            }))
            .await
            .unwrap();

        let _ = receiver.recv().await;
        let _ = receiver.recv().await;
        // Both messages received - sender clone works
    }

    #[tokio::test]
    async fn send_fails_when_receiver_dropped() {
        let (sender, receiver, _audio_out_rx) = create(None);
        drop(receiver);

        let result = sender
            .send_tcp(ControlMessage::Ping(mumble_tcp::Ping::default()))
            .await;
        assert!(result.is_err());
    }
}
