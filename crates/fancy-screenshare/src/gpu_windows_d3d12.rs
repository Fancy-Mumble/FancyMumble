//! D3D12-native GPU screen-share pipeline (Windows) - capture + convert.
//!
//! ```text
//! WGC ──(D3D11On12 layer)──► BGRA ID3D12Resource ──► D3D12 VideoProcess ──► NV12
//!                                                          │
//!                             [Stage B] ID3D12VideoEncoder ◄┘  (H.264, Win11)
//! ```
//!
//! The device that owns every resource is a genuine `ID3D12Device`. The only
//! D3D11 in sight is the thin `D3D11On12` layer that Windows.Graphics.Capture
//! requires - its public API still has no D3D12 frame pool in 2026, and this
//! is the same shim Chromium uses. Captured frames are copied once on the
//! GPU into a wrapped D3D12 texture and never touch the CPU; scaling and
//! BGRA→NV12 conversion run on the D3D12 video-process queue.
//!
//! Encoding (`ID3D12VideoEncoder`, the Windows 11 API Chrome/Edge are
//! rolling out) is Stage B on this seam: until it lands, the constructor
//! reports unsupported and the selector falls through to the proven
//! D3D11/MediaFoundation tier, then CPU. The H.264 SPS/PPS writer Stage B
//! needs is already here (and unit-tested) - the D3D12 encoder emits slice
//! NALs only, parameter sets are the application's job.
#![allow(unsafe_code, reason = "FFI with D3D12/D3D11On12/WGC; every unsafe block is a COM call")]
// The D3D12 capture+encode front is staged (Stage B mounts it once the encoder
// lands); several helpers are wired up but not yet called from a live path.
#![allow(dead_code, reason = "staged D3D12 pipeline; called once Stage B mounts the encoder")]

use std::time::Duration;

use windows::core::Interface;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Graphics::Direct3D::D3D_FEATURE_LEVEL_11_0;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
};
use windows::Win32::Graphics::Direct3D11on12::{
    D3D11On12CreateDevice, ID3D11On12Device, D3D11_RESOURCE_FLAGS,
};
use windows::Win32::Graphics::Direct3D12::{
    D3D12CreateDevice, ID3D12CommandAllocator, ID3D12CommandQueue, ID3D12Device, ID3D12Fence,
    ID3D12Resource, D3D12_COMMAND_LIST_TYPE_DIRECT, D3D12_COMMAND_QUEUE_DESC,
    D3D12_FENCE_FLAG_NONE, D3D12_HEAP_FLAG_NONE, D3D12_HEAP_PROPERTIES, D3D12_HEAP_TYPE_DEFAULT,
    D3D12_RESOURCE_BARRIER, D3D12_RESOURCE_BARRIER_0, D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES,
    D3D12_RESOURCE_BARRIER_FLAG_NONE, D3D12_RESOURCE_BARRIER_TYPE_TRANSITION,
    D3D12_RESOURCE_DESC, D3D12_RESOURCE_DIMENSION_TEXTURE2D, D3D12_RESOURCE_FLAG_NONE,
    D3D12_RESOURCE_STATES, D3D12_RESOURCE_STATE_COMMON, D3D12_RESOURCE_STATE_COPY_DEST,
    D3D12_RESOURCE_TRANSITION_BARRIER, D3D12_TEXTURE_LAYOUT_UNKNOWN,
    D3D12_COMMAND_LIST_TYPE_VIDEO_PROCESS, D3D12_RESOURCE_STATE_VIDEO_PROCESS_READ,
    D3D12_RESOURCE_STATE_VIDEO_PROCESS_WRITE,
};
// windows-rs generates the d3d12video.h API surface into the MediaFoundation
// module, not Direct3D12.
use windows::Win32::Media::MediaFoundation::{
    ID3D12VideoDevice, ID3D12VideoProcessCommandList, ID3D12VideoProcessor,
    D3D12_VIDEO_FIELD_TYPE_NONE,
    D3D12_VIDEO_FRAME_STEREO_FORMAT_NONE, D3D12_VIDEO_PROCESS_ALPHA_FILL_MODE_OPAQUE,
    D3D12_VIDEO_PROCESS_FILTER_FLAG_NONE, D3D12_VIDEO_PROCESS_INPUT_STREAM,
    D3D12_VIDEO_PROCESS_INPUT_STREAM_ARGUMENTS, D3D12_VIDEO_PROCESS_INPUT_STREAM_DESC,
    D3D12_VIDEO_PROCESS_INPUT_STREAM_RATE, D3D12_VIDEO_PROCESS_OUTPUT_STREAM,
    D3D12_VIDEO_PROCESS_OUTPUT_STREAM_ARGUMENTS, D3D12_VIDEO_PROCESS_OUTPUT_STREAM_DESC,
    D3D12_VIDEO_SIZE_RANGE,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject, INFINITE};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::Graphics::Dxgi::Common::DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709;
use windows::Win32::Graphics::Dxgi::Common::DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709;

use crate::encode::EncodeSettings;

/// The D3D12 capture + convert front half. Owns the device, the 11On12
/// capture shim and the video-process stage; Stage B mounts the encoder on
/// the NV12 output.
#[allow(dead_code, reason = "constructed by the Stage-B encoder and the hardware bench")]
pub(crate) struct GpuFrontD3D12 {
    device: ID3D12Device,
    // -- 11On12 capture shim -------------------------------------------------
    d3d11_device: ID3D11Device,
    d3d11_context: ID3D11DeviceContext,
    frame_pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    /// Our BGRA staging texture: a real D3D12 resource, wrapped for D3D11 so
    /// the capture frame can be copied into it by the 11On12 context.
    staging12: ID3D12Resource,
    staging11: ID3D11Texture2D,
    on12: ID3D11On12Device,
    // -- D3D12 video processing ---------------------------------------------
    video_queue: ID3D12CommandQueue,
    video_alloc: ID3D12CommandAllocator,
    video_list: ID3D12VideoProcessCommandList,
    processor: ID3D12VideoProcessor,
    nv12: ID3D12Resource,
    nv12_state: D3D12_RESOURCE_STATES,
    fence: ID3D12Fence,
    fence_value: u64,
    fence_event: windows::Win32::Foundation::HANDLE,
    in_width: u32,
    in_height: u32,
    out_width: u32,
    out_height: u32,
}

impl std::fmt::Debug for GpuFrontD3D12 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GpuFrontD3D12")
            .field("in", &(self.in_width, self.in_height))
            .field("out", &(self.out_width, self.out_height))
            .finish_non_exhaustive()
    }
}

/// Enable the D3D12 debug layer when `FANCY_D3D12_DEBUG=1`. It routes D3D12's
/// otherwise-cryptic `0x8000FFFF`-at-Close mistakes into readable messages.
fn enable_debug_layer_if_requested() {
    if std::env::var_os("FANCY_D3D12_DEBUG").is_none() {
        return;
    }
    let mut dbg: Option<windows::Win32::Graphics::Direct3D12::ID3D12Debug> = None;
    if unsafe { windows::Win32::Graphics::Direct3D12::D3D12GetDebugInterface(&mut dbg) }.is_ok() {
        if let Some(d) = dbg {
            unsafe { d.EnableDebugLayer() };
        }
    }
}

/// Create the D3D12 device, its video device, and the `DIRECT` (11On12/WGC)
/// and `VIDEO_PROCESS` command queues. Video-process support is queried
/// implicitly: creating the video device/processor fails cleanly where
/// unsupported.
fn create_d3d12_devices(
) -> Result<(ID3D12Device, ID3D12VideoDevice, ID3D12CommandQueue, ID3D12CommandQueue), String> {
    let mut device: Option<ID3D12Device> = None;
    unsafe { D3D12CreateDevice(None, D3D_FEATURE_LEVEL_11_0, &mut device) }
        .map_err(|e| format!("D3D12CreateDevice: {e}"))?;
    let device = device.ok_or("no D3D12 device")?;
    let video_device: ID3D12VideoDevice =
        device.cast().map_err(|e| format!("ID3D12VideoDevice: {e}"))?;
    let direct_queue: ID3D12CommandQueue = unsafe {
        device.CreateCommandQueue(&D3D12_COMMAND_QUEUE_DESC {
            Type: D3D12_COMMAND_LIST_TYPE_DIRECT,
            ..Default::default()
        })
    }
    .map_err(|e| format!("direct queue: {e}"))?;
    let video_queue: ID3D12CommandQueue = unsafe {
        device.CreateCommandQueue(&D3D12_COMMAND_QUEUE_DESC {
            Type: D3D12_COMMAND_LIST_TYPE_VIDEO_PROCESS,
            ..Default::default()
        })
    }
    .map_err(|e| format!("video-process queue: {e}"))?;
    Ok((device, video_device, direct_queue, video_queue))
}

/// The `D3D11On12` interop layer + `Windows.Graphics.Capture` session that
/// feed the pipeline BGRA frames of the monitor.
struct CaptureShim {
    d3d11_device: ID3D11Device,
    d3d11_context: ID3D11DeviceContext,
    on12: ID3D11On12Device,
    frame_pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    in_width: u32,
    in_height: u32,
}

/// Build the 11On12 layer (over `direct_queue`) and start a free-threaded WGC
/// capture session for `monitor_id`.
fn create_capture_shim(
    device: &ID3D12Device,
    direct_queue: &ID3D12CommandQueue,
    monitor_id: u32,
) -> Result<CaptureShim, String> {
    let mut d3d11_device: Option<ID3D11Device> = None;
    let mut d3d11_context: Option<ID3D11DeviceContext> = None;
    let direct_queue_unk: windows::core::IUnknown =
        direct_queue.cast().map_err(|e| format!("direct queue IUnknown: {e}"))?;
    let queues: [Option<windows::core::IUnknown>; 1] = [Some(direct_queue_unk)];
    unsafe {
        D3D11On12CreateDevice(
            device,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT.0,
            None,
            Some(&queues),
            0,
            Some(&mut d3d11_device),
            Some(&mut d3d11_context),
            None,
        )
    }
    .map_err(|e| format!("D3D11On12CreateDevice: {e}"))?;
    let d3d11_device = d3d11_device.ok_or("no 11On12 device")?;
    let d3d11_context = d3d11_context.ok_or("no 11On12 context")?;
    let on12: ID3D11On12Device =
        d3d11_device.cast().map_err(|e| format!("ID3D11On12Device: {e}"))?;

    let dxgi: IDXGIDevice = d3d11_device.cast().map_err(|e| format!("IDXGIDevice: {e}"))?;
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
    let session =
        frame_pool.CreateCaptureSession(&item).map_err(|e| format!("capture session: {e}"))?;
    crate::gpu_windows::disable_capture_border(&session);
    session.StartCapture().map_err(|e| format!("StartCapture: {e}"))?;

    Ok(CaptureShim { d3d11_device, d3d11_context, on12, frame_pool, session, in_width, in_height })
}

/// Create the BGRA staging texture (born D3D12, wrapped for the 11On12 copy).
/// Returns the D3D12 resource, its 11-wrapped view, and the desc/heap reused
/// for the NV12 output texture.
fn create_staging_textures(
    device: &ID3D12Device,
    on12: &ID3D11On12Device,
    in_width: u32,
    in_height: u32,
) -> Result<(ID3D12Resource, ID3D11Texture2D, D3D12_RESOURCE_DESC, D3D12_HEAP_PROPERTIES), String> {
    let staging_desc = D3D12_RESOURCE_DESC {
        Dimension: D3D12_RESOURCE_DIMENSION_TEXTURE2D,
        Width: u64::from(in_width),
        Height: in_height,
        DepthOrArraySize: 1,
        MipLevels: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Layout: D3D12_TEXTURE_LAYOUT_UNKNOWN,
        Flags: D3D12_RESOURCE_FLAG_NONE,
        ..Default::default()
    };
    let heap = D3D12_HEAP_PROPERTIES { Type: D3D12_HEAP_TYPE_DEFAULT, ..Default::default() };
    let mut staging12: Option<ID3D12Resource> = None;
    unsafe {
        device.CreateCommittedResource(
            &heap,
            D3D12_HEAP_FLAG_NONE,
            &staging_desc,
            D3D12_RESOURCE_STATE_COMMON,
            None,
            &mut staging12,
        )
    }
    .map_err(|e| format!("staging texture: {e}"))?;
    let staging12 = staging12.ok_or("no staging texture")?;
    let mut staging11: Option<ID3D11Resource> = None;
    unsafe {
        on12.CreateWrappedResource(
            &staging12,
            &D3D11_RESOURCE_FLAGS::default(),
            D3D12_RESOURCE_STATE_COPY_DEST,
            D3D12_RESOURCE_STATE_VIDEO_PROCESS_READ,
            &mut staging11,
        )
    }
    .map_err(|e| format!("CreateWrappedResource: {e}"))?;
    let staging11: ID3D11Texture2D = staging11
        .ok_or("no wrapped staging")?
        .cast()
        .map_err(|e| format!("wrapped staging cast: {e}"))?;
    Ok((staging12, staging11, staging_desc, heap))
}

/// The D3D12 video-processor objects: BGRA(any size) -> NV12(out size), plus
/// the NV12 output texture, its command allocator/list, and the sync fence.
struct VideoPipeline {
    processor: ID3D12VideoProcessor,
    nv12: ID3D12Resource,
    video_alloc: ID3D12CommandAllocator,
    video_list: ID3D12VideoProcessCommandList,
    fence: ID3D12Fence,
    fence_event: windows::Win32::Foundation::HANDLE,
}

/// Build the video processor, NV12 output texture, command list and fence.
fn create_video_pipeline(
    device: &ID3D12Device,
    video_device: &ID3D12VideoDevice,
    staging_desc: &D3D12_RESOURCE_DESC,
    heap: &D3D12_HEAP_PROPERTIES,
    (in_width, in_height): (u32, u32),
    (out_width, out_height): (u32, u32),
    settings: &EncodeSettings,
) -> Result<VideoPipeline, String> {
    let fps = settings.max_fps.clamp(1.0, 60.0) as u32;
    let frame_rate = DXGI_RATIONAL { Numerator: fps, Denominator: 1 };

    let input_desc = D3D12_VIDEO_PROCESS_INPUT_STREAM_DESC {
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        ColorSpace: DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
        SourceAspectRatio: DXGI_RATIONAL { Numerator: 1, Denominator: 1 },
        DestinationAspectRatio: DXGI_RATIONAL { Numerator: 1, Denominator: 1 },
        FrameRate: frame_rate,
        SourceSizeRange: D3D12_VIDEO_SIZE_RANGE {
            MaxWidth: in_width,
            MaxHeight: in_height,
            MinWidth: in_width,
            MinHeight: in_height,
        },
        DestinationSizeRange: D3D12_VIDEO_SIZE_RANGE {
            MaxWidth: out_width,
            MaxHeight: out_height,
            MinWidth: out_width,
            MinHeight: out_height,
        },
        EnableOrientation: false.into(),
        FilterFlags: D3D12_VIDEO_PROCESS_FILTER_FLAG_NONE,
        StereoFormat: D3D12_VIDEO_FRAME_STEREO_FORMAT_NONE,
        FieldType: D3D12_VIDEO_FIELD_TYPE_NONE,
        DeinterlaceMode: Default::default(),
        EnableAlphaBlending: false.into(),
        LumaKey: Default::default(),
        NumPastFrames: 0,
        NumFutureFrames: 0,
        EnableAutoProcessing: false.into(),
    };
    let output_desc = D3D12_VIDEO_PROCESS_OUTPUT_STREAM_DESC {
        Format: DXGI_FORMAT_NV12,
        ColorSpace: DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
        AlphaFillMode: D3D12_VIDEO_PROCESS_ALPHA_FILL_MODE_OPAQUE,
        AlphaFillModeSourceStreamIndex: 0,
        BackgroundColor: [0.0, 0.0, 0.0, 1.0],
        FrameRate: frame_rate,
        EnableStereo: false.into(),
    };
    let processor: ID3D12VideoProcessor =
        unsafe { video_device.CreateVideoProcessor(0, &output_desc, &[input_desc]) }
            .map_err(|e| format!("CreateVideoProcessor(d3d12): {e}"))?;

    // NV12 output texture (Stage B's encoder input).
    let nv12_desc = D3D12_RESOURCE_DESC {
        Format: DXGI_FORMAT_NV12,
        Width: u64::from(out_width),
        Height: out_height,
        ..*staging_desc
    };
    let mut nv12: Option<ID3D12Resource> = None;
    unsafe {
        device.CreateCommittedResource(
            heap,
            D3D12_HEAP_FLAG_NONE,
            &nv12_desc,
            D3D12_RESOURCE_STATE_COMMON,
            None,
            &mut nv12,
        )
    }
    .map_err(|e| format!("nv12 texture: {e}"))?;
    let nv12 = nv12.ok_or("no nv12 texture")?;

    let video_alloc: ID3D12CommandAllocator =
        unsafe { device.CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_VIDEO_PROCESS) }
            .map_err(|e| format!("video allocator: {e}"))?;
    let video_list: ID3D12VideoProcessCommandList = unsafe {
        device.CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_VIDEO_PROCESS, &video_alloc, None)
    }
    .map_err(|e| format!("video-process list: {e}"))?;
    unsafe { video_list.Close() }.map_err(|e| format!("initial close: {e}"))?;

    let fence: ID3D12Fence = unsafe { device.CreateFence(0, D3D12_FENCE_FLAG_NONE) }
        .map_err(|e| format!("fence: {e}"))?;
    let fence_event =
        unsafe { CreateEventW(None, false, false, None) }.map_err(|e| format!("fence event: {e}"))?;

    Ok(VideoPipeline { processor, nv12, video_alloc, video_list, fence, fence_event })
}

impl GpuFrontD3D12 {
    /// Build device + capture shim + video processor for `monitor_id`
    /// (an `HMONITOR` value, as the source enumeration reports for screens).
    pub(crate) fn new(monitor_id: u32, settings: &EncodeSettings) -> Result<Self, String> {
        enable_debug_layer_if_requested();
        let (device, video_device, direct_queue, video_queue) = create_d3d12_devices()?;
        let shim = create_capture_shim(&device, &direct_queue, monitor_id)?;
        let (staging12, staging11, staging_desc, heap) =
            create_staging_textures(&device, &shim.on12, shim.in_width, shim.in_height)?;
        let (out_width, out_height) =
            output_dims(shim.in_width, shim.in_height, settings.max_dimension);
        let vp = create_video_pipeline(
            &device,
            &video_device,
            &staging_desc,
            &heap,
            (shim.in_width, shim.in_height),
            (out_width, out_height),
            settings,
        )?;

        Ok(Self {
            device,
            d3d11_device: shim.d3d11_device,
            d3d11_context: shim.d3d11_context,
            frame_pool: shim.frame_pool,
            session: shim.session,
            staging12,
            staging11,
            on12: shim.on12,
            video_queue,
            video_alloc: vp.video_alloc,
            video_list: vp.video_list,
            processor: vp.processor,
            nv12: vp.nv12,
            nv12_state: D3D12_RESOURCE_STATE_COMMON,
            fence: vp.fence,
            fence_value: 0,
            fence_event: vp.fence_event,
            in_width: shim.in_width,
            in_height: shim.in_height,
            out_width,
            out_height,
        })
    }

    /// Output (encode) dimensions.
    pub(crate) fn output_dims(&self) -> (u32, u32) {
        (self.out_width, self.out_height)
    }

    /// Wait up to `wait` for a new captured frame, copy it into the D3D12
    /// staging texture (GPU-side, via the 11On12 layer) and run the video
    /// processor. Returns `Ok(true)` when [`Self::nv12`] holds a fresh frame.
    pub(crate) fn acquire_nv12(&mut self, wait: Duration) -> Result<bool, String> {
        // Newest capture frame, stale ones dropped.
        let deadline = std::time::Instant::now() + wait;
        let frame = loop {
            let mut newest = None;
            while let Ok(f) = self.frame_pool.TryGetNextFrame() {
                newest = Some(f);
            }
            if let Some(f) = newest {
                break f;
            }
            if std::time::Instant::now() >= deadline {
                return Ok(false);
            }
            std::thread::sleep(Duration::from_millis(2));
        };

        // GPU copy capture -> wrapped staging through the 11On12 context.
        let capture_tex: ID3D11Texture2D = {
            let surface = frame.Surface().map_err(|e| format!("frame surface: {e}"))?;
            let access: IDirect3DDxgiInterfaceAccess =
                surface.cast().map_err(|e| format!("surface interop: {e}"))?;
            unsafe { access.GetInterface() }.map_err(|e| format!("surface texture: {e}"))?
        };
        let staging11_res: ID3D11Resource =
            self.staging11.cast().map_err(|e| format!("staging11 resource: {e}"))?;
        unsafe {
            let wrapped: [Option<ID3D11Resource>; 1] = [Some(staging11_res)];
            self.on12.AcquireWrappedResources(&wrapped);
            self.d3d11_context.CopyResource(&self.staging11, &capture_tex);
            self.on12.ReleaseWrappedResources(&wrapped);
            self.d3d11_context.Flush();
        }
        // ReleaseWrappedResources transitions staging12 to VIDEO_PROCESS_READ
        // on the direct queue; Flush submits. The video queue must wait for
        // that work - the 11On12 layer signals internally, but a cross-queue
        // fence makes the ordering explicit and debuggable.

        // Record + run the video processor.
        unsafe { self.video_alloc.Reset() }.map_err(|e| format!("alloc reset: {e}"))?;
        unsafe { self.video_list.Reset(&self.video_alloc) }
            .map_err(|e| format!("list reset: {e}"))?;

        if self.nv12_state != D3D12_RESOURCE_STATE_VIDEO_PROCESS_WRITE {
            let barrier = transition(&self.nv12, self.nv12_state, D3D12_RESOURCE_STATE_VIDEO_PROCESS_WRITE);
            unsafe { self.video_list.ResourceBarrier(&[barrier]) };
            self.nv12_state = D3D12_RESOURCE_STATE_VIDEO_PROCESS_WRITE;
        }

        let mut input_args = D3D12_VIDEO_PROCESS_INPUT_STREAM_ARGUMENTS::default();
        input_args.InputStream[0] = D3D12_VIDEO_PROCESS_INPUT_STREAM {
            pTexture2D: std::mem::ManuallyDrop::new(Some(self.staging12.clone())),
            Subresource: 0,
            ReferenceSet: Default::default(),
        };
        input_args.RateInfo = D3D12_VIDEO_PROCESS_INPUT_STREAM_RATE::default();
        // Zeroed rectangles are NOT "full frame" in D3D12 (unlike D3D11's
        // video API) - they mean an empty blit and fail validation.
        input_args.Transform.SourceRectangle = windows::Win32::Foundation::RECT {
            left: 0,
            top: 0,
            right: self.in_width as i32,
            bottom: self.in_height as i32,
        };
        input_args.Transform.DestinationRectangle = windows::Win32::Foundation::RECT {
            left: 0,
            top: 0,
            right: self.out_width as i32,
            bottom: self.out_height as i32,
        };
        let output_args = D3D12_VIDEO_PROCESS_OUTPUT_STREAM_ARGUMENTS {
            OutputStream: [
                D3D12_VIDEO_PROCESS_OUTPUT_STREAM {
                    pTexture2D: std::mem::ManuallyDrop::new(Some(self.nv12.clone())),
                    Subresource: 0,
                },
                D3D12_VIDEO_PROCESS_OUTPUT_STREAM::default(),
            ],
            TargetRectangle: windows::Win32::Foundation::RECT {
                left: 0,
                top: 0,
                right: self.out_width as i32,
                bottom: self.out_height as i32,
            },
        };
        // Bisect aid: FANCY_D3D12_SKIP_BLT=1 records only the barrier, which
        // separates "ProcessFrames arguments rejected" from list/queue issues.
        if std::env::var_os("FANCY_D3D12_SKIP_BLT").is_none() {
            unsafe {
                self.video_list.ProcessFrames(
                    &self.processor,
                    &output_args,
                    std::slice::from_ref(&input_args),
                )
            };
        }
        unsafe { self.video_list.Close() }
            .map_err(|e| format!("list close: {e}{}", debug_messages(&self.device)))?;

        let video_list: windows::Win32::Graphics::Direct3D12::ID3D12CommandList =
            self.video_list.cast().map_err(|e| format!("video command list: {e}"))?;
        let lists = [Some(video_list)];
        unsafe { self.video_queue.ExecuteCommandLists(&lists) };
        self.wait_video_queue()?;

        // Release the ManuallyDrop interface clones the arg structs held.
        let mut s = input_args;
        unsafe { std::mem::ManuallyDrop::drop(&mut s.InputStream[0].pTexture2D) };
        let mut out = output_args;
        unsafe { std::mem::ManuallyDrop::drop(&mut out.OutputStream[0].pTexture2D) };
        Ok(true)
    }

    /// Block until the video queue drained its submitted work.
    fn wait_video_queue(&mut self) -> Result<(), String> {
        self.fence_value += 1;
        unsafe { self.video_queue.Signal(&self.fence, self.fence_value) }
            .map_err(|e| format!("queue signal: {e}"))?;
        if unsafe { self.fence.GetCompletedValue() } < self.fence_value {
            unsafe {
                self.fence
                    .SetEventOnCompletion(self.fence_value, self.fence_event)
                    .map_err(|e| format!("fence event set: {e}"))?;
                let _ = WaitForSingleObject(self.fence_event, INFINITE);
            }
        }
        Ok(())
    }

    /// Stop the capture session.
    pub(crate) fn close(&mut self) {
        let _ = self.session.Close();
        let _ = self.frame_pool.Close();
    }
}

/// Drain the debug layer's stored messages into a printable string (empty
/// when the layer is off - see `FANCY_D3D12_DEBUG`).
fn debug_messages(device: &ID3D12Device) -> String {
    use windows::Win32::Graphics::Direct3D12::ID3D12InfoQueue;
    let Ok(queue) = device.cast::<ID3D12InfoQueue>() else {
        return " (no ID3D12InfoQueue - debug layer off)".into();
    };
    let count = unsafe { queue.GetNumStoredMessages() };
    let mut out = format!(" ({count} stored debug messages)");
    for i in 0..count {
        let mut len = 0usize;
        if unsafe { queue.GetMessage(i, None, &mut len) }.is_err() || len == 0 {
            continue;
        }
        let mut buf = vec![0u8; len];
        let msg = buf.as_mut_ptr().cast();
        if unsafe { queue.GetMessage(i, Some(msg), &mut len) }.is_ok() {
            let msg: &windows::Win32::Graphics::Direct3D12::D3D12_MESSAGE = unsafe { &*msg };
            let text = unsafe {
                std::slice::from_raw_parts(
                    msg.pDescription.cast::<u8>(),
                    msg.DescriptionByteLength.saturating_sub(1),
                )
            };
            out.push_str("\n  d3d12: ");
            out.push_str(&String::from_utf8_lossy(text));
        }
    }
    out
}

/// Build a transition barrier (helper keeps the union noise in one place).
fn transition(
    resource: &ID3D12Resource,
    before: D3D12_RESOURCE_STATES,
    after: D3D12_RESOURCE_STATES,
) -> D3D12_RESOURCE_BARRIER {
    D3D12_RESOURCE_BARRIER {
        Type: D3D12_RESOURCE_BARRIER_TYPE_TRANSITION,
        Flags: D3D12_RESOURCE_BARRIER_FLAG_NONE,
        Anonymous: D3D12_RESOURCE_BARRIER_0 {
            Transition: std::mem::ManuallyDrop::new(D3D12_RESOURCE_TRANSITION_BARRIER {
                pResource: std::mem::ManuallyDrop::new(Some(resource.clone())),
                Subresource: D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES,
                StateBefore: before,
                StateAfter: after,
            }),
        },
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

// ---------------------------------------------------------------------------
// H.264 parameter set writer (Stage B: prepended to IDR output).
// ---------------------------------------------------------------------------

/// Minimal MSB-first bit writer with Exp-Golomb support for SPS/PPS.
#[derive(Debug, Default)]
pub(crate) struct BitWriter {
    bytes: Vec<u8>,
    bit: u8,
}

impl BitWriter {
    fn put_bit(&mut self, b: bool) {
        if self.bit == 0 {
            self.bytes.push(0);
        }
        if b {
            let last = self.bytes.len() - 1;
            self.bytes[last] |= 1 << (7 - self.bit);
        }
        self.bit = (self.bit + 1) % 8;
    }

    fn put_bits(&mut self, value: u32, count: u8) {
        for i in (0..count).rev() {
            self.put_bit((value >> i) & 1 == 1);
        }
    }

    /// Unsigned Exp-Golomb.
    fn put_ue(&mut self, value: u32) {
        let v = value + 1;
        let bits = 32 - v.leading_zeros() as u8;
        self.put_bits(0, bits - 1);
        self.put_bits(v, bits);
    }

    /// Signed Exp-Golomb.
    fn put_se(&mut self, value: i32) {
        let mapped = if value <= 0 { (-value as u32) * 2 } else { (value as u32) * 2 - 1 };
        self.put_ue(mapped);
    }

    /// RBSP trailing bits + emulation-prevention into an Annex-B NAL.
    fn finish_nal(mut self, nal_header: u8) -> Vec<u8> {
        self.put_bit(true); // rbsp_stop_one_bit
        while self.bit != 0 {
            self.put_bit(false);
        }
        let mut out = vec![0, 0, 0, 1, nal_header];
        let mut zeros = 0u32;
        for b in self.bytes {
            if zeros >= 2 && b <= 3 {
                out.push(3); // emulation prevention
                zeros = 0;
            }
            if b == 0 {
                zeros += 1;
            } else {
                zeros = 0;
            }
            out.push(b);
        }
        out
    }
}

/// H.264 Main-profile SPS matching the D3D12 encoder configuration this
/// module drives (progressive, poc type 2, CAVLC, one reference frame).
pub(crate) fn write_sps_impl(width: u32, height: u32, level_idc: u8) -> Vec<u8> {
    let mb_w = width.div_ceil(16);
    let mb_h = height.div_ceil(16);
    let crop_right = (mb_w * 16 - width) / 2;
    let crop_bottom = (mb_h * 16 - height) / 2;

    let mut w = BitWriter::default();
    w.put_bits(77, 8); // profile_idc: Main
    w.put_bits(0, 8); // constraint_set flags + reserved_zero
    w.put_bits(u32::from(level_idc), 8); // level_idc
    w.put_ue(0); // seq_parameter_set_id
    w.put_ue(4); // log2_max_frame_num_minus4
    w.put_ue(2); // pic_order_cnt_type (derived from frame_num; no B frames)
    w.put_ue(1); // max_num_ref_frames
    w.put_bit(false); // gaps_in_frame_num_value_allowed_flag
    w.put_ue(mb_w - 1); // pic_width_in_mbs_minus1
    w.put_ue(mb_h - 1); // pic_height_in_map_units_minus1
    w.put_bit(true); // frame_mbs_only_flag
    w.put_bit(true); // direct_8x8_inference_flag
    let cropping = crop_right > 0 || crop_bottom > 0;
    w.put_bit(cropping);
    if cropping {
        w.put_ue(0);
        w.put_ue(crop_right);
        w.put_ue(0);
        w.put_ue(crop_bottom);
    }
    w.put_bit(false); // vui_parameters_present_flag
    w.finish_nal(0x67) // nal_ref_idc=3, type=7 (SPS)
}

/// H.264 PPS matching [`write_sps_impl`] (CAVLC, no weighted pred,
/// deblocking control present).
pub(crate) fn write_pps() -> Vec<u8> {
    let mut w = BitWriter::default();
    w.put_ue(0); // pic_parameter_set_id
    w.put_ue(0); // seq_parameter_set_id
    w.put_bit(false); // entropy_coding_mode_flag: CAVLC
    w.put_bit(false); // bottom_field_pic_order_in_frame_present_flag
    w.put_ue(0); // num_slice_groups_minus1
    w.put_ue(0); // num_ref_idx_l0_default_active_minus1
    w.put_ue(0); // num_ref_idx_l1_default_active_minus1
    w.put_bit(false); // weighted_pred_flag
    w.put_bits(0, 2); // weighted_bipred_idc
    w.put_se(0); // pic_init_qp_minus26
    w.put_se(0); // pic_init_qs_minus26
    w.put_se(0); // chroma_qp_index_offset
    w.put_bit(true); // deblocking_filter_control_present_flag
    w.put_bit(false); // constrained_intra_pred_flag
    w.put_bit(false); // redundant_pic_cnt_present_flag
    w.finish_nal(0x68) // nal_ref_idc=3, type=8 (PPS)
}

// ---------------------------------------------------------------------------
// Stage B seam: the encoder mounts here.
// ---------------------------------------------------------------------------

/// Full D3D12 pipeline (capture + convert + encode). Stage B: constructing
/// it currently reports unsupported so the selector falls through to the
/// D3D11/MediaFoundation tier; [`GpuFrontD3D12`] above is complete and
/// benchmarked, and the SPS/PPS writers are ready for the encoder.
#[derive(Debug)]
pub(crate) struct GpuPipelineD3D12;

impl GpuPipelineD3D12 {
    /// Stage B pending: see module docs.
    pub(crate) fn new(_monitor_id: u32, _settings: &EncodeSettings) -> Result<Self, String> {
        Err("ID3D12VideoEncoder stage not yet implemented (front half ready)".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SPS/PPS must round-trip basic structural invariants (start code, NAL
    /// type, non-empty RBSP). Golden-stream validation happens in Stage B
    /// against the real decoder.
    #[test]
    fn parameter_sets_are_wellformed() {
        let sps = write_sps_impl(2560, 1440, 51);
        assert_eq!(&sps[..4], &[0, 0, 0, 1]);
        assert_eq!(sps[4], 0x67);
        assert!(sps.len() > 8, "SPS too short: {sps:?}");

        let pps = write_pps();
        assert_eq!(&pps[..4], &[0, 0, 0, 1]);
        assert_eq!(pps[4], 0x68);
        assert!(pps.len() > 6, "PPS too short: {pps:?}");

        // 1080p (needs bottom cropping: 1080 = 67.5 macroblocks).
        let sps1080 = write_sps_impl(1920, 1080, 42);
        assert_eq!(sps1080[4], 0x67);
    }

    /// Manual benchmark: capture + GPU convert on the REAL primary monitor.
    /// Run with `cargo test -p fancy-screenshare --release -- --ignored --nocapture d3d12`.
    #[test]
    #[ignore = "needs a display + D3D12 video-capable GPU; manual benchmark"]
    fn bench_d3d12_front_primary_monitor() {
        let monitors = xcap::Monitor::all().expect("monitors");
        let monitor = monitors.first().expect("at least one monitor");
        let id = monitor.id().expect("monitor id");

        let settings = EncodeSettings::default();
        let mut front = match GpuFrontD3D12::new(id, &settings) {
            Ok(f) => f,
            Err(e) => panic!("D3D12 front unavailable on this machine: {e}"),
        };
        println!("monitor -> nv12 {:?}", front.output_dims());

        let start = std::time::Instant::now();
        let mut frames = 0u32;
        while start.elapsed() < Duration::from_secs(5) {
            match front.acquire_nv12(Duration::from_millis(100)) {
                Ok(true) => frames += 1,
                Ok(false) => {}
                Err(e) => panic!("acquire_nv12 failed after {frames} frames: {e}"),
            }
        }
        front.close();
        let secs = start.elapsed().as_secs_f64();
        println!(
            "D3D12 capture+convert: {frames} frames in {secs:.1}s = {:.1} fps (change-driven)",
            f64::from(frames) / secs,
        );
        assert!(frames > 0, "no frames converted - is the desktop static?");
    }
}
