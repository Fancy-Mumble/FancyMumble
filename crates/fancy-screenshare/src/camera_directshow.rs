//! DirectShow webcam backend (Windows) - the capture path for *virtual*
//! cameras.
//!
//! nokhwa (the [`crate::camera::NativeCameraBackend`]) uses Media Foundation on
//! Windows, whose device enumeration only returns real, driver-backed cameras.
//! Software *virtual* cameras - OBS Virtual Camera above all - register solely
//! as DirectShow video-input devices and are therefore invisible to Media
//! Foundation. This backend enumerates and captures them through DirectShow so
//! they appear in the picker and can be shared like any other camera.
//!
//! Capture is a minimal DirectShow graph: `device source -> Sample Grabber ->
//! Null Renderer`, run **without a reference clock** (`SetSyncSource(NULL)`,
//! like every capture stack). With a clock, the Null Renderer schedules each
//! sample against its presentation timestamp - and a virtual camera stamping
//! from its own epoch then blocks the streaming thread indefinitely, freezing
//! the stream on the first frame. Clockless, samples flow at device rate.
//!
//! Frames are **pushed** into a shared slot by an `ISampleGrabberCB::BufferCB`
//! callback (one copy per sample, on the graph's streaming thread);
//! [`DirectShowSource::next_frame`] blocks on that slot's condvar for a NEW
//! sequence number, pacing the capture loop at the camera's fps exactly like
//! the nokhwa source. This also makes staleness *detectable*: no new sample
//! within the timeout is a genuine device stall reported as an error (the
//! pull-mode alternative, `GetCurrentBuffer`, happily re-serves the same stuck
//! sample forever).
//!
//! Pins are wired with **`ConnectDirect` only - never intelligent connect**
//! (`IGraphBuilder::Connect` / `ICaptureGraphBuilder2::RenderStream`).
//! Intelligent connect walks the registry's transform filters by merit and
//! *loads them into our process* to probe a conversion chain; any buggy
//! third-party codec someone's webcam suite registered a decade ago then
//! crashes the app (observed live: `lvcod64.dll`, the 2012 Logitech codec,
//! access-violates when probed to bridge OBS's NV12 to a forced RGB24 grabber
//! type). Instead the grabber accepts the camera's **native** format and the
//! pixel conversion to RGBA happens here in Rust (NV12 / YUY2 / UYVY / I420 /
//! YV12 / RGB24 / RGB32 / MJPG).
//!
//! Everything here is created and used on the broadcast's capture thread (or,
//! for a thumbnail, a command's blocking thread); COM objects never cross a
//! thread boundary, so the source needs no `Send` bound and manages its own
//! COM apartment for its lifetime.
#![allow(
    non_snake_case,
    non_upper_case_globals,
    reason = "mirrors the Win32/DirectShow C names (CLSID_*, IID_*) verbatim"
)]
#![allow(unsafe_code, reason = "FFI with DirectShow/COM; every unsafe block is a COM call")]

use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use image::RgbaImage;
use windows::core::{implement, interface, w, Interface, GUID, HRESULT, IUnknown, IUnknown_Vtbl};
use windows::Win32::Foundation::S_OK;
use windows::Win32::Media::DirectShow::{
    IBaseFilter, ICreateDevEnum, IGraphBuilder, IMediaControl, IMediaFilter, IPin, PINDIR_INPUT,
    PINDIR_OUTPUT, PIN_DIRECTION,
};
use windows::Win32::Media::MediaFoundation::{AM_MEDIA_TYPE, VIDEOINFOHEADER};
use windows::Win32::System::Com::StructuredStorage::IPropertyBag;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IEnumMoniker, IMoniker,
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::Variant::{VariantClear, VARIANT};

use crate::camera::{CameraBackend, FrameSource, DSHOW_ID_BASE};
use crate::sources::{CaptureSource, SourceKind};

// DirectShow class/interface GUIDs that the `windows` crate does not ship
// (they live in the legacy `strmiids`/`qedit` import libraries).
const CLSID_SystemDeviceEnum: GUID = GUID::from_u128(0x62BE5D10_60EB_11D0_BD3B_00A0C911CE86);
const CLSID_VideoInputDeviceCategory: GUID = GUID::from_u128(0x860BB310_5D01_11D0_BD3B_00A0C911CE86);
const CLSID_FilterGraph: GUID = GUID::from_u128(0xE436EBB3_524F_11CE_9F53_0020AF0BA770);
const CLSID_SampleGrabber: GUID = GUID::from_u128(0xC1F400A0_3F08_11D3_9F0B_006008039E37);
const CLSID_NullRenderer: GUID = GUID::from_u128(0xC1F400A4_3F08_11D3_9F0B_006008039E37);
const MEDIATYPE_Video: GUID = GUID::from_u128(0x73646976_0000_0010_8000_00AA00389B71);
const FORMAT_VideoInfo: GUID = GUID::from_u128(0x05589F80_C356_11CE_BF01_00AA0055595A);

// Uncompressed RGB subtypes (quartz-defined, not FOURCC-mapped).
const MEDIASUBTYPE_RGB24: GUID = GUID::from_u128(0xE436EB7D_524F_11CE_9F53_0020AF0BA770);
const MEDIASUBTYPE_RGB32: GUID = GUID::from_u128(0xE436EB7E_524F_11CE_9F53_0020AF0BA770);
const MEDIASUBTYPE_ARGB32: GUID = GUID::from_u128(0x773C9AC0_3274_11D0_B724_00AA006C1A01);

/// FOURCC-mapped subtype: `{FOURCC-0000-0010-8000-00AA00389B71}`.
const fn fourcc_subtype(fourcc: u32) -> GUID {
    GUID::from_u128(((fourcc as u128) << 96) | 0x0000_0010_8000_00AA_0038_9B71)
}
const MEDIASUBTYPE_NV12: GUID = fourcc_subtype(u32::from_le_bytes(*b"NV12"));
const MEDIASUBTYPE_YUY2: GUID = fourcc_subtype(u32::from_le_bytes(*b"YUY2"));
const MEDIASUBTYPE_UYVY: GUID = fourcc_subtype(u32::from_le_bytes(*b"UYVY"));
const MEDIASUBTYPE_I420: GUID = fourcc_subtype(u32::from_le_bytes(*b"I420"));
const MEDIASUBTYPE_IYUV: GUID = fourcc_subtype(u32::from_le_bytes(*b"IYUV"));
const MEDIASUBTYPE_YV12: GUID = fourcc_subtype(u32::from_le_bytes(*b"YV12"));
const MEDIASUBTYPE_MJPG: GUID = fourcc_subtype(u32::from_le_bytes(*b"MJPG"));

/// `ISampleGrabber` (from `qedit.h`) - absent from the `windows` crate, so it
/// is declared here as a raw COM interface. Method order MUST match the vtable
/// exactly (`SetOneShot`, `SetMediaType`, `GetConnectedMediaType`,
/// `SetBufferSamples`, `GetCurrentBuffer`, `GetCurrentSample`, `SetCallback`).
#[interface("6B652FFF-11FE-4fce-92AD-0266B5D7C78F")]
unsafe trait ISampleGrabber: IUnknown {
    unsafe fn SetOneShot(&self, one_shot: windows::core::BOOL) -> HRESULT;
    unsafe fn SetMediaType(&self, pmt: *const AM_MEDIA_TYPE) -> HRESULT;
    unsafe fn GetConnectedMediaType(&self, pmt: *mut AM_MEDIA_TYPE) -> HRESULT;
    unsafe fn SetBufferSamples(&self, buffer_them: windows::core::BOOL) -> HRESULT;
    unsafe fn GetCurrentBuffer(&self, psize: *mut i32, pbuffer: *mut core::ffi::c_void) -> HRESULT;
    unsafe fn GetCurrentSample(&self, ppsample: *mut *mut core::ffi::c_void) -> HRESULT;
    unsafe fn SetCallback(&self, pcallback: *mut core::ffi::c_void, which: i32) -> HRESULT;
}

/// `ISampleGrabberCB` (from `qedit.h`): the callback the Sample Grabber
/// invokes per sample on its streaming thread. `SetCallback(_, 1)` selects
/// `BufferCB` (buffer pointer + length; no `IMediaSample` handling needed).
#[interface("0579154A-2B53-4994-B0D0-E773148EFF85")]
unsafe trait ISampleGrabberCB: IUnknown {
    unsafe fn SampleCB(&self, sample_time: f64, psample: *mut core::ffi::c_void) -> HRESULT;
    unsafe fn BufferCB(&self, sample_time: f64, pbuffer: *mut u8, buffer_len: i32) -> HRESULT;
}

/// The latest camera sample, pushed by [`GrabberCallback`] (streaming thread)
/// and consumed by [`DirectShowSource::next_frame`] (capture thread). `seq`
/// distinguishes a NEW sample from a re-read - the heart of freeze detection.
#[derive(Default)]
struct FrameSlot {
    data: Vec<u8>,
    seq: u64,
}

struct SharedFrame {
    slot: Mutex<FrameSlot>,
    cond: Condvar,
}

fn lock_slot(shared: &SharedFrame) -> std::sync::MutexGuard<'_, FrameSlot> {
    shared.slot.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// COM object handed to `ISampleGrabber::SetCallback`; copies each sample into
/// the shared slot and wakes the consumer.
#[implement(ISampleGrabberCB)]
struct GrabberCallback {
    shared: Arc<SharedFrame>,
}

impl ISampleGrabberCB_Impl for GrabberCallback_Impl {
    unsafe fn SampleCB(&self, _sample_time: f64, _psample: *mut core::ffi::c_void) -> HRESULT {
        S_OK
    }

    unsafe fn BufferCB(&self, _sample_time: f64, pbuffer: *mut u8, buffer_len: i32) -> HRESULT {
        if !pbuffer.is_null() && buffer_len > 0 {
            // SAFETY: the grabber guarantees `pbuffer` holds `buffer_len` bytes
            // for the duration of this call.
            let bytes = unsafe { std::slice::from_raw_parts(pbuffer, buffer_len as usize) };
            let mut slot = lock_slot(&self.shared);
            slot.data.clear();
            slot.data.extend_from_slice(bytes);
            slot.seq += 1;
            drop(slot);
            self.shared.cond.notify_all();
        }
        S_OK
    }
}

/// The DirectShow camera backend: enumerates video-input devices and opens them
/// as [`DirectShowSource`]s. Its device ids live at and above [`DSHOW_ID_BASE`]
/// so they never collide with nokhwa's small numeric indices.
pub(crate) struct DirectShowBackend;

impl CameraBackend for DirectShowBackend {
    fn name(&self) -> &'static str {
        "directshow"
    }

    fn list(&self) -> Vec<CaptureSource> {
        let _com = ComScope::enter();
        // SAFETY: COM is initialised for this scope; monikers are used and
        // dropped before it ends.
        let names = unsafe { enumerate_device_names() };
        names
            .into_iter()
            .enumerate()
            .map(|(index, title)| CaptureSource {
                id: DSHOW_ID_BASE + index as u32,
                kind: SourceKind::Device,
                title,
                width: 0,
                height: 0,
            })
            .collect()
    }

    fn owns(&self, id: u32) -> bool {
        id >= DSHOW_ID_BASE
    }

    fn open(&self, id: u32) -> Result<Box<dyn FrameSource>, String> {
        let index = (id - DSHOW_ID_BASE) as usize;
        Ok(Box::new(DirectShowSource::open(index)?))
    }
}

/// RAII COM apartment for the current thread. Initialises COM on construction
/// (multithreaded) and uninitialises on drop, but only if *we* were the one to
/// initialise it - if the thread already had a (possibly single-threaded)
/// apartment, we leave it untouched.
struct ComScope {
    owned: bool,
}

impl ComScope {
    fn enter() -> Self {
        // S_OK / S_FALSE => we hold a ref to balance; RPC_E_CHANGED_MODE (the
        // thread is already an STA) => is_ok() is false and we touch nothing.
        let owned = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).is_ok() };
        Self { owned }
    }
}

impl Drop for ComScope {
    fn drop(&mut self) {
        if self.owned {
            unsafe { CoUninitialize() };
        }
    }
}

/// Enumerate DirectShow video-input devices as friendly names, in moniker
/// order. The position in this list is the device index used by
/// [`DirectShowBackend::open`] (mirroring how nokhwa indexes by position).
unsafe fn enumerate_device_names() -> Vec<String> {
    let mut names = Vec::new();
    let Ok(dev_enum) = (unsafe {
        CoCreateInstance::<_, ICreateDevEnum>(&CLSID_SystemDeviceEnum, None, CLSCTX_INPROC_SERVER)
    }) else {
        return names;
    };

    let mut moniker_enum: Option<IEnumMoniker> = None;
    // Returns S_FALSE (Ok, but a null enumerator) when the category is empty.
    if unsafe {
        dev_enum.CreateClassEnumerator(&CLSID_VideoInputDeviceCategory, &mut moniker_enum, 0)
    }
    .is_err()
    {
        return names;
    }
    let Some(moniker_enum) = moniker_enum else {
        return names;
    };

    loop {
        let mut fetched = 0u32;
        let mut monikers: [Option<IMoniker>; 1] = [None];
        let hr = unsafe { moniker_enum.Next(&mut monikers, Some(&mut fetched)) };
        if fetched == 0 || hr.is_err() {
            break;
        }
        let Some(moniker) = monikers[0].take() else {
            break;
        };
        names.push(unsafe { friendly_name(&moniker) }.unwrap_or_else(|| "Camera".to_owned()));
    }
    names
}

/// Read a device moniker's `FriendlyName` property.
unsafe fn friendly_name(moniker: &IMoniker) -> Option<String> {
    let bag: IPropertyBag = unsafe { moniker.BindToStorage(None, None) }.ok()?;
    let mut var = VARIANT::default();
    unsafe { bag.Read(w!("FriendlyName"), &mut var, None) }.ok()?;
    // FriendlyName is a BSTR (VT_BSTR); read it out before clearing the variant.
    let name = unsafe { var.Anonymous.Anonymous.Anonymous.bstrVal.to_string() };
    let _ = unsafe { VariantClear(&mut var) };
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// The pixel layout negotiated on the grabber's input pin, with everything a
/// converter needs. RGB DIBs honour the bottom-up flag; YUV layouts are
/// top-down by definition (MSDN: "For YUV bitmaps ... always top-down").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PixelLayout {
    /// Packed BGR, DWORD-aligned rows.
    Rgb24 { bottom_up: bool },
    /// Packed BGRX/BGRA, rows naturally DWORD-aligned.
    Rgb32 { bottom_up: bool },
    /// Planar Y then interleaved UV at half resolution.
    Nv12,
    /// Packed Y0 U Y1 V.
    Yuy2,
    /// Packed U Y0 V Y1.
    Uyvy,
    /// Planar Y, U, V (quarter-size chroma).
    I420,
    /// Planar Y, V, U (quarter-size chroma).
    Yv12,
    /// Motion-JPEG: each sample is one JPEG image.
    Mjpg,
}

impl PixelLayout {
    fn from_subtype(subtype: &GUID, bottom_up: bool) -> Option<Self> {
        match *subtype {
            s if s == MEDIASUBTYPE_RGB24 => Some(Self::Rgb24 { bottom_up }),
            s if s == MEDIASUBTYPE_RGB32 || s == MEDIASUBTYPE_ARGB32 => {
                Some(Self::Rgb32 { bottom_up })
            }
            s if s == MEDIASUBTYPE_NV12 => Some(Self::Nv12),
            s if s == MEDIASUBTYPE_YUY2 => Some(Self::Yuy2),
            s if s == MEDIASUBTYPE_UYVY => Some(Self::Uyvy),
            s if s == MEDIASUBTYPE_I420 || s == MEDIASUBTYPE_IYUV => Some(Self::I420),
            s if s == MEDIASUBTYPE_YV12 => Some(Self::Yv12),
            s if s == MEDIASUBTYPE_MJPG => Some(Self::Mjpg),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Rgb24 { .. } => "RGB24",
            Self::Rgb32 { .. } => "RGB32",
            Self::Nv12 => "NV12",
            Self::Yuy2 => "YUY2",
            Self::Uyvy => "UYVY",
            Self::I420 => "I420",
            Self::Yv12 => "YV12",
            Self::Mjpg => "MJPG",
        }
    }

    /// Minimum bytes one frame needs (0 = variable, e.g. MJPG).
    fn min_frame_len(self, w: u32, h: u32) -> usize {
        let (w, h) = (w as usize, h as usize);
        match self {
            Self::Rgb24 { .. } => ((w * 3 + 3) & !3) * h,
            Self::Rgb32 { .. } => w * 4 * h,
            Self::Nv12 | Self::I420 | Self::Yv12 => w * h + 2 * (w.div_ceil(2) * h.div_ceil(2)),
            Self::Yuy2 | Self::Uyvy => ((w * 2 + 3) & !3) * h,
            Self::Mjpg => 0,
        }
    }
}

/// A live DirectShow capture graph vending RGBA frames from one video-input
/// device via Sample Grabber callbacks.
struct DirectShowSource {
    width: u32,
    height: u32,
    layout: PixelLayout,
    /// Frames pushed by the grabber callback (graph streaming thread).
    shared: Arc<SharedFrame>,
    /// Sequence number of the last sample consumed.
    last_seq: u64,
    /// Reused staging buffer for the grabbed native-format frame.
    buf: Vec<u8>,
    grabber: ISampleGrabber,
    control: IMediaControl,
    // Kept alive for the graph's lifetime; dropped (released) before `_com`.
    _graph: IGraphBuilder,
    _com: ComScope,
}

impl DirectShowSource {
    fn open(index: usize) -> Result<Self, String> {
        let com = ComScope::enter();
        unsafe { Self::build(index, com) }
    }

    unsafe fn build(index: usize, com: ComScope) -> Result<Self, String> {
        // The device source filter for the requested index.
        let source = unsafe { source_filter(index) }?;

        let graph: IGraphBuilder = unsafe {
            CoCreateInstance(&CLSID_FilterGraph, None, CLSCTX_INPROC_SERVER)
        }
        .map_err(|e| format!("directshow FilterGraph: {e}"))?;
        unsafe { graph.AddFilter(&source, w!("Source")) }
            .map_err(|e| format!("directshow AddFilter(source): {e}"))?;

        // Sample Grabber in buffering mode. The media type constrains only the
        // MAJOR type: the grabber then accepts the camera's native subtype on a
        // direct connection and the pixel conversion happens in Rust. Forcing a
        // subtype here is what previously dragged intelligent connect (and with
        // it arbitrary registry codecs - lvcod64.dll) into the process.
        let grabber_filter: IBaseFilter = unsafe {
            CoCreateInstance(&CLSID_SampleGrabber, None, CLSCTX_INPROC_SERVER)
        }
        .map_err(|e| format!("directshow SampleGrabber: {e}"))?;
        let grabber: ISampleGrabber = grabber_filter
            .cast()
            .map_err(|e| format!("directshow ISampleGrabber: {e}"))?;
        // No owned COM/heap fields (pUnk/pbFormat stay null), so `want` needs no
        // FreeMediaType - a plain drop is correct.
        let want = AM_MEDIA_TYPE { majortype: MEDIATYPE_Video, ..Default::default() };
        unsafe { grabber.SetMediaType(&want) }
            .ok()
            .map_err(|e| format!("directshow SetMediaType: {e}"))?;
        unsafe { grabber.SetOneShot(false.into()) }
            .ok()
            .map_err(|e| format!("directshow SetOneShot: {e}"))?;
        // Frames arrive via BufferCB pushes into `shared`; the grabber's own
        // buffering (`SetBufferSamples`) would only add a second copy.
        let shared = Arc::new(SharedFrame { slot: Mutex::new(FrameSlot::default()), cond: Condvar::new() });
        let callback: ISampleGrabberCB = GrabberCallback { shared: Arc::clone(&shared) }.into();
        unsafe { grabber.SetCallback(callback.as_raw(), 1) }
            .ok()
            .map_err(|e| format!("directshow SetCallback: {e}"))?;
        unsafe { graph.AddFilter(&grabber_filter, w!("Grabber")) }
            .map_err(|e| format!("directshow AddFilter(grabber): {e}"))?;

        // Null Renderer: we consume frames via the grabber, not by rendering.
        let null_renderer: IBaseFilter = unsafe {
            CoCreateInstance(&CLSID_NullRenderer, None, CLSCTX_INPROC_SERVER)
        }
        .map_err(|e| format!("directshow NullRenderer: {e}"))?;
        unsafe { graph.AddFilter(&null_renderer, w!("NullRenderer")) }
            .map_err(|e| format!("directshow AddFilter(null): {e}"))?;

        // Wire source -> grabber -> null renderer with ConnectDirect ONLY (see
        // module docs: intelligent connect loads arbitrary third-party codecs
        // into the process, which is how this used to crash). The device's
        // capture pin is whichever output pin agrees to a direct connection.
        //
        // Two negotiation attempts per pin: first force each CONCRETE media
        // type the pin advertises that we can convert, best (nearest 720p)
        // first - deterministic resolution, and the only thing that works on
        // sources that bail out on the grabber's wildcard type instead of
        // proposing their own (DroidCam). Then fall back to letting the pins
        // agree on their own (sources whose enumeration is unusable but whose
        // own proposal works - OBS proposes its canvas format either way).
        let grabber_in = unsafe { pin_of(&grabber_filter, PINDIR_INPUT) }
            .ok_or("directshow: grabber has no input pin")?;
        let mut connected = false;
        let mut attempts: Vec<String> = Vec::new();
        for (pi, src_pin) in unsafe { pins_of(&source, PINDIR_OUTPUT) }.iter().enumerate() {
            if unsafe { connect_pin_to_grabber(&graph, src_pin, &grabber_in, pi, &mut attempts) } {
                connected = true;
                break;
            }
        }
        if !connected {
            attempts.dedup();
            attempts.truncate(6);
            return Err(format!(
                "directshow: no direct source->grabber connection ({})",
                attempts.join("; "),
            ));
        }
        let grabber_out = unsafe { pin_of(&grabber_filter, PINDIR_OUTPUT) }
            .ok_or("directshow: grabber has no output pin")?;
        let null_in = unsafe { pin_of(&null_renderer, PINDIR_INPUT) }
            .ok_or("directshow: null renderer has no input pin")?;
        unsafe { graph.ConnectDirect(&grabber_out, &null_in, None) }
            .map_err(|e| format!("directshow grabber->null connect: {e}"))?;

        // The negotiated format tells us dimensions and pixel layout.
        let (width, height, layout) = unsafe { negotiated_format(&grabber) }?;
        if width == 0 || height == 0 {
            return Err("directshow: device reported a zero-sized frame".to_owned());
        }

        // Run the graph WITHOUT a reference clock. With one, the Null Renderer
        // schedules each sample against its presentation timestamp; a virtual
        // camera stamping from its own epoch then wedges the streaming thread
        // on sample #2 - the "first frame, then frozen" failure. Clockless
        // graphs render (here: discard) samples on arrival.
        let media_filter: IMediaFilter =
            graph.cast().map_err(|e| format!("directshow IMediaFilter: {e}"))?;
        unsafe { media_filter.SetSyncSource(None) }
            .map_err(|e| format!("directshow SetSyncSource(none): {e}"))?;

        let control: IMediaControl =
            graph.cast().map_err(|e| format!("directshow IMediaControl: {e}"))?;
        unsafe { control.Run() }.map_err(|e| format!("directshow Run: {e}"))?;

        tracing::info!(
            width,
            height,
            format = layout.name(),
            "screenshare: DirectShow camera capture active",
        );
        Ok(Self {
            width,
            height,
            layout,
            shared,
            last_seq: 0,
            buf: Vec::new(),
            grabber,
            control,
            _graph: graph,
            _com: com,
        })
    }

    /// Convert the staged native-format frame (`self.buf[..len]`) into RGBA.
    fn convert(&self, len: usize) -> Result<RgbaImage, String> {
        let (w, h) = (self.width, self.height);
        let buf = &self.buf[..len];
        match self.layout {
            PixelLayout::Rgb24 { bottom_up } => Ok(convert_rgb(buf, w, h, 3, bottom_up)),
            PixelLayout::Rgb32 { bottom_up } => Ok(convert_rgb(buf, w, h, 4, bottom_up)),
            PixelLayout::Nv12 => Ok(convert_nv12(buf, w, h)),
            PixelLayout::Yuy2 => Ok(convert_packed_422(buf, w, h, /*y_first=*/ true)),
            PixelLayout::Uyvy => Ok(convert_packed_422(buf, w, h, /*y_first=*/ false)),
            PixelLayout::I420 => Ok(convert_planar_420(buf, w, h, /*u_first=*/ true)),
            PixelLayout::Yv12 => Ok(convert_planar_420(buf, w, h, /*u_first=*/ false)),
            PixelLayout::Mjpg => image::load_from_memory_with_format(buf, image::ImageFormat::Jpeg)
                .map(|img| img.to_rgba8())
                .map_err(|e| format!("directshow MJPG decode: {e}")),
        }
    }
}

impl FrameSource for DirectShowSource {
    fn next_frame(&mut self) -> Result<RgbaImage, String> {
        // Block until the callback pushes a sample NEWER than the last one
        // consumed - this paces the caller at the camera's real fps. A timeout
        // means the device genuinely stalled (or its first frame is very slow);
        // the pipeline reopens/fails on repeated errors. The generous budget
        // also covers real cameras' slow exposure spin-up on the first frame.
        const NEW_FRAME_TIMEOUT: Duration = Duration::from_millis(3000);
        let deadline = Instant::now() + NEW_FRAME_TIMEOUT;
        let mut slot = lock_slot(&self.shared);
        while slot.seq == self.last_seq {
            let now = Instant::now();
            if now >= deadline {
                return Err("directshow: no new frame from device".to_owned());
            }
            let (guard, _timeout) = self
                .shared
                .cond
                .wait_timeout(slot, deadline - now)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            slot = guard;
        }
        self.last_seq = slot.seq;
        self.buf.clear();
        self.buf.extend_from_slice(&slot.data);
        drop(slot);

        let len = self.buf.len();
        if len < self.layout.min_frame_len(self.width, self.height) {
            return Err("directshow: short frame buffer".to_owned());
        }
        self.convert(len)
    }

    fn describe(&self) -> String {
        format!("{}x{} {} (DirectShow)", self.width, self.height, self.layout.name())
    }
}

impl Drop for DirectShowSource {
    fn drop(&mut self) {
        // Stop streaming, then detach the callback so the grabber drops its
        // reference to our COM object, before filters (and then COM) release.
        let _ = unsafe { self.control.Stop() };
        let _ = unsafe { self.grabber.SetCallback(std::ptr::null_mut(), 1) };
    }
}

/// Owned `AM_MEDIA_TYPE` as returned by `IEnumMediaTypes` (task-allocated).
/// Frees the format block and the struct itself on drop (`DeleteMediaType`).
struct OwnedMediaType(*mut AM_MEDIA_TYPE);

impl Drop for OwnedMediaType {
    fn drop(&mut self) {
        if self.0.is_null() {
            return;
        }
        unsafe {
            let mt = &mut *self.0;
            if !mt.pbFormat.is_null() {
                CoTaskMemFree(Some(mt.pbFormat as *const core::ffi::c_void));
                mt.pbFormat = std::ptr::null_mut();
            }
            // Release a pUnk if the source set one (rare; usually null).
            drop(core::mem::ManuallyDrop::take(&mut mt.pUnk));
            CoTaskMemFree(Some(self.0 as *const core::ffi::c_void));
        }
    }
}

/// The concrete media types `pin` advertises that our converters support
/// (video major type, `VIDEOINFOHEADER` format block, known subtype), for
/// forcing an explicit direct connection. Sorted by closeness to 720p - the
/// same sweet spot the nokhwa backend requests: cameras advertising a whole
/// mode zoo would otherwise get their FIRST mode forced, which is often the
/// largest (a 4K camera frame costs 9x the 720p convert+encode budget).
unsafe fn supported_pin_types(pin: &IPin) -> Vec<OwnedMediaType> {
    let mut out = Vec::new();
    let Ok(types) = (unsafe { pin.EnumMediaTypes() }) else {
        return out;
    };
    loop {
        let mut fetched = 0u32;
        let mut arr: [*mut AM_MEDIA_TYPE; 1] = [std::ptr::null_mut()];
        let hr = unsafe { types.Next(&mut arr, Some(&mut fetched)) };
        if fetched == 0 || hr.is_err() || arr[0].is_null() {
            break;
        }
        let owned = OwnedMediaType(arr[0]);
        let mt = unsafe { &*owned.0 };
        if mt.majortype == MEDIATYPE_Video
            && mt.formattype == FORMAT_VideoInfo
            && (mt.cbFormat as usize) >= size_of::<VIDEOINFOHEADER>()
            && PixelLayout::from_subtype(&mt.subtype, false).is_some()
        {
            out.push(owned);
        }
    }
    out.sort_by_key(|owned| {
        // SAFETY: filtered above to VIH blocks of sufficient size.
        let vih = unsafe { &*((*owned.0).pbFormat as *const VIDEOINFOHEADER) };
        let px = i64::from(vih.bmiHeader.biWidth.unsigned_abs())
            * i64::from(vih.bmiHeader.biHeight.unsigned_abs());
        (px - 1280 * 720).abs()
    });
    out
}

/// Directly connect one source output pin to the grabber input: first each
/// supported concrete media type the pin advertises (best-first), then the
/// wildcard. Records every failure in `attempts`; returns true on success.
/// Extracted from `build` to keep that graph-wiring flow readable.
unsafe fn connect_pin_to_grabber(
    graph: &IGraphBuilder,
    src_pin: &IPin,
    grabber_in: &IPin,
    pi: usize,
    attempts: &mut Vec<String>,
) -> bool {
    for mt in unsafe { supported_pin_types(src_pin) } {
        match unsafe { graph.ConnectDirect(src_pin, grabber_in, Some(mt.0)) } {
            Ok(()) => return true,
            Err(e) => {
                let st = unsafe { (*mt.0).subtype };
                let fourcc = String::from_utf8_lossy(&st.data1.to_le_bytes()).into_owned();
                attempts.push(format!("pin{pi} {fourcc}: {e}"));
            }
        }
    }
    match unsafe { graph.ConnectDirect(src_pin, grabber_in, None) } {
        Ok(()) => true,
        Err(e) => {
            attempts.push(format!("pin{pi} wildcard: {e}"));
            false
        }
    }
}

/// All pins of `filter` with the given direction.
unsafe fn pins_of(filter: &IBaseFilter, dir: PIN_DIRECTION) -> Vec<IPin> {
    let mut out = Vec::new();
    let Ok(pins) = (unsafe { filter.EnumPins() }) else {
        return out;
    };
    loop {
        let mut fetched = 0u32;
        let mut arr: [Option<IPin>; 1] = [None];
        let hr = unsafe { pins.Next(&mut arr, Some(&mut fetched)) };
        if fetched == 0 || hr.is_err() {
            break;
        }
        let Some(pin) = arr[0].take() else { break };
        if unsafe { pin.QueryDirection() } == Ok(dir) {
            out.push(pin);
        }
    }
    out
}

/// First pin of `filter` with the given direction.
unsafe fn pin_of(filter: &IBaseFilter, dir: PIN_DIRECTION) -> Option<IPin> {
    unsafe { pins_of(filter, dir) }.into_iter().next()
}

/// Bind the video-input device at `index` (moniker order) to an `IBaseFilter`.
unsafe fn source_filter(index: usize) -> Result<IBaseFilter, String> {
    let dev_enum: ICreateDevEnum = unsafe {
        CoCreateInstance(&CLSID_SystemDeviceEnum, None, CLSCTX_INPROC_SERVER)
    }
    .map_err(|e| format!("directshow SystemDeviceEnum: {e}"))?;

    let mut moniker_enum: Option<IEnumMoniker> = None;
    unsafe { dev_enum.CreateClassEnumerator(&CLSID_VideoInputDeviceCategory, &mut moniker_enum, 0) }
        .map_err(|e| format!("directshow CreateClassEnumerator: {e}"))?;
    let moniker_enum = moniker_enum.ok_or_else(|| "directshow: no video devices".to_owned())?;

    let mut pos = 0usize;
    loop {
        let mut fetched = 0u32;
        let mut monikers: [Option<IMoniker>; 1] = [None];
        let hr = unsafe { moniker_enum.Next(&mut monikers, Some(&mut fetched)) };
        if fetched == 0 || hr.is_err() {
            break;
        }
        let Some(moniker) = monikers[0].take() else {
            break;
        };
        if pos == index {
            return unsafe { moniker.BindToObject(None, None) }
                .map_err(|e| format!("directshow BindToObject: {e}"));
        }
        pos += 1;
    }
    Err(format!("directshow: camera index {index} not found"))
}

/// Read the frame dimensions and pixel layout from the grabber's connected
/// media type (a `VIDEOINFOHEADER`).
unsafe fn negotiated_format(grabber: &ISampleGrabber) -> Result<(u32, u32, PixelLayout), String> {
    let mut mt = AM_MEDIA_TYPE::default();
    unsafe { grabber.GetConnectedMediaType(&mut mt) }
        .ok()
        .map_err(|e| format!("directshow GetConnectedMediaType: {e}"))?;

    let result = if mt.pbFormat.is_null()
        || (mt.cbFormat as usize) < size_of::<VIDEOINFOHEADER>()
    {
        Err("directshow: missing VIDEOINFOHEADER".to_owned())
    } else {
        // SAFETY: pbFormat points to a VIDEOINFOHEADER (the Sample Grabber only
        // accepts FORMAT_VideoInfo connections) of at least cbFormat bytes.
        let vih = unsafe { &*(mt.pbFormat as *const VIDEOINFOHEADER) };
        let width = vih.bmiHeader.biWidth.unsigned_abs();
        let height = vih.bmiHeader.biHeight.unsigned_abs();
        let bottom_up = vih.bmiHeader.biHeight > 0;
        match PixelLayout::from_subtype(&mt.subtype, bottom_up) {
            Some(layout) => Ok((width, height, layout)),
            None => Err(format!(
                "directshow: unsupported camera format (subtype {:?})",
                mt.subtype
            )),
        }
    };

    // Free the format block allocated by GetConnectedMediaType.
    if !mt.pbFormat.is_null() {
        unsafe { CoTaskMemFree(Some(mt.pbFormat as *const core::ffi::c_void)) };
    }
    result
}

/// BT.601 limited-range chroma terms shared by a 2x1 pixel pair (4:2:0/4:2:2
/// horizontal subsampling): precomputed once, applied to both lumas.
#[inline(always)]
fn chroma_terms(u: u8, v: u8) -> (i32, i32, i32) {
    let d = i32::from(u) - 128;
    let e = i32::from(v) - 128;
    (409 * e, -100 * d - 208 * e, 516 * d)
}

/// One BT.601 limited-range pixel into a 4-byte RGBA slot.
#[inline(always)]
fn write_yuv_px(dst: &mut [u8], y: u8, rc: i32, gc: i32, bc: i32) {
    let c = 298 * (i32::from(y) - 16) + 128;
    dst[0] = ((c + rc) >> 8).clamp(0, 255) as u8;
    dst[1] = ((c + gc) >> 8).clamp(0, 255) as u8;
    dst[2] = ((c + bc) >> 8).clamp(0, 255) as u8;
    dst[3] = 255;
}

/// Run `convert_row(src_row_index, dst_row)` over all `h` output rows, split
/// into even-aligned row bands across cores for large frames. Row-band
/// parallelism mirrors `encode.rs`'s I420 conversion; even band starts keep
/// 4:2:0/4:2:2 chroma row addressing (`row / 2`) local to a band.
fn convert_rows_parallel(
    w: usize,
    h: usize,
    convert_row: impl Fn(usize, &mut [u8]) + Sync,
) -> RgbaImage {
    let mut out = vec![0u8; w * h * 4];
    // Threads only pay off on big frames; ~half a megapixel is where the
    // per-frame spawn/join overhead stops mattering.
    let bands = if w * h < 512 * 1024 {
        1
    } else {
        std::thread::available_parallelism().map(std::num::NonZero::get).unwrap_or(4).clamp(1, 8)
    };
    let rows_per_band = (h / bands).max(2) & !1;
    if bands == 1 || rows_per_band >= h {
        for (row, dst) in out.chunks_mut(w * 4).enumerate() {
            convert_row(row, dst);
        }
    } else {
        std::thread::scope(|scope| {
            for (band, chunk) in out.chunks_mut(rows_per_band * w * 4).enumerate() {
                let convert_row = &convert_row;
                // Threads join at scope exit; the handle itself is unused.
                let _job = scope.spawn(move || convert_band(chunk, w, band * rows_per_band, convert_row));
            }
        });
    }
    RgbaImage::from_raw(w as u32, h as u32, out)
        .unwrap_or_else(|| RgbaImage::new(w as u32, h as u32))
}

/// Convert one horizontal band of `dst_rows` (each `w` RGBA pixels), starting
/// at output row `first_row`, via `convert_row`. Split out of the parallel
/// scope so the spawned closure stays a single call.
fn convert_band(chunk: &mut [u8], w: usize, first_row: usize, convert_row: &(impl Fn(usize, &mut [u8]) + Sync)) {
    for (i, dst) in chunk.chunks_mut(w * 4).enumerate() {
        convert_row(first_row + i, dst);
    }
}

/// Packed BGR(X) DIB -> RGBA. `bpp` is 3 (RGB24) or 4 (RGB32); RGB24 rows are
/// DWORD-aligned, RGB32 rows naturally are. Bottom-up DIBs are flipped.
fn convert_rgb(buf: &[u8], w: u32, h: u32, bpp: usize, bottom_up: bool) -> RgbaImage {
    let (wu, hu) = (w as usize, h as usize);
    let stride = (wu * bpp + 3) & !3;
    convert_rows_parallel(wu, hu, |row, dst| {
        let src_y = if bottom_up { hu - 1 - row } else { row };
        let src = &buf[src_y * stride..src_y * stride + wu * bpp];
        for (s, d) in src.chunks_exact(bpp).zip(dst.chunks_exact_mut(4)) {
            // DIB pixel order is BGR(X).
            d[0] = s[2];
            d[1] = s[1];
            d[2] = s[0];
            d[3] = 255;
        }
    })
}

/// NV12 (planar Y + interleaved UV at half resolution) -> RGBA.
fn convert_nv12(buf: &[u8], w: u32, h: u32) -> RgbaImage {
    let (wu, hu) = (w as usize, h as usize);
    let y_plane = &buf[..wu * hu];
    let uv_plane = &buf[wu * hu..];
    convert_rows_parallel(wu, hu, |row, dst| {
        let y_row = &y_plane[row * wu..row * wu + wu];
        let uv_row = &uv_plane[(row / 2) * wu..];
        for x2 in 0..wu / 2 {
            let (rc, gc, bc) = chroma_terms(uv_row[x2 * 2], uv_row[x2 * 2 + 1]);
            write_yuv_px(&mut dst[x2 * 8..x2 * 8 + 4], y_row[x2 * 2], rc, gc, bc);
            write_yuv_px(&mut dst[x2 * 8 + 4..x2 * 8 + 8], y_row[x2 * 2 + 1], rc, gc, bc);
        }
        if wu % 2 == 1 {
            let (rc, gc, bc) = chroma_terms(uv_row[wu - 1], uv_row[wu]);
            write_yuv_px(&mut dst[(wu - 1) * 4..], y_row[wu - 1], rc, gc, bc);
        }
    })
}

/// Packed 4:2:2 (YUY2: `Y0 U Y1 V`; UYVY: `U Y0 V Y1`) -> RGBA.
fn convert_packed_422(buf: &[u8], w: u32, h: u32, y_first: bool) -> RgbaImage {
    let (wu, hu) = (w as usize, h as usize);
    let stride = (wu * 2 + 3) & !3;
    let (y_off, u_off, v_off) = if y_first { (0, 1, 3) } else { (1, 0, 2) };
    convert_rows_parallel(wu, hu, |row, dst| {
        let src = &buf[row * stride..];
        for x2 in 0..wu / 2 {
            let q = &src[x2 * 4..x2 * 4 + 4];
            let (rc, gc, bc) = chroma_terms(q[u_off], q[v_off]);
            write_yuv_px(&mut dst[x2 * 8..x2 * 8 + 4], q[y_off], rc, gc, bc);
            write_yuv_px(&mut dst[x2 * 8 + 4..x2 * 8 + 8], q[y_off + 2], rc, gc, bc);
        }
        if wu % 2 == 1 {
            let q = &src[(wu / 2) * 4..];
            let (rc, gc, bc) = chroma_terms(q[u_off], q[v_off]);
            write_yuv_px(&mut dst[(wu - 1) * 4..], q[y_off], rc, gc, bc);
        }
    })
}

/// Planar 4:2:0 (I420: Y,U,V; YV12: Y,V,U) -> RGBA.
fn convert_planar_420(buf: &[u8], w: u32, h: u32, u_first: bool) -> RgbaImage {
    let (wu, hu) = (w as usize, h as usize);
    let (cw, ch) = (wu.div_ceil(2), hu.div_ceil(2));
    let y_plane = &buf[..wu * hu];
    let (a, b) = (&buf[wu * hu..wu * hu + cw * ch], &buf[wu * hu + cw * ch..]);
    let (u_plane, v_plane) = if u_first { (a, b) } else { (b, a) };
    convert_rows_parallel(wu, hu, |row, dst| {
        let y_row = &y_plane[row * wu..row * wu + wu];
        let u_row = &u_plane[(row / 2) * cw..];
        let v_row = &v_plane[(row / 2) * cw..];
        for x2 in 0..wu.div_ceil(2) {
            let (rc, gc, bc) = chroma_terms(u_row[x2], v_row[x2]);
            write_yuv_px(&mut dst[x2 * 8..x2 * 8 + 4], y_row[x2 * 2], rc, gc, bc);
            if x2 * 2 + 1 < wu {
                write_yuv_px(&mut dst[x2 * 8 + 4..x2 * 8 + 8], y_row[x2 * 2 + 1], rc, gc, bc);
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The FOURCC->GUID mapping must produce the canonical registered GUIDs.
    #[test]
    fn fourcc_guids_match_canonical_values() {
        assert_eq!(MEDIASUBTYPE_NV12, GUID::from_u128(0x3231564E_0000_0010_8000_00AA00389B71));
        assert_eq!(MEDIASUBTYPE_YUY2, GUID::from_u128(0x32595559_0000_0010_8000_00AA00389B71));
        assert_eq!(MEDIASUBTYPE_MJPG, GUID::from_u128(0x47504A4D_0000_0010_8000_00AA00389B71));
    }

    /// Grey NV12 (Y=128, U=V=128) must convert to mid-grey RGBA.
    #[test]
    fn nv12_grey_roundtrip() {
        let (w, h) = (4u32, 2u32);
        let buf = vec![128u8; (w * h + w * h / 2) as usize];
        let img = convert_nv12(&buf, w, h);
        let px = img.get_pixel(1, 1).0;
        assert!(px[0] == px[1] && px[1] == px[2], "grey in, grey out: {px:?}");
        assert!((px[0] as i32 - 130).abs() <= 2, "Y=128 is ~130 sRGB: {px:?}");
    }

    /// White YUY2 (Y=235, U=V=128) must clamp-convert to near-white.
    #[test]
    fn yuy2_white_roundtrip() {
        let (w, h) = (2u32, 1u32);
        let buf = vec![235, 128, 235, 128];
        let img = convert_packed_422(&buf, w, h, true);
        let px = img.get_pixel(0, 0).0;
        assert!(px[0] >= 253 && px[1] >= 253 && px[2] >= 253, "white: {px:?}");
    }

    /// Bottom-up RGB24: the DIB's FIRST row must land at the image's BOTTOM.
    #[test]
    fn rgb24_bottom_up_flips() {
        let (w, h) = (1u32, 2u32);
        // Row 0 (stored first, bottom of picture) = blue; row 1 = red. BGR order,
        // 1px rows padded to 4 bytes.
        let buf = vec![255, 0, 0, 0, /* row 1 */ 0, 0, 255, 0];
        let img = convert_rgb(&buf, w, h, 3, true);
        assert_eq!(img.get_pixel(0, 1).0, [0, 0, 255, 255], "bottom = stored row 0 (blue)");
        assert_eq!(img.get_pixel(0, 0).0, [255, 0, 0, 255], "top = stored row 1 (red)");
    }
}
