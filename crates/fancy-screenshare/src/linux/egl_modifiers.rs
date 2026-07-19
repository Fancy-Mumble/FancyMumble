//! DRM format-modifier enumeration via EGL - the OBS method.
//!
//! Compositors only allocate DMA-BUF screencast buffers when the consumer's
//! `EnumFormat` pod offers modifiers the compositor's own GPU can export.
//! Generic guesses (LINEAR, INVALID) intersect to nothing on NVIDIA, whose
//! exportable set is driver-specific block-linear layouts - so, like OBS
//! (`plugins/linux-pipewire`), we ask EGL: `eglQueryDmaBufFormatsEXT` +
//! `eglQueryDmaBufModifiersEXT` on a headless EGL device. Getting a DMA-BUF
//! stream is what unlocks Mutter's direct-scanout recording (mutter#3074:
//! fullscreen surfaces freeze SHM screencasts).
//!
//! Everything is resolved lazily once per process and the library handle is
//! deliberately leaked: EGL keeps global driver state, and unloading NVIDIA
//! GL libraries mid-process is a known crash source.
#![allow(
    unsafe_code,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    reason = "dlopen'd C API: every unsafe block is a single FFI call with \
              counted-output buffers sized by a preceding count query; the \
              casts convert EGL's signed counts/fourccs at API boundaries"
)]

use std::ffi::c_void;
use std::os::raw::c_char;
use std::sync::OnceLock;

pub(crate) type EglBoolean = u32;
pub(crate) type EglInt = i32;
pub(crate) type EglDisplay = *mut c_void;
type EglDevice = *mut c_void;

const EGL_PLATFORM_DEVICE_EXT: u32 = 0x313F;
const EGL_PLATFORM_WAYLAND_KHR: u32 = 0x31D8;
const EGL_EXTENSIONS: EglInt = 0x3055;
const EGL_TRUE: EglBoolean = 1;

/// DRM fourcc for the `BGRx` memory layout (`DRM_FORMAT_XRGB8888`, "XR24").
pub(crate) const DRM_FOURCC_XRGB8888: u32 = 0x3432_5258;
/// DRM fourcc for the `BGRA` memory layout (`DRM_FORMAT_ARGB8888`, "AR24").
pub(crate) const DRM_FOURCC_ARGB8888: u32 = 0x3432_5241;

type FnGetProcAddress = unsafe extern "C" fn(*const c_char) -> *mut c_void;
type FnQueryDevices = unsafe extern "C" fn(EglInt, *mut EglDevice, *mut EglInt) -> EglBoolean;
type FnGetPlatformDisplay =
    unsafe extern "C" fn(u32, *mut c_void, *const EglInt) -> EglDisplay;
type FnInitialize = unsafe extern "C" fn(EglDisplay, *mut EglInt, *mut EglInt) -> EglBoolean;
type FnQueryString = unsafe extern "C" fn(EglDisplay, EglInt) -> *const c_char;
type FnQueryDmaBufFormats =
    unsafe extern "C" fn(EglDisplay, EglInt, *mut i32, *mut EglInt) -> EglBoolean;
type FnQueryDmaBufModifiers = unsafe extern "C" fn(
    EglDisplay,
    i32,
    EglInt,
    *mut u64,
    *mut EglBoolean,
    *mut EglInt,
) -> EglBoolean;

/// The process-wide EGL state shared by modifier enumeration and the
/// DMA-BUF importer: the chosen device display (initialized, never
/// terminated) and the proc-address loader.
pub(crate) struct EglRuntime {
    pub(crate) display: EglDisplay,
    get_proc: FnGetProcAddress,
    /// Per-fourcc modifiers this display's GPU can share.
    modifiers: Vec<(u32, Vec<u64>)>,
}

// SAFETY: an initialized EGLDisplay handle and eglGetProcAddress are
// process-global, thread-safe entry points per the EGL spec; contexts (the
// thread-affine part) are created by users, not stored here.
unsafe impl Send for EglRuntime {}
// SAFETY: as above - shared references only read immutable handles.
unsafe impl Sync for EglRuntime {}

impl EglRuntime {
    /// Resolve an EGL/GL entry point through the runtime's loader.
    pub(crate) fn proc_addr(&self, name: &[u8]) -> Option<*mut c_void> {
        debug_assert!(name.ends_with(b"\0"));
        // SAFETY: `name` is NUL-terminated (asserted above).
        let p = unsafe { (self.get_proc)(name.as_ptr().cast()) };
        (!p.is_null()).then_some(p)
    }
}

/// The shared EGL runtime, set up once per process; `None` when EGL or the
/// dmabuf-modifier extension is unavailable (SHM capture still works).
pub(crate) fn runtime() -> Option<&'static EglRuntime> {
    static CACHE: OnceLock<Option<EglRuntime>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let rt = query_all(&[DRM_FOURCC_XRGB8888, DRM_FOURCC_ARGB8888]);
            if let Some(rt) = &rt {
                for (fourcc, mods) in &rt.modifiers {
                    tracing::info!(
                        fourcc = format!("{fourcc:08x}"),
                        count = mods.len(),
                        "screenshare: EGL dmabuf modifiers enumerated",
                    );
                }
            }
            rt
        })
        .as_ref()
}

/// Modifiers the GPU can share for `fourcc`. Empty when EGL is unavailable -
/// callers then skip the DMA-BUF offer entirely.
pub(crate) fn dmabuf_modifiers(fourcc: u32) -> &'static [u64] {
    runtime().map_or(&[], |rt| {
        rt.modifiers
            .iter()
            .find(|(f, _)| *f == fourcc)
            .map_or(&[], |(_, mods)| mods.as_slice())
    })
}

fn query_all(fourccs: &[u32]) -> Option<EglRuntime> {
    // SAFETY: dlopen of the well-known system EGL library.
    let lib = unsafe { libloading::Library::new("libEGL.so.1") }
        .map_err(|e| tracing::info!("screenshare: no EGL: {e}"))
        .ok()?;

    // SAFETY: standard EGL entry point with the declared C signature.
    let get_proc: FnGetProcAddress =
        *unsafe { lib.get(b"eglGetProcAddress\0") }.ok()?;
    let proc_addr = |name: &[u8]| -> Option<*mut c_void> {
        // SAFETY: `name` is a NUL-terminated literal below.
        let p = unsafe { get_proc(name.as_ptr().cast()) };
        (!p.is_null()).then_some(p)
    };
    macro_rules! load {
        ($name:literal, $ty:ty) => {{
            // SAFETY: the extension function's C signature matches `$ty`
            // per the EGL extension registry.
            let f: $ty = unsafe { std::mem::transmute(proc_addr($name)?) };
            f
        }};
    }
    let query_devices = load!(b"eglQueryDevicesEXT\0", FnQueryDevices);
    let get_platform_display =
        load!(b"eglGetPlatformDisplayEXT\0", FnGetPlatformDisplay);
    let initialize = load!(b"eglInitialize\0", FnInitialize);
    let query_string = load!(b"eglQueryString\0", FnQueryString);
    let query_formats = load!(b"eglQueryDmaBufFormatsEXT\0", FnQueryDmaBufFormats);
    let query_modifiers = load!(b"eglQueryDmaBufModifiersEXT\0", FnQueryDmaBufModifiers);

    // Unloading NVIDIA EGL after initializing displays is crash-prone; the
    // one-time leak is the safe lifetime.
    std::mem::forget(lib);

    let fns = DisplayFns {
        initialize,
        query_string,
        query_formats,
        query_modifiers,
    };

    // Preferred: an EGL display on the session's own WAYLAND connection -
    // the same driver instance and allocation domain as the compositor's
    // screencast buffers (what OBS renders through). The headless DEVICE
    // platform enumerates and negotiates fine but NVIDIA's device-platform
    // display refuses to import Mutter's dmabufs (EGL_BAD_ALLOC).
    if let Some(rt) = wayland_display_runtime(get_proc, get_platform_display, &fns, fourccs) {
        tracing::info!("screenshare: EGL on the session Wayland display");
        return Some(rt);
    }

    let mut count: EglInt = 0;
    // SAFETY: count query per EGL_EXT_device_enumeration.
    if unsafe { query_devices(0, std::ptr::null_mut(), &raw mut count) } != EGL_TRUE || count <= 0
    {
        return None;
    }
    let mut devices: Vec<EglDevice> = vec![std::ptr::null_mut(); count as usize];
    // SAFETY: `devices` holds `count` slots as returned by the count query.
    if unsafe { query_devices(count, devices.as_mut_ptr(), &raw mut count) } != EGL_TRUE {
        return None;
    }
    devices.truncate(count.max(0) as usize);

    devices.into_iter().find_map(|device| {
        // SAFETY: platform-display lookup for an enumerated device.
        let display = unsafe {
            get_platform_display(EGL_PLATFORM_DEVICE_EXT, device, std::ptr::null())
        };
        if display.is_null() {
            return None;
        }
        let modifiers = display_modifiers(display, &fns, fourccs)?;
        Some(EglRuntime {
            display,
            get_proc,
            modifiers,
        })
    })
}

/// Try an EGL display on the session's Wayland connection (kept open for
/// the process lifetime). `None` when there is no Wayland session or the
/// display lacks the dmabuf-modifier extension.
fn wayland_display_runtime(
    get_proc: FnGetProcAddress,
    get_platform_display: FnGetPlatformDisplay,
    fns: &DisplayFns,
    fourccs: &[u32],
) -> Option<EglRuntime> {
    let _wayland = std::env::var_os("WAYLAND_DISPLAY")?;
    // SAFETY: dlopen of the well-known system Wayland client library.
    let wl = unsafe { libloading::Library::new("libwayland-client.so.0") }
        .map_err(|e| tracing::debug!("screenshare: no libwayland-client: {e}"))
        .ok()?;
    type FnWlConnect = unsafe extern "C" fn(*const c_char) -> *mut c_void;
    // SAFETY: standard libwayland entry point with the declared signature.
    let connect: FnWlConnect = *unsafe { wl.get(b"wl_display_connect\0") }.ok()?;
    // SAFETY: NULL name = connect to $WAYLAND_DISPLAY.
    let wl_display = unsafe { connect(std::ptr::null()) };
    if wl_display.is_null() {
        return None;
    }
    // The connection backs the EGL display for the process lifetime.
    std::mem::forget(wl);

    // SAFETY: platform-display lookup on a live wl_display.
    let display = unsafe {
        get_platform_display(EGL_PLATFORM_WAYLAND_KHR, wl_display, std::ptr::null())
    };
    if display.is_null() {
        return None;
    }
    let modifiers = display_modifiers(display, fns, fourccs)?;
    Some(EglRuntime {
        display,
        get_proc,
        modifiers,
    })
}

/// The per-display EGL entry points [`display_modifiers`] needs.
struct DisplayFns {
    initialize: FnInitialize,
    query_string: FnQueryString,
    query_formats: FnQueryDmaBufFormats,
    query_modifiers: FnQueryDmaBufModifiers,
}

/// Modifier lists for the `fourccs` this display's GPU can share; `None`
/// when the display lacks the import-modifiers extension or none match.
fn display_modifiers(
    display: EglDisplay,
    fns: &DisplayFns,
    fourccs: &[u32],
) -> Option<Vec<(u32, Vec<u64>)>> {
    // SAFETY: eglInitialize on a valid display; version outputs unused.
    if unsafe { (fns.initialize)(display, std::ptr::null_mut(), std::ptr::null_mut()) }
        != EGL_TRUE
    {
        return None;
    }
    // SAFETY: querying the display's extension string.
    let exts = unsafe { (fns.query_string)(display, EGL_EXTENSIONS) };
    if exts.is_null() {
        return None;
    }
    // SAFETY: EGL returns a NUL-terminated static string.
    let exts = unsafe { std::ffi::CStr::from_ptr(exts) }.to_string_lossy();
    if !exts.contains("EGL_EXT_image_dma_buf_import_modifiers") {
        return None;
    }

    let mut n: EglInt = 0;
    // SAFETY: count query per EGL_EXT_image_dma_buf_import_modifiers.
    if unsafe { (fns.query_formats)(display, 0, std::ptr::null_mut(), &raw mut n) } != EGL_TRUE
        || n <= 0
    {
        return None;
    }
    let mut formats: Vec<i32> = vec![0; n as usize];
    // SAFETY: `formats` holds `n` slots per the preceding count query.
    if unsafe { (fns.query_formats)(display, n, formats.as_mut_ptr(), &raw mut n) } != EGL_TRUE {
        return None;
    }
    formats.truncate(n.max(0) as usize);

    let result: Vec<(u32, Vec<u64>)> = fourccs
        .iter()
        .filter(|&&fourcc| formats.contains(&(fourcc as i32)))
        .filter_map(|&fourcc| Some((fourcc, format_modifiers(display, fns, fourcc)?)))
        .collect();
    (!result.is_empty()).then_some(result)
}

/// The non-external-only modifiers for one format (all of them if every
/// modifier is external-only - external textures can still be imported by
/// consumers that render rather than read back).
fn format_modifiers(display: EglDisplay, fns: &DisplayFns, fourcc: u32) -> Option<Vec<u64>> {
    let mut m: EglInt = 0;
    // SAFETY: modifier count query for a supported format.
    if unsafe {
        (fns.query_modifiers)(
            display,
            fourcc as i32,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &raw mut m,
        )
    } != EGL_TRUE
        || m <= 0
    {
        return None;
    }
    let mut mods: Vec<u64> = vec![0; m as usize];
    let mut external: Vec<EglBoolean> = vec![0; m as usize];
    // SAFETY: both buffers hold `m` slots per the count query.
    if unsafe {
        (fns.query_modifiers)(
            display,
            fourcc as i32,
            m,
            mods.as_mut_ptr(),
            external.as_mut_ptr(),
            &raw mut m,
        )
    } != EGL_TRUE
    {
        return None;
    }
    let m = m.max(0) as usize;
    let importable: Vec<u64> = mods[..m]
        .iter()
        .zip(&external[..m])
        .filter(|&(_, &ext)| ext != EGL_TRUE)
        .map(|(&modifier, _)| modifier)
        .collect();
    let chosen = if importable.is_empty() {
        mods[..m].to_vec()
    } else {
        importable
    };
    (!chosen.is_empty()).then_some(chosen)
}
