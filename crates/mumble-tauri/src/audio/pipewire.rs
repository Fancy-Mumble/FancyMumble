//! PipeWire device layer for Linux.
//!
//! # Why this exists next to the cpal backends
//!
//! cpal's ALSA host can only offer the PCMs that ALSA's *hint* list
//! advertises, and on a PipeWire box that list is a poor description of
//! the machine. It names one card five to seven times over (`hw:`,
//! `plughw:`, `sysdefault:`, `front:`, `dsnoop:` …), it has no entry at
//! all for "the microphone I picked in my desktop's sound settings", and
//! the only PCMs that route through the sound server - `pipewire`,
//! `pulse`, `default` - all resolve to whatever the server's *default*
//! source or sink happens to be. So a picker built from that list can
//! either offer card PCMs, which take the hardware away from PipeWire and
//! silence every other application on the machine, or offer the server
//! PCMs, in which case every entry is the same device and the user cannot
//! choose an input at all. [`super::devices::linux_alsa`] is ~200 lines of
//! heuristics spent making the first option survivable.
//!
//! Card PCMs are also simply unreliable through cpal here: opening the
//! Komplete Audio 1 fails with `snd_pcm_hw_params: Invalid argument`, and
//! the ALC897 opens and then dies mid-stream with `alsa::poll()
//! spuriously returned`. Both record fine under `arecord`.
//!
//! # What this does instead
//!
//! PipeWire's own registry already holds the list every other application
//! shows - one entry per source/sink, with the descriptions users
//! recognise ("Komplete Audio 1 Analog Stereo"). Each of those nodes can
//! be opened directly as an ALSA PCM through PipeWire's ALSA plugin:
//!
//! ```text
//! arecord -D pipewire:NODE=alsa_input.pci-0000_0e_00.6.analog-stereo
//! ```
//!
//! `NODE` accepts the stable `node.name`, not just the volatile numeric
//! id, so a stored preference survives reboots and hot-plug. Routing
//! per-node never takes a card away from the server, so the whole class
//! of problems the ALSA heuristics exist to contain does not arise.
//!
//! cpal cannot be pointed at an arbitrary PCM string - it opens what it
//! enumerated - so the PCM is opened through the `alsa` crate directly and
//! wrapped in the same [`AudioCapture`] / [`MixingPlayback`] traits the
//! rest of the stack already speaks. The PipeWire plugin does rate,
//! format and channel conversion itself, so no resampler is needed on
//! this path.
//!
//! When PipeWire is not running (bare ALSA, or PulseAudio without
//! pipewire-pulse) [`available`] reports false and the caller keeps the
//! existing cpal backends.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use alsa::pcm::{Access, Format, HwParams, PCM};
use alsa::{Direction, ValueOr};
use tracing::{debug, warn};

use mumble_protocol::audio::capture::AudioCapture;
use mumble_protocol::audio::mixer::{SpeakerBuffers, SpeakerVolumes};
use mumble_protocol::audio::sample::{AudioFormat, AudioFrame};
use mumble_protocol::error::{Error, Result};

/// Everything on this path runs at the pipeline's native rate; the
/// PipeWire plugin converts to whatever the device wants.
const RATE: u32 = 48_000;

/// Escape hatch back to the cpal backends, for diagnosing a regression
/// against the old path without rebuilding.
const ENV_DISABLE: &str = "FANCY_MUMBLE_NO_PIPEWIRE";

// -- Node registry ----------------------------------------------------

/// One PipeWire audio node as offered to the UI.
pub struct Node {
    /// `node.description` - what the user sees, matching every other app.
    pub name: String,
    /// `node.name` - the stable id passed to `pipewire:NODE=`.
    pub node: String,
    pub is_default: bool,
}

/// Which half of the graph to enumerate.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Source,
    Sink,
}

impl Kind {
    /// The `media.class` a node must carry to belong to this list.
    fn media_class(self) -> &'static str {
        match self {
            Self::Source => "Audio/Source",
            Self::Sink => "Audio/Sink",
        }
    }

    /// The key under which the `default` metadata object names this
    /// half's default node.
    fn default_key(self) -> &'static str {
        match self {
            Self::Source => "default.audio.source",
            Self::Sink => "default.audio.sink",
        }
    }

    fn alsa_direction(self) -> Direction {
        match self {
            Self::Source => Direction::Capture,
            Self::Sink => Direction::Playback,
        }
    }
}

/// Whether the PipeWire path can be used at all.
///
/// Requires both halves to be present: a registry to enumerate (the
/// `pw-dump` client) and the ALSA plugin that actually opens the PCMs.
/// A machine with one but not the other must keep the cpal backends.
pub fn available() -> bool {
    if std::env::var_os(ENV_DISABLE).is_some() {
        return false;
    }
    !dump().is_empty() && alsa_plugin_present()
}

/// Whether ALSA advertises a `pipewire` PCM, i.e. the plugin that
/// `pipewire:NODE=…` is routed through is installed.
///
/// Read from the hint list rather than by opening the PCM: an open
/// creates a real (if short-lived) node in the graph, and this is called
/// on every enumeration and every device open, which would leave a
/// stream flickering in and out of everyone's `wpctl status`.
fn alsa_plugin_present() -> bool {
    static PRESENT: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *PRESENT.get_or_init(|| {
        alsa::device_name::HintIter::new_str(None, "pcm")
            .is_ok_and(|mut hints| hints.any(|h| h.name.as_deref() == Some("pipewire")))
    })
}

/// The audio nodes of one half of the graph, in registry order.
pub fn nodes(kind: Kind) -> Vec<Node> {
    let objects = dump();
    let default = default_node(&objects, kind);
    let mut out: Vec<Node> = Vec::new();
    for o in &objects {
        let props = o
            .get("info")
            .and_then(|i| i.get("props"))
            .and_then(serde_json::Value::as_object);
        let Some(props) = props else { continue };
        if props.get("media.class").and_then(serde_json::Value::as_str) != Some(kind.media_class())
        {
            continue;
        }
        let Some(node) = props.get("node.name").and_then(serde_json::Value::as_str) else {
            continue;
        };
        // A node without a description is not one the user would
        // recognise; its `node.name` is the only label available.
        let name = props
            .get("node.description")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(node);
        out.push(Node {
            name: name.to_owned(),
            node: node.to_owned(),
            is_default: default.as_deref() == Some(node),
        });
    }
    disambiguate(out)
}

/// Two nodes may legitimately share a description (two identical
/// capture cards). Give the collisions their `node.name` so every
/// entry the user can pick resolves to exactly one node.
fn disambiguate(mut list: Vec<Node>) -> Vec<Node> {
    let mut seen: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for n in &list {
        *seen.entry(n.name.as_str()).or_insert(0) += 1;
    }
    let dupes: std::collections::HashSet<String> = seen
        .into_iter()
        .filter(|(_, count)| *count > 1)
        .map(|(name, _)| name.to_owned())
        .collect();
    for n in &mut list {
        if dupes.contains(&n.name) {
            n.name = format!("{} ({})", n.name, n.node);
        }
    }
    list
}

/// Resolve a display name from [`nodes`] back to its `node.name`.
///
/// A stored name that is no longer offered (device unplugged, or a
/// profile switch that renamed it) falls back to the graph's default
/// rather than failing, so a stale setting cannot leave the user with
/// no audio at all.
pub fn resolve(kind: Kind, name: Option<&str>) -> Option<String> {
    let list = nodes(kind);
    if let Some(name) = name {
        if let Some(n) = list.iter().find(|n| n.name == name) {
            return Some(n.node.clone());
        }
        warn!(
            device = name,
            "PipeWire node not offered; using the default"
        );
    }
    // `None` here is not an error: with no node named, PipeWire's ALSA
    // plugin follows the default itself, which is what the caller wants.
    list.into_iter().find(|n| n.is_default).map(|n| n.node)
}

/// Read the `default` metadata object's entry for this half.
fn default_node(objects: &[serde_json::Value], kind: Kind) -> Option<String> {
    for o in objects {
        if o.get("props")
            .and_then(|p| p.get("metadata.name"))
            .and_then(serde_json::Value::as_str)
            != Some("default")
        {
            continue;
        }
        for entry in o.get("metadata").and_then(serde_json::Value::as_array)? {
            if entry.get("key").and_then(serde_json::Value::as_str) == Some(kind.default_key()) {
                return entry
                    .get("value")
                    .and_then(|v| v.get("name"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned);
            }
        }
    }
    None
}

/// The registry as `pw-dump` reports it, or empty when PipeWire is not
/// reachable.
///
/// `pw-dump` ships with PipeWire itself and is the supported way to read
/// the registry without linking libpipewire, which would put a new
/// pkg-config dependency in the build for a list that is read when the
/// settings page opens and when a device is opened.
fn dump() -> Vec<serde_json::Value> {
    let out = match std::process::Command::new("pw-dump")
        .arg("--no-colors")
        .stderr(std::process::Stdio::null())
        .output()
    {
        Ok(out) if out.status.success() => out.stdout,
        Ok(_) | Err(_) => return Vec::new(),
    };
    serde_json::from_slice(&out).unwrap_or_default()
}

// -- PCM helpers ------------------------------------------------------

/// Open one PipeWire node as an ALSA PCM.
///
/// `node` of `None` leaves the plugin on its default, which follows the
/// graph's default device the way every other ALSA client does.
fn open(kind: Kind, node: Option<&str>, channels: u32, period: u32) -> Result<PCM> {
    let name = match node {
        Some(n) => format!("pipewire:NODE={n}"),
        None => "pipewire".to_owned(),
    };
    let pcm = PCM::new(&name, kind.alsa_direction(), false)
        .map_err(|e| Error::InvalidState(format!("Open '{name}': {e}")))?;
    {
        let hwp = HwParams::any(&pcm)
            .map_err(|e| Error::InvalidState(format!("'{name}' hw params: {e}")))?;
        let set = |r: std::result::Result<(), alsa::Error>, what: &str| {
            r.map_err(|e| Error::InvalidState(format!("'{name}' {what}: {e}")))
        };
        set(hwp.set_access(Access::RWInterleaved), "access")?;
        set(hwp.set_format(Format::float()), "format")?;
        set(hwp.set_channels(channels), "channels")?;
        set(hwp.set_rate(RATE, ValueOr::Nearest), "rate")?;
        // A period is the granularity the plugin wakes us at; the buffer
        // is four of them so a late thread does not underrun on the
        // first miss.
        set(
            hwp.set_period_size_near(i64::from(period), ValueOr::Nearest)
                .map(|_| ()),
            "period size",
        )?;
        set(
            hwp.set_buffer_size_near(i64::from(period) * 4).map(|_| ()),
            "buffer size",
        )?;
        set(pcm.hw_params(&hwp), "apply hw params")?;
    }
    pcm.prepare()
        .map_err(|e| Error::InvalidState(format!("'{name}' prepare: {e}")))?;
    Ok(pcm)
}

// -- Capture ----------------------------------------------------------

/// Microphone capture through one PipeWire node.
///
/// Reads are blocking, which is what the shared-capture pump wants: it
/// is a dedicated thread whose whole job is to wait for the next frame,
/// and blocking on the device paces it exactly rather than approximately.
pub struct PwCapture {
    node: Option<String>,
    frame_size: usize,
    volume: Arc<AtomicU32>,
    pcm: Option<PCM>,
    sequence: u64,
    pending: Vec<f32>,
}

impl std::fmt::Debug for PwCapture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PwCapture")
            .field("node", &self.node)
            .field("frame_size", &self.frame_size)
            .field("open", &self.pcm.is_some())
            .finish_non_exhaustive()
    }
}

impl PwCapture {
    /// `device_name` is the display name from [`nodes`]; `None` follows
    /// the graph's default source.
    pub fn new(device_name: Option<&str>, frame_size: usize, volume: Arc<AtomicU32>) -> Self {
        Self {
            node: resolve(Kind::Source, device_name),
            frame_size,
            volume,
            pcm: None,
            sequence: 0,
            pending: Vec::with_capacity(frame_size * 2),
        }
    }
}

impl AudioCapture for PwCapture {
    fn format(&self) -> AudioFormat {
        AudioFormat::MONO_48KHZ_F32
    }

    fn read_frame(&mut self) -> Result<AudioFrame> {
        let pcm = self
            .pcm
            .as_ref()
            .ok_or_else(|| Error::InvalidState("PipeWire capture not started".into()))?;
        let io = pcm
            .io_f32()
            .map_err(|e| Error::InvalidState(format!("capture io: {e}")))?;

        while self.pending.len() < self.frame_size {
            let want = self.frame_size - self.pending.len();
            let mut buf = vec![0.0_f32; want];
            match io.readi(&mut buf) {
                Ok(read) => {
                    buf.truncate(read);
                    self.pending.append(&mut buf);
                }
                Err(e) => {
                    // An overrun is recoverable and routine under load;
                    // anything else ends the stream so the broker can
                    // report a lost device.
                    pcm.try_recover(e, true)
                        .map_err(|e| Error::InvalidState(format!("capture recover: {e}")))?;
                }
            }
        }

        let vol = f32::from_bits(self.volume.load(Ordering::Relaxed));
        let mut data = Vec::with_capacity(self.frame_size * 4);
        for s in self.pending.drain(..self.frame_size) {
            data.extend_from_slice(&(s * vol).to_ne_bytes());
        }
        self.sequence += 1;
        Ok(AudioFrame {
            data,
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: self.sequence,
            is_silent: false,
        })
    }

    fn start(&mut self) -> Result<()> {
        if self.pcm.is_some() {
            return Ok(());
        }
        let period = u32::try_from(self.frame_size).unwrap_or(480);
        let pcm = open(Kind::Source, self.node.as_deref(), 1, period)?;
        pcm.start()
            .map_err(|e| Error::InvalidState(format!("capture start: {e}")))?;
        debug!(node = ?self.node, "PipeWire capture opened");
        self.pcm = Some(pcm);
        self.pending.clear();
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        if let Some(pcm) = self.pcm.take() {
            let _ = pcm.drop();
            debug!(node = ?self.node, "PipeWire capture released");
        }
        self.pending.clear();
        Ok(())
    }
}

// -- Playback ---------------------------------------------------------

/// Mixing playback through one PipeWire node.
///
/// Owns a writer thread that pulls from the same mixer source the rodio
/// backend uses, so mixing, priming, underrun fades and per-speaker
/// volumes behave identically on both paths - only the device layer
/// differs.
pub struct PwMixingPlayback {
    node: Option<String>,
    volume: Arc<AtomicU32>,
    buffers: SpeakerBuffers,
    speaker_volumes: SpeakerVolumes,
    running: Arc<AtomicBool>,
    writer: Option<std::thread::JoinHandle<()>>,
}

impl PwMixingPlayback {
    pub fn new(
        device_name: Option<&str>,
        volume: Arc<AtomicU32>,
        buffers: SpeakerBuffers,
        speaker_volumes: SpeakerVolumes,
    ) -> Self {
        Self {
            node: resolve(Kind::Sink, device_name),
            volume,
            buffers,
            speaker_volumes,
            running: Arc::new(AtomicBool::new(false)),
            writer: None,
        }
    }
}

/// Samples written per `writei` call (10 ms at 48 kHz).
const PLAYBACK_PERIOD: usize = 480;

/// Recover from an underrun on `pcm`, or log why it could not.
///
/// Underruns are routine when the decoder starves; recovering and continuing
/// keeps the stream alive rather than the user hearing playback end for good.
fn recover_playback(pcm: &PCM, error: alsa::Error) -> bool {
    if let Err(e) = pcm.try_recover(error, true) {
        warn!("PipeWire playback: unrecoverable write: {e}");
        return false;
    }
    true
}

impl super::MixingPlayback for PwMixingPlayback {
    fn start(&mut self) -> Result<()> {
        if self.writer.is_some() {
            return Ok(());
        }
        let pcm = open(
            Kind::Sink,
            self.node.as_deref(),
            1,
            u32::try_from(PLAYBACK_PERIOD).unwrap_or(480),
        )?;
        self.running.store(true, Ordering::Relaxed);

        let mut source = super::rodio_desktop::MumbleMixerSource::new(
            self.buffers.clone(),
            self.speaker_volumes.clone(),
            Arc::clone(&self.volume),
            Arc::clone(&self.running),
        );
        let running = Arc::clone(&self.running);
        let node = self.node.clone();
        let writer = std::thread::Builder::new()
            .name("pipewire-playback".into())
            .spawn(move || {
                let mut buf = vec![0.0_f32; PLAYBACK_PERIOD];
                while running.load(Ordering::Relaxed) {
                    // The mixer never ends while `running` is set; a
                    // `None` means it observed the stop before we did.
                    for slot in &mut buf {
                        *slot = source.next().unwrap_or(0.0);
                    }
                    let Ok(io) = pcm.io_f32() else { break };
                    if io
                        .writei(&buf)
                        .err()
                        .is_some_and(|e| !recover_playback(&pcm, e))
                    {
                        break;
                    }
                }
                let _ = pcm.drain();
                debug!(?node, "PipeWire playback released");
            })
            .map_err(|e| Error::InvalidState(format!("playback thread: {e}")))?;
        debug!(node = ?self.node, "PipeWire playback opened");
        self.writer = Some(writer);
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        self.running.store(false, Ordering::Relaxed);
        if let Some(writer) = self.writer.take() {
            let _ = writer.join();
        }
        Ok(())
    }
}

impl Drop for PwMixingPlayback {
    fn drop(&mut self) {
        let _ = super::MixingPlayback::stop(self);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mumble_protocol::audio::mixer::{JitterConfig, SpeakerBuffer};

    /// Hardware diagnostic - run manually:
    /// `cargo test -p mumble-tauri pipewire_hw -- --ignored --nocapture`
    #[test]
    #[ignore = "requires a running PipeWire; run manually with --ignored --nocapture"]
    fn pipewire_hw_nodes() {
        println!("available={}", available());
        for kind in [Kind::Source, Kind::Sink] {
            for n in nodes(kind) {
                println!(
                    "{:7} | {:45} | {} | default={}",
                    kind.media_class(),
                    n.name,
                    n.node,
                    n.is_default
                );
            }
        }
    }

    /// Hardware diagnostic - opens every source in turn and reports what
    /// it delivers, so a node that enumerates but cannot capture is
    /// visible without launching the app:
    /// `cargo test -p mumble-tauri pipewire_hw_capture -- --ignored --nocapture`
    #[test]
    #[ignore = "requires a running PipeWire; run manually with --ignored --nocapture"]
    fn pipewire_hw_capture() {
        if !available() {
            println!("PipeWire not available");
            return;
        }
        for n in nodes(Kind::Source) {
            let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
            let mut cap = PwCapture::new(Some(&n.name), 480, vol);
            if let Err(e) = cap.start() {
                println!("{:45} | START FAILED: {e}", n.name);
                continue;
            }
            let (mut frames, mut peak) = (0_u32, 0.0_f32);
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            let mut err = None;
            while std::time::Instant::now() < deadline {
                match cap.read_frame() {
                    Ok(f) => {
                        frames += 1;
                        peak = f
                            .as_f32_samples()
                            .iter()
                            .fold(peak, |acc, s| acc.max(s.abs()));
                    }
                    Err(e) => {
                        err = Some(e.to_string());
                        break;
                    }
                }
            }
            let _ = cap.stop();
            println!(
                "{:45} | frames={frames:4} peak={peak:.6} err={err:?}",
                n.name
            );
        }
    }

    /// Hardware diagnostic - pushes a 440 Hz tone through
    /// [`PwMixingPlayback`] into the default sink and records that
    /// sink's monitor back, so "the link exists but carries silence" is
    /// distinguishable from working playback:
    /// `cargo test -p mumble-tauri pipewire_hw_playback -- --ignored --nocapture`
    #[test]
    #[ignore = "requires a running PipeWire; run manually with --ignored --nocapture"]
    fn pipewire_hw_playback() {
        use super::super::MixingPlayback as _;
        if !available() {
            println!("PipeWire not available");
            return;
        }
        let Some(sink) = nodes(Kind::Sink).into_iter().find(|n| n.is_default) else {
            println!("no default sink");
            return;
        };
        println!("sink: {} ({})", sink.name, sink.node);

        let buffers: SpeakerBuffers =
            Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
        let volumes: SpeakerVolumes =
            Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
        // Two seconds of 440 Hz at a level nothing downstream will gate.
        let tone: Vec<f32> = (0..96_000)
            .map(|i| {
                let t = f64::from(i) / f64::from(RATE);
                (0.4 * (2.0 * std::f64::consts::PI * 440.0 * t).sin()) as f32
            })
            .collect();
        if let Ok(mut b) = buffers.lock() {
            let mut buf = SpeakerBuffer::new(AudioFormat::MONO_48KHZ_F32, JitterConfig::default());
            // A finished talkspurt: the whole tone is here, so play it.
            buf.push_complete(&tone);
            let _ = b.insert(1_u32, buf);
        }

        let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let mut pb = PwMixingPlayback::new(Some(&sink.name), vol, buffers, volumes);
        pb.start().expect("playback start");

        let wav = std::env::temp_dir().join("fancy-pw-playback-probe.wav");
        let rec = std::process::Command::new("pw-record")
            .args([
                // A sink's monitor is not a node of its own the way
                // PulseAudio names it; it is this node captured with
                // `stream.capture.sink`. Without the property pw-record
                // silently falls back to the default *source* - i.e. a
                // microphone - and the take looks like silent playback.
                "-P",
                "{ stream.capture.sink=true }",
                "--target",
                &sink.node,
                "--rate",
                "48000",
                "--channels",
                "1",
                "--format",
                "s16",
            ])
            .arg(&wav)
            .spawn();
        std::thread::sleep(std::time::Duration::from_millis(1500));
        if let Ok(mut rec) = rec {
            let _ = rec.kill();
            let _ = rec.wait();
        }
        let _ = pb.stop();

        let raw = std::fs::read(&wav).unwrap_or_default();
        let samples: Vec<f32> = raw
            .chunks_exact(2)
            .skip(22) // WAV header
            .map(|c| f32::from(i16::from_le_bytes([c[0], c[1]])) / 32768.0)
            .collect();
        let peak = samples.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
        println!("monitor: samples={} peak={peak:.4}", samples.len());
        // Goertzel at 440 Hz over the middle of the take.
        let goertzel = |sig: &[f32], f: f32| {
            let k = 2.0 * (2.0 * std::f32::consts::PI * f / RATE as f32).cos();
            let (mut s1, mut s2) = (0.0_f32, 0.0_f32);
            for &x in sig {
                let s0 = x + k * s1 - s2;
                s2 = s1;
                s1 = s0;
            }
            s1.mul_add(s1, s2.mul_add(s2, -k * s1 * s2))
        };
        if samples.len() > 24_000 {
            let seg = &samples[8_000..24_000];
            let total: f32 = seg.iter().map(|s| s * s).sum::<f32>().max(1e-12);
            for f in [330.0, 440.0, 660.0] {
                println!(
                    "  {f:5} Hz ratio={:.4}",
                    goertzel(seg, f) / seg.len() as f32 / total
                );
            }
        }
    }

    /// A description that is not in the list must not leave the caller
    /// with nothing: it degrades to the graph's default node.
    #[test]
    #[ignore = "requires a running PipeWire; run manually with --ignored --nocapture"]
    fn stale_name_falls_back_to_default() {
        if !available() {
            return;
        }
        assert!(
            resolve(Kind::Source, Some("no such device")).is_some(),
            "stale name did not fall back to the default source"
        );
    }
}
