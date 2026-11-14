//! The textures paths are rasterised into before they are drawn: a
//! multisampled one and the one it is resolved into.
//!
//! They used to be the window's size, made with the window and kept for its
//! life, so every window paid for a four-samples-a-pixel copy of itself
//! (about 20 MB at 1400 x 800, 70 MB maximised on a large screen) as soon as
//! one path was drawn, whatever its size. Now they are made on the first
//! path, are as large as the paths drawn need (in steps, so that they are not
//! made again for every small change), grow at once when more is needed,
//! shrink once less has been needed for a while, and are let go of once no
//! path has been drawn for a while.

use std::time::{Duration, Instant};

use anyhow::Result;
use windows::Win32::Graphics::{Direct3D11::*, Dxgi::Common::*};

/// The step a texture's sides are rounded up to.
const STEP: u32 = 256;
/// How long less has to be needed before the textures are made smaller.
const SHRINK_AFTER: Duration = Duration::from_secs(5);
/// How long no path has to be drawn before the textures are let go of.
const RELEASE_AFTER: Duration = Duration::from_secs(5);

/// The two textures, of one size.
pub(super) struct PathTextures {
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) msaa_texture: ID3D11Texture2D,
    pub(super) msaa_view: [Option<ID3D11RenderTargetView>; 1],
    pub(super) resolved_texture: ID3D11Texture2D,
    pub(super) resolved_view: [Option<ID3D11ShaderResourceView>; 1],
}

/// The textures paths are rasterised into, sized to what is drawn.
pub(super) struct PathTarget {
    textures: Option<PathTextures>,
    /// The most asked for since `since`, in pixels.
    most: (u32, u32),
    since: Instant,
    /// When a path was last drawn.
    last_used: Instant,
}

impl PathTarget {
    pub(super) fn new() -> Self {
        let now = Instant::now();
        Self {
            textures: None,
            most: (0, 0),
            since: now,
            last_used: now,
        }
    }

    /// Textures that hold `need` pixels, in a window of `window` pixels: the
    /// ones there are where they are large enough, larger ones where not.
    pub(super) fn ready(
        &mut self,
        device: &ID3D11Device,
        format: DXGI_FORMAT,
        samples: u32,
        need: (u32, u32),
        window: (u32, u32),
    ) -> Result<&PathTextures> {
        let now = Instant::now();
        self.last_used = now;
        self.most = (self.most.0.max(need.0), self.most.1.max(need.1));
        let fits = |textures: &PathTextures| {
            textures.width >= need.0
                && textures.height >= need.1
                && textures.width <= window.0.max(1)
                && textures.height <= window.1.max(1)
        };
        // Less has been needed for a while than these hold: smaller ones.
        let shrink = now.duration_since(self.since) >= SHRINK_AFTER;
        let wanted = match &self.textures {
            Some(textures) if fits(textures) && !shrink => None,
            Some(textures) if fits(textures) => {
                let smaller = (stepped(self.most.0, window.0), stepped(self.most.1, window.1));
                self.most = need;
                self.since = now;
                (smaller.0 < textures.width || smaller.1 < textures.height).then_some(smaller)
            }
            // Never smaller than they were, unless the window is.
            Some(textures) => Some((
                stepped(need.0.max(textures.width), window.0),
                stepped(need.1.max(textures.height), window.1),
            )),
            None => Some((stepped(need.0, window.0), stepped(need.1, window.1))),
        };
        if let Some((width, height)) = wanted {
            self.textures = Some(textures(device, format, samples, width, height)?);
        }
        Ok(self.textures.as_ref().expect("made above"))
    }

    /// At the end of a frame: let the textures go once no path has been
    /// drawn for a while.
    pub(super) fn end_frame(&mut self) {
        if self.textures.is_some() && self.last_used.elapsed() >= RELEASE_AFTER {
            self.textures = None;
            self.most = (0, 0);
            self.since = Instant::now();
        }
    }
}

/// `side` rounded up to the step, and no larger than the window's `most`.
fn stepped(side: u32, most: u32) -> u32 {
    side.max(1).div_ceil(STEP).saturating_mul(STEP).min(most.max(1))
}

fn textures(
    device: &ID3D11Device,
    format: DXGI_FORMAT,
    samples: u32,
    width: u32,
    height: u32,
) -> Result<PathTextures> {
    let texture = |samples: u32, bind: D3D11_BIND_FLAG| -> Result<ID3D11Texture2D> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: format,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: samples,
                Quality: if samples > 1 {
                    D3D11_STANDARD_MULTISAMPLE_PATTERN.0 as u32
                } else {
                    0
                },
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: bind.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut output = None;
        unsafe { device.CreateTexture2D(&desc, None, Some(&mut output))? };
        Ok(output.expect("a texture"))
    };
    let msaa_texture = texture(samples, D3D11_BIND_RENDER_TARGET)?;
    let mut msaa_view = None;
    unsafe { device.CreateRenderTargetView(&msaa_texture, None, Some(&mut msaa_view))? };
    let resolved_texture = texture(1, D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE)?;
    let mut resolved_view = None;
    unsafe { device.CreateShaderResourceView(&resolved_texture, None, Some(&mut resolved_view))? };
    Ok(PathTextures {
        width,
        height,
        msaa_texture,
        msaa_view: [msaa_view],
        resolved_texture,
        resolved_view: [resolved_view],
    })
}

#[cfg(test)]
mod tests {
    use super::stepped;

    #[test]
    fn a_side_is_rounded_up_to_the_step_and_held_to_the_window() {
        assert_eq!(stepped(1, 2560), 256);
        assert_eq!(stepped(256, 2560), 256);
        assert_eq!(stepped(257, 2560), 512);
        assert_eq!(stepped(2500, 2560), 2560);
        assert_eq!(stepped(0, 2560), 256);
        assert_eq!(stepped(300, 200), 200);
    }
}
