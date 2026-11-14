//! Frames an embedder draws itself, broadcast as a captured screen is.
//!
//! A test pattern for an end-to-end run, a picture made up for a demo: an
//! embedder that wants to share pixels it makes, rather than a screen or a
//! window, hands one [`FrameSource`] per track to
//! [`crate::ScreenBroadcaster::start_frames`]. Nothing of the desktop is
//! touched; the frames are scaled, encoded and sent exactly as a captured
//! screen's are, so everything after capture is the real pipeline.

use std::time::{Duration, Instant};

use crate::encode::{EncodeSettings, EncodedFrame, H264Encoder, VideoEncoder};
use crate::pipeline::{EncodePipeline, FrameScaler};

/// Where the frames of one track come from, in place of a capture.
pub trait FrameSource: Send {
    /// The next frame (RGBA, tightly packed), waiting up to `wait` for one.
    /// `None` when nothing changed: the last frame is repeated as a capture
    /// of a still screen would be.
    fn next_frame(&mut self, wait: Duration) -> Option<image::RgbaImage>;
}

/// [`EncodePipeline`] over a [`FrameSource`]: the portable encoder, fed by
/// the embedder instead of by a capture.
pub(crate) struct FramePipeline {
    source: Box<dyn FrameSource>,
    encoder: H264Encoder,
    scaler: FrameScaler,
    /// The last frame, at the size it is encoded at: re-encoded when a
    /// keyframe is due and nothing new came.
    last: Option<image::RgbaImage>,
}

impl std::fmt::Debug for FramePipeline {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FramePipeline").finish_non_exhaustive()
    }
}

impl FramePipeline {
    pub(crate) fn new(source: Box<dyn FrameSource>, settings: EncodeSettings) -> Self {
        Self {
            source,
            encoder: H264Encoder::new(settings),
            scaler: FrameScaler::new(settings.max_dimension),
            last: None,
        }
    }
}

impl EncodePipeline for FramePipeline {
    fn name(&self) -> &'static str {
        "frames"
    }

    fn next_frame(
        &mut self,
        wait: Duration,
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String> {
        let started = Instant::now();
        let fresh = self
            .source
            .next_frame(wait)
            .and_then(|frame| self.scaler.downscale(frame));
        let had_fresh = fresh.is_some();
        if let Some(frame) = fresh {
            self.last = Some(frame);
        }
        if !(had_fresh || force_keyframe) {
            return Ok(None);
        }
        let Some(frame) = self.last.as_ref() else {
            return Ok(None);
        };
        let encoded =
            self.encoder
                .encode_rgba(frame.width(), frame.height(), frame.as_raw(), force_keyframe)?;
        tracing::trace!(took = ?started.elapsed(), "screenshare: frame source encoded");
        Ok(encoded)
    }

    fn encode_repeat(&mut self) -> Result<Option<EncodedFrame>, String> {
        let Some(frame) = self.last.as_ref() else {
            return Ok(None);
        };
        self.encoder
            .encode_rgba(frame.width(), frame.height(), frame.as_raw(), false)
    }

    fn set_bitrate(&mut self, bps: u32) {
        self.encoder.set_bitrate(bps);
    }

    fn content_bitrate(&self) -> Option<u32> {
        self.encoder.content_bitrate()
    }

    fn shutdown(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two frames, then nothing: a source that runs dry.
    struct Two(u32);

    impl FrameSource for Two {
        fn next_frame(&mut self, _wait: Duration) -> Option<image::RgbaImage> {
            if self.0 == 0 {
                return None;
            }
            self.0 -= 1;
            Some(image::RgbaImage::from_pixel(
                64,
                48,
                image::Rgba([self.0 as u8 * 90, 40, 200, 255]),
            ))
        }
    }

    #[test]
    fn frames_are_encoded_and_a_still_source_is_encoded_again_only_for_a_keyframe() {
        let mut pipeline = FramePipeline::new(Box::new(Two(2)), EncodeSettings::default());
        let first = pipeline
            .next_frame(Duration::ZERO, false)
            .expect("encodes")
            .expect("a frame");
        assert!(first.keyframe, "the first frame is a keyframe");
        assert!(pipeline.next_frame(Duration::ZERO, false).expect("encodes").is_some());
        assert!(
            pipeline.next_frame(Duration::ZERO, false).expect("encodes").is_none(),
            "nothing new, nothing sent"
        );
        let again = pipeline
            .next_frame(Duration::ZERO, true)
            .expect("encodes")
            .expect("the last frame again");
        assert!(again.keyframe);
        assert!(pipeline.encode_repeat().expect("encodes").is_some());
    }
}
