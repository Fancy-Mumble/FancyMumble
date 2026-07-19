//! xdg-desktop-portal `ScreenCast` session - the Linux analogue of Chromium's
//! `ScreenCastPortal` (`modules/desktop_capture/linux/wayland`).
//!
//! The portal is the only capture entry point Wayland permits, and modern
//! Chromium prefers it on X11 sessions too. The D-Bus dance is:
//!
//! 1. `CreateSession`
//! 2. `SelectSources` - source types + cursor mode.
//! 3. `Start` - the COMPOSITOR shows its own picker dialog here; there is no
//!    way to enumerate or pre-choose sources from the app. That is the
//!    platform's security model, and it is why Chromium shows the same
//!    double dialog (its picker, then the portal's) on Wayland.
//! 4. `OpenPipeWireRemote` - an fd for a PipeWire connection scoped to the
//!    picked stream nodes.
//!
//! On GNOME ([`super::native_portal_picker`]) the compositor's dialog IS the
//! source picker - the in-app picker is skipped entirely - so `SelectSources`
//! offers monitors AND windows and the session is persisted for the app's
//! lifetime. The restore token from `Start` lets a broadcast *replace*
//! (quality change, camera added/removed) reuse the picked source without
//! prompting again; an explicit "change source" click skips the token so the
//! dialog comes back.
//!
//! All D-Bus work runs on the process-wide [`super::portal_runtime`] -
//! ashpd caches one global connection whose reader task must never die
//! with a session (see that function's doc for the incident). Dropping a
//! [`PortalSession`] closes the cast explicitly (detached and bounded), so
//! the compositor removes its "sharing" chrome promptly.

use std::os::fd::OwnedFd;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use ashpd::desktop::screencast::{
    CursorMode, OpenPipeWireRemoteOptions, Screencast, SelectSourcesOptions, SourceType,
    StartCastOptions,
};
use ashpd::desktop::{CreateSessionOptions, PersistMode, ResponseError, Session};
use ashpd::enumflags2::BitFlags;

use crate::sources::SourceKind;

/// Bound on the PRE-DIALOG D-Bus setup (proxy + `CreateSession`). A wedged
/// portal service must surface as an error (-> CPU-pipeline fallback), not
/// as a capture thread parked forever - `stop()` joins capture threads, and
/// one such hang froze share teardown and every share after it. The
/// user-interaction phase (the compositor's dialog) is deliberately
/// unbounded.
const PORTAL_SETUP_TIMEOUT: Duration = Duration::from_secs(5);

/// Bound on closing the session at drop, for the same reason.
const PORTAL_CLOSE_TIMEOUT: Duration = Duration::from_secs(3);

/// Restore token of the last successful portal pick (GNOME native-picker
/// mode). In-memory only: a fresh app start always shows the dialog once.
static LAST_RESTORE_TOKEN: Mutex<Option<String>> = Mutex::new(None);

/// One-shot consent to restore [`LAST_RESTORE_TOKEN`] on the next open (set
/// per broadcast start by the embedder, consumed by [`PortalSession::open`]).
static RESTORE_LAST_PICK: AtomicBool = AtomicBool::new(false);

/// Allow the NEXT portal open to silently reuse the previously picked source
/// (via the screencast restore token) instead of showing the compositor's
/// dialog again. The embedder sets this for broadcast *replaces* that keep
/// the display source - quality changes, adding/removing a camera track -
/// and leaves it unset when the user explicitly asked to (re)pick a source.
pub fn set_restore_last_pick(allow: bool) {
    RESTORE_LAST_PICK.store(allow, Ordering::Relaxed);
}

/// An established portal screencast: the user has picked a source and the
/// compositor is ready to stream it over PipeWire.
pub(crate) struct PortalSession {
    session: Option<Session<Screencast>>,
    /// PipeWire node of the picked source, valid on [`Self::fd`].
    pub(crate) node_id: u32,
    /// Connection fd for [`pipewire::context::Context::connect_fd`].
    fd: Option<OwnedFd>,
}

impl std::fmt::Debug for PortalSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PortalSession")
            .field("node_id", &self.node_id)
            .finish_non_exhaustive()
    }
}

impl PortalSession {
    /// Run the full portal handshake. Blocks until the user picks a source
    /// in the compositor's dialog (or cancels, which returns `Err`).
    pub(crate) fn open(kind: SourceKind) -> Result<Self, String> {
        let rt = super::portal_runtime()?;

        let native_picker = super::native_portal_picker();
        let source_types: BitFlags<SourceType> = if native_picker {
            // The compositor's dialog is the ONLY picker in this mode (the
            // in-app one is hidden), so it must offer everything shareable:
            // GNOME renders its own screen-vs-window tabs.
            SourceType::Monitor | SourceType::Window
        } else {
            // Our in-app picker already asked screen-vs-window, so scope the
            // compositor's dialog to the same type.
            BitFlags::from(match kind {
                SourceKind::Screen => SourceType::Monitor,
                SourceKind::Window => SourceType::Window,
                // Cameras never reach the ScreenCast portal: create_pipeline()
                // routes SourceKind::Device to CameraPipeline (nokhwa/V4L2)
                // before this is called. Guard the invariant so a mis-route
                // fails loudly instead of opening a screen dialog for a webcam.
                SourceKind::Device => {
                    return Err(
                        "cameras are captured via the camera pipeline, not the screencast portal"
                            .to_string(),
                    );
                }
            })
        };

        // Replaces (quality change, camera toggled) reuse the previous pick
        // silently; anything else prompts. Consumed one-shot so a stale flag
        // can never suppress a picker the user asked for.
        let restore_token = if RESTORE_LAST_PICK.swap(false, Ordering::Relaxed) {
            LAST_RESTORE_TOKEN.lock().ok().and_then(|t| t.clone())
        } else {
            None
        };
        // Application persistence is what makes restore tokens valid at all;
        // it never outlives the process, so a fresh start still prompts.
        let persist_mode = if native_picker {
            PersistMode::Application
        } else {
            PersistMode::DoNot
        };

        let (session, node_id, size, fd, new_token) = rt
            .block_on(async move {
                let proxy = tokio::time::timeout(PORTAL_SETUP_TIMEOUT, Screencast::new())
                    .await
                    .unwrap_or(Err(ashpd::Error::NoResponse))?;
                let session = tokio::time::timeout(
                    PORTAL_SETUP_TIMEOUT,
                    proxy.create_session(CreateSessionOptions::default()),
                )
                .await
                .unwrap_or(Err(ashpd::Error::NoResponse))?;
                proxy
                    .select_sources(
                        &session,
                        SelectSourcesOptions::default()
                            .set_multiple(false) // one source per broadcast
                            // Embedded: the compositor composites the pointer
                            // into the frames (Chromium's portal default).
                            .set_cursor_mode(CursorMode::Embedded)
                            .set_sources(source_types)
                            .set_persist_mode(persist_mode)
                            .set_restore_token(restore_token.as_deref()),
                    )
                    .await?
                    .response()?;

                let streams = proxy
                    .start(&session, None, StartCastOptions::default())
                    .await?
                    .response()?;
                let new_token = streams.restore_token().map(ToOwned::to_owned);
                let stream = streams
                    .streams()
                    .first()
                    .cloned()
                    .ok_or(ashpd::Error::NoResponse)?;

                let fd = proxy
                    .open_pipe_wire_remote(&session, OpenPipeWireRemoteOptions::default())
                    .await?;
                Ok::<_, ashpd::Error>((
                    session,
                    stream.pipe_wire_node_id(),
                    stream.size(),
                    fd,
                    new_token,
                ))
            })
            .map_err(|e| match e {
                // Distinguishable marker: the frontend ends the pending
                // broadcast quietly on a user cancel instead of raising an
                // error toast over a dialog the user just dismissed.
                ashpd::Error::Response(ResponseError::Cancelled) => {
                    "selection cancelled in the system picker".to_owned()
                }
                e => format!("screencast portal: {e}"),
            })?;

        if let Ok(mut slot) = LAST_RESTORE_TOKEN.lock() {
            *slot = new_token;
        }

        // `size` is advisory (the negotiated PipeWire format is authoritative
        // and follows resizes); log it for bring-up diagnostics only.
        tracing::info!(node_id, ?size, "screenshare: portal source picked");
        Ok(Self {
            session: Some(session),
            node_id,
            fd: Some(fd),
        })
    }

    /// Take the PipeWire connection fd (single consumer).
    pub(crate) fn take_fd(&mut self) -> Option<OwnedFd> {
        self.fd.take()
    }
}

impl Drop for PortalSession {
    fn drop(&mut self) {
        // Explicitly close so the compositor tears the cast down (and drops
        // its "screen is being shared" chrome) promptly. Detached AND
        // bounded: this drop runs on the capture thread, which `stop()`
        // joins - it must never wait on the portal at all.
        let Some(session) = self.session.take() else {
            return;
        };
        let rt = match super::portal_runtime() {
            Ok(rt) => rt,
            Err(e) => {
                tracing::debug!("screenshare: portal close skipped: {e}");
                return;
            }
        };
        let _detached = rt.spawn(close_session(session));
    }
}

/// Close one screencast session, bounded by [`PORTAL_CLOSE_TIMEOUT`] so an
/// unresponsive portal is abandoned instead of holding anything up.
async fn close_session(session: Session<Screencast>) {
    if tokio::time::timeout(PORTAL_CLOSE_TIMEOUT, session.close())
        .await
        .is_err()
    {
        tracing::warn!("screenshare: portal session close timed out; abandoning it");
    }
}
