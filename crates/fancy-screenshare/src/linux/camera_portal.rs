//! `org.freedesktop.portal.Camera` consent for the GNOME-native share flow.
//!
//! Where the compositor's portal dialog replaces the in-app source picker
//! ([`super::native_portal_picker`]), the camera gets its own header button,
//! and this is its "native selection": GNOME's own consent dialog ("Allow
//! ... to use your camera?"). The grant is stored by the portal, so the
//! dialog appears once; capture itself still runs through the existing
//! nokhwa/V4L2 camera pipeline - `AccessCamera` is a consent gate, not a
//! capture path.
//!
//! Consent is deliberately fail-open: a missing or broken portal service is
//! not a "no" from the user (V4L2 needs no portal for host apps), so only an
//! explicit portal response counts as denial.

use ashpd::desktop::camera::{Camera, CameraAccessOptions};

/// Ask the portal for camera consent, blocking on GNOME's dialog when the
/// grant is not stored yet. `Ok(false)` only on an explicit denial.
pub fn request_access() -> Result<bool, String> {
    // The shared portal runtime, NOT a private one: ashpd's cached D-Bus
    // connection must stay on a runtime that never dies (see
    // `super::portal_runtime`).
    let rt = super::portal_runtime()?;
    rt.block_on(async {
        let camera = match Camera::new().await {
            Ok(camera) => camera,
            Err(e) => {
                tracing::info!("screenshare: camera portal unavailable ({e}); proceeding");
                return Ok(true);
            }
        };
        let response = match camera.request_access(CameraAccessOptions::default()).await {
            Ok(request) => request.response(),
            Err(e) => {
                tracing::info!("screenshare: camera consent request failed ({e}); proceeding");
                return Ok(true);
            }
        };
        match response {
            Ok(()) => Ok(true),
            // Cancelled = the user said no (or dismissed the dialog); Other
            // covers backends that report denial that way.
            Err(ashpd::Error::Response(_)) => Ok(false),
            Err(e) => {
                tracing::info!("screenshare: camera consent errored ({e}); proceeding");
                Ok(true)
            }
        }
    })
}
