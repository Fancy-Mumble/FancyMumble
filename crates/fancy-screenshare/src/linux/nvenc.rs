//! NVENC H.264 encoding - the NVIDIA tier of the Linux ladder.
//!
//! Chromium's Linux encode accelerator is VA-API-only, so on NVIDIA it
//! falls back to software; Discord ships an NVENC path instead (their
//! Linux client bundles a cros-codecs fork plus NVENC). This module is
//! that tier: when the VA-API probe fails (NVIDIA has no VA *encode*
//! entrypoints, their VA driver is a decode-only shim) but the NVIDIA
//! driver stack is present, frames are encoded by the GPU's NVENC engine.
//!
//! Everything is loaded at RUNTIME with `dlopen` (`libcuda.so.1`,
//! `libnvidia-encode.so.1`) - machines without an NVIDIA driver just fail
//! the probe and the ladder moves on; the client binary never links
//! NVIDIA libraries. This also works inside WSL, whose GPU
//! paravirtualization exposes both libraries, which is how this tier is
//! smoke-tested without a Linux boot (`cargo test -p fancy-screenshare
//! nvenc_hw -- --ignored`).
//!
//! FFI layouts and constants are transcribed from NVIDIA's MIT-licensed
//! `nvEncodeAPI.h` (nv-codec-headers, SDK 12.1 - the struct versions we
//! stamp), cross-checked against the oxideav-nvidia crate (MIT). Two of
//! that crate's constants disagreed with the official header and the
//! header values are used here: `NV_ENC_PIC_FLAG_FORCEIDR` is 0x2 (0x1 is
//! FORCEINTRA) and the codec union inside `NV_ENC_PIC_PARAMS` sits at
//! offset 80, not 76. Every struct carries a compile-time size assertion.

#![allow(
    unsafe_code,
    reason = "dlopen'd C API: every unsafe block is a single FFI call or a \
              bounds-checked slice over a driver-provided buffer, with the \
              layout contract pinned by compile-time size assertions"
)]

use std::ffi::{c_char, c_void, CStr};
use std::sync::OnceLock;

use crate::encode::{scaled_bitrate, EncodeSettings, EncodedFrame};

// ─── constants (nvEncodeAPI.h, SDK 12.1) ───────────────────────────────────

const NVENCAPI_VERSION: u32 = 12 | (1 << 24);

/// `NVENCAPI_STRUCT_VERSION(ver)`.
const fn struct_ver(v: u32) -> u32 {
    NVENCAPI_VERSION | (v << 16) | (0x7 << 28)
}
const HI: u32 = 1 << 31;

const NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER: u32 = struct_ver(1);
const NV_ENCODE_API_FUNCTION_LIST_VER: u32 = struct_ver(2);
const NV_ENC_INITIALIZE_PARAMS_VER: u32 = struct_ver(6) | HI;
const NV_ENC_CONFIG_VER: u32 = struct_ver(8) | HI;
const NV_ENC_PRESET_CONFIG_VER: u32 = struct_ver(4) | HI;
const NV_ENC_CREATE_INPUT_BUFFER_VER: u32 = struct_ver(1);
const NV_ENC_CREATE_BITSTREAM_BUFFER_VER: u32 = struct_ver(1);
const NV_ENC_LOCK_INPUT_BUFFER_VER: u32 = struct_ver(1);
const NV_ENC_LOCK_BITSTREAM_VER: u32 = struct_ver(1) | HI;
const NV_ENC_PIC_PARAMS_VER: u32 = struct_ver(6) | HI;
const NV_ENC_RECONFIGURE_PARAMS_VER: u32 = struct_ver(1) | HI;

const NV_ENC_SUCCESS: i32 = 0;
const NV_ENC_DEVICE_TYPE_CUDA: u32 = 0x1;
const NV_ENC_BUFFER_FORMAT_NV12: u32 = 0x1;
const NV_ENC_PIC_STRUCT_FRAME: u32 = 0x1;
const NV_ENC_TUNING_INFO_LOW_LATENCY: u32 = 2;
/// IDR + attach SPS/PPS to this picture (0x2 | 0x4; 0x1 would be
/// FORCEINTRA - an intra picture WITHOUT IDR semantics, which never
/// resynchronises a joining viewer).
const NV_ENC_PIC_FLAGS_IDR_WITH_HEADERS: u32 = 0x2 | 0x4;
const NV_ENC_PIC_TYPE_IDR: u32 = 0x03;
const NV_ENC_PARAMS_RC_CBR: u32 = 0x2;
const NVENC_INFINITE_GOPLENGTH: u32 = 0xffff_ffff;

const CUDA_SUCCESS: i32 = 0;

/// 16-byte GUID as used throughout the NVENC API.
#[repr(C)]
#[derive(Clone, Copy)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

const NV_ENC_CODEC_H264_GUID: Guid = Guid {
    data1: 0x6bc8_2762,
    data2: 0x4e63,
    data3: 0x4ca4,
    data4: [0xaa, 0x85, 0x1e, 0x50, 0xf3, 0x21, 0xf6, 0xbf],
};
const NV_ENC_H264_PROFILE_MAIN_GUID: Guid = Guid {
    data1: 0x60b5_c1d4,
    data2: 0x67fe,
    data3: 0x4790,
    data4: [0x94, 0xd5, 0xc4, 0x72, 0x6d, 0x7b, 0x6e, 0x6d],
};
/// P4 = balanced quality/speed; latency behaviour comes from the tuning
/// info, not the P-number.
const NV_ENC_PRESET_P4_GUID: Guid = Guid {
    data1: 0x90a7_b826,
    data2: 0xdf06,
    data3: 0x4862,
    data4: [0xb9, 0xd2, 0xcd, 0x6d, 0x73, 0xa0, 0x86, 0x81],
};

// ─── FFI structs (offsets per nvEncodeAPI.h 12.1) ──────────────────────────

/// `NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS`.
#[repr(C)]
struct OpenSessionParams {
    version: u32,
    device_type: u32,
    device: *mut c_void,
    reserved: *mut c_void,
    api_version: u32,
    reserved1: [u32; 253],
    reserved2: [*mut c_void; 64],
}
const _: () = assert!(size_of::<OpenSessionParams>() == 1552);

/// `NV_ENC_CONFIG` as an opaque blob: it is filled by
/// `nvEncGetEncodePresetConfigEx` and handed straight back to
/// `nvEncInitializeEncoder`; only the header-verified offsets below are
/// poked.
#[repr(C, align(8))]
#[derive(Clone, Copy)]
struct EncConfig {
    bytes: [u8; 3584],
}
const _: () = assert!(size_of::<EncConfig>() == 3584);

/// Byte offsets inside `NV_ENC_CONFIG` (verified against the 12.1 header:
/// version 0, profileGUID 4, gopLength 20, frameIntervalP 24, then
/// `rcParams` at 40 whose prefix is version, `rateControlMode`, `NV_ENC_QP`
/// constQP[12], averageBitRate, maxBitRate).
mod cfg_off {
    pub(super) const PROFILE_GUID: usize = 4;
    pub(super) const GOP_LENGTH: usize = 20;
    pub(super) const FRAME_INTERVAL_P: usize = 24;
    pub(super) const RC_MODE: usize = 44;
    pub(super) const AVERAGE_BITRATE: usize = 60;
    pub(super) const MAX_BITRATE: usize = 64;
}

/// `NV_ENC_PRESET_CONFIG`.
#[repr(C)]
struct PresetConfig {
    version: u32,
    _pad0: u32,
    preset_cfg: EncConfig,
    reserved1: [u32; 255],
    _pad1: u32,
    reserved2: [*mut c_void; 64],
}
const _: () = assert!(size_of::<PresetConfig>() == 5128);

/// `NV_ENC_INITIALIZE_PARAMS`.
#[repr(C)]
struct InitializeParams {
    version: u32,
    encode_guid: Guid,
    preset_guid: Guid,
    encode_width: u32,
    encode_height: u32,
    dar_width: u32,
    dar_height: u32,
    frame_rate_num: u32,
    frame_rate_den: u32,
    enable_encode_async: u32,
    enable_ptd: u32,
    flags: u32,
    priv_data_size: u32,
    _pad0: u32,
    priv_data: *mut c_void,
    encode_config: *mut EncConfig,
    max_encode_width: u32,
    max_encode_height: u32,
    max_me_hint_counts_per_block: [u8; 32],
    tuning_info: u32,
    buffer_format: u32,
    num_state_buffers: u32,
    output_stats_level: u32,
    tail: [u8; 1808 - 152],
}
const _: () = assert!(size_of::<InitializeParams>() == 1808);

/// `NV_ENC_RECONFIGURE_PARAMS`: re-initialisation parameters for a LIVE
/// session, which is how the bitrate moves without destroying the encoder
/// (destroying it would cost an IDR - the burst a congested uplink can least
/// afford at the moment the target drops).
///
/// The C struct opens with a `uint32_t version` followed by an 8-aligned
/// `NV_ENC_INITIALIZE_PARAMS`, so the compiler inserts four bytes of padding
/// that must be spelled out here; the trailing bitfield needs four more to
/// round the whole thing up. Both the total size and the member offset are
/// asserted below against values read out of `ffnvcodec/nvEncodeAPI.h` (API
/// 12.1) with a C probe, the same way every other layout in this file is
/// pinned.
#[repr(C)]
struct ReconfigureParams {
    version: u32,
    _pad0: u32,
    re_init: InitializeParams,
    /// `resetEncoder:1, forceIDR:1, reserved:30`. Always zero: resetting
    /// would clear the rate-control state (and is only legal on an IDR), and
    /// forcing an IDR is precisely what this path exists to avoid.
    flags: u32,
    _pad1: u32,
}
const _: () = assert!(size_of::<ReconfigureParams>() == 1824);
const _: () = assert!(std::mem::offset_of!(ReconfigureParams, re_init) == 8);

/// `NV_ENC_CREATE_INPUT_BUFFER`.
#[repr(C)]
struct CreateInputBuffer {
    version: u32,
    width: u32,
    height: u32,
    memory_heap: u32,
    buffer_fmt: u32,
    reserved: u32,
    input_buffer: *mut c_void,
    p_sys_mem_buffer: *mut c_void,
    reserved1: [u32; 57],
    reserved2: [*mut c_void; 63],
}
const _: () = assert!(size_of::<CreateInputBuffer>() == 776);

/// `NV_ENC_CREATE_BITSTREAM_BUFFER`.
#[repr(C)]
struct CreateBitstreamBuffer {
    version: u32,
    size: u32,
    memory_heap: u32,
    reserved: u32,
    bitstream_buffer: *mut c_void,
    bitstream_buffer_ptr: *mut c_void,
    reserved1: [u32; 58],
    reserved2: [*mut c_void; 64],
}
const _: () = assert!(size_of::<CreateBitstreamBuffer>() == 776);

/// `NV_ENC_LOCK_INPUT_BUFFER`.
#[repr(C)]
struct LockInputBuffer {
    version: u32,
    flags: u32,
    input_buffer: *mut c_void,
    buffer_data_ptr: *mut c_void,
    pitch: u32,
    reserved1: [u32; 251],
    reserved2: [*mut c_void; 64],
}
const _: () = assert!(size_of::<LockInputBuffer>() == 1544);

/// `NV_ENC_LOCK_BITSTREAM` (12.1 layout).
#[repr(C)]
struct LockBitstream {
    version: u32,
    flags: u32,
    output_bitstream: *mut c_void,
    slice_offsets: *mut u32,
    frame_idx: u32,
    hw_encode_status: u32,
    num_slices: u32,
    bitstream_size_in_bytes: u32,
    output_time_stamp: u64,
    output_duration: u64,
    bitstream_buffer_ptr: *mut c_void,
    picture_type: u32,
    picture_struct: u32,
    frame_avg_qp: u32,
    frame_satd: u32,
    ltr_frame_idx: u32,
    ltr_frame_bitmap: u32,
    temporal_id: u32,
    intra_mb_count: u32,
    inter_mb_count: u32,
    average_mvx: i32,
    average_mvy: i32,
    alpha_layer_size_in_bytes: u32,
    output_stats_ptr_size: u32,
    _pad0: u32,
    output_stats_ptr: *mut c_void,
    frame_idx_display: u32,
    reserved1: [u32; 220],
    reserved2: [*mut c_void; 63],
    reserved_internal: [u32; 8],
}
const _: () = assert!(size_of::<LockBitstream>() == 1552);

/// `NV_ENC_PIC_PARAMS`. The codec-specific union (offset 80, 8-aligned)
/// and everything after it stay zeroed - with PTD enabled the driver
/// fills in sensible per-picture codec params itself.
#[repr(C)]
struct PicParams {
    version: u32,
    input_width: u32,
    input_height: u32,
    input_pitch: u32,
    encode_pic_flags: u32,
    frame_idx: u32,
    input_time_stamp: u64,
    input_duration: u64,
    input_buffer: *mut c_void,
    output_bitstream: *mut c_void,
    completion_event: *mut c_void,
    buffer_fmt: u32,
    picture_struct: u32,
    picture_type: u32,
    _pad0: u32,
    codec_pic_params: [u64; 128],
    tail: [u8; 3360 - 80 - 1024],
}
const _: () = assert!(size_of::<PicParams>() == 3360);

// ─── NVENC function table ───────────────────────────────────────────────────

type NvStatus = i32;
type PfnOpenSessionEx =
    Option<unsafe extern "C" fn(*mut OpenSessionParams, *mut *mut c_void) -> NvStatus>;
type PfnGetPresetConfigEx =
    Option<unsafe extern "C" fn(*mut c_void, Guid, Guid, u32, *mut PresetConfig) -> NvStatus>;
type PfnInitialize = Option<unsafe extern "C" fn(*mut c_void, *mut InitializeParams) -> NvStatus>;
type PfnCreateInput = Option<unsafe extern "C" fn(*mut c_void, *mut CreateInputBuffer) -> NvStatus>;
type PfnDestroyBuf = Option<unsafe extern "C" fn(*mut c_void, *mut c_void) -> NvStatus>;
type PfnCreateBitstream =
    Option<unsafe extern "C" fn(*mut c_void, *mut CreateBitstreamBuffer) -> NvStatus>;
type PfnEncodePicture = Option<unsafe extern "C" fn(*mut c_void, *mut PicParams) -> NvStatus>;
type PfnLockBitstream = Option<unsafe extern "C" fn(*mut c_void, *mut LockBitstream) -> NvStatus>;
type PfnLockInput = Option<unsafe extern "C" fn(*mut c_void, *mut LockInputBuffer) -> NvStatus>;
type PfnDestroyEncoder = Option<unsafe extern "C" fn(*mut c_void) -> NvStatus>;
type PfnLastError = Option<unsafe extern "C" fn(*mut c_void) -> *const c_char>;
type PfnReconfigure = Option<unsafe extern "C" fn(*mut c_void, *mut ReconfigureParams) -> NvStatus>;

/// `NV_ENCODE_API_FUNCTION_LIST` - the driver fills the pointer slots in
/// `NvEncodeAPICreateInstance`; slot order is ABI (append-only in the
/// header) and pinned by the size assertion.
#[repr(C)]
struct FunctionList {
    version: u32,
    reserved: u32,
    nv_enc_open_encode_session: *mut c_void,
    nv_enc_get_encode_guid_count: *mut c_void,
    nv_enc_get_encode_profile_guid_count: *mut c_void,
    nv_enc_get_encode_profile_guids: *mut c_void,
    nv_enc_get_encode_guids: *mut c_void,
    nv_enc_get_input_format_count: *mut c_void,
    nv_enc_get_input_formats: *mut c_void,
    nv_enc_get_encode_caps: *mut c_void,
    nv_enc_get_encode_preset_count: *mut c_void,
    nv_enc_get_encode_preset_guids: *mut c_void,
    nv_enc_get_encode_preset_config: *mut c_void,
    nv_enc_initialize_encoder: PfnInitialize,
    nv_enc_create_input_buffer: PfnCreateInput,
    nv_enc_destroy_input_buffer: PfnDestroyBuf,
    nv_enc_create_bitstream_buffer: PfnCreateBitstream,
    nv_enc_destroy_bitstream_buffer: PfnDestroyBuf,
    nv_enc_encode_picture: PfnEncodePicture,
    nv_enc_lock_bitstream: PfnLockBitstream,
    nv_enc_unlock_bitstream: PfnDestroyBuf,
    nv_enc_lock_input_buffer: PfnLockInput,
    nv_enc_unlock_input_buffer: PfnDestroyBuf,
    nv_enc_get_encode_stats: *mut c_void,
    nv_enc_get_sequence_params: *mut c_void,
    nv_enc_register_async_event: *mut c_void,
    nv_enc_unregister_async_event: *mut c_void,
    nv_enc_map_input_resource: *mut c_void,
    nv_enc_unmap_input_resource: *mut c_void,
    nv_enc_destroy_encoder: PfnDestroyEncoder,
    nv_enc_invalidate_ref_frames: *mut c_void,
    nv_enc_open_encode_session_ex: PfnOpenSessionEx,
    nv_enc_register_resource: *mut c_void,
    nv_enc_unregister_resource: *mut c_void,
    nv_enc_reconfigure_encoder: PfnReconfigure,
    reserved1: *mut c_void,
    nv_enc_create_mv_buffer: *mut c_void,
    nv_enc_destroy_mv_buffer: *mut c_void,
    nv_enc_run_motion_estimation_only: *mut c_void,
    nv_enc_get_last_error_string: PfnLastError,
    nv_enc_set_io_cuda_streams: *mut c_void,
    nv_enc_get_encode_preset_config_ex: PfnGetPresetConfigEx,
    nv_enc_get_sequence_param_ex: *mut c_void,
    nv_enc_restore_encoder_state: *mut c_void,
    nv_enc_lookahead_picture: *mut c_void,
    reserved2: [*mut c_void; 275],
}
const _: () = assert!(size_of::<FunctionList>() == 2552);
// The reconfigure slot is the first typed entry past a long run of untyped
// ones, so its offset is what actually proves that run is counted correctly.
const _: () = assert!(std::mem::offset_of!(FunctionList, nv_enc_reconfigure_encoder) == 264);

// ─── runtime library loading ────────────────────────────────────────────────

type FnCuInit = unsafe extern "C" fn(u32) -> i32;
type FnCuDeviceGetCount = unsafe extern "C" fn(*mut i32) -> i32;
type FnCuDeviceGet = unsafe extern "C" fn(*mut i32, i32) -> i32;
type FnCuDeviceGetName = unsafe extern "C" fn(*mut c_char, i32, i32) -> i32;
type FnCuCtxCreate = unsafe extern "C" fn(*mut *mut c_void, u32, i32) -> i32;
type FnCuCtxDestroy = unsafe extern "C" fn(*mut c_void) -> i32;

/// dlopen'd NVIDIA entry points, resolved once per process.
struct NvLibs {
    _cuda: libloading::Library,
    _nvenc: libloading::Library,
    cu_init: FnCuInit,
    cu_device_get_count: FnCuDeviceGetCount,
    cu_device_get: FnCuDeviceGet,
    cu_device_get_name: FnCuDeviceGetName,
    cu_ctx_create: FnCuCtxCreate,
    cu_ctx_destroy: FnCuCtxDestroy,
    fns: FunctionList,
}

// SAFETY: the function list is written exactly once (by
// NvEncodeAPICreateInstance, before the OnceLock publishes it) and only
// read afterwards; the contained pointers are process-global driver code.
unsafe impl Send for NvLibs {}
unsafe impl Sync for NvLibs {}

fn load_libs() -> Result<NvLibs, String> {
    // SAFETY: dlopen of well-known system libraries; failure is reported.
    let cuda = unsafe { libloading::Library::new("libcuda.so.1") }
        .map_err(|e| format!("libcuda.so.1: {e}"))?;
    // SAFETY: as above.
    let nvenc = unsafe { libloading::Library::new("libnvidia-encode.so.1") }
        .map_err(|e| format!("libnvidia-encode.so.1: {e}"))?;

    /// Resolve one symbol and copy the function pointer out (the library
    /// handle outlives it inside `NvLibs`).
    macro_rules! sym {
        ($lib:expr, $name:literal, $ty:ty) => {{
            // SAFETY: the symbol's C signature matches `$ty` per the
            // driver headers this module transcribes.
            let s: libloading::Symbol<'_, $ty> = unsafe { $lib.get($name) }
                .map_err(|e| format!("{}: {e}", String::from_utf8_lossy($name)))?;
            *s
        }};
    }

    let cu_init = sym!(cuda, b"cuInit\0", FnCuInit);
    let cu_device_get_count = sym!(cuda, b"cuDeviceGetCount\0", FnCuDeviceGetCount);
    let cu_device_get = sym!(cuda, b"cuDeviceGet\0", FnCuDeviceGet);
    let cu_device_get_name = sym!(cuda, b"cuDeviceGetName\0", FnCuDeviceGetName);
    let cu_ctx_create = sym!(cuda, b"cuCtxCreate_v2\0", FnCuCtxCreate);
    let cu_ctx_destroy = sym!(cuda, b"cuCtxDestroy_v2\0", FnCuCtxDestroy);

    type FnCreateInstance = unsafe extern "C" fn(*mut FunctionList) -> NvStatus;
    let create_instance = sym!(nvenc, b"NvEncodeAPICreateInstance\0", FnCreateInstance);

    // SAFETY: zero-initialised function list with the correct version
    // stamp, as the API requires.
    let mut fns: FunctionList = unsafe { std::mem::zeroed() };
    fns.version = NV_ENCODE_API_FUNCTION_LIST_VER;
    // SAFETY: `fns` is a valid, version-stamped function list.
    let status = unsafe { create_instance(&mut fns) };
    if status != NV_ENC_SUCCESS {
        return Err(format!(
            "NvEncodeAPICreateInstance failed ({status}); driver older than NVENC API 12.1?"
        ));
    }

    Ok(NvLibs {
        _cuda: cuda,
        _nvenc: nvenc,
        cu_init,
        cu_device_get_count,
        cu_device_get,
        cu_device_get_name,
        cu_ctx_create,
        cu_ctx_destroy,
        fns,
    })
}

fn libs() -> Result<&'static NvLibs, String> {
    static LIBS: OnceLock<Result<NvLibs, String>> = OnceLock::new();
    LIBS.get_or_init(load_libs).as_ref().map_err(Clone::clone)
}

/// Human-readable message for a failed NVENC call.
fn nv_err(libs: &NvLibs, encoder: *mut c_void, what: &str, status: NvStatus) -> String {
    let detail = libs
        .fns
        .nv_enc_get_last_error_string
        .and_then(|f| {
            if encoder.is_null() {
                return None;
            }
            // SAFETY: valid encoder handle; the API returns a NUL-terminated
            // string owned by the encoder (copied out immediately).
            let ptr = unsafe { f(encoder) };
            if ptr.is_null() {
                None
            } else {
                // SAFETY: non-null NUL-terminated string per the API.
                Some(
                    unsafe { CStr::from_ptr(ptr) }
                        .to_string_lossy()
                        .into_owned(),
                )
            }
        })
        .unwrap_or_default();
    format!("{what} failed ({status}) {detail}")
}

/// Open a CUDA-backed NVENC encode session for `device`. The returned
/// encoder must be destroyed (`Session::destroy`) on any later failure.
fn open_encode_session(libs: &NvLibs, device: *mut c_void) -> Result<*mut c_void, String> {
    let open = libs
        .fns
        .nv_enc_open_encode_session_ex
        .ok_or("nvEncOpenEncodeSessionEx missing")?;
    // SAFETY: zeroed + version-stamped params struct.
    let mut params: OpenSessionParams = unsafe { std::mem::zeroed() };
    params.version = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER;
    params.device_type = NV_ENC_DEVICE_TYPE_CUDA;
    params.device = device;
    params.api_version = NVENCAPI_VERSION;
    let mut encoder = std::ptr::null_mut();
    // SAFETY: valid params + out-pointer.
    let r = unsafe { open(&mut params, &mut encoder) };
    if r != NV_ENC_SUCCESS || encoder.is_null() {
        return Err(nv_err(libs, encoder, "nvEncOpenEncodeSessionEx", r));
    }
    Ok(encoder)
}

/// Allocate the NV12 input buffer and the bitstream output buffer for an
/// initialized `encoder`, returned as `(input, output)`.
fn create_io_buffers(
    libs: &NvLibs,
    encoder: *mut c_void,
    w: u32,
    h: u32,
) -> Result<(*mut c_void, *mut c_void), String> {
    let create_in = libs
        .fns
        .nv_enc_create_input_buffer
        .ok_or("nvEncCreateInputBuffer missing")?;
    // SAFETY: zeroed + version-stamped.
    let mut cin: CreateInputBuffer = unsafe { std::mem::zeroed() };
    cin.version = NV_ENC_CREATE_INPUT_BUFFER_VER;
    cin.width = w;
    cin.height = h;
    cin.buffer_fmt = NV_ENC_BUFFER_FORMAT_NV12;
    // SAFETY: live encoder, valid struct.
    let r = unsafe { create_in(encoder, &mut cin) };
    if r != NV_ENC_SUCCESS || cin.input_buffer.is_null() {
        return Err(nv_err(libs, encoder, "nvEncCreateInputBuffer", r));
    }

    let create_out = libs
        .fns
        .nv_enc_create_bitstream_buffer
        .ok_or("nvEncCreateBitstreamBuffer missing")?;
    // SAFETY: zeroed + version-stamped.
    let mut cout: CreateBitstreamBuffer = unsafe { std::mem::zeroed() };
    cout.version = NV_ENC_CREATE_BITSTREAM_BUFFER_VER;
    // SAFETY: live encoder, valid struct.
    let r = unsafe { create_out(encoder, &mut cout) };
    if r != NV_ENC_SUCCESS || cout.bitstream_buffer.is_null() {
        // Free the input buffer we just made before bailing.
        if let Some(f) = libs.fns.nv_enc_destroy_input_buffer {
            // SAFETY: live encoder + the input buffer allocated just above.
            let _ = unsafe { f(encoder, cin.input_buffer) };
        }
        return Err(nv_err(libs, encoder, "nvEncCreateBitstreamBuffer", r));
    }
    Ok((cin.input_buffer, cout.bitstream_buffer))
}

// ─── encoder ────────────────────────────────────────────────────────────────

/// Owned CUDA context (NVENC's device handle). Created on - and current
/// for - the capture thread, which is the only thread that encodes.
struct CudaCtx {
    raw: *mut c_void,
    destroy: FnCuCtxDestroy,
}

impl Drop for CudaCtx {
    fn drop(&mut self) {
        // SAFETY: `raw` is a live context created by cuCtxCreate_v2.
        let _ = unsafe { (self.destroy)(self.raw) };
    }
}

/// One NVENC session at a fixed resolution (rebuilt on source resize).
struct Session {
    encoder: *mut c_void,
    input: *mut c_void,
    output: *mut c_void,
    dims: (u32, u32),
    frame_index: u64,
    /// First frame after (re)creation always gets IDR + headers.
    fresh: bool,
    /// The config this session was initialised with, kept alive so a retune
    /// can re-poke its rate-control fields and hand the whole thing back to
    /// `nvEncReconfigureEncoder`. `None` until `configure_session` succeeds.
    config: Option<Box<PresetConfig>>,
}

impl Session {
    fn destroy(&mut self, libs: &NvLibs) {
        if !self.input.is_null() {
            if let Some(f) = libs.fns.nv_enc_destroy_input_buffer {
                // SAFETY: live encoder + buffer handles.
                let _ = unsafe { f(self.encoder, self.input) };
            }
            self.input = std::ptr::null_mut();
        }
        if !self.output.is_null() {
            if let Some(f) = libs.fns.nv_enc_destroy_bitstream_buffer {
                // SAFETY: live encoder + buffer handles.
                let _ = unsafe { f(self.encoder, self.output) };
            }
            self.output = std::ptr::null_mut();
        }
        if !self.encoder.is_null() {
            if let Some(f) = libs.fns.nv_enc_destroy_encoder {
                // SAFETY: live encoder handle.
                let _ = unsafe { f(self.encoder) };
            }
            self.encoder = std::ptr::null_mut();
        }
    }
}

/// Write the CBR target into a config blob's rate-control fields.
fn poke_rate_control(cfg: &mut [u8; 3584], bitrate: u32) {
    let bytes = bitrate.to_ne_bytes();
    cfg[cfg_off::AVERAGE_BITRATE..cfg_off::AVERAGE_BITRATE + 4].copy_from_slice(&bytes);
    cfg[cfg_off::MAX_BITRATE..cfg_off::MAX_BITRATE + 4].copy_from_slice(&bytes);
}

/// Fill the session geometry NVENC needs, for both the initial
/// `nvEncInitializeEncoder` and any later `nvEncReconfigureEncoder`.
///
/// A reconfigure whose geometry disagrees with the original is rejected (or
/// silently resets the encoder), so both paths must produce identical params
/// apart from the config contents - which is why this is one function rather
/// than two similar blocks that could drift.
fn fill_init_params(init: &mut InitializeParams, w: u32, h: u32, fps: u32, config: *mut EncConfig) {
    init.version = NV_ENC_INITIALIZE_PARAMS_VER;
    init.encode_guid = NV_ENC_CODEC_H264_GUID;
    init.preset_guid = NV_ENC_PRESET_P4_GUID;
    init.encode_width = w;
    init.encode_height = h;
    init.dar_width = w;
    init.dar_height = h;
    init.frame_rate_num = fps;
    init.frame_rate_den = 1;
    init.enable_encode_async = 0; // synchronous on Linux
    init.enable_ptd = 1; // driver decides picture types (we force IDRs)
    init.encode_config = config;
    init.max_encode_width = w;
    init.max_encode_height = h;
    init.tuning_info = NV_ENC_TUNING_INFO_LOW_LATENCY;
}

/// Stateful NVENC H.264 encoder consuming RGBA frames; interface-identical
/// to the VA-API tier so the pipeline can swap tiers freely.
pub(crate) struct NvencEncoder {
    settings: EncodeSettings,
    _ctx: CudaCtx,
    session: Option<Session>,
    /// Live rate-control target from the congestion controller, or 0 before
    /// one has arrived (then [`scaled_bitrate`] alone decides).
    target_bps: u32,
}

impl std::fmt::Debug for NvencEncoder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NvencEncoder").finish_non_exhaustive()
    }
}

impl Drop for NvencEncoder {
    fn drop(&mut self) {
        if let (Some(mut session), Ok(libs)) = (self.session.take(), libs()) {
            session.destroy(libs);
        }
    }
}

impl NvencEncoder {
    /// Load the driver libraries and stand up a CUDA context on device 0
    /// (honours `CUDA_VISIBLE_DEVICES`). Fails cleanly on machines
    /// without an NVIDIA driver so the tier ladder can move on.
    pub(crate) fn probe(settings: EncodeSettings) -> Result<Self, String> {
        let libs = libs().map_err(|e| format!("NVIDIA driver stack not loadable: {e}"))?;

        // SAFETY: plain driver-API calls with out-params.
        let r = unsafe { (libs.cu_init)(0) };
        if r != CUDA_SUCCESS {
            return Err(format!("cuInit failed ({r})"));
        }
        let mut count = 0i32;
        // SAFETY: valid out-pointer.
        let r = unsafe { (libs.cu_device_get_count)(&mut count) };
        if r != CUDA_SUCCESS || count <= 0 {
            return Err(format!("no CUDA devices (status {r}, count {count})"));
        }
        let mut device = 0i32;
        // SAFETY: valid out-pointer; ordinal 0 exists (count > 0).
        let r = unsafe { (libs.cu_device_get)(&mut device, 0) };
        if r != CUDA_SUCCESS {
            return Err(format!("cuDeviceGet(0) failed ({r})"));
        }
        let mut name = [0 as c_char; 128];
        // SAFETY: buffer of the stated size.
        if unsafe { (libs.cu_device_get_name)(name.as_mut_ptr(), name.len() as i32, device) }
            == CUDA_SUCCESS
        {
            // SAFETY: the driver NUL-terminates within the buffer.
            let name = unsafe { CStr::from_ptr(name.as_ptr()) }
                .to_string_lossy()
                .into_owned();
            tracing::info!(gpu = name, "screenshare: NVENC encoder ready");
        }
        let mut raw = std::ptr::null_mut();
        // SAFETY: valid out-pointer; the created context becomes current on
        // this thread, which is the thread all encode calls run on.
        let r = unsafe { (libs.cu_ctx_create)(&mut raw, 0, device) };
        if r != CUDA_SUCCESS || raw.is_null() {
            return Err(format!("cuCtxCreate failed ({r})"));
        }

        Ok(Self {
            settings,
            _ctx: CudaCtx {
                raw,
                destroy: libs.cu_ctx_destroy,
            },
            session: None,
            target_bps: 0,
        })
    }

    /// Bring up one NVENC H.264 session (open, configure, allocate buffers).
    /// Any failure after the encoder opens tears it back down here, so the
    /// per-stage helpers can propagate with `?` and never leak the encoder.
    fn create_session(&self, libs: &NvLibs, w: u32, h: u32) -> Result<Session, String> {
        let encoder = open_encode_session(libs, self._ctx.raw)?;
        let mut session = Session {
            encoder,
            input: std::ptr::null_mut(),
            output: std::ptr::null_mut(),
            dims: (w, h),
            frame_index: 0,
            fresh: true,
            config: None,
        };
        match self.configure_session(libs, &mut session, w, h) {
            Ok(bitrate) => {
                tracing::info!(w, h, bitrate, "screenshare: NVENC H.264 session up");
                Ok(session)
            }
            Err(e) => {
                session.destroy(libs);
                Err(e)
            }
        }
    }

    /// Configure the opened encoder and allocate its I/O buffers, storing the
    /// buffer handles into `session`. Returns the negotiated bitrate. On any
    /// `Err` the caller destroys `session`.
    fn configure_session(
        &self,
        libs: &NvLibs,
        session: &mut Session,
        w: u32,
        h: u32,
    ) -> Result<u32, String> {
        let (bitrate, config) = self.initialize_encoder(libs, session.encoder, w, h)?;
        let (input, output) = create_io_buffers(libs, session.encoder, w, h)?;
        session.input = input;
        session.output = output;
        session.config = Some(config);
        Ok(bitrate)
    }

    /// Apply our stream contract to the encoder (P4/low-latency preset, Main
    /// profile, CBR at the scaled bitrate, I/P only, app-forced IDRs) and
    /// initialize it. Returns the negotiated bitrate.
    fn initialize_encoder(
        &self,
        libs: &NvLibs,
        encoder: *mut c_void,
        w: u32,
        h: u32,
    ) -> Result<(u32, Box<PresetConfig>), String> {
        let get_preset = libs
            .fns
            .nv_enc_get_encode_preset_config_ex
            .ok_or("nvEncGetEncodePresetConfigEx missing")?;
        let mut preset: Box<PresetConfig> =
            // SAFETY: zero is a valid initial byte pattern for the struct.
            unsafe { Box::new(std::mem::zeroed()) };
        preset.version = NV_ENC_PRESET_CONFIG_VER;
        preset.preset_cfg.bytes[..4].copy_from_slice(&NV_ENC_CONFIG_VER.to_ne_bytes());
        // SAFETY: live encoder, valid preset struct.
        let r = unsafe {
            get_preset(
                encoder,
                NV_ENC_CODEC_H264_GUID,
                NV_ENC_PRESET_P4_GUID,
                NV_ENC_TUNING_INFO_LOW_LATENCY,
                preset.as_mut(),
            )
        };
        if r != NV_ENC_SUCCESS {
            return Err(nv_err(libs, encoder, "nvEncGetEncodePresetConfigEx", r));
        }

        let bitrate = self.effective_bitrate(w, h);
        let cfg = &mut preset.preset_cfg.bytes;
        cfg[..4].copy_from_slice(&NV_ENC_CONFIG_VER.to_ne_bytes());
        let poke_u32 = |cfg: &mut [u8; 3584], off: usize, v: u32| {
            cfg[off..off + 4].copy_from_slice(&v.to_ne_bytes());
        };
        cfg[cfg_off::PROFILE_GUID..cfg_off::PROFILE_GUID + 16]
            .copy_from_slice(&guid_bytes(NV_ENC_H264_PROFILE_MAIN_GUID));
        poke_u32(cfg, cfg_off::GOP_LENGTH, NVENC_INFINITE_GOPLENGTH);
        poke_u32(cfg, cfg_off::FRAME_INTERVAL_P, 1);
        poke_u32(cfg, cfg_off::RC_MODE, NV_ENC_PARAMS_RC_CBR);
        poke_rate_control(cfg, bitrate);

        let fps = self.settings.max_fps.clamp(1.0, 240.0).round() as u32;
        let init_fn = libs
            .fns
            .nv_enc_initialize_encoder
            .ok_or("nvEncInitializeEncoder missing")?;
        // SAFETY: zeroed + fully filled below.
        let mut init: Box<InitializeParams> = unsafe { Box::new(std::mem::zeroed()) };
        fill_init_params(&mut init, w, h, fps, &mut preset.preset_cfg);
        // SAFETY: live encoder, valid init struct (config points into
        // `preset`, alive for the duration of the call).
        let r = unsafe { init_fn(encoder, init.as_mut()) };
        if r != NV_ENC_SUCCESS {
            return Err(nv_err(libs, encoder, "nvEncInitializeEncoder", r));
        }
        Ok((bitrate, preset))
    }

    /// The target for a `w` x `h` frame, never above what the content needs.
    fn effective_bitrate(&self, w: u32, h: u32) -> u32 {
        let ceiling = scaled_bitrate(&self.settings, w, h);
        if self.target_bps == 0 {
            ceiling
        } else {
            self.target_bps.min(ceiling)
        }
    }

    /// Retarget rate control on the live session.
    ///
    /// `nvEncReconfigureEncoder` takes a full re-initialisation, so the
    /// geometry handed back must match what the session was created with -
    /// hence the shared [`fill_init_params`]. Only the rate-control fields of
    /// the retained config change, and both `resetEncoder` and `forceIDR`
    /// stay clear, so the encoder keeps its reference chain and its
    /// rate-control state and emits no keyframe.
    pub(crate) fn set_bitrate(&mut self, bps: u32) {
        if self.target_bps == bps {
            return;
        }
        self.target_bps = bps;
        let Ok(libs) = libs() else { return };
        let Some(reconfigure) = libs.fns.nv_enc_reconfigure_encoder else {
            tracing::debug!("screenshare: NVENC driver has no reconfigure entry point");
            return;
        };
        let settings = self.settings;
        let fps = settings.max_fps.clamp(1.0, 240.0).round() as u32;
        let Some(session) = self.session.as_mut() else {
            return; // no session yet; creation will pick the target up
        };
        let (w, h) = session.dims;
        let effective = bps.min(scaled_bitrate(&settings, w, h));
        let encoder = session.encoder;
        let Some(config) = session.config.as_mut() else {
            return;
        };
        poke_rate_control(&mut config.preset_cfg.bytes, effective);

        // SAFETY: zeroed + fully filled below.
        let mut re: Box<ReconfigureParams> = unsafe { Box::new(std::mem::zeroed()) };
        re.version = NV_ENC_RECONFIGURE_PARAMS_VER;
        re.flags = 0;
        let cfg_ptr: *mut EncConfig = &mut config.preset_cfg;
        fill_init_params(&mut re.re_init, w, h, fps, cfg_ptr);
        // SAFETY: live encoder handle and a version-stamped params struct
        // whose config pointer targets the session-owned config, which
        // outlives the call.
        let r = unsafe { reconfigure(encoder, re.as_mut()) };
        if r == NV_ENC_SUCCESS {
            tracing::debug!(bps = effective, "screenshare: NVENC retuned");
        } else {
            tracing::warn!(
                "screenshare: {}",
                nv_err(libs, encoder, "nvEncReconfigureEncoder", r)
            );
        }
    }

    /// Encode one RGBA frame (interface-identical to the VA-API tier).
    pub(crate) fn encode_rgba(
        &mut self,
        width: u32,
        height: u32,
        rgba: &[u8],
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String> {
        let w = width & !1;
        let h = height & !1;
        if w == 0 || h == 0 || rgba.len() < (width as usize) * (height as usize) * 4 {
            return Err("frame too small".to_owned());
        }
        let libs = libs()?;

        if self.session.as_ref().is_none_or(|s| s.dims != (w, h)) {
            if let Some(mut old) = self.session.take() {
                old.destroy(libs);
            }
            self.session = Some(self.create_session(libs, w, h)?);
        }
        let session = self.session.as_mut().ok_or("session missing after init")?;
        let force = force_keyframe || session.fresh;
        session.fresh = false;

        // ── upload: RGBA -> NV12 straight into the locked input buffer ──
        let lock_in = libs
            .fns
            .nv_enc_lock_input_buffer
            .ok_or("nvEncLockInputBuffer missing")?;
        let unlock_in = libs
            .fns
            .nv_enc_unlock_input_buffer
            .ok_or("nvEncUnlockInputBuffer missing")?;
        // SAFETY: zeroed + version-stamped.
        let mut li: LockInputBuffer = unsafe { std::mem::zeroed() };
        li.version = NV_ENC_LOCK_INPUT_BUFFER_VER;
        li.input_buffer = session.input;
        // SAFETY: live encoder + input buffer.
        let r = unsafe { lock_in(session.encoder, &mut li) };
        if r != NV_ENC_SUCCESS || li.buffer_data_ptr.is_null() || li.pitch == 0 {
            return Err(nv_err(libs, session.encoder, "nvEncLockInputBuffer", r));
        }
        let pitch = li.pitch as usize;
        let nv12_len = pitch * (h as usize) * 3 / 2;
        {
            // SAFETY: NVENC's NV12 input-buffer contract: the locked
            // allocation holds `pitch` bytes per row for `h` luma rows
            // followed by `h/2` interleaved chroma rows.
            let dst =
                unsafe { std::slice::from_raw_parts_mut(li.buffer_data_ptr as *mut u8, nv12_len) };
            rgba_to_nv12_pitched(width as usize, w as usize, h as usize, rgba, dst, pitch);
        }
        // SAFETY: live encoder + locked buffer.
        let r = unsafe { unlock_in(session.encoder, session.input) };
        if r != NV_ENC_SUCCESS {
            return Err(nv_err(libs, session.encoder, "nvEncUnlockInputBuffer", r));
        }

        // ── encode ───────────────────────────────────────────────────────
        let encode = libs
            .fns
            .nv_enc_encode_picture
            .ok_or("nvEncEncodePicture missing")?;
        // SAFETY: zeroed + fully filled below.
        let mut pic: Box<PicParams> = unsafe { Box::new(std::mem::zeroed()) };
        pic.version = NV_ENC_PIC_PARAMS_VER;
        pic.input_width = w;
        pic.input_height = h;
        pic.input_pitch = li.pitch;
        pic.encode_pic_flags = if force {
            NV_ENC_PIC_FLAGS_IDR_WITH_HEADERS
        } else {
            0
        };
        pic.input_time_stamp = session.frame_index;
        pic.input_buffer = session.input;
        pic.output_bitstream = session.output;
        pic.buffer_fmt = NV_ENC_BUFFER_FORMAT_NV12;
        pic.picture_struct = NV_ENC_PIC_STRUCT_FRAME;
        session.frame_index = session.frame_index.wrapping_add(1);
        // SAFETY: live encoder, valid pic params referencing live buffers.
        let r = unsafe { encode(session.encoder, pic.as_mut()) };
        if r != NV_ENC_SUCCESS {
            return Err(nv_err(libs, session.encoder, "nvEncEncodePicture", r));
        }

        // ── drain ────────────────────────────────────────────────────────
        let lock_bs = libs
            .fns
            .nv_enc_lock_bitstream
            .ok_or("nvEncLockBitstream missing")?;
        let unlock_bs = libs
            .fns
            .nv_enc_unlock_bitstream
            .ok_or("nvEncUnlockBitstream missing")?;
        // SAFETY: zeroed + version-stamped.
        let mut lb: Box<LockBitstream> = unsafe { Box::new(std::mem::zeroed()) };
        lb.version = NV_ENC_LOCK_BITSTREAM_VER;
        lb.output_bitstream = session.output;
        // SAFETY: live encoder + bitstream buffer; doNotWait=0 blocks until
        // the frame is done (sync mode).
        let r = unsafe { lock_bs(session.encoder, lb.as_mut()) };
        if r != NV_ENC_SUCCESS {
            return Err(nv_err(libs, session.encoder, "nvEncLockBitstream", r));
        }
        let size = lb.bitstream_size_in_bytes as usize;
        let data = if size > 0 && !lb.bitstream_buffer_ptr.is_null() {
            // SAFETY: the driver reports `size` valid bytes at the pointer
            // while the bitstream is locked.
            unsafe { std::slice::from_raw_parts(lb.bitstream_buffer_ptr as *const u8, size) }
                .to_vec()
        } else {
            Vec::new()
        };
        let keyframe = lb.picture_type == NV_ENC_PIC_TYPE_IDR;
        // SAFETY: live encoder + locked bitstream buffer.
        let r = unsafe { unlock_bs(session.encoder, session.output) };
        if r != NV_ENC_SUCCESS {
            return Err(nv_err(libs, session.encoder, "nvEncUnlockBitstream", r));
        }

        if data.is_empty() {
            return Ok(None);
        }
        Ok(Some(EncodedFrame { data, keyframe }))
    }
}

fn guid_bytes(g: Guid) -> [u8; 16] {
    let mut out = [0u8; 16];
    out[..4].copy_from_slice(&g.data1.to_ne_bytes());
    out[4..6].copy_from_slice(&g.data2.to_ne_bytes());
    out[6..8].copy_from_slice(&g.data3.to_ne_bytes());
    out[8..].copy_from_slice(&g.data4);
    out
}

/// RGBA -> NV12 written directly into a pitched destination (Y rows at
/// `row * pitch`, interleaved UV rows at `pitch * h + row * pitch`), same
/// BT.601 fixed-point math as the other tiers, threaded in bands of
/// source-row pairs (per-band work in [`convert_nv12_band`]).
fn rgba_to_nv12_pitched(
    src_width: usize,
    w: usize,
    h: usize,
    rgba: &[u8],
    dst: &mut [u8],
    pitch: usize,
) {
    let (y_plane, uv_plane) = dst.split_at_mut(pitch * h);
    let pairs = h / 2;
    let threads = std::thread::available_parallelism()
        .map(std::num::NonZero::get)
        .unwrap_or(4)
        .min(8);
    let band = pairs.div_ceil(threads.max(1)).max(1);

    std::thread::scope(|scope| {
        let mut y_rest = y_plane;
        let mut uv_rest = uv_plane;
        let mut pair0 = 0usize;
        while pair0 < pairs {
            let take = band.min(pairs - pair0);
            let (y_band, y_next) = y_rest.split_at_mut(take * 2 * pitch);
            let (uv_band, uv_next) = uv_rest.split_at_mut((take * pitch).min(uv_rest.len()));
            y_rest = y_next;
            uv_rest = uv_next;
            let first_pair = pair0;
            let _ = scope.spawn(move || {
                convert_nv12_band(rgba, src_width, w, pitch, first_pair, take, y_band, uv_band);
            });
            pair0 += take;
        }
    });
}

/// Convert `take` source-row-pairs starting at `first_pair` into one band's
/// worth of NV12 (Y into `y_band`, interleaved UV into `uv_band`). The hot
/// BT.601 arithmetic that the band threads run in parallel.
#[allow(
    clippy::too_many_arguments,
    reason = "the band's source view + both destination planes + geometry; \
              a struct would only relocate the same fields"
)]
fn convert_nv12_band(
    rgba: &[u8],
    src_width: usize,
    w: usize,
    pitch: usize,
    first_pair: usize,
    take: usize,
    y_band: &mut [u8],
    uv_band: &mut [u8],
) {
    for p in 0..take {
        let src_row = (first_pair + p) * 2;
        for dy in 0..2 {
            let src = &rgba[(src_row + dy) * src_width * 4..];
            let dst = &mut y_band[(p * 2 + dy) * pitch..(p * 2 + dy) * pitch + w];
            for (x, out_y) in dst.iter_mut().enumerate() {
                let px = &src[x * 4..x * 4 + 4];
                let (r, g, b) = (i32::from(px[0]), i32::from(px[1]), i32::from(px[2]));
                *out_y = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(0, 255) as u8;
            }
        }
        let row0 = &rgba[src_row * src_width * 4..];
        let row1 = &rgba[(src_row + 1) * src_width * 4..];
        let uv_row = &mut uv_band[p * pitch..p * pitch + w];
        for x2 in 0..w / 2 {
            let x = x2 * 2;
            let (mut r, mut g, mut b) = (0i32, 0i32, 0i32);
            for row in [row0, row1] {
                for dx in 0..2 {
                    let px = &row[(x + dx) * 4..(x + dx) * 4 + 4];
                    r += i32::from(px[0]);
                    g += i32::from(px[1]);
                    b += i32::from(px[2]);
                }
            }
            r /= 4;
            g /= 4;
            b /= 4;
            uv_row[x] = ((((-38) * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(0, 255) as u8;
            uv_row[x + 1] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(0, 255) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_stamps_match_sdk_12_1() {
        // Literals computed from the 12.1 header macros; guards against
        // accidental edits to the version math.
        assert_eq!(NVENCAPI_VERSION, 0x0100_000c);
        assert_eq!(
            NV_ENC_CONFIG_VER,
            0x0100_000c | (8 << 16) | (0x7 << 28) | (1 << 31)
        );
        assert_eq!(
            NV_ENC_PIC_PARAMS_VER,
            0x0100_000c | (6 << 16) | (0x7 << 28) | (1 << 31)
        );
    }

    #[test]
    fn pitched_nv12_conversion_matches_tight_conversion() {
        // Same input through the pitched converter (pitch > width) must
        // produce the same plane content as the VA tier's tight converter.
        const W: usize = 6;
        const H: usize = 4;
        const PITCH: usize = 16;
        let rgba: Vec<u8> = (0..W * H * 4).map(|i| (i * 7 % 251) as u8).collect();

        let mut pitched = vec![0u8; PITCH * H * 3 / 2];
        rgba_to_nv12_pitched(W, W, H, &rgba, &mut pitched, PITCH);

        let mut tight = Vec::new();
        crate::linux::vaapi::rgba_to_nv12_for_tests(W, W, H, &rgba, &mut tight);

        for row in 0..H {
            assert_eq!(
                &pitched[row * PITCH..row * PITCH + W],
                &tight[row * W..row * W + W]
            );
        }
        for row in 0..H / 2 {
            assert_eq!(
                &pitched[PITCH * H + row * PITCH..PITCH * H + row * PITCH + W],
                &tight[W * H + row * W..W * H + row * W + W],
            );
        }
    }

    /// Real hardware encode on the first CUDA device. Run manually where
    /// an NVIDIA driver is reachable (bare Linux or WSL):
    /// `cargo test -p fancy-screenshare nvenc_hw -- --ignored --nocapture`
    #[test]
    #[ignore = "requires an NVIDIA GPU + driver (works in WSL)"]
    fn nvenc_hw_smoke() {
        const W: u32 = 640;
        const H: u32 = 360;
        let mut enc = NvencEncoder::probe(EncodeSettings::default()).expect("NVENC probe");

        let mut frames = 0usize;
        let mut bytes = 0usize;
        let mut dump: Vec<u8> = Vec::new();
        for i in 0..60u32 {
            // Moving vertical bar: every frame differs, so P-frames have
            // real motion to code.
            let mut rgba = vec![20u8; (W * H * 4) as usize];
            let bar_x = (i * 9) % (W - 40);
            for row in 0..H as usize {
                let start = row * (W as usize) * 4 + (bar_x as usize) * 4;
                for px in rgba[start..start + 40 * 4].chunks_exact_mut(4) {
                    px[0] = 240;
                    px[1] = 80;
                    px[2] = (i * 4) as u8;
                    px[3] = 255;
                }
            }
            let out = enc.encode_rgba(W, H, &rgba, i == 0).expect("encode frame");
            if let Some(frame) = out {
                if i == 0 {
                    assert!(frame.keyframe, "first frame must be an IDR");
                    assert!(
                        crate::linux::vaapi::contains_idr(&frame.data),
                        "first frame bitstream must contain an IDR NAL",
                    );
                }
                frames += 1;
                bytes += frame.data.len();
                dump.extend_from_slice(&frame.data);
            }
        }
        assert!(
            frames >= 59,
            "expected ~1 access unit per frame, got {frames}"
        );
        assert!(bytes > 5_000, "suspiciously small bitstream: {bytes} bytes");
        // Set FANCY_NVENC_DUMP=/path/out.h264 to keep the Annex-B stream
        // for external validation (ffprobe/ffplay decode it directly).
        if let Ok(path) = std::env::var("FANCY_NVENC_DUMP") {
            std::fs::write(&path, &dump).expect("write dump");
            println!("NVENC smoke: bitstream dumped to {path}");
        }
        println!("NVENC smoke: {frames} frames, {bytes} bytes total");
    }
}
