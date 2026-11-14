//! Platform IPC transports behind one type.
//!
//! Discord's IPC endpoint is a Unix domain socket on Linux and macOS and a
//! named pipe on Windows. Both are byte-oriented duplex streams carrying the
//! same [`crate::codec`] framing, so the rest of the crate works against
//! [`Endpoint`] and never names a platform type.
//!
//! Addresses are [`PathBuf`]s on every platform: Windows pipe names
//! (`\\.\pipe\discord-ipc-0`) are valid paths, which keeps one signature for
//! both sides instead of a platform-conditional string type.

use std::io;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// A connected IPC stream, either accepted from a client or opened towards
/// the real Discord client.
#[derive(Debug)]
pub enum Endpoint {
    /// A Unix domain socket connection (Linux, macOS).
    #[cfg(unix)]
    Unix(tokio::net::UnixStream),
    /// The server side of a Windows named pipe instance.
    #[cfg(windows)]
    PipeServer(tokio::net::windows::named_pipe::NamedPipeServer),
    /// The client side of a Windows named pipe.
    #[cfg(windows)]
    PipeClient(tokio::net::windows::named_pipe::NamedPipeClient),
}

impl AsyncRead for Endpoint {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            #[cfg(unix)]
            Self::Unix(stream) => Pin::new(stream).poll_read(cx, buf),
            #[cfg(windows)]
            Self::PipeServer(pipe) => Pin::new(pipe).poll_read(cx, buf),
            #[cfg(windows)]
            Self::PipeClient(pipe) => Pin::new(pipe).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for Endpoint {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            #[cfg(unix)]
            Self::Unix(stream) => Pin::new(stream).poll_write(cx, buf),
            #[cfg(windows)]
            Self::PipeServer(pipe) => Pin::new(pipe).poll_write(cx, buf),
            #[cfg(windows)]
            Self::PipeClient(pipe) => Pin::new(pipe).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            #[cfg(unix)]
            Self::Unix(stream) => Pin::new(stream).poll_flush(cx),
            #[cfg(windows)]
            Self::PipeServer(pipe) => Pin::new(pipe).poll_flush(cx),
            #[cfg(windows)]
            Self::PipeClient(pipe) => Pin::new(pipe).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            #[cfg(unix)]
            Self::Unix(stream) => Pin::new(stream).poll_shutdown(cx),
            #[cfg(windows)]
            Self::PipeServer(pipe) => Pin::new(pipe).poll_shutdown(cx),
            #[cfg(windows)]
            Self::PipeClient(pipe) => Pin::new(pipe).poll_shutdown(cx),
        }
    }
}

/// Open a connection to an existing IPC endpoint - used to reach the real
/// Discord client in bridge mode, and to probe whether a slot is alive.
pub async fn connect(address: &Path) -> io::Result<Endpoint> {
    #[cfg(unix)]
    {
        tokio::net::UnixStream::connect(address)
            .await
            .map(Endpoint::Unix)
    }
    #[cfg(windows)]
    {
        // `open` fails with ERROR_PIPE_BUSY when every instance is taken;
        // callers treat that as "occupied", which is what it means for us.
        tokio::net::windows::named_pipe::ClientOptions::new()
            .open(address)
            .map(Endpoint::PipeClient)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = address;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Discord IPC is not supported on this platform",
        ))
    }
}

/// A bound IPC endpoint that accepts client connections.
#[derive(Debug)]
pub struct Listener {
    #[cfg(unix)]
    inner: UnixListener,
    #[cfg(windows)]
    inner: PipeListener,
}

impl Listener {
    /// Bind the endpoint at `address`, failing if something already holds it.
    ///
    /// On Unix a *stale* socket file (one left behind by a crashed process,
    /// which nothing is listening on) is removed and rebound; a socket with a
    /// live listener is left strictly alone.
    pub async fn bind(address: &Path) -> io::Result<Self> {
        #[cfg(unix)]
        {
            Ok(Self {
                inner: UnixListener::bind(address).await?,
            })
        }
        #[cfg(windows)]
        {
            Ok(Self {
                inner: PipeListener::bind(address)?,
            })
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = address;
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "Discord IPC is not supported on this platform",
            ))
        }
    }

    /// Wait for the next client connection.
    pub async fn accept(&mut self) -> io::Result<Endpoint> {
        self.inner.accept().await
    }

    /// The address this listener is bound to.
    #[must_use]
    pub fn address(&self) -> &Path {
        self.inner.address()
    }

    /// Publish an additional path that resolves to this listener.
    ///
    /// Sandboxed applications (Flatpak, Snap) look for the socket inside
    /// their own runtime directory rather than the host one, so the socket
    /// has to be reachable from several paths. Failures are reported but not
    /// fatal - a mirror we cannot create only costs us those clients.
    ///
    /// A no-op on Windows, where the pipe namespace is already global.
    pub fn mirror_to(&mut self, path: &Path) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.inner.mirror_to(path)
        }
        #[cfg(not(unix))]
        {
            let _ = path;
            Ok(())
        }
    }
}

// -- Unix ------------------------------------------------------------

#[cfg(unix)]
#[derive(Debug)]
struct UnixListener {
    listener: tokio::net::UnixListener,
    address: PathBuf,
    mirrors: Vec<PathBuf>,
}

#[cfg(unix)]
impl UnixListener {
    async fn bind(address: &Path) -> io::Result<Self> {
        match tokio::net::UnixListener::bind(address) {
            Ok(listener) => Ok(Self {
                listener,
                address: address.to_path_buf(),
                mirrors: Vec::new(),
            }),
            Err(e) if e.kind() == io::ErrorKind::AddrInUse => Self::rebind_if_stale(address).await,
            Err(e) => Err(e),
        }
    }

    /// Reclaim a socket path whose owner is gone.
    ///
    /// The only reliable liveness test for a Unix socket is to connect to it:
    /// the file outlives the process that made it, so its presence proves
    /// nothing. A refused connection means no listener, and only then do we
    /// unlink. If the connection succeeds, someone real is there - most
    /// likely Discord itself - and we must not touch it.
    async fn rebind_if_stale(address: &Path) -> io::Result<Self> {
        if connect(address).await.is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                format!("{} has a live listener", address.display()),
            ));
        }
        tracing::debug!(path = %address.display(), "removing stale IPC socket");
        std::fs::remove_file(address)?;
        Ok(Self {
            listener: tokio::net::UnixListener::bind(address)?,
            address: address.to_path_buf(),
            mirrors: Vec::new(),
        })
    }

    async fn accept(&mut self) -> io::Result<Endpoint> {
        let (stream, _addr) = self.listener.accept().await?;
        Ok(Endpoint::Unix(stream))
    }

    fn address(&self) -> &Path {
        &self.address
    }

    fn mirror_to(&mut self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Replace whatever is there: a symlink to our previous run's socket
        // is dead, and a stale socket file is equally useless.
        if path.symlink_metadata().is_ok() {
            std::fs::remove_file(path)?;
        }
        std::os::unix::fs::symlink(&self.address, path)?;
        self.mirrors.push(path.to_path_buf());
        Ok(())
    }
}

#[cfg(unix)]
impl Drop for UnixListener {
    fn drop(&mut self) {
        // Leaving the socket file behind would make the next run take our
        // stale-socket path, or worse, make a client hang connecting to a
        // dead endpoint.
        let _ = std::fs::remove_file(&self.address);
        for mirror in &self.mirrors {
            let _ = std::fs::remove_file(mirror);
        }
    }
}

// -- Windows ---------------------------------------------------------

#[cfg(windows)]
#[derive(Debug)]
struct PipeListener {
    address: PathBuf,
    /// The instance currently waiting for a client. Taken on accept and
    /// immediately replaced, so there is never a window in which the pipe
    /// name exists but refuses connections.
    pending: Option<tokio::net::windows::named_pipe::NamedPipeServer>,
}

#[cfg(windows)]
impl PipeListener {
    fn bind(address: &Path) -> io::Result<Self> {
        // `first_pipe_instance` is the occupancy test: if another process
        // (Discord) already owns this name, creation fails instead of
        // silently adding an instance and stealing half its connections.
        let pipe = tokio::net::windows::named_pipe::ServerOptions::new()
            .first_pipe_instance(true)
            .create(address)?;
        Ok(Self {
            address: address.to_path_buf(),
            pending: Some(pipe),
        })
    }

    async fn accept(&mut self) -> io::Result<Endpoint> {
        let pipe = match self.pending.take() {
            Some(pipe) => pipe,
            None => tokio::net::windows::named_pipe::ServerOptions::new().create(&self.address)?,
        };
        pipe.connect().await?;
        self.pending =
            Some(tokio::net::windows::named_pipe::ServerOptions::new().create(&self.address)?);
        Ok(Endpoint::PipeServer(pipe))
    }

    fn address(&self) -> &Path {
        &self.address
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn refuses_to_steal_a_socket_with_a_live_listener() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ipc-0");

        let _held = Listener::bind(&path).await.expect("first bind");
        let err = Listener::bind(&path).await.expect_err("second bind");
        assert_eq!(err.kind(), io::ErrorKind::AddrInUse);
    }

    #[tokio::test]
    async fn reclaims_a_socket_left_behind_by_a_dead_process() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ipc-0");

        // A socket file with nothing listening: what a crash leaves behind.
        drop(std::os::unix::net::UnixListener::bind(&path).expect("stale socket"));
        assert!(path.exists());

        let listener = Listener::bind(&path).await.expect("rebind over stale");
        assert_eq!(listener.address(), path);
    }

    #[tokio::test]
    async fn unlinks_its_socket_and_mirrors_on_drop() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ipc-0");
        let mirror = dir.path().join("sandbox/ipc-0");

        let mut listener = Listener::bind(&path).await.expect("bind");
        listener.mirror_to(&mirror).expect("mirror");
        assert!(mirror.symlink_metadata().is_ok());

        drop(listener);
        assert!(!path.exists());
        assert!(mirror.symlink_metadata().is_err());
    }

    #[tokio::test]
    async fn carries_bytes_between_a_client_and_the_listener() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ipc-0");
        let mut listener = Listener::bind(&path).await.expect("bind");

        let client = tokio::spawn(async move {
            let mut endpoint = connect(&path).await.expect("connect");
            endpoint.write_all(b"ping").await.expect("write");
        });

        let mut accepted = listener.accept().await.expect("accept");
        let mut buf = [0_u8; 4];
        let _ = accepted.read_exact(&mut buf).await.expect("read");
        assert_eq!(&buf, b"ping");
        client.await.expect("client task");
    }

    #[tokio::test]
    async fn a_mirror_path_reaches_the_same_listener() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ipc-0");
        let mirror = dir.path().join("sandbox/ipc-0");

        let mut listener = Listener::bind(&path).await.expect("bind");
        listener.mirror_to(&mirror).expect("mirror");

        let client = tokio::spawn(async move {
            let mut endpoint = connect(&mirror).await.expect("connect via mirror");
            endpoint.write_all(b"via").await.expect("write");
        });

        let mut accepted = listener.accept().await.expect("accept");
        let mut buf = [0_u8; 3];
        let _ = accepted.read_exact(&mut buf).await.expect("read");
        assert_eq!(&buf, b"via");
        client.await.expect("client task");
    }
}
