//! GPU screen-share pipeline (Windows).
//!
//! ```text
//! WGC capture ──► D3D11 VideoProcessor ──► hardware H.264 MFT ──► bitstream
//! (GPU texture)   (scale + BGRA→NV12,      (NVENC/AMF/QuickSync,    (CPU, small)
//!                  GPU)                     GPU)
//! ```
//!
//! Frames never touch system memory: capture hands us a D3D11 texture, the
//! video processor scales and converts it on the GPU, and the hardware
//! encoder consumes the NV12 texture directly. The CPU's only per-frame work
//! is copying the compressed Annex-B bitstream out of the encoder sample.
//!
//! Everything here is best-effort: [`GpuPipeline::new`] returns `Err` on any
//! missing capability (no hardware encoder, RDP session, old driver, ...)
//! and the caller falls back to the CPU pipeline.
#![allow(unsafe_code, reason = "FFI with D3D11/MF/WGC; every unsafe block is a COM call")]

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread, ID3D11Texture2D,
    ID3D11VideoContext, ID3D11VideoDevice, ID3D11VideoProcessor,
    ID3D11VideoProcessorEnumerator, ID3D11VideoProcessorInputView,
    ID3D11VideoProcessorOutputView, D3D11_BIND_RENDER_TARGET, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_CREATE_DEVICE_VIDEO_SUPPORT, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, D3D11_VIDEO_PROCESSOR_CONTENT_DESC,
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC,
    D3D11_VIDEO_PROCESSOR_STREAM, D3D11_VIDEO_USAGE_PLAYBACK_NORMAL, D3D11_VPIV_DIMENSION_TEXTURE2D,
    D3D11_VPOV_DIMENSION_TEXTURE2D,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_NV12;
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::Foundation::VARIANT_BOOL;
use windows::Win32::Media::MediaFoundation::{
    ICodecAPI, IMFDXGIDeviceManager, IMFMediaEvent, IMFMediaEventGenerator,
    IMFTransform, MFCreateDXGIDeviceManager, MFCreateDXGISurfaceBuffer, MFCreateMediaType,
    MFCreateSample, MFStartup, MFTEnumEx, CODECAPI_AVEncCommonMeanBitRate,
    CODECAPI_AVEncCommonRateControlMode, CODECAPI_AVEncMPVDefaultBPictureCount,
    CODECAPI_AVEncVideoForceKeyFrame, CODECAPI_AVLowLatencyMode, MFMediaType_Video,
    MFSTARTUP_LITE, MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE,
    MFT_ENUM_FLAG_SORTANDFILTER, MFT_MESSAGE_NOTIFY_BEGIN_STREAMING,
    MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_MESSAGE_SET_D3D_MANAGER, MFT_REGISTER_TYPE_INFO,
    MFVideoFormat_H264, MFVideoFormat_NV12, MFVideoInterlace_Progressive,
    MFSampleExtension_CleanPoint, METransformHaveOutput, METransformNeedInput,
    MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS, MF_E_NO_EVENTS_AVAILABLE,
    MF_E_TRANSFORM_NEED_MORE_INPUT, MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE,
    MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_TRANSFORM_ASYNC_UNLOCK,
    MFT_OUTPUT_DATA_BUFFER,
};
use windows::Win32::System::Variant::{VARENUM, VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_BOOL, VT_UI4};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

use crate::encode::{EncodeSettings, EncodedFrame};

/// Number of NV12 textures cycled between the video processor and the
/// encoder. The encoder holds a texture only until it finished reading it;
/// four buffers give it >60 ms of slack at 60 fps.
const NV12_POOL: usize = 4;

/// One-time Media Foundation startup for the process.
fn ensure_mf_started() -> Result<(), String> {
    static MF_STARTED: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    MF_STARTED
        .get_or_init(|| {
            // MF stays up for the process lifetime; MFShutdown at exit is not
            // worth the teardown-ordering hazards in a GUI app.
            unsafe { MFStartup(mf_version(), MFSTARTUP_LITE) }.map_err(|e| e.to_string())
        })
        .clone()
}

/// `MF_VERSION` as the headers compute it (MF_SDK_VERSION << 16 | MF_API_VERSION).
const fn mf_version() -> u32 {
    (2 << 16) | 0x0070
}

/// The full GPU pipeline for one monitor. NOT `Send` (D3D/WGC objects are
/// used from the capture thread that created them).
pub(crate) struct GpuPipeline {
    _device: ID3D11Device,
    _context: ID3D11DeviceContext,
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    processor: ID3D11VideoProcessor,
    processor_enum: ID3D11VideoProcessorEnumerator,
    nv12_pool: Vec<ID3D11Texture2D>,
    next_nv12: usize,
    /// Last converted picture, for idle keep-alive re-encodes. Safe to reuse:
    /// pool slots only advance when a NEW capture frame is converted.
    last_nv12: Option<ID3D11Texture2D>,
    frame_pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    encoder: IMFTransform,
    encoder_events: IMFMediaEventGenerator,
    codec_api: ICodecAPI,
    /// Inputs the encoder has asked for and we have not yet satisfied.
    pending_need_input: u32,
    /// Outputs the encoder signalled via `METransformHaveOutput` and we have
    /// not yet drained. MUST be a COUNT, not a bool: the async MFT raises one
    /// event per available output, and each REQUIRES its own `ProcessOutput`.
    /// Collapsing several events into a bool strands the surplus outputs in the
    /// encoder, which then stops raising `METransformNeedInput` (it cannot make
    /// output room) - a saturation that stalls `submit()` for its full 200 ms
    /// timeout and drops frames in bursts.
    have_output: u32,
    /// Encoded frames already pulled from the MFT but not yet returned to the
    /// caller. Decouples draining from emitting: `submit()` drains here WHILE
    /// it waits for `METransformNeedInput` so the encoder is never blocked on
    /// undrained output (the deadlock behind the 200 ms `submit` stalls), and
    /// the caller pops one per `next_frame`.
    output_queue: VecDeque<EncodedFrame>,
    out_width: u32,
    out_height: u32,
    frame_duration_100ns: i64,
    started_at: Instant,
}

impl std::fmt::Debug for GpuPipeline {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GpuPipeline")
            .field("out", &(self.out_width, self.out_height))
            .finish_non_exhaustive()
    }
}

impl GpuPipeline {
    /// Build the whole chain for `monitor_id` (an `HMONITOR` value, as the
    /// source enumeration reports for screens). Any missing capability is an
    /// `Err` - the caller falls back to the CPU pipeline.
    pub(crate) fn new(monitor_id: u32, settings: &EncodeSettings) -> Result<Self, String> {
        ensure_mf_started()?;

        // D3D11 device shared by capture, video processor and encoder.
        let (device, context) = create_d3d11_device()?;

        // -- Windows.Graphics.Capture session for the monitor --------------
        let dxgi: IDXGIDevice = device.cast().map_err(|e| format!("IDXGIDevice: {e}"))?;
        let winrt_device: IDirect3DDevice = {
            let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }
                .map_err(|e| format!("CreateDirect3D11DeviceFromDXGIDevice: {e}"))?;
            inspectable.cast().map_err(|e| format!("IDirect3DDevice: {e}"))?
        };

        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(|e| format!("capture interop factory: {e}"))?;
        let item: GraphicsCaptureItem =
            unsafe { interop.CreateForMonitor(HMONITOR(monitor_id as usize as *mut _)) }
                .map_err(|e| format!("CreateForMonitor: {e}"))?;
        let size = item.Size().map_err(|e| format!("capture item size: {e}"))?;
        let (in_width, in_height) = (size.Width.max(2) as u32, size.Height.max(2) as u32);

        let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )
        .map_err(|e| format!("capture frame pool: {e}"))?;
        let session = frame_pool
            .CreateCaptureSession(&item)
            .map_err(|e| format!("capture session: {e}"))?;
        disable_capture_border(&session);
        session.StartCapture().map_err(|e| format!("StartCapture: {e}"))?;

        // -- D3D11 video processor: scale + BGRA -> NV12 --------------------
        let (out_width, out_height) = output_dims(in_width, in_height, settings.max_dimension);
        let VideoProcessor { video_device, video_context, processor, processor_enum, nv12_pool } =
            create_video_processor(&device, &context, (in_width, in_height), (out_width, out_height))?;

        // -- Hardware H.264 encoder MFT -------------------------------------
        let (encoder, codec_api, encoder_events) = create_hardware_encoder(
            &device,
            out_width,
            out_height,
            settings,
        )?;

        let fps = settings.max_fps.clamp(1.0, 60.0);
        Ok(Self {
            _device: device,
            _context: context,
            video_device,
            video_context,
            processor,
            processor_enum,
            nv12_pool,
            next_nv12: 0,
            last_nv12: None,
            frame_pool,
            session,
            encoder,
            encoder_events,
            codec_api,
            pending_need_input: 0,
            have_output: 0,
            output_queue: VecDeque::new(),
            out_width,
            out_height,
            frame_duration_100ns: (10_000_000.0 / fps) as i64,
            started_at: Instant::now(),
        })
    }

    /// Encoded output size (what viewers will decode).
    pub(crate) fn output_dims(&self) -> (u32, u32) {
        (self.out_width, self.out_height)
    }

    /// Pump the pipeline once: take the newest captured frame (if any),
    /// convert + submit it, and return the next encoded frame when ready.
    ///
    /// `Ok(None)` = nothing changed on screen and no output pending.
    fn pump(
        &mut self,
        wait: Duration,
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String> {
        let deadline = Instant::now() + wait;
        loop {
            // Drain encoder events first - output may already be waiting.
            self.pump_encoder_events()?;
            if let Some(frame) = self.try_take_output()? {
                return Ok(Some(frame));
            }

            // Newest capture frame (drop stale ones - encoding old frames
            // only adds latency).
            let mut newest = None;
            while let Ok(frame) = self.frame_pool.TryGetNextFrame() {
                newest = Some(frame);
            }
            if let Some(frame) = newest {
                let texture: ID3D11Texture2D = {
                    let surface = frame.Surface().map_err(|e| format!("frame surface: {e}"))?;
                    let access: IDirect3DDxgiInterfaceAccess =
                        surface.cast().map_err(|e| format!("surface interop: {e}"))?;
                    unsafe { access.GetInterface() }
                        .map_err(|e| format!("surface texture: {e}"))?
                };
                let nv12 = self.convert(&texture)?;
                self.submit(&nv12, force_keyframe)?;
                self.last_nv12 = Some(nv12);
                // Give the encoder a moment to produce output on this pass.
                continue;
            }

            if Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    /// Scale + colorspace-convert one captured BGRA texture into the next
    /// NV12 pool texture on the GPU.
    fn convert(&mut self, src: &ID3D11Texture2D) -> Result<ID3D11Texture2D, String> {
        let dst = self.nv12_pool[self.next_nv12].clone();
        self.next_nv12 = (self.next_nv12 + 1) % self.nv12_pool.len();

        let input_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: Default::default(),
        };
        let mut input_view: Option<ID3D11VideoProcessorInputView> = None;
        unsafe {
            self.video_device.CreateVideoProcessorInputView(
                src,
                &self.processor_enum,
                &input_desc,
                Some(&mut input_view),
            )
        }
        .map_err(|e| format!("CreateVideoProcessorInputView: {e}"))?;
        let input_view = input_view.ok_or("no input view")?;

        let output_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
            ..Default::default()
        };
        let mut output_view: Option<ID3D11VideoProcessorOutputView> = None;
        unsafe {
            self.video_device.CreateVideoProcessorOutputView(
                &dst,
                &self.processor_enum,
                &output_desc,
                Some(&mut output_view),
            )
        }
        .map_err(|e| format!("CreateVideoProcessorOutputView: {e}"))?;
        let output_view = output_view.ok_or("no output view")?;

        let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            pInputSurface: std::mem::ManuallyDrop::new(Some(input_view)),
            ..Default::default()
        };
        let blt = unsafe {
            self.video_context.VideoProcessorBlt(
                &self.processor,
                &output_view,
                0,
                std::slice::from_ref(&stream),
            )
        };
        // Release the view reference the stream struct holds.
        unsafe { std::mem::ManuallyDrop::drop(&mut stream.pInputSurface) };
        blt.map_err(|e| format!("VideoProcessorBlt: {e}"))?;
        Ok(dst)
    }

    /// Wrap the NV12 texture in an MF sample and hand it to the encoder.
    fn submit(&mut self, nv12: &ID3D11Texture2D, force_keyframe: bool) -> Result<(), String> {
        // Wait until the encoder has asked for input (async MFT contract).
        // CRITICAL: drain output while waiting. A hardware MFT stops raising
        // `METransformNeedInput` when its output buffers are full, and it only
        // frees them when we call `ProcessOutput`. If we merely spin on events
        // without draining (as before), the encoder waits for us to drain and
        // we wait for it to ask for input - a deadlock that burned the whole
        // 200 ms timeout and dropped the frame, in bursts. Draining here breaks
        // it; the pulled frames are queued for the caller.
        let deadline = Instant::now() + Duration::from_millis(200);
        while self.pending_need_input == 0 {
            self.pump_encoder_events()?;
            self.drain_outputs()?;
            if self.pending_need_input == 0 {
                if Instant::now() >= deadline {
                    // Genuinely saturated - drop this frame rather than stall.
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        }

        if force_keyframe {
            let one = variant_u32(1);
            unsafe { self.codec_api.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &one) }
                .map_err(|e| format!("force keyframe: {e}"))?;
        }

        let buffer = unsafe {
            MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, nv12, 0, false)
        }
        .map_err(|e| format!("MFCreateDXGISurfaceBuffer: {e}"))?;
        let sample = unsafe { MFCreateSample() }.map_err(|e| format!("MFCreateSample: {e}"))?;
        unsafe { sample.AddBuffer(&buffer) }.map_err(|e| format!("AddBuffer: {e}"))?;
        let pts = self.started_at.elapsed().as_nanos() as i64 / 100;
        unsafe {
            sample
                .SetSampleTime(pts)
                .and_then(|()| sample.SetSampleDuration(self.frame_duration_100ns))
        }
        .map_err(|e| format!("sample timing: {e}"))?;

        unsafe { self.encoder.ProcessInput(0, &sample, 0) }
            .map_err(|e| format!("ProcessInput: {e}"))?;
        self.pending_need_input -= 1;
        Ok(())
    }

    /// Non-blocking drain of the encoder's event queue.
    fn pump_encoder_events(&mut self) -> Result<(), String> {
        loop {
            let event: IMFMediaEvent = match unsafe {
                self.encoder_events
                    .GetEvent(MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(1)) // MF_EVENT_FLAG_NO_WAIT
            } {
                Ok(ev) => ev,
                Err(e) if e.code() == MF_E_NO_EVENTS_AVAILABLE => return Ok(()),
                Err(e) => return Err(format!("encoder GetEvent: {e}")),
            };
            let kind = unsafe { event.GetType() }.map_err(|e| e.to_string())?;
            if kind == METransformNeedInput.0 as u32 {
                self.pending_need_input += 1;
            } else if kind == METransformHaveOutput.0 as u32 {
                // One output ready per event; try_take_output drains one each.
                self.have_output += 1;
            }
        }
    }

    /// Pull all currently-signalled outputs into the queue, then return the
    /// oldest. Draining ALL of them (not one) keeps the MFT's output buffers
    /// free so it keeps requesting input.
    fn try_take_output(&mut self) -> Result<Option<EncodedFrame>, String> {
        self.drain_outputs()?;
        Ok(self.output_queue.pop_front())
    }

    /// Call `ProcessOutput` for every output the encoder has signalled,
    /// pushing each onto [`Self::output_queue`]. Safe to call anytime; a no-op
    /// when nothing is pending.
    fn drain_outputs(&mut self) -> Result<(), String> {
        while self.have_output > 0 {
            match self.take_one_output()? {
                Some(frame) => self.output_queue.push_back(frame),
                None => break,
            }
        }
        Ok(())
    }

    /// Pull exactly one encoded sample via `ProcessOutput` if one is signalled.
    fn take_one_output(&mut self) -> Result<Option<EncodedFrame>, String> {
        if self.have_output == 0 {
            return Ok(None);
        }
        self.have_output -= 1;

        let mut out_buffer = MFT_OUTPUT_DATA_BUFFER { dwStreamID: 0, ..Default::default() };
        let mut status = 0u32;
        let result = unsafe {
            self.encoder
                .ProcessOutput(0, std::slice::from_mut(&mut out_buffer), &mut status)
        };
        // Whatever happens, the MFT gave us owned COM pointers in the
        // ManuallyDrop fields - take them so they get released exactly once.
        let sample = std::mem::ManuallyDrop::into_inner(std::mem::take(&mut out_buffer.pSample));
        let events = std::mem::ManuallyDrop::into_inner(std::mem::take(&mut out_buffer.pEvents));
        drop(events);
        if let Err(e) = result {
            if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT {
                return Ok(None);
            }
            return Err(format!("ProcessOutput: {e}"));
        }
        let Some(sample) = sample else {
            return Ok(None);
        };

        let keyframe = unsafe { sample.GetUINT32(&MFSampleExtension_CleanPoint) }.unwrap_or(0) == 1;
        let buffer = unsafe { sample.ConvertToContiguousBuffer() }
            .map_err(|e| format!("ConvertToContiguousBuffer: {e}"))?;
        let mut ptr = std::ptr::null_mut();
        let mut len = 0u32;
        unsafe { buffer.Lock(&mut ptr, None, Some(&mut len)) }
            .map_err(|e| format!("buffer lock: {e}"))?;
        let data = unsafe { std::slice::from_raw_parts(ptr, len as usize) }.to_vec();
        let _ = unsafe { buffer.Unlock() };

        Ok(Some(EncodedFrame { data, keyframe }))
    }

    /// Stop the capture session (encoder/device teardown is drop-driven).
    fn close(&mut self) {
        let _ = self.session.Close();
        let _ = self.frame_pool.Close();
    }
}

impl crate::pipeline::EncodePipeline for GpuPipeline {
    fn name(&self) -> &'static str {
        "windows-gpu"
    }

    fn next_frame(
        &mut self,
        wait: Duration,
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String> {
        self.pump(wait, force_keyframe)
    }

    fn encode_repeat(&mut self) -> Result<Option<EncodedFrame>, String> {
        let Some(nv12) = self.last_nv12.clone() else {
            return Ok(None);
        };
        // Same picture again = a minimal delta frame (no keyframe). Drain
        // briefly like next_frame's normal pass; the async MFT usually has
        // the output ready within a few polls.
        self.submit(&nv12, false)?;
        let deadline = Instant::now() + Duration::from_millis(50);
        loop {
            if let Some(frame) = self.try_take_output()? {
                return Ok(Some(frame));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    fn shutdown(&mut self) {
        self.close();
    }
}

/// Build a `VT_UI4` VARIANT for `ICodecAPI::SetValue`.
fn variant_u32(value: u32) -> VARIANT {
    variant_with(VT_UI4, VARIANT_0_0_0 { ulVal: value })
}

/// Build a `VT_BOOL` VARIANT for `ICodecAPI::SetValue`.
fn variant_bool(value: bool) -> VARIANT {
    variant_with(
        VT_BOOL,
        VARIANT_0_0_0 { boolVal: VARIANT_BOOL(if value { -1 } else { 0 }) },
    )
}

fn variant_with(vt: VARENUM, value: VARIANT_0_0_0) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(VARIANT_0_0 {
                vt,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: value,
            }),
        },
    }
}

/// Turn off Windows' yellow capture border for a WGC session. The embedder
/// draws its own sharing indicator instead. Best-effort: needs Windows 11 /
/// Win10 20348+ plus the Borderless capability (auto-granted to full-trust
/// desktop apps); anywhere else the OS border simply stays.
pub(crate) fn disable_capture_border(session: &GraphicsCaptureSession) {
    use windows::Graphics::Capture::{GraphicsCaptureAccess, GraphicsCaptureAccessKind};
    let granted = GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless)
        .and_then(|op| op.get());
    match granted {
        Ok(_) => {
            if let Err(e) = session.SetIsBorderRequired(false) {
                tracing::debug!("screenshare: borderless capture unavailable: {e}");
            }
        }
        Err(e) => tracing::debug!("screenshare: borderless capture access denied: {e}"),
    }
}

/// Compute even output dimensions capped at `max_dim` on the longest edge.
fn output_dims(w: u32, h: u32, max_dim: u32) -> (u32, u32) {
    if max_dim == 0 || w.max(h) <= max_dim {
        return (w & !1, h & !1);
    }
    let scale = f64::from(max_dim) / f64::from(w.max(h));
    (
        ((f64::from(w) * scale) as u32).max(2) & !1,
        ((f64::from(h) * scale) as u32).max(2) & !1,
    )
}

/// Activate one encoder candidate and attach our D3D device to it.
fn try_bind_encoder(
    activate: &windows::Win32::Media::MediaFoundation::IMFActivate,
    device: &ID3D11Device,
) -> Result<IMFTransform, String> {
    let encoder: IMFTransform =
        unsafe { activate.ActivateObject() }.map_err(|e| format!("ActivateObject: {e}"))?;

    // Async MFT contract: unlock, then attach our D3D device.
    let attrs = unsafe { encoder.GetAttributes() }.map_err(|e| format!("GetAttributes: {e}"))?;
    unsafe { attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1) }
        .map_err(|e| format!("ASYNC_UNLOCK: {e}"))?;

    let manager: IMFDXGIDeviceManager = {
        let mut token = 0u32;
        let mut mgr: Option<IMFDXGIDeviceManager> = None;
        unsafe { MFCreateDXGIDeviceManager(&mut token, &mut mgr) }
            .map_err(|e| format!("MFCreateDXGIDeviceManager: {e}"))?;
        let mgr = mgr.ok_or("no DXGI device manager")?;
        unsafe { mgr.ResetDevice(device, token) }.map_err(|e| format!("ResetDevice: {e}"))?;
        mgr
    };
    unsafe { encoder.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize) }
        .map_err(|e| format!("SET_D3D_MANAGER: {e}"))?;
    // The MFT AddRef'd the manager; our reference drops normally.
    drop(manager);
    Ok(encoder)
}

/// Create the shared D3D11 hardware device + immediate context, marked
/// multithread-protected (MF and WGC drive it from their own threads).
fn create_d3d11_device() -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    let mut feature_level = D3D_FEATURE_LEVEL::default();
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            Some(&mut feature_level),
            Some(&mut context),
        )
    }
    .map_err(|e| format!("D3D11CreateDevice: {e}"))?;
    let device = device.ok_or("no D3D11 device")?;
    let context = context.ok_or("no D3D11 context")?;
    let multithread: ID3D11Multithread =
        device.cast().map_err(|e| format!("ID3D11Multithread: {e}"))?;
    let _ = unsafe { multithread.SetMultithreadProtected(true) };
    Ok((device, context))
}

/// The D3D11 video-processor objects plus the NV12 output texture pool.
struct VideoProcessor {
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    processor: ID3D11VideoProcessor,
    processor_enum: ID3D11VideoProcessorEnumerator,
    nv12_pool: Vec<ID3D11Texture2D>,
}

/// Build the video processor (GPU scale + BGRA -> NV12) and its NV12 output
/// texture pool for the given input/output dimensions.
fn create_video_processor(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    (in_width, in_height): (u32, u32),
    (out_width, out_height): (u32, u32),
) -> Result<VideoProcessor, String> {
    let video_device: ID3D11VideoDevice =
        device.cast().map_err(|e| format!("ID3D11VideoDevice: {e}"))?;
    let video_context: ID3D11VideoContext =
        context.cast().map_err(|e| format!("ID3D11VideoContext: {e}"))?;

    let content_desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
        InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
        InputWidth: in_width,
        InputHeight: in_height,
        OutputWidth: out_width,
        OutputHeight: out_height,
        Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
        ..Default::default()
    };
    let processor_enum = unsafe { video_device.CreateVideoProcessorEnumerator(&content_desc) }
        .map_err(|e| format!("CreateVideoProcessorEnumerator: {e}"))?;
    let processor = unsafe { video_device.CreateVideoProcessor(&processor_enum, 0) }
        .map_err(|e| format!("CreateVideoProcessor: {e}"))?;

    let nv12_desc = D3D11_TEXTURE2D_DESC {
        Width: out_width,
        Height: out_height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_NV12,
        SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
        ..Default::default()
    };
    let mut nv12_pool = Vec::with_capacity(NV12_POOL);
    for _ in 0..NV12_POOL {
        let mut tex: Option<ID3D11Texture2D> = None;
        unsafe { device.CreateTexture2D(&nv12_desc, None, Some(&mut tex)) }
            .map_err(|e| format!("CreateTexture2D(NV12): {e}"))?;
        nv12_pool.push(tex.ok_or("no NV12 texture")?);
    }
    Ok(VideoProcessor { video_device, video_context, processor, processor_enum, nv12_pool })
}

/// Find and configure a hardware H.264 encoder MFT bound to `device`.
fn create_hardware_encoder(
    device: &ID3D11Device,
    width: u32,
    height: u32,
    settings: &EncodeSettings,
) -> Result<(IMFTransform, ICodecAPI, IMFMediaEventGenerator), String> {
    let input_info = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output_info = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_H264,
    };
    let mut activates_ptr = std::ptr::null_mut();
    let mut count = 0u32;
    unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            Some(&input_info),
            Some(&output_info),
            &mut activates_ptr,
            &mut count,
        )
    }
    .map_err(|e| format!("MFTEnumEx: {e}"))?;
    if count == 0 || activates_ptr.is_null() {
        return Err("no hardware H.264 encoder MFT".into());
    }
    let activates = unsafe { std::slice::from_raw_parts(activates_ptr, count as usize) };
    // On multi-adapter machines the "best" MFT (index 0) may belong to a
    // different GPU than our D3D device, and several vendors answer
    // SET_D3D_MANAGER with E_FAIL instead of degrading - so try each
    // enumerated encoder until one accepts the device.
    let mut encoder_and_err: Result<IMFTransform, String> = Err("no candidates".into());
    for candidate in activates.iter().flatten() {
        match try_bind_encoder(candidate, device) {
            Ok(enc) => {
                encoder_and_err = Ok(enc);
                break;
            }
            Err(e) => {
                tracing::debug!("screenshare: encoder MFT rejected: {e}");
                encoder_and_err = Err(e);
            }
        }
    }
    // The array itself is CoTaskMem-allocated by MFTEnumEx.
    unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(activates_ptr as *const _)) };
    let encoder = encoder_and_err.map_err(|e| format!("no usable hardware encoder: {e}"))?;

    // Output type FIRST (H.264), then input (NV12) - the MFT contract.
    let fps = settings.max_fps.clamp(1.0, 60.0) as u32;
    let bitrate = scaled_bitrate(width, height, settings);
    (|| -> windows::core::Result<()> {
        unsafe {
            let out_type = MFCreateMediaType()?;
            out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            out_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
            out_type.SetUINT64(&MF_MT_FRAME_SIZE, (u64::from(width) << 32) | u64::from(height))?;
            out_type.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(fps) << 32) | 1)?;
            out_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            out_type.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            encoder.SetOutputType(0, &out_type, 0)
        }
    })()
    .map_err(|e| format!("SetOutputType: {e}"))?;

    (|| -> windows::core::Result<()> {
        unsafe {
            let in_type = MFCreateMediaType()?;
            in_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            in_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
            in_type.SetUINT64(&MF_MT_FRAME_SIZE, (u64::from(width) << 32) | u64::from(height))?;
            in_type.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(fps) << 32) | 1)?;
            in_type.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            encoder.SetInputType(0, &in_type, 0)
        }
    })()
    .map_err(|e| format!("SetInputType: {e}"))?;

    // Low-latency knobs; failures are tolerable (driver-specific support).
    let codec_api: ICodecAPI = encoder.cast().map_err(|e| format!("ICodecAPI: {e}"))?;
    unsafe {
        let on = variant_bool(true);
        let _ = codec_api.SetValue(&CODECAPI_AVLowLatencyMode, &on);
        let zero = variant_u32(0);
        let _ = codec_api.SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &zero);
        // Rate control mode 3 = CBR (eAVEncCommonRateControlMode_CBR).
        let cbr = variant_u32(3);
        let _ = codec_api.SetValue(&CODECAPI_AVEncCommonRateControlMode, &cbr);
        let rate = variant_u32(bitrate);
        let _ = codec_api.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &rate);
    }

    let events: IMFMediaEventGenerator =
        encoder.cast().map_err(|e| format!("IMFMediaEventGenerator: {e}"))?;

    (|| -> windows::core::Result<()> {
        unsafe {
            encoder.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            encoder.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)
        }
    })()
    .map_err(|e| format!("start streaming: {e}"))?;

    Ok((encoder, codec_api, events))
}

/// Same pixel-rate bitrate scaling the CPU encoder uses.
fn scaled_bitrate(w: u32, h: u32, settings: &EncodeSettings) -> u32 {
    let reference = 1920.0 * 1080.0 * 30.0;
    let px_rate = f64::from(w) * f64::from(h) * f64::from(settings.max_fps.clamp(1.0, 60.0));
    (f64::from(settings.bitrate_bps) * (px_rate / reference).max(0.25))
        .clamp(1_000_000.0, 20_000_000.0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::EncodePipeline;

    /// Manual end-to-end GPU benchmark against the REAL primary monitor and
    /// the machine's hardware encoder. Run with
    /// `cargo test -p fancy-screenshare --release -- --ignored --nocapture gpu`.
    #[test]
    #[ignore = "needs a display + hardware encoder; manual benchmark"]
    fn bench_gpu_pipeline_primary_monitor() {
        let monitors = xcap::Monitor::all().expect("monitors");
        let monitor = monitors.first().expect("at least one monitor");
        let id = monitor.id().expect("monitor id");
        let (mw, mh) = (monitor.width().unwrap_or(0), monitor.height().unwrap_or(0));

        // Encode at native size to measure the true 4K-class budget.
        let settings = EncodeSettings { max_dimension: 0, ..EncodeSettings::default() };
        let mut gpu = match GpuPipeline::new(id, &settings) {
            Ok(g) => g,
            Err(e) => panic!("GPU pipeline unavailable on this machine: {e}"),
        };
        println!("monitor {mw}x{mh} -> encoding at {:?}", gpu.output_dims());

        let start = Instant::now();
        let mut frames = 0u32;
        let mut keyframes = 0u32;
        let mut bytes = 0usize;
        let mut waited_out = 0u32;
        while start.elapsed() < Duration::from_secs(5) {
            match gpu.next_frame(Duration::from_millis(100), frames == 0) {
                Ok(Some(f)) => {
                    frames += 1;
                    keyframes += u32::from(f.keyframe);
                    bytes += f.data.len();
                }
                Ok(None) => waited_out += 1,
                Err(e) => panic!("gpu.next_frame failed after {frames} frames: {e}"),
            }
        }
        gpu.shutdown();
        let secs = start.elapsed().as_secs_f64();
        println!(
            "GPU pipeline: {frames} frames in {secs:.1}s = {:.1} fps ({keyframes} IDR, {:.2} Mbit/s, {waited_out} idle waits)",
            f64::from(frames) / secs,
            (bytes as f64 * 8.0) / secs / 1_000_000.0,
        );
        assert!(frames > 0, "no frames produced - is the desktop static?");
    }
}
