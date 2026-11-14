# Changes from GPUI 0.2.2

This is the `gpui` crate as published on crates.io at version 0.2.2 (Zed
commit `69e2130295c2649963eb639fc70b4f2ee8ea1624`, `crates/gpui`), under the
Apache License 2.0 (`LICENSE-APACHE`), with the changes listed here. The
licence asks that changed files say so; this file says it for all of them.

Left out of the copy: `examples/`, `docs/`, `tests/`, and their entries in
`Cargo.toml`.

## Backdrop blur

An element can blur whatever was painted behind it, as the CSS
`backdrop-filter: blur(<length>)` does:

    div().backdrop_blur(px(8.)).bg(veil)

The length is the standard deviation of the blur.

| File | Change |
| --- | --- |
| `src/scene.rs` | The `BackdropBlur` primitive, its batches, and its place ahead of the other kinds within a layer. |
| `src/window.rs` | `Window::paint_backdrop_blur`. |
| `src/style.rs` | `Style::backdrop_blur`, painted before the shadows and the background. |
| `src/styled.rs` | `Styled::backdrop_blur`. |
| `src/platform/windows/directx_renderer.rs` | Two passes for each blur: across into an intermediate texture, then down onto the drawable. Their textures are held only while a scene has blurs. |
| `src/platform/windows/shaders.hlsl` | The `backdrop_blur_intermediate` and `backdrop_blur` shaders. |
| `build.rs` | Compiles those two shaders for release builds. |
| `src/platform/blade/blade_renderer.rs` | Skips blurs (`todo(linux)`). |
| `src/platform/mac/metal_renderer.rs` | Skips blurs (`todo(macos)`). |

Only the DirectX renderer draws blurs so far. On Linux and macOS an element
with a backdrop blur is drawn as it would be without one.

A blur reads what was drawn before it and intersects its bounds. What lies
just outside the bounds and is painted earlier in the same layer
(`Window::paint_layer`) can be missing from the blurred edge.

## Atlas space given back

`src/platform/windows/directx_atlas.rs` and `src/platform/blade/blade_atlas.rs`:
removing a tile from a texture that still holds others now gives the tile's
space back to the texture's allocator. Before, the space was lost until the
whole texture was freed, so a texture shared with one long-lived image never
had room again. An image redrawn from new pixels many times a second (an
animation read a frame at a time) allocated a new texture every few frames.

## Float literals

`src/taffy.rs`: two literals are written as `f32`, which newer compilers warn
about otherwise (`float_literal_f32_fallback`). As a registry crate the
warning was hidden; as a path dependency it is shown on every build.

## A quicker start on Windows

Creating the GPU device and reading the system fonts took about 250 ms of a
300 ms start (`STARTUP.md` in fancy-gpui has the measurements).

| File | Change |
| --- | --- |
| `src/platform/windows/directx_devices.rs` | `get_adapter` keeps the device it makes to check an adapter, and returns it with its context. Before, a second device was made right after, which cost another 60 to 90 ms. |
| `src/platform/windows/direct_write.rs` | `SystemFonts`: the DirectWrite factory and the system font collection, read before the text system is made. `DirectWriteComponent::new` and `DirectWriteTextSystem::new` take them instead of reading them. |
| `src/platform/windows/platform.rs` | `WindowsPlatform::new` reads the system fonts on another thread while it creates the GPU device, which saves the 45 to 55 ms they took. |

## Child windows over the drawing, and what was painted over a region

A window of another program's drawing (a web view playing a video) can be
laid over part of a GPUI window as a child window, and kept exactly on an
element.

| File | Change |
| --- | --- |
| `src/platform/windows/directx_renderer.rs` | The DirectComposition target is made with `topmost` false, so the window's child windows show over what GPUI draws. A window without child windows looks as before. |
| `src/window.rs` | `Window::on_frame_painted`: a callback once the whole frame is painted, deferred elements and tooltips included, before it is presented. `Window::paint_mark` and `Window::painted_over`: whether anything visible was painted over a region after a point in the frame. `PaintMark`. |
| `src/scene.rs` | `Primitive::covers`: whether a primitive changes a pixel of a region. A quad with only a border covers only its border, so an element's frame drawn after its children does not count as drawn over them; a transparent one covers nothing. |

## An image's pixels replaced in place

A video drawn as an image: each new frame goes into the texture tile the
image already has, instead of a new image, a new tile and (for anything
larger than the atlas's default 1024 square) a new texture every frame.

    if !window.update_image(&image, 0, &bgra) {
        // not painted yet, or another size: paint a new image instead
    }

| File | Change |
| --- | --- |
| `src/platform.rs` | `PlatformAtlas::update`: replace a tile's pixels, false where there is no such tile or the bytes do not fill it. False by default. |
| `src/platform/windows/directx_atlas.rs` | `update` with `UpdateSubresource` on the tile's bounds, as a new tile is uploaded. |
| `src/platform/blade/blade_atlas.rs` | `update` queues the upload as a new tile's is. Not run on Linux from here; type-checked only. |
| `src/platform/test/window.rs` | `update` answers as a real atlas would, uploading nothing. |
| `src/window.rs` | `Window::update_image`. |

Metal keeps the default (`todo(macos)`): there `update_image` answers false
and the caller paints a new image each frame, as before.

## A text background on an aligned line

A run's background on a centred or right-aligned line covered the run's
glyphs from where they start to where they would end on a left-aligned
line: cut short by the line's offset at the right. On a wrapped line the
part after the wrap started at the box's left edge instead of under the
line's first glyph.

| File | Change |
| --- | --- |
| `src/text_system/line.rs` | `paint_line_background`: the background goes on after a wrap from where the next line starts, and the last line ends where its glyphs end, both aligned as the glyphs are. A left-aligned line draws as before. |

## A window moved, not only resized

For a window that lies over another application's window and follows it
as it moves (viewers' drawings over a screen being shared): GPUI could
resize a window but not move it.

    window.set_bounds(bounds); // on the screen, in logical pixels

| File | Change |
| --- | --- |
| `src/platform.rs` | `PlatformWindow::set_bounds`, a no-op by default. |
| `src/window.rs` | `Window::set_bounds`. |
| `src/platform/windows/window.rs` | `set_bounds` with `SetWindowPos`, at the window's scale, neither reordering nor activating it. |
| `src/platform/test/window.rs` | `set_bounds` sets the bounds a test reads back. |

macOS, X11 and Wayland keep the no-op: the window stays where it opened.
Owed: macOS (`setFrame:display:`) and X11 (`configure_window` with x and
y); Wayland lets no client place its own window, so there it cannot be
done.

## A window kept over the others

For a share popped out into a window of its own, which the web client
keeps on top. `WindowKind::Floating` (whose comment says "on top of its
parent window") was made as a normal window on Windows.

| File | Change |
| --- | --- |
| `src/platform/windows/window.rs` | `Floating` is made `WS_EX_TOPMOST`. |

Elsewhere `Floating` is unchanged and is not kept on top: X11 and Wayland
make it a child of its parent window (`WM_TRANSIENT_FOR`, `set_parent`),
which keeps it over that window only, and macOS makes it a normal window.
Owed: `NSFloatingWindowLevel` on macOS, `_NET_WM_STATE_ABOVE` on X11;
Wayland lets no client keep its window over others.

## A window laid over the screen that the pointer passes through

For viewers' drawings shown over the sharer's own shared screen or window:
the pointer and the keyboard go to what is under it, it is not in the
taskbar, and screen captures leave it out, so the share does not send each
stroke back to the viewers a second time (the web client's
`WDA_EXCLUDEFROMCAPTURE`).

    WindowOptions {
        kind: WindowKind::Overlay,
        window_background: WindowBackgroundAppearance::Transparent,
        focus: false,
        ..
    }

| File | Change |
| --- | --- |
| `src/platform.rs` | `WindowKind::Overlay`. |
| `src/platform/windows/window.rs` | A `WS_POPUP` with `WS_EX_TOOLWINDOW`, `WS_EX_TOPMOST` and `WS_EX_NOACTIVATE`, made `WS_EX_LAYERED` and `WS_EX_TRANSPARENT` once it exists (as tao's `set_ignore_cursor_events` does) so the pointer passes through; left out of captures (`SetWindowDisplayAffinity`, `WDA_EXCLUDEFROMCAPTURE`); shown with `SW_SHOWNOACTIVATE`. All of it is client area: the frame insets a window without a title bar is given are not taken from it (a small one came out of them negative in size, and its swap chain could not be resized). |
| `src/platform/mac/window.rs` | Made as `PopUp` is (`todo(mac)`): a non-activating panel, but not passed through by the pointer and not left out of captures. |

X11 and Wayland make an `Overlay` as a normal window (both compare the kind
with `==`, so nothing there had to change). Owed: on macOS
`setIgnoresMouseEvents:` and `setSharingType:NSWindowSharingNone`; on X11
an empty input shape (XShape) and override-redirect; on Wayland an empty
input region on a layer-shell surface. Capture exclusion has no
counterpart on X11 or Wayland. The client opens no overlay off Windows
until then (`share::whereabouts` says no source lies anywhere there).

## No frames while nothing changes, on Windows

The vsync thread woke every window on every refresh, for as long as the
program ran: a frame callback on the main thread at the refresh rate (200
times a second here) with nothing to draw, about 1.5 to 2 % of a core at
rest and 5 % minimised. Now
a window asks for frames while it has something to draw, present or call
back on the next frame (or input came less than a second ago), and the
vsync thread sleeps until one does, looking for a lost device once a second
meanwhile.

| File | Change |
| --- | --- |
| `src/platform.rs` | `PlatformWindow::request_frame`, by default nothing: platforms that call the request frame callback on every refresh need not be asked. |
| `src/window.rs` | `Window::request_frame_if_wanted`. |
| `src/app.rs` | `flush_effects` ends by asking each window for a frame if it wants one; every change to a window happens in an update, which ends there. |
| `src/platform/windows/vsync.rs` | `FrameRequests`: whether a window asked, and the wait for it. |
| `src/platform/windows/platform.rs`, `src/platform/windows/window.rs` | The vsync thread waits on `FrameRequests`; `WindowsWindow::request_frame` makes one. |

## Letter spacing in text

GPUI spaced no letters, so a theme whose web UI sets `letter-spacing` on all
its text (Nimbus: `.01em` on the body) had every sentence a little narrow,
3 to 7 px over a line, and wrapped later than the browser. `TextStyle` now
carries `letter_spacing` in ems, inherited like the other text properties.
After the platform shapes a line, each glyph moves along by the spacing of
every character before it and the line widens by all of it, the last
character's too, as CSS adds it; wrapping, painting and hit-testing read the
moved positions. Done in the shared layout code, so every platform has it.

| File | Change |
| --- | --- |
| `src/style.rs` | `TextStyle::letter_spacing` (ems, default 0), passed on by `to_run`. |
| `src/styled.rs` | `Styled::letter_spacing(ems)`. |
| `src/text_system.rs` | `TextRun::letter_spacing`; `Eq` by hand (a spacing is never NaN). Font runs carry it in pixels, and runs with different spacing are not merged. |
| `src/text_system/line_layout.rs` | `FontRun::letter_spacing` (part of the layout cache's key); `space_letters` after the platform's layout; tests. |
| `src/text_system/line_wrapper.rs` | `truncate_line` counts each character's spacing, and the ellipsis's. |
| `src/platform/mac/text_system.rs` | Its tests' font runs name the new field. |

## Drag areas that leave controls their presses, and the top edge first

A `WindowControlArea::Drag` held the window wherever its hitbox lay under the
pointer, controls inside it included; a control kept its press only by
stopping the mouse-down's propagation. A drag area laid over a header full
of controls (a theme with no title band is held by a strip along its top)
would have turned their clicks into drags. Now an element that takes a press
(mouse down, up or click listeners, a drag, or the focus) marks its hitbox,
and a drag area holds the window only where nothing above it under the
pointer is marked: text, hover-only boxes and tooltips still hold it, as the
words on a system title bar do. On Windows the top resize edge is now
answered before the drawn areas are asked, as the system's title bar
resizes from its top pixels; a drag area reaching the top had taken the
edge for a caption.

| File | Change |
| --- | --- |
| `src/window.rs` | `Frame::pressable_hitboxes`; `Window::insert_pressable_hitbox`; `Window::window_control_area_under` (the rule) and, for tests, `Window::window_control_area_at`. |
| `src/elements/div.rs` | A div that takes a press marks its hitbox. |
| `src/platform/windows/events.rs` | `handle_hit_test_msg` answers the top edge (and its corners) first while the window is not maximised. |
## Path batches appended, not discarded, and their colour written once a path

Paths are drawn in a batch for each run of draw order, several a frame when
a theme lays lettering and rings over a dot lattice. Each batch mapped the
path buffer with `WRITE_DISCARD`: the driver hands out a fresh copy of the
whole buffer for every discard while the GPU still reads the old one, and
keeps the copies. With Nimbus's lattice (25,000 vertices of 104 bytes each)
the process held 65 MB of them in shared GPU memory, counted in its commit.
Now each batch is written after the last (`WRITE_NO_OVERWRITE`), the buffer
is discarded only when full, and each batch is read through a view that
starts at its first element (`SV_VertexID` counts from zero whatever vertex
a draw starts at). A vertex carries its position and the index of its path;
the path's colour and bounds, which were copied into every vertex, are
written once a path into a second buffer. A driver that refuses
`NO_OVERWRITE` on a buffer shaders read gets the discard as before.

| File | Change |
| --- | --- |
| `src/platform/windows/directx_renderer.rs` | `AppendBuffer` (append, discard when full, range views); `PathRasterizationVertex` and the per-path `PathRasterizationSprite`; `PipelineState::draw_paths`; `create_buffer_range_view`, `map_buffer`. |
| `src/platform/windows/shaders.hlsl` | `path_rasterization_vertices` (t1) and `path_rasterization_sprites` (t2); a vertex names its path. |

## A shadow with no blur

A box shadow whose blur radius is zero was not drawn at all: the shadow
shader spreads a shape by its blur, and with none there is nothing to
spread. A theme asks for exactly that as a hard plate under a button
(Nimbus's `3px 3px 0`), and the client for unblurred rings (a focus point, a
lit setting, a livery's edge). Such a shadow is now painted as a filled quad
at the shadow's offset and spread, with the element's corner radii; a
blurred one goes through the shader as before. It is in the shared paint
code, so every platform gets it.

| File | Change |
| --- | --- |
| `src/window.rs` | `Window::paint_shadows` paints a shadow with `blur_radius <= 0` as a quad. |

## Path textures as large as the paths drawn, and only while they are

The multisampled texture paths are rasterised into, and the one it is
resolved into, were the window's size, made with the window and kept for
its life: about 20 MB of commit and GPU memory at 1400 x 800 and 70 MB on a
large maximised window, in every window, with or without a path. Now they
are made on the first path drawn, sized to the batch's bounds (rounded up
to 256 pixels, never larger than the window), grow at once when more is
needed, shrink after 5 s of needing less, and are let go of after 5 s
without a path (checked at the end of each frame drawn). A batch is
rasterised through the window's viewport moved by its top left corner, and
each path sprite says where on the window the texture starts and how large
it is, so the copy back samples the same texels as before.

| File | Change |
| --- | --- |
| `src/platform/windows/directx_path_target.rs` | New: `PathTarget` (made, grown, shrunk, released) and `PathTextures`. |
| `src/platform/windows.rs` | Declares it. |
| `src/platform/windows/directx_renderer.rs` | `DirectXResources::path_target` replaces the four window-sized fields; `draw_paths_to_intermediate` answers a `PathsPlaced`; `PathSprite` carries `target_origin` and `target_size`; `end_frame` after each frame. |
| `src/platform/windows/shaders.hlsl` | `path_sprite_vertex` samples at `(screen - target_origin) / target_size`. |
