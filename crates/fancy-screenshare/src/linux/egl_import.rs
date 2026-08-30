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
const GL_TEXTURE_EXTERNAL_OES: GlEnum = 0x8D65;
const GL_TEXTURE_WRAP_S: GlEnum = 0x2802;
const GL_TEXTURE_WRAP_T: GlEnum = 0x2803;
const GL_CLAMP_TO_EDGE: GlInt = 0x812F;
const GL_VERTEX_SHADER: GlEnum = 0x8B31;
const GL_FRAGMENT_SHADER: GlEnum = 0x8B30;
const GL_COMPILE_STATUS: GlEnum = 0x8B81;
const GL_LINK_STATUS: GlEnum = 0x8B82;
const GL_FLOAT: GlEnum = 0x1406;
const GL_TRIANGLE_STRIP: GlEnum = 0x0005;
const GL_TEXTURE0: GlEnum = 0x84C0;
const GL_FALSE_U8: u8 = 0;

/// Fullscreen quad. UVs are derived as `pos * 0.5 + 0.5`, which maps texel
/// (u,v) onto framebuffer pixel (u,v) - an identity blit. That matters: the
/// legacy path read the imported image straight out of the framebuffer, so
/// preserving the mapping keeps the image the same way up.
const QUAD: [f32; 8] = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];

const VERTEX_SRC: &[u8] = b"attribute vec2 a_pos;\nvarying vec2 v_uv;\nvoid main() {\n  v_uv = a_pos * 0.5 + 0.5;\n  gl_Position = vec4(a_pos, 0.0, 1.0);\n}\n\0";

/// Samples the imported image as an EXTERNAL texture, which is the only
/// target guaranteed to work for a dmabuf in a driver-private tiled layout.
const FRAGMENT_SRC: &[u8] = b"#extension GL_OES_EGL_image_external : require\nprecision mediump float;\nvarying vec2 v_uv;\nuniform samplerExternalOES u_tex;\nvoid main() {\n  gl_FragColor = texture2D(u_tex, v_uv);\n}\n\0";

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
type FnCreateImage =
    unsafe extern "C" fn(EglDisplay, EglContext, u32, *mut c_void, *const EglInt) -> EglImage;
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
type FnReadPixels = unsafe extern "C" fn(GlInt, GlInt, GlInt, GlInt, GlEnum, GlEnum, *mut c_void);
type FnGlGetError = unsafe extern "C" fn() -> GlEnum;
type FnCreateShader = unsafe extern "C" fn(GlEnum) -> GlUint;
type FnShaderSource = unsafe extern "C" fn(GlUint, GlInt, *const *const u8, *const GlInt);
type FnCompileShader = unsafe extern "C" fn(GlUint);
type FnGetShaderiv = unsafe extern "C" fn(GlUint, GlEnum, *mut GlInt);
type FnCreateProgram = unsafe extern "C" fn() -> GlUint;
type FnAttachShader = unsafe extern "C" fn(GlUint, GlUint);
type FnLinkProgram = unsafe extern "C" fn(GlUint);
type FnGetProgramiv = unsafe extern "C" fn(GlUint, GlEnum, *mut GlInt);
type FnUseProgram = unsafe extern "C" fn(GlUint);
type FnDeleteShader = unsafe extern "C" fn(GlUint);
type FnGetAttribLocation = unsafe extern "C" fn(GlUint, *const u8) -> GlInt;
type FnGetUniformLocation = unsafe extern "C" fn(GlUint, *const u8) -> GlInt;
type FnUniform1i = unsafe extern "C" fn(GlInt, GlInt);
type FnVertexAttribPointer = unsafe extern "C" fn(GlUint, GlInt, GlEnum, u8, GlInt, *const c_void);
type FnEnableVertexAttribArray = unsafe extern "C" fn(GlUint);
type FnDrawArrays = unsafe extern "C" fn(GlEnum, GlInt, GlInt);
type FnViewport = unsafe extern "C" fn(GlInt, GlInt, GlInt, GlInt);
type FnActiveTexture = unsafe extern "C" fn(GlEnum);
type FnTexImage2D =
    unsafe extern "C" fn(GlEnum, GlInt, GlInt, GlInt, GlInt, GlInt, GlEnum, GlEnum, *const c_void);

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
    tex_parameteri: FnTexParameteri,
    tex_image_2d: FnTexImage2D,
    use_program: FnUseProgram,
    get_attrib_location: FnGetAttribLocation,
    uniform1i: FnUniform1i,
    vertex_attrib_pointer: FnVertexAttribPointer,
    enable_vertex_attrib_array: FnEnableVertexAttribArray,
    draw_arrays: FnDrawArrays,
    viewport: FnViewport,
    active_texture: FnActiveTexture,
    texture: GlUint,
    framebuffer: GlUint,
    /// The external-sampler blit, when the driver could compile it. `None`
    /// falls back to attaching the imported image to the framebuffer
    /// directly - which works on simple linear buffers and is what this
    /// module did before.
    blit: Option<Blit>,
}

/// Shader program and render target for the external-texture blit.
struct Blit {
    program: GlUint,
    a_pos: GlUint,
    u_tex: GlInt,
    /// Texture the imported image is bound to. Distinct from the importer's
    /// own texture on purpose: a GL texture object's target is fixed by its
    /// FIRST bind, so one already bound as `GL_TEXTURE_2D` can never be used
    /// as `GL_TEXTURE_EXTERNAL_OES` - the attempt is a `GL_INVALID_OPERATION`.
    external: GlUint,
    /// Owned RGBA texture the imported image is drawn into, and the size it
    /// is currently allocated for.
    dest: GlUint,
    dest_dims: (u32, u32),
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

/// Build the external-sampler blit, or explain why it is unavailable.
///
/// Failure is expected and survivable on a driver without
/// `GL_OES_EGL_image_external`; the caller falls back to attaching the
/// imported image to the framebuffer directly.
fn build_blit(rt: &EglRuntime, gen_textures: FnGenObjects, imp: &DmabufImporter) -> Option<Blit> {
    match build_blit_inner(rt, gen_textures, imp) {
        Ok(blit) => Some(blit),
        Err(e) => {
            tracing::debug!("screenshare: external-texture blit unavailable ({e})");
            None
        }
    }
}

fn build_blit_inner(
    rt: &EglRuntime,
    gen_textures: FnGenObjects,
    imp: &DmabufImporter,
) -> Result<Blit, String> {
    let create_shader = load!(rt, b"glCreateShader\0", FnCreateShader);
    let shader_source = load!(rt, b"glShaderSource\0", FnShaderSource);
    let compile_shader = load!(rt, b"glCompileShader\0", FnCompileShader);
    let get_shaderiv = load!(rt, b"glGetShaderiv\0", FnGetShaderiv);
    let create_program = load!(rt, b"glCreateProgram\0", FnCreateProgram);
    let attach_shader = load!(rt, b"glAttachShader\0", FnAttachShader);
    let link_program = load!(rt, b"glLinkProgram\0", FnLinkProgram);
    let get_programiv = load!(rt, b"glGetProgramiv\0", FnGetProgramiv);
    let delete_shader = load!(rt, b"glDeleteShader\0", FnDeleteShader);
    let get_uniform_location = load!(rt, b"glGetUniformLocation\0", FnGetUniformLocation);

    let compile = |kind: GlEnum, src: &[u8]| -> Result<GlUint, String> {
        // SAFETY: GLES2 shader compilation on the current context; `src` is a
        // NUL-terminated static string and the status out-pointer is local.
        unsafe {
            let shader = create_shader(kind);
            if shader == 0 {
                return Err("glCreateShader returned 0".to_owned());
            }
            let ptr = src.as_ptr();
            shader_source(shader, 1, &raw const ptr, std::ptr::null());
            compile_shader(shader);
            let mut status: GlInt = 0;
            get_shaderiv(shader, GL_COMPILE_STATUS, &raw mut status);
            if status == 0 {
                delete_shader(shader);
                return Err(format!("shader {kind:#x} did not compile"));
            }
            Ok(shader)
        }
    };

    let vertex = compile(GL_VERTEX_SHADER, VERTEX_SRC)?;
    let fragment = compile(GL_FRAGMENT_SHADER, FRAGMENT_SRC).inspect_err(|_| {
        // SAFETY: deleting the shader compiled just above.
        unsafe { delete_shader(vertex) };
    })?;

    // SAFETY: linking the two shaders compiled above, then querying the
    // result; every pointer is a local or a NUL-terminated static.
    let (program, status) = unsafe {
        let program = create_program();
        attach_shader(program, vertex);
        attach_shader(program, fragment);
        link_program(program);
        let mut status: GlInt = 0;
        get_programiv(program, GL_LINK_STATUS, &raw mut status);
        delete_shader(vertex);
        delete_shader(fragment);
        (program, status)
    };
    if status == 0 {
        return Err("program did not link".to_owned());
    }

    // SAFETY: attribute/uniform lookup on the linked program, then allocating
    // the two textures - one bound as EXTERNAL for the imported image, one as
    // 2D for the render target. Their targets are fixed here, for good.
    let (a_pos, u_tex, external, dest) = unsafe {
        let a_pos = (imp.get_attrib_location)(program, c"a_pos".as_ptr().cast());
        let u_tex = get_uniform_location(program, c"u_tex".as_ptr().cast());
        let mut external: GlUint = 0;
        gen_textures(1, &raw mut external);
        (imp.bind_texture)(GL_TEXTURE_EXTERNAL_OES, external);
        (imp.tex_parameteri)(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        (imp.tex_parameteri)(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        (imp.tex_parameteri)(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        (imp.tex_parameteri)(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        let mut dest: GlUint = 0;
        gen_textures(1, &raw mut dest);
        (imp.bind_texture)(GL_TEXTURE_2D, dest);
        (imp.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        (imp.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        (imp.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        (imp.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        (a_pos, u_tex, external, dest)
    };
    if a_pos < 0 || u_tex < 0 {
        return Err("blit program is missing a_pos/u_tex".to_owned());
    }
    Ok(Blit {
        program,
        a_pos: a_pos as GlUint,
        u_tex,
        external,
        dest,
        dest_dims: (0, 0),
    })
}

impl DmabufImporter {
    /// Resolve every EGL/GLES entry point the importer calls per frame.
    ///
    /// Split out of [`Self::new`] purely for length: it is one flat table.
    fn with_entry_points(
        rt: &'static EglRuntime,
        egl_get_error: FnGetError,
        bind_texture: FnBindTexture,
        tex_parameteri: FnTexParameteri,
        texture: GlUint,
        framebuffer: GlUint,
    ) -> Result<Self, String> {
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
            tex_parameteri,
            tex_image_2d: load!(rt, b"glTexImage2D\0", FnTexImage2D),
            use_program: load!(rt, b"glUseProgram\0", FnUseProgram),
            get_attrib_location: load!(rt, b"glGetAttribLocation\0", FnGetAttribLocation),
            uniform1i: load!(rt, b"glUniform1i\0", FnUniform1i),
            vertex_attrib_pointer: load!(rt, b"glVertexAttribPointer\0", FnVertexAttribPointer),
            enable_vertex_attrib_array: load!(
                rt,
                b"glEnableVertexAttribArray\0",
                FnEnableVertexAttribArray
            ),
            draw_arrays: load!(rt, b"glDrawArrays\0", FnDrawArrays),
            viewport: load!(rt, b"glViewport\0", FnViewport),
            active_texture: load!(rt, b"glActiveTexture\0", FnActiveTexture),
            texture,
            framebuffer,
            blit: None,
        })
    }

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
            let context = create_context(
                rt.display,
                config,
                std::ptr::null_mut(),
                ctx_attribs.as_ptr(),
            );
            if context.is_null() {
                return Err(format!("eglCreateContext: 0x{:x}", egl_get_error()));
            }
            // Surfaceless current (EGL_KHR_surfaceless_context); rendering
            // happens into our own FBO.
            if make_current(
                rt.display,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                context,
            ) != EGL_TRUE
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

        let mut importer = Self::with_entry_points(
            rt,
            egl_get_error,
            bind_texture,
            tex_parameteri,
            texture,
            framebuffer,
        )?;
        importer.blit = build_blit(rt, gen_textures, &importer);
        match importer.blit {
            Some(_) => {
                tracing::info!("screenshare: dmabuf import via external-texture blit (tiled-safe)")
            }
            None => tracing::warn!(
                "screenshare: no GL_OES_EGL_image_external; importing dmabufs by direct \
                 framebuffer attachment, which only works for linear layouts"
            ),
        }
        Ok(importer)
    }

    /// Read one dmabuf frame into tightly packed opaque RGBA (top-down).
    pub(crate) fn read_frame(
        &mut self,
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
        let result = if self.blit.is_some() {
            self.read_via_blit(image, width, height, &mut rgba)
        } else {
            self.read_via_attachment(image, width, height, &mut rgba)
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

    /// Draw the imported image through the external sampler into an owned
    /// RGBA texture, then read that back.
    ///
    /// This is the path that works for driver-private tiled layouts.
    /// `GL_TEXTURE_EXTERNAL_OES` is the only target the EGL image-external
    /// extension guarantees for such a buffer, and the driver detiles as the
    /// shader samples. Attaching the imported image to a framebuffer directly
    /// (see [`Self::read_via_attachment`]) is only defined for linear
    /// layouts; on a tiled one it reads whatever the driver felt like
    /// exposing, which is how a share ends up cycling between the right
    /// screen, some other surface and noise.
    ///
    /// The quad's UVs map texel (u,v) to framebuffer pixel (u,v), so the
    /// readback keeps the same row order the attachment path produced - no
    /// flip is introduced here.
    fn read_via_blit(
        &mut self,
        image: EglImage,
        width: u32,
        height: u32,
        rgba: &mut [u8],
    ) -> Result<(), String> {
        let framebuffer = self.framebuffer;
        let Some(blit) = self.blit.as_mut() else {
            return Err("blit unavailable".to_owned());
        };
        let resize = blit.dest_dims != (width, height);
        blit.dest_dims = (width, height);
        let (program, a_pos, u_tex) = (blit.program, blit.a_pos, blit.u_tex);
        let (external, dest) = (blit.external, blit.dest);

        // SAFETY: GL calls on this thread's current context; `rgba` is sized
        // width*height*4 by the caller and `QUAD` is a static that outlives
        // the draw call reading it.
        unsafe {
            if resize {
                (self.bind_texture)(GL_TEXTURE_2D, dest);
                (self.tex_image_2d)(
                    GL_TEXTURE_2D,
                    0,
                    GL_RGBA as GlInt,
                    width as GlInt,
                    height as GlInt,
                    0,
                    GL_RGBA,
                    GL_UNSIGNED_BYTE,
                    std::ptr::null(),
                );
            }
            (self.active_texture)(GL_TEXTURE0);
            (self.bind_texture)(GL_TEXTURE_EXTERNAL_OES, external);
            (self.egl_image_target)(GL_TEXTURE_EXTERNAL_OES, image);

            (self.bind_framebuffer)(GL_FRAMEBUFFER, framebuffer);
            (self.framebuffer_texture)(
                GL_FRAMEBUFFER,
                GL_COLOR_ATTACHMENT0,
                GL_TEXTURE_2D,
                dest,
                0,
            );
            let status = (self.check_framebuffer)(GL_FRAMEBUFFER);
            if status != GL_FRAMEBUFFER_COMPLETE {
                return Err(format!("framebuffer incomplete: 0x{status:x}"));
            }

            (self.viewport)(0, 0, width as GlInt, height as GlInt);
            (self.use_program)(program);
            (self.uniform1i)(u_tex, 0);
            (self.enable_vertex_attrib_array)(a_pos);
            (self.vertex_attrib_pointer)(a_pos, 2, GL_FLOAT, GL_FALSE_U8, 0, QUAD.as_ptr().cast());
            (self.draw_arrays)(GL_TRIANGLE_STRIP, 0, 4);
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
            if err != GL_NO_ERROR {
                return Err(format!("blit readback: 0x{err:x}"));
            }
        }
        Ok(())
    }

    /// Attach the imported image to the framebuffer and read it straight
    /// back. Defined only for linear buffers, so this is the fallback for
    /// drivers without `GL_OES_EGL_image_external`.
    fn read_via_attachment(
        &self,
        image: EglImage,
        width: u32,
        height: u32,
        rgba: &mut [u8],
    ) -> Result<(), String> {
        // SAFETY: GL calls on this thread's current context; `rgba` is sized
        // width*height*4 by the caller.
        unsafe {
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
            if status != GL_FRAMEBUFFER_COMPLETE {
                return Err(format!("framebuffer incomplete: 0x{status:x}"));
            }
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
            if err != GL_NO_ERROR {
                return Err(format!("glReadPixels: 0x{err:x}"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod readback_probe {
    use std::ffi::c_void;

    use super::*;

    type FnGbmCreateDevice = unsafe extern "C" fn(i32) -> *mut c_void;
    type FnBoCreateMods =
        unsafe extern "C" fn(*mut c_void, u32, u32, u32, *const u64, u32) -> *mut c_void;
    type FnBoGetFd = unsafe extern "C" fn(*mut c_void) -> i32;
    type FnBoGetStride = unsafe extern "C" fn(*mut c_void) -> u32;
    type FnBoGetModifier = unsafe extern "C" fn(*mut c_void) -> u64;

    fn amd_render_node() -> Option<String> {
        for entry in std::fs::read_dir("/dev/dri").ok()? {
            let name = entry.ok()?.file_name().into_string().ok()?;
            if !name.starts_with("renderD") {
                continue;
            }
            let uevent =
                std::fs::read_to_string(format!("/sys/class/drm/{name}/device/uevent")).ok()?;
            if uevent.contains("DRIVER=amdgpu") {
                return Some(format!("/dev/dri/{name}"));
            }
        }
        None
    }

    type FnBoMap = unsafe extern "C" fn(
        *mut c_void,
        u32,
        u32,
        u32,
        u32,
        u32,
        *mut u32,
        *mut *mut c_void,
    ) -> *mut c_void;
    type FnBoUnmap = unsafe extern "C" fn(*mut c_void, *mut c_void);

    /// `GBM_BO_TRANSFER_READ_WRITE`.
    const GBM_BO_TRANSFER_READ_WRITE: u32 = 3;

    /// The import must reproduce the source buffer exactly - same pixels, same
    /// way up.
    ///
    /// The blit path added for tiled buffers renders through a shader before
    /// reading back, which is precisely where an inverted or offset UV mapping
    /// would creep in and silently hand every viewer an upside-down share. A
    /// linear buffer is used because it is the one layout the CPU can author
    /// directly; the sampling path under test is the same either way.
    #[test]
    #[ignore = "needs a GPU + gbm"]
    fn dmabuf_readback_is_pixel_exact() {
        let (w, h) = (256u32, 128u32);
        let Some(node) = amd_render_node() else {
            println!("no amdgpu render node; skipping");
            return;
        };
        let fd_owner = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&node)
            .expect("open render node");
        use std::os::fd::AsRawFd;

        // SAFETY: dlopen of the system GBM library; standard entry points.
        let gbm = unsafe { libloading::Library::new("libgbm.so.1") }.expect("libgbm");
        let create_device: FnGbmCreateDevice =
            *unsafe { gbm.get(b"gbm_create_device\0") }.expect("gbm_create_device");
        let bo_create: FnBoCreateMods = *unsafe { gbm.get(b"gbm_bo_create_with_modifiers\0") }
            .expect("gbm_bo_create_with_modifiers");
        let bo_fd: FnBoGetFd = *unsafe { gbm.get(b"gbm_bo_get_fd\0") }.expect("gbm_bo_get_fd");
        let bo_stride: FnBoGetStride =
            *unsafe { gbm.get(b"gbm_bo_get_stride\0") }.expect("gbm_bo_get_stride");
        let bo_map: FnBoMap = *unsafe { gbm.get(b"gbm_bo_map\0") }.expect("gbm_bo_map");
        let bo_unmap: FnBoUnmap = *unsafe { gbm.get(b"gbm_bo_unmap\0") }.expect("gbm_bo_unmap");

        // SAFETY: valid fd; device freed with the process (test).
        let device = unsafe { create_device(fd_owner.as_raw_fd()) };
        assert!(!device.is_null(), "gbm_create_device");
        let linear = [0u64];
        // SAFETY: valid device and a one-entry modifier list.
        let bo = unsafe {
            bo_create(
                device,
                w,
                h,
                super::super::egl_modifiers::DRM_FOURCC_XRGB8888,
                linear.as_ptr(),
                1,
            )
        };
        assert!(!bo.is_null(), "gbm_bo_create_with_modifiers(LINEAR)");

        // Author a pattern whose every pixel encodes its own coordinates, so
        // a flip, a transpose or a half-texel offset all fail loudly.
        let expected = |x: u32, y: u32| -> [u8; 3] { [(x % 251) as u8, (y % 241) as u8, 0x40] };
        // SAFETY: mapping the linear bo we just created for writing.
        unsafe {
            let mut map_stride: u32 = 0;
            let mut map_data: *mut c_void = std::ptr::null_mut();
            let ptr = bo_map(
                bo,
                0,
                0,
                w,
                h,
                GBM_BO_TRANSFER_READ_WRITE,
                &raw mut map_stride,
                &raw mut map_data,
            );
            assert!(!ptr.is_null(), "gbm_bo_map");
            for y in 0..h {
                let row = ptr.cast::<u8>().add((y * map_stride) as usize);
                for x in 0..w {
                    let [r, g, b] = expected(x, y);
                    let px = row.add((x * 4) as usize);
                    // XRGB8888 is B,G,R,X in memory on little-endian.
                    px.write(b);
                    px.add(1).write(g);
                    px.add(2).write(r);
                    px.add(3).write(0);
                }
            }
            bo_unmap(bo, map_data);
        }

        let rt = super::super::egl_modifiers::runtime().expect("EGL runtime");
        let mut importer = DmabufImporter::new(rt).expect("importer");
        assert!(
            importer.blit.is_some(),
            "this GPU should support GL_OES_EGL_image_external"
        );
        // SAFETY: reading properties of the live bo.
        let (fd, stride) = unsafe { (bo_fd(bo), bo_stride(bo)) };
        let plane = DmabufPlane {
            fd,
            offset: 0,
            stride: stride as i32,
        };
        let out = importer
            .read_frame(
                &plane,
                super::super::egl_modifiers::DRM_FOURCC_XRGB8888,
                0,
                w,
                h,
            )
            .expect("read_frame");
        assert_eq!(out.len() as u32, w * h * 4);

        let (mismatches, first) = compare_pattern(&out, w, h, &expected);
        assert_eq!(
            mismatches,
            0,
            "{mismatches} pixels differ; first {}",
            first.unwrap_or_default()
        );
    }

    /// Count pixels in `out` (RGBA) that differ from `expected`, and describe
    /// the first one. Also asserts alpha was forced opaque.
    fn compare_pattern(
        out: &[u8],
        w: u32,
        h: u32,
        expected: &impl Fn(u32, u32) -> [u8; 3],
    ) -> (usize, Option<String>) {
        let mut mismatches = 0usize;
        let mut first: Option<String> = None;
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                let got = [out[i], out[i + 1], out[i + 2]];
                let want = expected(x, y);
                assert_eq!(out[i + 3], 255, "alpha must be forced opaque");
                if got == want {
                    continue;
                }
                mismatches += 1;
                let _ =
                    first.get_or_insert_with(|| format!("({x},{y}): got {got:?} want {want:?}"));
            }
        }
        (mismatches, first)
    }

    #[test]
    #[ignore = "manual perf probe (needs a GPU + gbm)"]
    fn dmabuf_readback_timing() {
        let (w, h) = (1920u32, 1200u32);
        let node = amd_render_node().expect("amd render node");
        println!("gbm node: {node}");
        let fd_owner = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&node)
            .expect("open render node");
        use std::os::fd::AsRawFd;

        // SAFETY: dlopen of the system GBM library; standard entry points.
        let gbm = unsafe { libloading::Library::new("libgbm.so.1") }.expect("libgbm");
        let create_device: FnGbmCreateDevice =
            *unsafe { gbm.get(b"gbm_create_device\0") }.expect("gbm_create_device");
        let bo_create: FnBoCreateMods = *unsafe { gbm.get(b"gbm_bo_create_with_modifiers\0") }
            .expect("gbm_bo_create_with_modifiers");
        let bo_fd: FnBoGetFd = *unsafe { gbm.get(b"gbm_bo_get_fd\0") }.expect("gbm_bo_get_fd");
        let bo_stride: FnBoGetStride =
            *unsafe { gbm.get(b"gbm_bo_get_stride\0") }.expect("gbm_bo_get_stride");
        let bo_modifier: FnBoGetModifier =
            *unsafe { gbm.get(b"gbm_bo_get_modifier\0") }.expect("gbm_bo_get_modifier");

        // SAFETY: valid fd; device freed with the process (probe).
        let device = unsafe { create_device(fd_owner.as_raw_fd()) };
        assert!(!device.is_null(), "gbm_create_device");

        let rt = super::super::egl_modifiers::runtime().expect("EGL runtime");
        let mut importer = DmabufImporter::new(rt).expect("importer");

        // The modifier Mutter fixated in the real session, then LINEAR.
        for (label, mods) in [
            ("mutter-fixated", vec![216_172_782_120_099_856u64]),
            ("linear", vec![0u64]),
        ] {
            // SAFETY: modifier list valid for the call.
            let bo = unsafe {
                bo_create(
                    device,
                    w,
                    h,
                    super::super::egl_modifiers::DRM_FOURCC_XRGB8888,
                    mods.as_ptr(),
                    mods.len() as u32,
                )
            };
            if bo.is_null() {
                println!("{label}: gbm_bo_create failed (modifier unsupported here)");
                continue;
            }
            // SAFETY: valid bo.
            let (fd, stride, actual_mod) = unsafe { (bo_fd(bo), bo_stride(bo), bo_modifier(bo)) };
            println!("{label}: bo modifier=0x{actual_mod:x} stride={stride}");
            let plane = DmabufPlane {
                fd,
                offset: 0,
                stride: stride as i32,
            };
            let mut times = Vec::new();
            for _ in 0..60 {
                let start = std::time::Instant::now();
                let out = importer
                    .read_frame(
                        &plane,
                        super::super::egl_modifiers::DRM_FOURCC_XRGB8888,
                        actual_mod,
                        w,
                        h,
                    )
                    .expect("read_frame");
                let _ = std::hint::black_box(out.len());
                times.push(start.elapsed().as_secs_f64() * 1e3);
            }
            let avg = times.iter().sum::<f64>() / times.len() as f64;
            let max = times.iter().copied().fold(0.0f64, f64::max);
            println!(
                "{label}: read_frame avg={avg:.2}ms max={max:.2}ms n={}",
                times.len()
            );
        }
    }
}
