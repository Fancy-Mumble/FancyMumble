//! DMA-BUF frame import: `EGLImage` -> GL texture -> FBO readback.
//!
//! The DMA-BUF screencast buffers Mutter exports (see [`super::egl_modifiers`])
//! are GPU memory in a driver-specific tiled layout - the CPU cannot read
//! them, and on NVIDIA they cannot even be mmapped. The portable consumption
//! path (what OBS renders with, minus the readback) is:
//!
//! 1. `eglCreateImageKHR(EGL_LINUX_DMA_BUF_EXT)` wraps the fd + stride +
//!    modifier without copying,
//! 2. `glEGLImageTargetTexture2DOES` binds it as a GL texture (the driver
//!    handles detiling when sampling),
//! 3. a framebuffer-attached `glReadPixels` hands the CPU tightly packed
//!    RGBA - the GPU does layout conversion; the only CPU cost is the copy.
//!
//! The GL context is created ON the PipeWire loop thread (contexts are
//! thread-affine) via `EGL_KHR_surfaceless_context`, once per stream.
#![allow(
    unsafe_code,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    reason = "dlopen'd C API: each unsafe block is one FFI call; casts sit \
              at the EGL/GL ABI boundary (signed sizes, attrib lists)"
)]

use std::ffi::c_void;
use std::os::fd::RawFd;

use super::egl_modifiers::{EglBoolean, EglDisplay, EglInt, EglRuntime};

type EglContext = *mut c_void;
type EglConfig = *mut c_void;
type EglImage = *mut c_void;
type GlUint = u32;
type GlEnum = u32;
type GlInt = i32;

const EGL_TRUE: EglBoolean = 1;
const EGL_NONE: EglInt = 0x3038;
const EGL_OPENGL_ES2_BIT: EglInt = 0x0004;
const EGL_RENDERABLE_TYPE: EglInt = 0x3040;
const EGL_SURFACE_TYPE: EglInt = 0x3033;
const EGL_CONTEXT_CLIENT_VERSION: EglInt = 0x3098;
const EGL_OPENGL_ES_API: u32 = 0x30A0;
const EGL_LINUX_DMA_BUF_EXT: u32 = 0x3270;
const EGL_WIDTH: EglInt = 0x3057;
const EGL_HEIGHT: EglInt = 0x3056;
const EGL_LINUX_DRM_FOURCC_EXT: EglInt = 0x3271;
const EGL_DMA_BUF_PLANE0_FD_EXT: EglInt = 0x3272;
const EGL_DMA_BUF_PLANE0_OFFSET_EXT: EglInt = 0x3273;
const EGL_DMA_BUF_PLANE0_PITCH_EXT: EglInt = 0x3274;
const EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT: EglInt = 0x3443;
const EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT: EglInt = 0x3444;

const GL_TEXTURE_2D: GlEnum = 0x0DE1;
const GL_TEXTURE_MIN_FILTER: GlEnum = 0x2801;
const GL_TEXTURE_MAG_FILTER: GlEnum = 0x2800;
const GL_NEAREST: GlInt = 0x2600;
const GL_RGBA: GlEnum = 0x1908;
const GL_UNSIGNED_BYTE: GlEnum = 0x1401;
const GL_FRAMEBUFFER: GlEnum = 0x8D40;
const GL_COLOR_ATTACHMENT0: GlEnum = 0x8CE0;
const GL_FRAMEBUFFER_COMPLETE: GlEnum = 0x8CD5;
const GL_PACK_ALIGNMENT: GlEnum = 0x0D05;
const GL_NO_ERROR: GlEnum = 0;

type FnBindApi = unsafe extern "C" fn(u32) -> EglBoolean;
type FnChooseConfig = unsafe extern "C" fn(
    EglDisplay,
    *const EglInt,
    *mut EglConfig,
    EglInt,
    *mut EglInt,
) -> EglBoolean;
type FnCreateContext =
    unsafe extern "C" fn(EglDisplay, EglConfig, EglContext, *const EglInt) -> EglContext;
type FnMakeCurrent =
    unsafe extern "C" fn(EglDisplay, *mut c_void, *mut c_void, EglContext) -> EglBoolean;
type FnCreateImage = unsafe extern "C" fn(
    EglDisplay,
    EglContext,
    u32,
    *mut c_void,
    *const EglInt,
) -> EglImage;
type FnDestroyImage = unsafe extern "C" fn(EglDisplay, EglImage) -> EglBoolean;
type FnGetError = unsafe extern "C" fn() -> EglInt;

type FnGenObjects = unsafe extern "C" fn(GlInt, *mut GlUint);
type FnBindTexture = unsafe extern "C" fn(GlEnum, GlUint);
type FnTexParameteri = unsafe extern "C" fn(GlEnum, GlEnum, GlInt);
type FnEglImageTargetTexture2D = unsafe extern "C" fn(GlEnum, EglImage);
type FnBindFramebuffer = unsafe extern "C" fn(GlEnum, GlUint);
type FnFramebufferTexture2D = unsafe extern "C" fn(GlEnum, GlEnum, GlEnum, GlUint, GlInt);
type FnCheckFramebufferStatus = unsafe extern "C" fn(GlEnum) -> GlEnum;
type FnPixelStorei = unsafe extern "C" fn(GlEnum, GlInt);
type FnReadPixels =
    unsafe extern "C" fn(GlInt, GlInt, GlInt, GlInt, GlEnum, GlEnum, *mut c_void);
type FnGlGetError = unsafe extern "C" fn() -> GlEnum;

/// One dmabuf plane's import parameters, straight from the spa buffer.
pub(crate) struct DmabufPlane {
    pub(crate) fd: RawFd,
    pub(crate) offset: u32,
    pub(crate) stride: i32,
}

/// Per-stream GL state for turning dmabuf frames into RGBA bytes. Must be
/// created and used on ONE thread (the PipeWire loop thread).
pub(crate) struct DmabufImporter {
    display: EglDisplay,
    create_image: FnCreateImage,
    destroy_image: FnDestroyImage,
    egl_get_error: FnGetError,
    bind_texture: FnBindTexture,
    egl_image_target: FnEglImageTargetTexture2D,
    bind_framebuffer: FnBindFramebuffer,
    framebuffer_texture: FnFramebufferTexture2D,
    check_framebuffer: FnCheckFramebufferStatus,
    read_pixels: FnReadPixels,
    gl_get_error: FnGlGetError,
    texture: GlUint,
    framebuffer: GlUint,
}

macro_rules! load {
    ($rt:expr, $name:literal, $ty:ty) => {{
        // SAFETY: the entry point's C signature matches `$ty` per the
        // EGL/GLES2 specs and extension registry.
        let f: $ty = unsafe {
            std::mem::transmute(
                $rt.proc_addr($name)
                    .ok_or_else(|| format!("missing {}", String::from_utf8_lossy($name)))?,
            )
        };
        f
    }};
}

impl DmabufImporter {
    /// Build the surfaceless GLES2 context + texture/FBO pair on the
    /// calling thread and leave the context current on it.
    pub(crate) fn new(rt: &'static EglRuntime) -> Result<Self, String> {
        let bind_api = load!(rt, b"eglBindAPI\0", FnBindApi);
        let choose_config = load!(rt, b"eglChooseConfig\0", FnChooseConfig);
        let create_context = load!(rt, b"eglCreateContext\0", FnCreateContext);
        let make_current = load!(rt, b"eglMakeCurrent\0", FnMakeCurrent);
        let egl_get_error = load!(rt, b"eglGetError\0", FnGetError);

        // SAFETY: plain EGL calls on the process display; failure handled.
        unsafe {
            if bind_api(EGL_OPENGL_ES_API) != EGL_TRUE {
                return Err("eglBindAPI(ES) failed".to_owned());
            }
            // SURFACE_TYPE 0: the default is WINDOW_BIT, which no config on
            // a headless device-platform display satisfies - rendering goes
            // to our FBO, so no surface support is needed at all.
            let attribs = [
                EGL_SURFACE_TYPE,
                0,
                EGL_RENDERABLE_TYPE,
                EGL_OPENGL_ES2_BIT,
                EGL_NONE,
            ];
            let mut config: EglConfig = std::ptr::null_mut();
            let mut n: EglInt = 0;
            if choose_config(rt.display, attribs.as_ptr(), &raw mut config, 1, &raw mut n)
                != EGL_TRUE
                || n < 1
            {
                // EGL_KHR_no_config_context fallback: a NULL config is valid
                // for context creation on implementations exposing it.
                config = std::ptr::null_mut();
            }
            let ctx_attribs = [EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE];
            let context =
                create_context(rt.display, config, std::ptr::null_mut(), ctx_attribs.as_ptr());
            if context.is_null() {
                return Err(format!("eglCreateContext: 0x{:x}", egl_get_error()));
            }
            // Surfaceless current (EGL_KHR_surfaceless_context); rendering
            // happens into our own FBO.
            if make_current(rt.display, std::ptr::null_mut(), std::ptr::null_mut(), context)
                != EGL_TRUE
            {
                return Err(format!("eglMakeCurrent: 0x{:x}", egl_get_error()));
            }
        }

        let gen_textures = load!(rt, b"glGenTextures\0", FnGenObjects);
        let bind_texture = load!(rt, b"glBindTexture\0", FnBindTexture);
        let tex_parameteri = load!(rt, b"glTexParameteri\0", FnTexParameteri);
        let gen_framebuffers = load!(rt, b"glGenFramebuffers\0", FnGenObjects);
        let pixel_storei = load!(rt, b"glPixelStorei\0", FnPixelStorei);

        let mut texture: GlUint = 0;
        let mut framebuffer: GlUint = 0;
        // SAFETY: GL object setup on the context made current above.
        unsafe {
            gen_textures(1, &raw mut texture);
            bind_texture(GL_TEXTURE_2D, texture);
            tex_parameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
            tex_parameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
            gen_framebuffers(1, &raw mut framebuffer);
            pixel_storei(GL_PACK_ALIGNMENT, 1);
        }

        Ok(Self {
            display: rt.display,
            create_image: load!(rt, b"eglCreateImageKHR\0", FnCreateImage),
            destroy_image: load!(rt, b"eglDestroyImageKHR\0", FnDestroyImage),
            egl_get_error,
            bind_texture,
            egl_image_target: load!(
                rt,
                b"glEGLImageTargetTexture2DOES\0",
                FnEglImageTargetTexture2D
            ),
            bind_framebuffer: load!(rt, b"glBindFramebuffer\0", FnBindFramebuffer),
            framebuffer_texture: load!(rt, b"glFramebufferTexture2D\0", FnFramebufferTexture2D),
            check_framebuffer: load!(rt, b"glCheckFramebufferStatus\0", FnCheckFramebufferStatus),
            read_pixels: load!(rt, b"glReadPixels\0", FnReadPixels),
            gl_get_error: load!(rt, b"glGetError\0", FnGlGetError),
            texture,
            framebuffer,
        })
    }

    /// Read one dmabuf frame into tightly packed opaque RGBA (top-down).
    pub(crate) fn read_frame(
        &self,
        plane: &DmabufPlane,
        fourcc: u32,
        modifier: u64,
        width: u32,
        height: u32,
    ) -> Result<Vec<u8>, String> {
        let attribs: [EglInt; 17] = [
            EGL_WIDTH,
            width as EglInt,
            EGL_HEIGHT,
            height as EglInt,
            EGL_LINUX_DRM_FOURCC_EXT,
            fourcc as EglInt,
            EGL_DMA_BUF_PLANE0_FD_EXT,
            plane.fd,
            EGL_DMA_BUF_PLANE0_OFFSET_EXT,
            plane.offset as EglInt,
            EGL_DMA_BUF_PLANE0_PITCH_EXT,
            plane.stride,
            EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT,
            (modifier & 0xffff_ffff) as EglInt,
            EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT,
            (modifier >> 32) as EglInt,
            EGL_NONE,
        ];
        // SAFETY: importing a valid dmabuf fd owned by the caller's buffer;
        // the image (a no-copy wrapper) is destroyed before returning.
        let image = unsafe {
            (self.create_image)(
                self.display,
                std::ptr::null_mut(),
                EGL_LINUX_DMA_BUF_EXT,
                std::ptr::null_mut(),
                attribs.as_ptr(),
            )
        };
        if image.is_null() {
            // SAFETY: plain error query.
            return Err(format!("eglCreateImageKHR: 0x{:x}", unsafe {
                (self.egl_get_error)()
            }));
        }

        let mut rgba = vec![0_u8; width as usize * height as usize * 4];
        // SAFETY: GL calls on this thread's context; the readback target
        // buffer is sized exactly width*height*4 above.
        let result = unsafe {
            (self.bind_texture)(GL_TEXTURE_2D, self.texture);
            (self.egl_image_target)(GL_TEXTURE_2D, image);
            (self.bind_framebuffer)(GL_FRAMEBUFFER, self.framebuffer);
            (self.framebuffer_texture)(
                GL_FRAMEBUFFER,
                GL_COLOR_ATTACHMENT0,
                GL_TEXTURE_2D,
                self.texture,
                0,
            );
            let status = (self.check_framebuffer)(GL_FRAMEBUFFER);
            if status == GL_FRAMEBUFFER_COMPLETE {
                (self.read_pixels)(
                    0,
                    0,
                    width as GlInt,
                    height as GlInt,
                    GL_RGBA,
                    GL_UNSIGNED_BYTE,
                    rgba.as_mut_ptr().cast(),
                );
                let err = (self.gl_get_error)();
                if err == GL_NO_ERROR {
                    Ok(())
                } else {
                    Err(format!("glReadPixels: 0x{err:x}"))
                }
            } else {
                Err(format!("framebuffer incomplete: 0x{status:x}"))
            }
        };
        // SAFETY: destroying the image created above (the texture keeps its
        // own reference to the underlying storage until re-targeted).
        let _ = unsafe { (self.destroy_image)(self.display, image) };
        result?;

        // No row flip: reading an FBO whose color attachment is a texture
        // returns texel-memory order - row 0 is the buffer's TOP row, same
        // as the dmabuf (a flip here showed everyone an upside-down share).
        // Only force alpha opaque: the X channel of BGRx reads undefined.
        for px in rgba.chunks_exact_mut(4) {
            px[3] = 255;
        }
        Ok(rgba)
    }
}
