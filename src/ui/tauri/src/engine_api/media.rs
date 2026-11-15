//! Screen sharing, as the engine carries it for a view that is not the web
//! page: the WebRTC signalling that view's own peers answer, and the strokes
//! drawn over a shared screen.
//!
//! The engine only carries these; the peers, the capture and the drawing are
//! the view's (the web client's are in `commands/screenshare.rs`,
//! `commands/stream_view.rs` and its drawing overlay). The wire is the one
//! the web client speaks, field for field, so both draw on each other's
//! shares.

use crate::state::protocol_commands::DrawStrokeArgs;

use super::EngineHandle;

/// One `WebRtcSignal` that arrived.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignalInfo {
    /// The server it came from, as [`super::SessionInfo::id`] names it: a
    /// peer must answer through the connection it was made on.
    pub server: Option<String>,
    /// Who sent it, as this client knows them; for an SFU's answer, whose
    /// broadcast it is about.
    pub sender: Option<u32>,
    /// Who it is for; 0 or nothing for the whole channel.
    pub target: Option<u32>,
    /// `WebRtcSignal.signal_type`: 0 start, 1 stop, 2 offer, 3 answer,
    /// 4 ICE candidate.
    pub kind: i32,
    /// The SDP, the candidate, or a start's track list.
    pub payload: String,
}

/// One packet of a stroke drawn over a shared screen
/// (`FancyDrawStroke`), going out or come in.
#[derive(Debug, Clone)]
pub struct StrokeInfo {
    /// Who drew it; filled in by the server on the way out.
    pub sender: u32,
    /// The channel whose share it is drawn on.
    pub channel: u32,
    /// Which stroke, as its drawer names it: packets of one stroke share it.
    pub id: String,
    /// ARGB.
    pub colour: u32,
    /// Its width in the drawer's pixels, for clients that predate
    /// `width_frac`.
    pub width: f32,
    /// Its width as a fraction of the shared picture's height.
    pub width_frac: Option<f32>,
    /// The points added by this packet, `x, y, x, y, ...`, each from 0 to 1
    /// across the shared picture.
    pub points: Vec<f32>,
    /// Whether the stroke ends with this packet.
    pub end: bool,
    /// Whether this packet clears the drawer's strokes instead.
    pub clear: bool,
    /// With `clear`: every stroke in the channel, whoever drew it.
    pub clear_all: bool,
}

// Equal when every number is the same bits: what a packet that went out and
// came back is, and an equivalence where `f32`'s own is not one.
impl PartialEq for StrokeInfo {
    fn eq(&self, other: &Self) -> bool {
        let bits = |floats: &[f32]| floats.iter().map(|f| f.to_bits()).collect::<Vec<_>>();
        self.sender == other.sender
            && self.channel == other.channel
            && self.id == other.id
            && self.colour == other.colour
            && self.width.to_bits() == other.width.to_bits()
            && self.width_frac.map(f32::to_bits) == other.width_frac.map(f32::to_bits)
            && bits(&self.points) == bits(&other.points)
            && self.end == other.end
            && self.clear == other.clear
            && self.clear_all == other.clear_all
    }
}

impl Eq for StrokeInfo {}

impl EngineHandle {
    /// Send one `WebRtcSignal` to `target` (0 for the channel) through the
    /// connection `server` names, or the active one.
    ///
    /// # Errors
    ///
    /// When not connected there, or the message could not be queued.
    pub async fn send_webrtc_signal(
        &self,
        target: u32,
        kind: i32,
        payload: String,
        server: Option<String>,
    ) -> Result<(), String> {
        self.state
            .send_webrtc_signal(target, kind, payload, server)
            .await
    }

    /// Send one packet of a stroke drawn over a shared screen, on the
    /// active connection.
    ///
    /// # Errors
    ///
    /// When not connected, or the message could not be queued.
    pub async fn send_draw_stroke(&self, stroke: StrokeInfo) -> Result<(), String> {
        self.state
            .send_draw_stroke(DrawStrokeArgs {
                channel_id: stroke.channel,
                stroke_id: stroke.id,
                color: stroke.colour,
                width: stroke.width,
                width_frac: stroke.width_frac,
                points: stroke.points,
                is_end: stroke.end,
                is_clear: stroke.clear,
                clear_all: stroke.clear_all,
            })
            .await
    }

    /// Whether the active server relays shared screens itself (it has an
    /// SFU). Without one, sharing is peer to peer, which a native broadcaster
    /// does not do.
    pub fn relays_media(&self) -> bool {
        self.state.server_config().webrtc_sfu_available
    }

    /// Play 20 ms of a watched share's sound (interleaved stereo at 48 kHz)
    /// with voice, through the voice output, as the web client's native
    /// viewer does. Nothing is played while voice is off.
    #[cfg(not(target_os = "android"))]
    pub fn hear_shared(&self, session: u32, stereo: &[f32]) {
        crate::audio::stream_audio::push(session, stereo);
    }

    /// How loud `session`'s share is played: 1 as sent.
    #[cfg(not(target_os = "android"))]
    pub fn set_shared_volume(&self, session: u32, volume: f32) {
        crate::audio::stream_audio::set_volume(session, volume);
    }

    /// `session`'s share is no longer watched: what is queued of its sound
    /// goes.
    #[cfg(not(target_os = "android"))]
    pub fn stop_shared(&self, session: u32) {
        crate::audio::stream_audio::stop(session);
    }

    /// How much of `session`'s share's sound is queued, and the most that
    /// is, in milliseconds; `None` while it is not playing.
    #[cfg(not(target_os = "android"))]
    pub fn shared_playout(&self, session: u32) -> Option<(u32, u32)> {
        crate::audio::stream_audio::playout(session)
    }
}
