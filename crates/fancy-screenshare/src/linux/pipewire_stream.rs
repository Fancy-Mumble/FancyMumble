//! PipeWire video-stream consumer - the analogue of Chromium's
//! `SharedScreenCastStream` (`modules/desktop_capture/linux/wayland`).
//!
//! A dedicated thread runs the PipeWire main loop (libwebrtc uses
//! `pw_thread_loop`; a plain `MainLoop` on our own thread is the same thing
//! with the locking made explicit by Rust). Frames land in a single
//! latest-frame slot that the capture thread drains - identical semantics to
//! `sources::ScreenRecorder`, so the pipeline treats "compositor pushed
//! nothing" as an idle tick, not a stall.
//!
//! Format negotiation deliberately offers only linear RGB variants and NO
//! `VideoModifier` property: without modifiers the compositor falls back to
//! plain shared memory (MemFd/MemPtr), which `MAP_BUFFERS` hands us
//! pre-mapped. This is exactly Chromium's no-EGL path; zero-copy DMA-BUF
//! import (its EGL path) is a later optimisation and needs a GPU context on
//! this thread.

use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use pipewire as pw;
use pw::spa::param::format::{MediaSubtype, MediaType};
use pw::spa::param::video::{VideoFormat, VideoInfoRaw};

/// One decoded (still packed-RGB) frame from the compositor, tightly packed
/// RGBA with alpha forced opaque.
pub(crate) struct RawFrame {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) rgba: Vec<u8>,
}

/// Poll result of [`PwCaptureStream::latest_frame`].
pub(crate) enum StreamFrame {
    /// A new frame (only the newest is kept if the consumer lags).
    Frame(RawFrame),
    /// Nothing new on screen within the wait budget.
    Idle,
    /// The stream ended (session closed from the compositor side, error).
    Dead(String),
}

#[derive(Default)]
struct Slot {
    frame: Option<RawFrame>,
    dead: Option<String>,
}

#[derive(Default)]
struct Shared {
    slot: Mutex<Slot>,
    cond: Condvar,
}

/// State owned by the PipeWire loop thread (callback user data).
struct LoopState {
    shared: Arc<Shared>,
    info: VideoInfoRaw,
    have_format: bool,
    was_streaming: bool,
    /// Whether the connect offered DMA-BUF (EGL runtime present); gates the
    /// modifier fixation / buffers-answer steps in `param_changed`.
    dmabuf_offered: bool,
    /// Lazily created on the first DMA-BUF frame, on this loop thread (GL
    /// contexts are thread-affine). `Some(None)` = creation failed; stop
    /// retrying and drop dmabuf frames (logged).
    importer: Option<Option<super::egl_import::DmabufImporter>>,
    /// Log the first buffer's data type once - the ground truth for whether
    /// the stream actually negotiated DMA-BUF or fell back to shared memory.
    logged_data_type: bool,
    /// Failed dmabuf imports, for rate-limited logging.
    import_errors: u32,
}

/// Consumes the portal's PipeWire node on a dedicated loop thread.
pub(crate) struct PwCaptureStream {
    shared: Arc<Shared>,
    quit: Option<pw::channel::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl std::fmt::Debug for PwCaptureStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PwCaptureStream").finish_non_exhaustive()
    }
}

impl PwCaptureStream {
    /// Connect to `node_id` on the portal-provided connection `fd` and start
    /// delivering frames.
    pub(crate) fn start(fd: std::os::fd::OwnedFd, node_id: u32) -> Result<Self, String> {
        let shared = Arc::new(Shared::default());
        let (quit_tx, quit_rx) = pw::channel::channel::<()>();

        let thread_shared = Arc::clone(&shared);
        let thread = std::thread::Builder::new()
            .name("pw-screencast".into())
            .spawn(move || {
                let result = run_loop(fd, node_id, Arc::clone(&thread_shared), quit_rx);
                let reason = match result {
                    Ok(()) => "pipewire stream ended".to_owned(),
                    Err(e) => e,
                };
                if let Ok(mut slot) = thread_shared.slot.lock() {
                    if slot.dead.is_none() {
                        slot.dead = Some(reason);
                    }
                }
                thread_shared.cond.notify_all();
            })
            .map_err(|e| format!("pipewire thread spawn: {e}"))?;

        Ok(Self {
            shared,
            quit: Some(quit_tx),
            thread: Some(thread),
        })
    }

    /// Take the newest frame, waiting up to `wait` for one to arrive.
    pub(crate) fn latest_frame(&self, wait: Duration) -> StreamFrame {
        let Ok(mut slot) = self.shared.slot.lock() else {
            return StreamFrame::Dead("pipewire slot poisoned".to_owned());
        };
        if let Some(frame) = slot.frame.take() {
            return StreamFrame::Frame(frame);
        }
        if let Some(reason) = slot.dead.clone() {
            return StreamFrame::Dead(reason);
        }
        let Ok((mut slot, _timeout)) = self.shared.cond.wait_timeout(slot, wait) else {
            return StreamFrame::Dead("pipewire slot poisoned".to_owned());
        };
        if let Some(frame) = slot.frame.take() {
            return StreamFrame::Frame(frame);
        }
        if let Some(reason) = slot.dead.clone() {
            return StreamFrame::Dead(reason);
        }
        StreamFrame::Idle
    }

    /// Stop the loop thread and release the PipeWire connection. Idempotent.
    pub(crate) fn shutdown(&mut self) {
        if let Some(quit) = self.quit.take() {
            let _ = quit.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for PwCaptureStream {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// The loop thread body: connect, negotiate, pump frames until quit/error.
#[allow(
    clippy::too_many_lines,
    reason = "single PipeWire loop lifecycle (connect, negotiate, pump); the \
              callbacks capture shared loop state and don't factor out cleanly"
)]
fn run_loop(
    fd: std::os::fd::OwnedFd,
    node_id: u32,
    shared: Arc<Shared>,
    quit_rx: pw::channel::Receiver<()>,
) -> Result<(), String> {
    pw::init();

    let mainloop = pw::main_loop::MainLoop::new(None).map_err(|e| format!("pw mainloop: {e}"))?;
    let context = pw::context::Context::new(&mainloop).map_err(|e| format!("pw context: {e}"))?;
    let core = context
        .connect_fd(fd, None)
        .map_err(|e| format!("pw connect (portal fd): {e}"))?;

    let loop_weak = mainloop.downgrade();
    let _quit_guard = quit_rx.attach(mainloop.loop_(), move |()| {
        if let Some(mainloop) = loop_weak.upgrade() {
            mainloop.quit();
        }
    });

    let stream = pw::stream::Stream::new(
        &core,
        "fancy-screenshare-capture",
        pw::properties::properties! {
            *pw::keys::MEDIA_TYPE => "Video",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
        },
    )
    .map_err(|e| format!("pw stream: {e}"))?;

    let shm_pod = build_format_pod(&SHM_FORMATS, &ModifierSpec::None)?;
    // EGL-enumerated modifiers (empty when EGL/the extension is missing) -
    // generic guesses like LINEAR intersect to nothing on NVIDIA, which is
    // why anything less than real enumeration falls back to shared memory.
    let modifiers: &[u64] =
        super::egl_modifiers::dmabuf_modifiers(super::egl_modifiers::DRM_FOURCC_XRGB8888);
    let dmabuf_pod = if modifiers.is_empty() {
        None
    } else {
        Some(build_format_pod(
            &DMABUF_FORMATS,
            &ModifierSpec::Offer(modifiers),
        )?)
    };
    // The fixation answer keeps SHM as the fallback so a failed dmabuf
    // test-allocation degrades to working shared memory, not an error.
    let fixation_shm = shm_pod.clone();

    let state = LoopState {
        shared,
        info: VideoInfoRaw::new(),
        have_format: false,
        was_streaming: false,
        dmabuf_offered: dmabuf_pod.is_some(),
        importer: None,
        logged_data_type: false,
        import_errors: 0,
    };

    let loop_weak_state = mainloop.downgrade();
    let _listener = stream
        .add_local_listener_with_user_data(state)
        .state_changed(move |_stream, state, _old, new| {
            use pw::stream::StreamState;
            tracing::debug!(state = ?new, "screenshare: pipewire stream state");
            let died = match &new {
                StreamState::Error(e) => Some(format!("pipewire stream error: {e}")),
                // The node disappearing after we streamed = the user hit the
                // compositor's own "stop sharing", or the source went away.
                StreamState::Unconnected if state.was_streaming => {
                    Some("screencast stopped by compositor".to_owned())
                }
                StreamState::Streaming => {
                    state.was_streaming = true;
                    None
                }
                _ => None,
            };
            if let Some(reason) = died {
                if let Ok(mut slot) = state.shared.slot.lock() {
                    if slot.dead.is_none() {
                        slot.dead = Some(reason);
                    }
                }
                state.shared.cond.notify_all();
                if let Some(mainloop) = loop_weak_state.upgrade() {
                    mainloop.quit();
                }
            }
        })
        .param_changed(move |stream, state, id, param| {
            let Some(param) = param else { return };
            if id != pw::spa::param::ParamType::Format.as_raw() {
                return;
            }
            let Ok((media_type, media_subtype)) = pw::spa::param::format_utils::parse_format(param)
            else {
                return;
            };
            if media_type != MediaType::Video || media_subtype != MediaSubtype::Raw {
                return;
            }
            if state.info.parse(param).is_ok() {
                state.have_format = true;
                state.logged_data_type = false;
                tracing::info!(
                    format = ?state.info.format(),
                    width = state.info.size().width,
                    height = state.info.size().height,
                    modifier = state.info.modifier(),
                    "screenshare: pipewire format negotiated",
                );
                if state.dmabuf_offered {
                    negotiate_dmabuf_step(stream, state.info.format(), param, &fixation_shm);
                }
            }
        })
        .process(|stream, state| {
            if !state.have_format {
                return;
            }
            // Drain to the newest buffer; dropping older ones requeues them
            // to the compositor immediately (latest-frame semantics).
            let mut newest = None;
            while let Some(buffer) = stream.dequeue_buffer() {
                newest = Some(buffer);
            }
            let Some(mut buffer) = newest else { return };
            let width = state.info.size().width;
            let height = state.info.size().height;
            let format = state.info.format();
            let datas = buffer.datas_mut();
            let Some(data) = datas.first_mut() else {
                return;
            };
            if !state.logged_data_type {
                state.logged_data_type = true;
                tracing::info!(
                    data_type = ?data.type_(),
                    "screenshare: pipewire buffer type (DmaBuf = scanout-capable)",
                );
            }
            let frame = if data.type_() == pw::spa::buffer::DataType::DmaBuf {
                let Some(frame) = import_dmabuf_frame(state, data, width, height) else {
                    return;
                };
                frame
            } else {
                let chunk_size = data.chunk().size() as usize;
                let chunk_stride = data.chunk().stride();
                let Some(bytes) = data.data() else { return };
                let Some(frame) =
                    convert_to_rgba(format, width, height, chunk_stride, chunk_size, bytes)
                else {
                    return;
                };
                frame
            };
            if let Ok(mut slot) = state.shared.slot.lock() {
                slot.frame = Some(frame);
            }
            state.shared.cond.notify_all();
        })
        .register()
        .map_err(|e| format!("pw stream listener: {e}"))?;

    fn as_pod(bytes: &[u8]) -> Result<&pw::spa::pod::Pod, String> {
        pw::spa::pod::Pod::from_bytes(bytes).ok_or_else(|| "format pod rejected".to_owned())
    }
    // DMA-BUF offered first so the producer prefers it; SHM stays as the
    // fallback for producers that cannot export dmabufs.
    let mut probe_params;
    let mut shm_params;
    let params: &mut [&pw::spa::pod::Pod] = if let Some(dmabuf_pod) = &dmabuf_pod {
        probe_params = [as_pod(dmabuf_pod)?, as_pod(&shm_pod)?];
        &mut probe_params
    } else {
        shm_params = [as_pod(&shm_pod)?];
        &mut shm_params
    };
    stream
        .connect(
            pw::spa::utils::Direction::Input,
            Some(node_id),
            pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
            params,
        )
        .map_err(|e| format!("pw stream connect: {e}"))?;

    mainloop.run();

    let _ = stream.disconnect();
    Ok(())
}

/// `SPA_PARAM_Buffers` answer pod (sent after Format negotiation): the data
/// types this consumer accepts, as a flags choice of `1 << SPA_DATA_*` bits.
/// Announcing `DmaBuf` alongside the shared-memory types lets the producer
/// allocate GPU buffers - the prerequisite for Mutter's scanout recording.
fn build_buffers_pod() -> Result<Vec<u8>, String> {
    let data_types: i32 = (1 << pw::spa::sys::SPA_DATA_DmaBuf)
        | (1 << pw::spa::sys::SPA_DATA_MemFd)
        | (1 << pw::spa::sys::SPA_DATA_MemPtr);
    let object = pw::spa::pod::Object {
        type_: pw::spa::utils::SpaTypes::ObjectParamBuffers.as_raw(),
        id: pw::spa::param::ParamType::Buffers.as_raw(),
        properties: vec![pw::spa::pod::Property {
            key: pw::spa::sys::SPA_PARAM_BUFFERS_dataType,
            flags: pw::spa::pod::PropertyFlags::empty(),
            value: pw::spa::pod::Value::Choice(pw::spa::pod::ChoiceValue::Int(
                pw::spa::utils::Choice(
                    pw::spa::utils::ChoiceFlags::empty(),
                    pw::spa::utils::ChoiceEnum::Flags {
                        default: data_types,
                        flags: vec![data_types],
                    },
                ),
            )),
        }],
    };
    let (cursor, _size) = pw::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &pw::spa::pod::Value::Object(object),
    )
    .map_err(|e| format!("buffers pod serialize: {e:?}"))?;
    Ok(cursor.into_inner())
}

/// How an `EnumFormat` pod constrains DRM modifiers (= buffer memory).
enum ModifierSpec<'a> {
    /// No `VideoModifier` property: the producer allocates shared memory.
    None,
    /// A `MANDATORY | DONT_FIXATE` choice of EGL-enumerated modifiers: asks
    /// for DMA-BUF and invites the producer's fixation dance (the OBS flow).
    Offer(&'a [u64]),
    /// A single `MANDATORY` modifier: our fixation answer.
    Fixed(u64),
}

/// `EnumFormat` pod: video/raw in the given layouts, any size, any rate,
/// with modifiers per `spec`. DMA-BUF negotiation (the modifier dance plus a
/// DmaBuf-capable `SPA_PARAM_Buffers` answer) is what unlocks Mutter's
/// direct-scanout recording - SHM monitor streams freeze on fullscreen
/// surfaces (mutter#3074).
fn build_format_pod(formats: &[VideoFormat], spec: &ModifierSpec<'_>) -> Result<Vec<u8>, String> {
    use pw::spa::pod::{ChoiceValue, Property, PropertyFlags, Value};
    use pw::spa::utils::{Choice, ChoiceEnum, ChoiceFlags, Id, SpaTypes};

    let fmt_key = pw::spa::param::format::FormatProperties::VideoFormat.as_raw();
    let format_prop = match formats {
        [] => return Err("empty format list".to_owned()),
        [only] => Property {
            key: fmt_key,
            flags: PropertyFlags::empty(),
            value: Value::Id(Id(only.as_raw())),
        },
        [first, ..] => Property {
            key: fmt_key,
            flags: PropertyFlags::empty(),
            value: Value::Choice(ChoiceValue::Id(Choice(
                ChoiceFlags::empty(),
                ChoiceEnum::Enum {
                    default: Id(first.as_raw()),
                    alternatives: formats.iter().map(|f| Id(f.as_raw())).collect(),
                },
            ))),
        },
    };

    let mut properties = vec![
        Property {
            key: pw::spa::param::format::FormatProperties::MediaType.as_raw(),
            flags: PropertyFlags::empty(),
            value: Value::Id(Id(MediaType::Video.as_raw())),
        },
        Property {
            key: pw::spa::param::format::FormatProperties::MediaSubtype.as_raw(),
            flags: PropertyFlags::empty(),
            value: Value::Id(Id(MediaSubtype::Raw.as_raw())),
        },
        format_prop,
    ];
    // DONT_FIXATE (1 << 4, spa pod.h) is behind libspa's v0_3_33 feature
    // gate; use the raw bit rather than widening the dependency surface.
    let dont_fixate = PropertyFlags::from_bits_retain(1 << 4);
    let modifier_key = pw::spa::param::format::FormatProperties::VideoModifier.as_raw();
    #[allow(
        clippy::cast_possible_wrap,
        reason = "DRM modifiers are opaque u64 bit patterns carried in spa Long"
    )]
    match *spec {
        ModifierSpec::None => {}
        ModifierSpec::Offer(mods) => {
            let alternatives: Vec<i64> = mods.iter().map(|&m| m as i64).collect();
            properties.push(Property {
                key: modifier_key,
                flags: PropertyFlags::MANDATORY | dont_fixate,
                value: Value::Choice(ChoiceValue::Long(Choice(
                    ChoiceFlags::empty(),
                    ChoiceEnum::Enum {
                        default: *alternatives.first().unwrap_or(&0),
                        alternatives,
                    },
                ))),
            });
        }
        ModifierSpec::Fixed(modifier) => {
            properties.push(Property {
                key: modifier_key,
                flags: PropertyFlags::MANDATORY,
                value: Value::Long(modifier as i64),
            });
        }
    }
    properties.extend(size_and_framerate_props());

    let object = pw::spa::pod::Object {
        type_: SpaTypes::ObjectParamFormat.as_raw(),
        id: pw::spa::param::ParamType::EnumFormat.as_raw(),
        properties,
    };
    let (cursor, _size) = pw::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &Value::Object(object),
    )
    .map_err(|e| format!("format pod serialize: {e:?}"))?;
    Ok(cursor.into_inner())
}

/// Any-size / any-rate constraints shared by every `EnumFormat` pod.
fn size_and_framerate_props() -> [pw::spa::pod::Property; 2] {
    use pw::spa::pod::{ChoiceValue, Property, PropertyFlags, Value};
    use pw::spa::utils::{Choice, ChoiceEnum, ChoiceFlags, Fraction, Rectangle};
    [
        Property {
            key: pw::spa::param::format::FormatProperties::VideoSize.as_raw(),
            flags: PropertyFlags::empty(),
            value: Value::Choice(ChoiceValue::Rectangle(Choice(
                ChoiceFlags::empty(),
                ChoiceEnum::Range {
                    default: Rectangle {
                        width: 1920,
                        height: 1080,
                    },
                    min: Rectangle {
                        width: 1,
                        height: 1,
                    },
                    max: Rectangle {
                        width: 16384,
                        height: 16384,
                    },
                },
            ))),
        },
        Property {
            key: pw::spa::param::format::FormatProperties::VideoFramerate.as_raw(),
            flags: PropertyFlags::empty(),
            value: Value::Choice(ChoiceValue::Fraction(Choice(
                ChoiceFlags::empty(),
                ChoiceEnum::Range {
                    default: Fraction { num: 30, denom: 1 },
                    min: Fraction { num: 0, denom: 1 },
                    max: Fraction {
                        num: 1000,
                        denom: 1,
                    },
                },
            ))),
        },
    ]
}

/// All linear RGB layouts `convert_to_rgba` can swizzle (shared-memory pod).
const SHM_FORMATS: [VideoFormat; 6] = [
    VideoFormat::BGRx,
    VideoFormat::BGRA,
    VideoFormat::RGBx,
    VideoFormat::RGBA,
    VideoFormat::BGR,
    VideoFormat::RGB,
];

/// Layouts offered on the DMA-BUF pod (the ones with EGL-queried modifiers).
const DMABUF_FORMATS: [VideoFormat; 2] = [VideoFormat::BGRx, VideoFormat::BGRA];

/// Turn one DMA-BUF buffer into an RGBA frame via the stream's lazily
/// created GL importer. `None` (logged, rate-limited) on failure - dropping
/// a frame costs smoothness, never correctness.
fn import_dmabuf_frame(
    state: &mut LoopState,
    data: &pw::spa::buffer::Data,
    width: u32,
    height: u32,
) -> Option<RawFrame> {
    let fourcc = match state.info.format() {
        VideoFormat::BGRx => super::egl_modifiers::DRM_FOURCC_XRGB8888,
        VideoFormat::BGRA => super::egl_modifiers::DRM_FOURCC_ARGB8888,
        other => {
            tracing::warn!(?other, "screenshare: dmabuf in unexpected format");
            return None;
        }
    };
    let modifier = state.info.modifier();
    if state.importer.is_none() {
        let importer = super::egl_modifiers::runtime()
            .ok_or_else(|| "EGL runtime unavailable".to_owned())
            .and_then(super::egl_import::DmabufImporter::new);
        state.importer = Some(match importer {
            Ok(importer) => {
                tracing::info!("screenshare: dmabuf GL importer ready");
                Some(importer)
            }
            Err(e) => {
                tracing::warn!(
                    "screenshare: dmabuf importer init failed ({e}); dmabuf frames dropped"
                );
                None
            }
        });
    }
    let importer = state.importer.as_ref()?.as_ref()?;
    let plane = super::egl_import::DmabufPlane {
        #[allow(
            clippy::cast_possible_truncation,
            reason = "spa carries the dmabuf fd widened to i64; it is an fd"
        )]
        fd: data.as_raw().fd as std::os::fd::RawFd,
        offset: data.chunk().offset(),
        stride: data.chunk().stride(),
    };
    match importer.read_frame(&plane, fourcc, modifier, width, height) {
        Ok(rgba) => Some(RawFrame {
            width,
            height,
            rgba,
        }),
        Err(e) => {
            state.import_errors += 1;
            if state.import_errors <= 3 || state.import_errors.is_multiple_of(300) {
                tracing::warn!(
                    errors = state.import_errors,
                    fd = plane.fd,
                    offset = plane.offset,
                    stride = plane.stride,
                    modifier,
                    width,
                    height,
                    "screenshare: dmabuf import failed: {e}"
                );
            }
            None
        }
    }
}

/// Parse each pod and push one params update, logging (not failing) on
/// rejection - negotiation glitches must degrade, never kill the stream.
fn send_params(stream: &pw::stream::StreamRef, pods: &[&[u8]], what: &str) {
    let parsed: Option<Vec<&pw::spa::pod::Pod>> =
        pods.iter().map(|b| pw::spa::pod::Pod::from_bytes(b)).collect();
    let Some(mut parsed) = parsed else {
        tracing::warn!("screenshare: {what}: pod rejected");
        return;
    };
    if let Err(e) = stream.update_params(&mut parsed) {
        tracing::warn!("screenshare: {what} failed: {e}");
    }
}

/// One step of the OBS-style DMA-BUF negotiation, run on every `Format`
/// param change. An unfixated modifier CHOICE from the producer gets our
/// fixation answer (one modifier, MANDATORY, SHM fallback appended); once
/// the format is final we answer `SPA_PARAM_Buffers` advertising `DmaBuf`
/// support - without that bit the producer allocates shared memory, and
/// Mutter's direct-scanout recording feeds ONLY dmabuf streams
/// (mutter#3074), which is why SHM monitor captures freeze on fullscreen
/// surfaces.
fn negotiate_dmabuf_step(
    stream: &pw::stream::StreamRef,
    format: VideoFormat,
    param: &pw::spa::pod::Pod,
    fixation_shm: &[u8],
) {
    match modifier_prop(param) {
        Some((modifier, true)) => {
            tracing::info!(modifier, "screenshare: fixating dmabuf modifier");
            match build_format_pod(&[format], &ModifierSpec::Fixed(modifier)) {
                Ok(fixated) => {
                    send_params(stream, &[&fixated, fixation_shm], "modifier fixation");
                }
                Err(e) => tracing::warn!("screenshare: fixated pod: {e}"),
            }
        }
        other => {
            if let Some((modifier, false)) = other {
                tracing::info!(modifier, "screenshare: dmabuf modifier fixed by producer");
            }
            match build_buffers_pod() {
                Ok(pod_bytes) => send_params(stream, &[&pod_bytes], "buffers param update"),
                Err(e) => tracing::warn!("screenshare: buffers pod: {e}"),
            }
        }
    }
}

/// The producer's `Format` param's `VideoModifier`, if any: the modifier
/// value plus whether it is still an unfixated choice (needing our
/// fixation answer) or already final.
fn modifier_prop(param: &pw::spa::pod::Pod) -> Option<(u64, bool)> {
    use pw::spa::pod::{deserialize::PodDeserializer, ChoiceValue, Value};
    let (_, value) = PodDeserializer::deserialize_from::<Value>(param.as_bytes()).ok()?;
    let Value::Object(obj) = value else { return None };
    let key = pw::spa::param::format::FormatProperties::VideoModifier.as_raw();
    let prop = obj.properties.iter().find(|p| p.key == key)?;
    #[allow(
        clippy::cast_sign_loss,
        reason = "DRM modifiers are opaque u64 bit patterns carried in spa Long"
    )]
    match &prop.value {
        Value::Long(v) => Some((*v as u64, false)),
        Value::Choice(ChoiceValue::Long(pw::spa::utils::Choice(
            _,
            pw::spa::utils::ChoiceEnum::Enum { default, .. },
        ))) => Some((*default as u64, true)),
        _ => None,
    }
}

/// Swizzle one negotiated-layout frame into tightly packed opaque RGBA.
fn convert_to_rgba(
    format: VideoFormat,
    width: u32,
    height: u32,
    stride: i32,
    chunk_size: usize,
    src: &[u8],
) -> Option<RawFrame> {
    let (w, h) = (width as usize, height as usize);
    if w == 0 || h == 0 {
        return None;
    }
    let bpp: usize = match format {
        VideoFormat::BGRx | VideoFormat::BGRA | VideoFormat::RGBx | VideoFormat::RGBA => 4,
        VideoFormat::BGR | VideoFormat::RGB => 3,
        _ => {
            tracing::warn!(?format, "screenshare: unsupported pipewire format");
            return None;
        }
    };
    // Some producers leave stride 0; infer it from the chunk then.
    let stride = if stride > 0 {
        stride as usize
    } else if h > 0 && chunk_size >= w * bpp * h {
        chunk_size / h
    } else {
        w * bpp
    };
    let avail = src.len().min(chunk_size.max(1));
    if stride < w * bpp || avail < stride * (h - 1) + w * bpp {
        tracing::warn!(stride, avail, w, h, "screenshare: short pipewire buffer");
        return None;
    }

    let mut rgba = vec![0u8; w * h * 4];
    for (row_index, out_row) in rgba.chunks_exact_mut(w * 4).enumerate() {
        let in_row = &src[row_index * stride..row_index * stride + w * bpp];
        match format {
            VideoFormat::BGRx | VideoFormat::BGRA => {
                for (out_px, in_px) in out_row.chunks_exact_mut(4).zip(in_row.chunks_exact(4)) {
                    out_px[0] = in_px[2];
                    out_px[1] = in_px[1];
                    out_px[2] = in_px[0];
                    out_px[3] = 255;
                }
            }
            VideoFormat::RGBx | VideoFormat::RGBA => {
                for (out_px, in_px) in out_row.chunks_exact_mut(4).zip(in_row.chunks_exact(4)) {
                    out_px[0] = in_px[0];
                    out_px[1] = in_px[1];
                    out_px[2] = in_px[2];
                    out_px[3] = 255;
                }
            }
            VideoFormat::BGR => {
                for (out_px, in_px) in out_row.chunks_exact_mut(4).zip(in_row.chunks_exact(3)) {
                    out_px[0] = in_px[2];
                    out_px[1] = in_px[1];
                    out_px[2] = in_px[0];
                    out_px[3] = 255;
                }
            }
            VideoFormat::RGB => {
                for (out_px, in_px) in out_row.chunks_exact_mut(4).zip(in_row.chunks_exact(3)) {
                    out_px[0] = in_px[0];
                    out_px[1] = in_px[1];
                    out_px[2] = in_px[2];
                    out_px[3] = 255;
                }
            }
            _ => unreachable!("filtered above"),
        }
    }
    // True dimensions; encoders handle their own even-alignment cropping.
    Some(RawFrame {
        width,
        height,
        rgba,
    })
}
