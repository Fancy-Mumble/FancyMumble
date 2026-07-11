//! PipeWire video-stream consumer - the analogue of Chromium's
//! `SharedScreenCastStream` (modules/desktop_capture/linux/wayland).
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

    let state = LoopState {
        shared,
        info: VideoInfoRaw::new(),
        have_format: false,
        was_streaming: false,
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
        .param_changed(|_stream, state, id, param| {
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
                tracing::info!(
                    format = ?state.info.format(),
                    width = state.info.size().width,
                    height = state.info.size().height,
                    "screenshare: pipewire format negotiated",
                );
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
            let chunk_size = data.chunk().size() as usize;
            let chunk_stride = data.chunk().stride();
            let Some(bytes) = data.data() else { return };
            let Some(frame) =
                convert_to_rgba(format, width, height, chunk_stride, chunk_size, bytes)
            else {
                return;
            };
            if let Ok(mut slot) = state.shared.slot.lock() {
                slot.frame = Some(frame);
            }
            state.shared.cond.notify_all();
        })
        .register()
        .map_err(|e| format!("pw stream listener: {e}"))?;

    let format_pod = build_format_pod()?;
    let mut params = [pw::spa::pod::Pod::from_bytes(&format_pod)
        .ok_or_else(|| "format pod rejected".to_owned())?];
    stream
        .connect(
            pw::spa::utils::Direction::Input,
            Some(node_id),
            pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
            &mut params,
        )
        .map_err(|e| format!("pw stream connect: {e}"))?;

    mainloop.run();

    let _ = stream.disconnect();
    Ok(())
}

/// EnumFormat pod: video/raw, the linear RGB layouts we can swizzle, any
/// size, any rate. No `VideoModifier` property = shared-memory buffers.
fn build_format_pod() -> Result<Vec<u8>, String> {
    let object = pw::spa::pod::object!(
        pw::spa::utils::SpaTypes::ObjectParamFormat,
        pw::spa::param::ParamType::EnumFormat,
        pw::spa::pod::property!(
            pw::spa::param::format::FormatProperties::MediaType,
            Id,
            MediaType::Video
        ),
        pw::spa::pod::property!(
            pw::spa::param::format::FormatProperties::MediaSubtype,
            Id,
            MediaSubtype::Raw
        ),
        pw::spa::pod::property!(
            pw::spa::param::format::FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            VideoFormat::BGRx,
            VideoFormat::BGRx,
            VideoFormat::BGRA,
            VideoFormat::RGBx,
            VideoFormat::RGBA,
            VideoFormat::BGR,
            VideoFormat::RGB
        ),
        pw::spa::pod::property!(
            pw::spa::param::format::FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            pw::spa::utils::Rectangle {
                width: 1920,
                height: 1080
            },
            pw::spa::utils::Rectangle {
                width: 1,
                height: 1
            },
            pw::spa::utils::Rectangle {
                width: 16384,
                height: 16384
            }
        ),
        pw::spa::pod::property!(
            pw::spa::param::format::FormatProperties::VideoFramerate,
            Choice,
            Range,
            Fraction,
            pw::spa::utils::Fraction { num: 30, denom: 1 },
            pw::spa::utils::Fraction { num: 0, denom: 1 },
            pw::spa::utils::Fraction {
                num: 1000,
                denom: 1
            }
        )
    );
    let (cursor, _size) = pw::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &pw::spa::pod::Value::Object(object),
    )
    .map_err(|e| format!("format pod serialize: {e:?}"))?;
    Ok(cursor.into_inner())
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
