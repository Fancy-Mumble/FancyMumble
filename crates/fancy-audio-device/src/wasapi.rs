//! Native WASAPI capture with exclusive-mode support (Windows only).
//!
//! Mirrors the official Mumble client's input strategy (`WASAPI.cpp`):
//! when exclusive mode is requested, walk a ladder of plain-PCM formats
//! at the device's own rate and `Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE)`;
//! if none succeeds, fall back to a shared-mode open with the device's
//! mix format. Exclusive mode connects directly to the driver, bypassing
//! the shared audio engine - which is both why it is immune to other
//! shared clients and why (like Mumble) it locks everyone else out while
//! active.
//!
//! Captured audio is downmixed to mono and resampled from the device's
//! native rate to the pipeline's 48 kHz with
//! [`StreamResampler`](mumble_protocol::audio::resampler::StreamResampler),
//! so the [`AudioCapture`] contract is identical to [`CpalCapture`]'s.

#![allow(
    unsafe_code,
    reason = "raw WASAPI COM calls; each unsafe block is a single documented \
              API call on handles owned by the capture thread"
)]

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use mumble_protocol::audio::capture::AudioCapture;
use mumble_protocol::audio::resampler::StreamResampler;
use mumble_protocol::audio::sample::{AudioFormat, AudioFrame};
use mumble_protocol::error::{Error, Result};
use tracing::{debug, warn};

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, AudioSessionStateActive, IAudioCaptureClient, IAudioClient,
    IAudioSessionControl2, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
use windows::core::Interface;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};

/// `AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED`: exclusive event-driven init must
/// retry with a period aligned to the driver's returned buffer size.
const E_BUFFER_SIZE_NOT_ALIGNED: i32 = 0x8889_0019_u32 as i32;

/// `AUDCLNT_E_DEVICE_IN_USE`: the device is already held in EXCLUSIVE mode
/// by another client. No rate/format will help - only one exclusive owner
/// can exist - so we stop the ladder immediately with a clear message.
const E_DEVICE_IN_USE: i32 = 0x8889_000A_u32 as i32;

/// Per-thread capture ring cap (~1 s at 48 kHz).
const MAX_SAMPLES: usize = 48_000;

/// How the device ended up being opened (for logs/diagnostics).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenMode {
    /// Exclusive-mode stream (device locked to this process).
    Exclusive,
    /// Shared-mode stream at the engine mix format.
    Shared,
}

/// Sample layout delivered by the opened stream.
#[derive(Debug, Clone, Copy)]
enum SampleKind {
    I16,
    I32,
    F32,
}

/// Best-effort list of OTHER applications currently holding an active
/// capture session on the default microphone (process names, no `.exe`,
/// de-duplicated, our own process excluded).
///
/// Used to tell the user *which* app has the mic when capture fails with
/// "device in use". Enumerates the WASAPI audio sessions on the default
/// capture endpoint - this names shared-mode holders and most
/// exclusive-mode holders that still register a session; anything it
/// can't attribute simply doesn't appear (the UI falls back to a generic
/// message). Runs on a short-lived thread so its COM apartment never
/// clashes with the caller's.
pub fn capture_device_users() -> Vec<String> {
    std::thread::spawn(|| {
        // SAFETY: COM init/uninit paired on this dedicated thread.
        unsafe {
            let co = CoInitializeEx(None, COINIT_MULTITHREADED);
            let users = capture_device_users_inner().unwrap_or_default();
            if co.is_ok() {
                CoUninitialize();
            }
            users
        }
    })
    .join()
    .unwrap_or_default()
}

unsafe fn capture_device_users_inner() -> windows::core::Result<Vec<String>> {
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let device = enumerator.GetDefaultAudioEndpoint(eCapture, eConsole)?;
    let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
    let sessions = manager.GetSessionEnumerator()?;
    let count = sessions.GetCount()?;
    let self_pid = std::process::id();

    let mut names: Vec<String> = Vec::new();
    for i in 0..count {
        let Ok(ctrl) = sessions.GetSession(i) else { continue };
        let Ok(ctrl2) = ctrl.cast::<IAudioSessionControl2>() else { continue };
        // Only sessions that are actively capturing.
        if ctrl.GetState().unwrap_or(AudioSessionStateActive) != AudioSessionStateActive {
            continue;
        }
        let pid = ctrl2.GetProcessId().unwrap_or(0);
        if pid == 0 || pid == self_pid {
            continue;
        }
        if let Some(name) = process_name(pid) {
            if !names.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
                names.push(name);
            }
        }
    }
    Ok(names)
}

/// Resolve a PID to its executable's display name (no path, no `.exe`).
unsafe fn process_name(pid: u32) -> Option<String> {
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buf = [0u16; 260];
    let mut len = buf.len() as u32;
    let ok = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        PWSTR(buf.as_mut_ptr()),
        &mut len,
    );
    let _ = CloseHandle(handle);
    ok.ok()?;
    if len == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    let file = path.rsplit(['\\', '/']).next().unwrap_or(&path);
    let stem = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file);
    if stem.is_empty() {
        None
    } else {
        Some(stem.to_owned())
    }
}

/// Native WASAPI microphone capture implementing [`AudioCapture`].
pub struct WasapiCapture {
    device_name: Option<String>,
    frame_size: usize,
    volume: Arc<AtomicU32>,
    prefer_exclusive: bool,
    sequence: u64,
    buffer: Arc<Mutex<VecDeque<f32>>>,
    dead: Arc<Mutex<Option<String>>>,
    stop_flag: Arc<AtomicBool>,
    /// Raw event handle value, used to wake the thread on stop.
    wake_event: Arc<AtomicU32>, // stores low 32 bits of HANDLE; 0 = none
    thread: Option<std::thread::JoinHandle<()>>,
    /// Mode of the currently-open stream (after `start`).
    pub open_mode: Option<OpenMode>,
}

impl std::fmt::Debug for WasapiCapture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WasapiCapture")
            .field("device_name", &self.device_name)
            .field("prefer_exclusive", &self.prefer_exclusive)
            .field("open_mode", &self.open_mode)
            .finish_non_exhaustive()
    }
}

impl WasapiCapture {
    /// Create a capture for `device_name` (substring match; `None` =
    /// default device). `prefer_exclusive` selects Mumble-style exclusive
    /// mode with shared fallback; `false` opens shared directly.
    pub fn new(
        device_name: Option<&str>,
        frame_size: usize,
        volume: Arc<AtomicU32>,
        prefer_exclusive: bool,
    ) -> Self {
        Self {
            device_name: device_name.map(str::to_owned),
            frame_size,
            volume,
            prefer_exclusive,
            sequence: 0,
            buffer: Arc::new(Mutex::new(VecDeque::with_capacity(9_600))),
            dead: Arc::new(Mutex::new(None)),
            stop_flag: Arc::new(AtomicBool::new(false)),
            wake_event: Arc::new(AtomicU32::new(0)),
            thread: None,
            open_mode: None,
        }
    }
}

impl AudioCapture for WasapiCapture {
    fn format(&self) -> AudioFormat {
        AudioFormat::MONO_48KHZ_F32
    }

    fn read_frame(&mut self) -> Result<AudioFrame> {
        if let Ok(dead) = self.dead.lock() {
            if let Some(reason) = dead.as_ref() {
                return Err(Error::InvalidState(format!("wasapi capture lost: {reason}")));
            }
        }
        let mut buf = self
            .buffer
            .lock()
            .map_err(|e| Error::InvalidState(e.to_string()))?;
        if buf.len() < self.frame_size {
            return Err(Error::NotEnoughSamples);
        }
        let vol = f32::from_bits(self.volume.load(Ordering::Relaxed));
        let mut data = Vec::with_capacity(self.frame_size * 4);
        for s in buf.drain(..self.frame_size) {
            data.extend_from_slice(&(s * vol).to_ne_bytes());
        }
        self.sequence += 1;
        Ok(AudioFrame {
            data,
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: self.sequence,
            is_silent: false,
        })
    }

    fn start(&mut self) -> Result<()> {
        self.stop_flag.store(false, Ordering::SeqCst);
        if let Ok(mut d) = self.dead.lock() {
            *d = None;
        }
        if let Ok(mut b) = self.buffer.lock() {
            b.clear();
        }

        let (tx, rx) = mpsc::channel::<std::result::Result<OpenMode, String>>();
        let device_name = self.device_name.clone();
        let prefer_exclusive = self.prefer_exclusive;
        let buffer = Arc::clone(&self.buffer);
        let dead = Arc::clone(&self.dead);
        let stop_flag = Arc::clone(&self.stop_flag);
        let wake_event = Arc::clone(&self.wake_event);

        let thread = std::thread::Builder::new()
            .name("wasapi-capture".into())
            .spawn(move || {
                capture_thread(
                    device_name,
                    prefer_exclusive,
                    buffer,
                    dead,
                    stop_flag,
                    wake_event,
                    tx,
                );
            })
            .map_err(|e| Error::InvalidState(format!("wasapi thread spawn: {e}")))?;

        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(mode)) => {
                self.open_mode = Some(mode);
                self.thread = Some(thread);
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(Error::InvalidState(e))
            }
            Err(_) => {
                self.stop_flag.store(true, Ordering::SeqCst);
                let _ = thread.join();
                Err(Error::InvalidState("wasapi open timed out".into()))
            }
        }
    }

    fn stop(&mut self) -> Result<()> {
        self.stop_flag.store(true, Ordering::SeqCst);
        // Wake the thread out of its event wait so shutdown is prompt.
        let ev = self.wake_event.load(Ordering::SeqCst);
        if ev != 0 {
            // SAFETY: the value is a live event handle owned by the capture
            // thread; SetEvent on a stale handle after thread exit is
            // prevented by joining below before the handle is closed.
            unsafe {
                let _ = SetEvent(HANDLE(ev as isize as *mut _));
            }
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        self.open_mode = None;
        if let Ok(mut b) = self.buffer.lock() {
            b.clear();
        }
        Ok(())
    }
}

impl Drop for WasapiCapture {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// Everything COM happens on this thread: device selection, the
/// exclusive/shared open ladder, and the event-driven capture loop.
#[allow(
    clippy::too_many_arguments,
    clippy::needless_pass_by_value,
    reason = "single-use thread body; it owns its captured state for the thread's lifetime"
)]
fn capture_thread(
    device_name: Option<String>,
    prefer_exclusive: bool,
    buffer: Arc<Mutex<VecDeque<f32>>>,
    dead: Arc<Mutex<Option<String>>>,
    stop_flag: Arc<AtomicBool>,
    wake_event: Arc<AtomicU32>,
    handshake: mpsc::Sender<std::result::Result<OpenMode, String>>,
) {
    // SAFETY: standard per-thread COM init, paired with CoUninitialize.
    let co = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let run = || -> std::result::Result<(), String> {
        let (client, capture, event, mode, rate, channels, kind) =
            open_stream(device_name.as_deref(), prefer_exclusive)?;
        wake_event.store(event.0 as usize as u32, Ordering::SeqCst);
        let _ = handshake.send(Ok(mode));

        let mut resampler = StreamResampler::new(f64::from(rate), 48_000.0)
            .map_err(|e| format!("resampler: {e}"))?;
        let mut mono: Vec<f32> = Vec::with_capacity(4_096);
        let mut out: Vec<f32> = Vec::with_capacity(4_096);

        while !stop_flag.load(Ordering::SeqCst) {
            // SAFETY: event is a live handle owned by this thread.
            let wait = unsafe { WaitForSingleObject(event, 200) };
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }
            if wait != WAIT_OBJECT_0 {
                continue; // timeout tick - re-check stop flag
            }
            mono.clear();
            loop {
                // SAFETY: capture client obtained from the started stream.
                let packet = unsafe { capture.GetNextPacketSize() }
                    .map_err(|e| format!("GetNextPacketSize: {e}"))?;
                if packet == 0 {
                    break;
                }
                let mut data_ptr: *mut u8 = std::ptr::null_mut();
                let mut frames: u32 = 0;
                let mut flags: u32 = 0;
                // SAFETY: out-params per the WASAPI contract; buffer is
                // valid until ReleaseBuffer.
                unsafe {
                    capture
                        .GetBuffer(&mut data_ptr, &mut frames, &mut flags, None, None)
                        .map_err(|e| format!("GetBuffer: {e}"))?;
                }
                if frames > 0 && !data_ptr.is_null() {
                    downmix_into(&mut mono, data_ptr, frames as usize, channels as usize, kind);
                }
                // SAFETY: paired with the successful GetBuffer above.
                unsafe {
                    capture
                        .ReleaseBuffer(frames)
                        .map_err(|e| format!("ReleaseBuffer: {e}"))?;
                }
            }
            if mono.is_empty() {
                continue;
            }
            out.clear();
            resampler.process_into(&mono, &mut out);
            if let Ok(mut buf) = buffer.lock() {
                buf.extend(out.iter().copied());
                if buf.len() > MAX_SAMPLES {
                    let excess = buf.len() - MAX_SAMPLES;
                    let _ = buf.drain(..excess);
                }
            }
        }

        // SAFETY: stopping the client this thread started.
        unsafe {
            let _ = client.Stop();
        }
        wake_event.store(0, Ordering::SeqCst);
        // SAFETY: this thread owns the event handle.
        unsafe {
            let _ = CloseHandle(event);
        }
        Ok(())
    };

    match run() {
        Ok(()) => {}
        Err(e) => {
            warn!("wasapi capture thread: {e}");
            // If the handshake was already consumed, surface via `dead`.
            let _ = handshake.send(Err(e.clone()));
            if let Ok(mut d) = dead.lock() {
                *d = Some(e);
            }
        }
    }
    if co.is_ok() {
        // SAFETY: paired with CoInitializeEx at thread entry.
        unsafe { CoUninitialize() };
    }
}

type OpenResult = (
    IAudioClient,
    IAudioCaptureClient,
    HANDLE,
    OpenMode,
    u32,
    u16,
    SampleKind,
);

/// Select the device and open it: exclusive ladder first (when asked),
/// then shared mix format - the official Mumble strategy.
fn open_stream(
    device_name: Option<&str>,
    prefer_exclusive: bool,
) -> std::result::Result<OpenResult, String> {
    // SAFETY: single COM calls with checked results throughout.
    unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("device enumerator: {e}"))?;
        let device = select_device(&enumerator, device_name)?;

        let mix_client: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate: {e}"))?;
        let mix = mix_client.GetMixFormat().map_err(|e| format!("GetMixFormat: {e}"))?;
        let mix_rate = std::ptr::addr_of!((*mix).nSamplesPerSec).read_unaligned();
        let mix_channels = std::ptr::addr_of!((*mix).nChannels).read_unaligned();
        let mix_bits = std::ptr::addr_of!((*mix).wBitsPerSample).read_unaligned();

        if prefer_exclusive {
            match open_exclusive(&device, mix_rate, mix_channels) {
                Ok(opened) => {
                    windows::Win32::System::Com::CoTaskMemFree(Some(mix.cast()));
                    return Ok(opened);
                }
                Err(e) if e.contains("held exclusively") => {
                    // Another app owns the device exclusively; a shared open
                    // would fail identically. Surface the clear cause.
                    windows::Win32::System::Com::CoTaskMemFree(Some(mix.cast()));
                    return Err(e);
                }
                Err(e) => {
                    warn!("wasapi: exclusive open failed ({e}); falling back to shared");
                }
            }
        }

        // Shared mode with the engine mix format (usually 32-bit float).
        let kind = match mix_bits {
            16 => SampleKind::I16,
            32 => SampleKind::F32, // engine mix format is float32
            other => {
                windows::Win32::System::Com::CoTaskMemFree(Some(mix.cast()));
                return Err(format!("unsupported mix format ({other}-bit)"));
            }
        };
        let init = mix_client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            0,
            0,
            mix,
            None,
        );
        windows::Win32::System::Com::CoTaskMemFree(Some(mix.cast()));
        init.map_err(|e| format!("shared Initialize: 0x{:08X} {}", e.code().0, e.message()))?;

        let (event, capture) = arm_stream(&mix_client)?;
        debug!("wasapi capture: SHARED {mix_rate} Hz, {mix_channels} ch");
        Ok((mix_client, capture, event, OpenMode::Shared, mix_rate, mix_channels, kind))
    }
}

/// Mumble's exclusive strategy, refined by live testing:
///
/// - Try **48 kHz first** (Mumble hardcodes it). Exclusive mode talks to
///   the HARDWARE, not the Windows endpoint format, and re-clocks the
///   device. Observed on the Komplete Audio 1: an exclusive open at the
///   engine's CURRENT rate is refused with "in use" while another shared
///   client is active, but a rate-switching 48 kHz exclusive open
///   preempts them and succeeds - and it needs no resampling.
/// - The endpoint mix rate is tried second, for hardware that cannot do
///   48 kHz at all.
/// - No `IsFormatSupported` pre-check (Mumble has none; drivers answer
///   the query unreliably) - just attempt `Initialize`.
/// - Period is at least 10 ms (`max(min, 100000)`), matching Mumble.
#[allow(
    clippy::excessive_nesting,
    reason = "the rate x bit-depth x alignment-retry open ladder is one flat search, clearer inline"
)]
unsafe fn open_exclusive(
    device: &IMMDevice,
    mix_rate: u32,
    mix_channels: u16,
) -> std::result::Result<OpenResult, String> {
    // 48 kHz first (pipeline-native, no resampling, Mumble's choice and
    // the rate-switch that preempts shared holders), then the endpoint's
    // own mix rate, then the remaining standard rates as belt-and-braces
    // for hardware that supports neither. Whatever rate wins, the capture
    // thread resamples it to 48 kHz, so any of these is fully usable.
    // Failed Initialize attempts cost microseconds; first hit wins.
    let mut rates: Vec<u32> = vec![
        48_000, mix_rate, 44_100, 96_000, 88_200, 192_000, 32_000, 22_050, 16_000, 11_025, 8_000,
    ];
    let mut seen = Vec::with_capacity(rates.len());
    rates.retain(|r| {
        if seen.contains(r) {
            false
        } else {
            seen.push(*r);
            true
        }
    });
    let mut ladder: Vec<(u16, u16)> = Vec::new();
    for bits in [16u16, 32] {
        for ch in [mix_channels, 2, 1] {
            if !ladder.contains(&(ch, bits)) {
                ladder.push((ch, bits));
            }
        }
    }

    let mut last_err = String::from("no exclusive-capable PCM format found");
    for &rate in &rates {
        for &(ch, bits) in &ladder {
            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate: {e}"))?;
            let block = ch * bits / 8;
            let wfe = WAVEFORMATEX {
                wFormatTag: WAVE_FORMAT_PCM as u16,
                nChannels: ch,
                nSamplesPerSec: rate,
                wBitsPerSample: bits,
                nBlockAlign: block,
                nAvgBytesPerSec: rate * u32::from(block),
                cbSize: 0,
            };
            let (mut def, mut min) = (0i64, 0i64);
            client
                .GetDevicePeriod(Some(&mut def), Some(&mut min))
                .map_err(|e| format!("GetDevicePeriod: {e}"))?;
            let mut period = min.max(100_000);

            let mut attempt: IAudioClient = client;
            for retry in 0..2 {
                match attempt.Initialize(
                    AUDCLNT_SHAREMODE_EXCLUSIVE,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                    period,
                    period,
                    &wfe,
                    None,
                ) {
                    Ok(()) => {
                        let (event, capture) = arm_stream(&attempt)?;
                        let kind = if bits == 16 { SampleKind::I16 } else { SampleKind::I32 };
                        debug!("wasapi capture: EXCLUSIVE {rate} Hz, {ch} ch, {bits}-bit");
                        return Ok((attempt, capture, event, OpenMode::Exclusive, rate, ch, kind));
                    }
                    Err(e) if e.code().0 == E_BUFFER_SIZE_NOT_ALIGNED && retry == 0 => {
                        // Standard alignment dance: recompute the period from
                        // the driver's buffer size and retry on a FRESH client.
                        let frames = attempt
                            .GetBufferSize()
                            .map_err(|e2| format!("GetBufferSize: {e2}"))?;
                        period =
                            (10_000_000.0 * f64::from(frames) / f64::from(rate)).round() as i64;
                        attempt = device
                            .Activate(CLSCTX_ALL, None)
                            .map_err(|e2| format!("re-Activate: {e2}"))?;
                    }
                    Err(e) if e.code().0 == E_DEVICE_IN_USE => {
                        // Another app owns the device exclusively - no other
                        // rate/format can change that. Bail with a clear,
                        // actionable message (the UI keys "device_busy" off
                        // this HRESULT and suggests closing the other app).
                        return Err(format!(
                            "device held exclusively by another application (0x{:08X})",
                            e.code().0
                        ));
                    }
                    Err(e) => {
                        last_err = format!(
                            "exclusive Initialize {rate}Hz/{ch}ch/{bits}bit: 0x{:08X} {}",
                            e.code().0,
                            e.message()
                        );
                        break;
                    }
                }
            }
        }
    }
    Err(last_err)
}

/// Create the event, attach it, fetch the capture service, start.
unsafe fn arm_stream(
    client: &IAudioClient,
) -> std::result::Result<(HANDLE, IAudioCaptureClient), String> {
    let event = CreateEventW(None, false, false, PCWSTR::null())
        .map_err(|e| format!("CreateEvent: {e}"))?;
    client
        .SetEventHandle(event)
        .map_err(|e| format!("SetEventHandle: {e}"))?;
    let capture: IAudioCaptureClient =
        client.GetService().map_err(|e| format!("GetService: {e}"))?;
    client.Start().map_err(|e| format!("Start: {e}"))?;
    Ok((event, capture))
}

fn select_device(
    enumerator: &IMMDeviceEnumerator,
    device_name: Option<&str>,
) -> std::result::Result<IMMDevice, String> {
    // SAFETY: enumeration COM calls with checked results.
    unsafe {
        if let Some(want) = device_name {
            let coll = enumerator
                .EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)
                .map_err(|e| format!("EnumAudioEndpoints: {e}"))?;
            let count = coll.GetCount().map_err(|e| e.to_string())?;
            for i in 0..count {
                let dev = coll.Item(i).map_err(|e| e.to_string())?;
                if let Some(name) = friendly_name(&dev) {
                    if name.to_lowercase().contains(&want.to_lowercase()) {
                        return Ok(dev);
                    }
                }
            }
            warn!("wasapi: input '{want}' not found, using default device");
        }
        enumerator
            .GetDefaultAudioEndpoint(eCapture, eConsole)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))
    }
}

unsafe fn friendly_name(dev: &IMMDevice) -> Option<String> {
    let store = dev.OpenPropertyStore(STGM_READ).ok()?;
    let mut prop = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
    let s = prop.to_string();
    let _ = PropVariantClear(&mut prop);
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Downmix `frames` interleaved samples at `data` to mono f32 appended
/// to `mono`.
fn downmix_into(mono: &mut Vec<f32>, data: *const u8, frames: usize, channels: usize, kind: SampleKind) {
    match kind {
        SampleKind::I16 => {
            // SAFETY: WASAPI guarantees frames*channels samples of the
            // negotiated format at `data` until ReleaseBuffer.
            let s = unsafe { std::slice::from_raw_parts(data.cast::<i16>(), frames * channels) };
            for frame in s.chunks_exact(channels) {
                let sum: f32 = frame.iter().map(|&v| f32::from(v) / 32_768.0).sum();
                mono.push(sum / channels as f32);
            }
        }
        SampleKind::I32 => {
            // SAFETY: as above.
            let s = unsafe { std::slice::from_raw_parts(data.cast::<i32>(), frames * channels) };
            for frame in s.chunks_exact(channels) {
                let sum: f32 = frame.iter().map(|&v| v as f32 / 2_147_483_648.0).sum();
                mono.push(sum / channels as f32);
            }
        }
        SampleKind::F32 => {
            // SAFETY: as above.
            let s = unsafe { std::slice::from_raw_parts(data.cast::<f32>(), frames * channels) };
            for frame in s.chunks_exact(channels) {
                let sum: f32 = frame.iter().sum();
                mono.push(sum / channels as f32);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    /// Full hardware run in EXCLUSIVE mode - the Mumble-style "take the
    /// device" path. Run manually:
    /// `cargo test -p fancy-audio-device wasapi_exclusive_hw -- --ignored --nocapture`
    #[test]
    #[ignore = "requires audio hardware; locks the input device while running"]
    fn wasapi_exclusive_hw_captures_48k_frames() {
        let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let mut cap = WasapiCapture::new(None, 480, vol, true);
        cap.start().expect("exclusive/shared open");
        println!("opened in mode: {:?}", cap.open_mode);

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let mut frames = 0u32;
        while frames < 100 && std::time::Instant::now() < deadline {
            match cap.read_frame() {
                Ok(_) => frames += 1,
                Err(Error::NotEnoughSamples) => std::thread::sleep(Duration::from_millis(3)),
                Err(e) => panic!("read_frame: {e}"),
            }
        }
        cap.stop().expect("stop");
        println!("captured {frames} x 10 ms frames in <=3 s");
        assert!(frames >= 100, "expected >=1 s of audio in 3 s, got {frames} frames");
    }
}
