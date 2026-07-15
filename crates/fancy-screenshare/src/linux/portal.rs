//! xdg-desktop-portal ScreenCast session - the Linux analogue of Chromium's
//! `ScreenCastPortal` (modules/desktop_capture/linux/wayland).
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
//! The session lives exactly as long as the D-Bus connection that created
//! it, so this struct keeps its own small tokio runtime (ashpd is async)
//! plus the session alive for the whole broadcast; dropping it ends the
//! cast and the compositor removes its own "sharing" chrome.

use std::os::fd::OwnedFd;

use ashpd::desktop::screencast::{
    CursorMode, OpenPipeWireRemoteOptions, Screencast, SelectSourcesOptions, SourceType,
    StartCastOptions,
};
use ashpd::desktop::{CreateSessionOptions, PersistMode, Session};
use ashpd::enumflags2::BitFlags;

use crate::sources::SourceKind;

/// An established portal screencast: the user has picked a source and the
/// compositor is ready to stream it over PipeWire.
pub(crate) struct PortalSession {
    /// Runtime driving ashpd/zbus; also keeps the D-Bus connection (and with
    /// it the portal session) alive.
    rt: tokio::runtime::Runtime,
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
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("portal runtime: {e}"))?;

        // Our in-app picker already asked screen-vs-window, so scope the
        // compositor's dialog to the same type.
        let source_type = match kind {
            SourceKind::Screen => SourceType::Monitor,
            SourceKind::Window => SourceType::Window,
            // Cameras never reach the ScreenCast portal: create_pipeline()
            // routes SourceKind::Device to CameraPipeline (nokhwa/V4L2) before
            // this is called. Guard the invariant so a mis-route fails loudly
            // instead of opening a screen-capture dialog for a webcam.
            SourceKind::Device => {
                return Err(
                    "cameras are captured via the camera pipeline, not the screencast portal"
                        .to_string(),
                );
            }
        };

        let (session, node_id, size, fd) = rt
            .block_on(async move {
                let proxy = Screencast::new().await?;
                let session = proxy
                    .create_session(CreateSessionOptions::default())
                    .await?;
                proxy
                    .select_sources(
                        &session,
                        SelectSourcesOptions::default()
                            .set_multiple(false) // one source per broadcast
                            // Embedded: the compositor composites the pointer
                            // into the frames (Chromium's portal default).
                            .set_cursor_mode(CursorMode::Embedded)
                            .set_sources(BitFlags::from(source_type))
                            .set_persist_mode(PersistMode::DoNot),
                    )
                    .await?
                    .response()?;

                let streams = proxy
                    .start(&session, None, StartCastOptions::default())
                    .await?
                    .response()?;
                let stream = streams
                    .streams()
                    .first()
                    .cloned()
                    .ok_or(ashpd::Error::NoResponse)?;

                let fd = proxy
                    .open_pipe_wire_remote(&session, OpenPipeWireRemoteOptions::default())
                    .await?;
                Ok::<_, ashpd::Error>((session, stream.pipe_wire_node_id(), stream.size(), fd))
            })
            .map_err(|e| format!("screencast portal: {e}"))?;

        // `size` is advisory (the negotiated PipeWire format is authoritative
        // and follows resizes); log it for bring-up diagnostics only.
        tracing::info!(node_id, ?size, "screenshare: portal source picked");
        Ok(Self {
            rt,
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
        // its "screen is being shared" chrome) immediately rather than when
        // the D-Bus connection times out.
        if let Some(session) = self.session.take() {
            let _ = self.rt.block_on(async move { session.close().await });
        }
    }
}
