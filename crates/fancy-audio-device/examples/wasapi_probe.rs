//! Compares three ways of opening a capture device, to explain why the
//! official Mumble client can open a device that cpal reports as "in use":
//!
//! 1. **cpal**  - build an input stream the way our client does now.
//! 2. **WASAPI shared, mix format** - exactly what Mumble does by default:
//!    `GetMixFormat()` then `Initialize(SHARED, EVENTCALLBACK, 0, 0, mix)`.
//! 3. **WASAPI exclusive, 48k/16bit** - Mumble's optional exclusive path.
//!
//! ```text
//! cargo run -p fancy-audio-device --example wasapi_probe -- "Line"
//! ```
//! Pass a device-name substring (default: the default capture device).

#![cfg(target_os = "windows")]
#![allow(
    unsafe_code,
    reason = "raw WASAPI COM to mirror the official Mumble client's device open"
)]

use windows::core::PCWSTR;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Media::Audio::{
    eCapture, eConsole, IAudioClient, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
    STGM_READ,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;

fn main() {
    let want = std::env::args().nth(1);
    if want.as_deref() == Some("--users") {
        let users = fancy_audio_device::capture_device_users();
        println!("apps currently using the default microphone: {users:?}");
        return;
    }
    // SAFETY: standard COM init for this thread.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        match run(want.as_deref()) {
            Ok(()) => {}
            Err(e) => eprintln!("probe error: {e:?}"),
        }
    }
}

unsafe fn run(want: Option<&str>) -> windows::core::Result<()> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let collection = enumerator.EnumAudioEndpoints(
        eCapture,
        windows::Win32::Media::Audio::DEVICE_STATE_ACTIVE,
    )?;
    let count = collection.GetCount()?;
    println!("{count} active capture device(s)");

    let mut chosen: Option<IMMDevice> = None;
    for i in 0..count {
        let dev = collection.Item(i)?;
        let name = friendly_name(&dev).unwrap_or_else(|| "<unnamed>".into());
        let matches = want.map(|w| name.to_lowercase().contains(&w.to_lowercase())).unwrap_or(false);
        println!("  [{i}] {name}{}", if matches { "   <-- selected" } else { "" });
        if matches && chosen.is_none() {
            chosen = Some(dev);
        }
    }
    let device = match chosen {
        Some(d) => d,
        None => {
            println!("(no name match; using default capture device)");
            enumerator.GetDefaultAudioEndpoint(eCapture, eConsole)?
        }
    };

    // --- 2. Mumble-style: SHARED mode with the device's own mix format ---
    let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
    let mix = client.GetMixFormat()?;
    // WAVEFORMATEX is #[repr(packed)]; read each field unaligned into locals.
    let rate = std::ptr::addr_of!((*mix).nSamplesPerSec).read_unaligned();
    let ch = std::ptr::addr_of!((*mix).nChannels).read_unaligned();
    let bits = std::ptr::addr_of!((*mix).wBitsPerSample).read_unaligned();
    let tag = std::ptr::addr_of!((*mix).wFormatTag).read_unaligned();
    println!("\nGetMixFormat: {rate} Hz, {ch} ch, {bits}-bit (tag {tag})");

    let shared = client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        0,
        0,
        mix,
        None,
    );
    match &shared {
        Ok(()) => {
            // Give it an event handle + start, exactly like Mumble, to be
            // sure the open is real and not deferred.
            let ev = windows::Win32::System::Threading::CreateEventW(None, false, false, PCWSTR::null())?;
            let _ = client.SetEventHandle(HANDLE(ev.0));
            let started = client.Start();
            println!("WASAPI SHARED + mix format: OK (start: {started:?})");
            let _ = client.Stop();
        }
        Err(e) => println!("WASAPI SHARED + mix format: FAILED hr=0x{:08X} ({})", e.code().0, e.message()),
    }
    CoTaskMemFree(Some(mix as *const _ as *const _));

    // --- 3. Exclusive path at the DEVICE'S ACTUAL rate ---
    // Exclusive mode requires a format the hardware natively supports, so
    // try a set of standard PCM formats at the real endpoint rate (not a
    // hardcoded 48k). Exclusive bypasses the shared engine, so it can
    // succeed even when the shared open above returns "in use".
    for &(ch, bits) in &[(2u16, 16u16), (1, 16), (2, 24), (1, 24), (2, 32), (1, 32)] {
        let client2: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
        let (mut def, mut minp) = (0i64, 0i64);
        client2.GetDevicePeriod(Some(&mut def), Some(&mut minp))?;
        let want_period = minp.max(30_000);
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
        // Ask the driver whether this exact format is exclusive-capable.
        let supported =
            client2.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, &wfe, None);
        if supported.is_err() {
            continue;
        }
        let excl = client2.Initialize(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            want_period,
            want_period,
            &wfe,
            None,
        );
        match &excl {
            Ok(()) => {
                let ev = windows::Win32::System::Threading::CreateEventW(
                    None, false, false, PCWSTR::null(),
                )?;
                let _ = client2.SetEventHandle(HANDLE(ev.0));
                let started = client2.Start();
                println!(
                    "WASAPI EXCLUSIVE {rate}Hz/{ch}ch/{bits}bit: OK (start: {started:?})  <== this is how to 'take' the device",
                );
                let _ = client2.Stop();
                break;
            }
            Err(e) => println!(
                "WASAPI EXCLUSIVE {rate}Hz/{ch}ch/{bits}bit: FAILED hr=0x{:08X}",
                e.code().0,
            ),
        }
    }

    // --- 4. MUMBLE-EXACT exclusive open (WASAPI.cpp verbatim) ---
    // Differences from section 3: rate hardcoded to 48000 (exclusive talks
    // to the HARDWARE, not the Windows endpoint format), channels tried in
    // Mumble's order 1 then 2, 16-bit only, period = max(min, 100000)
    // (>= 10 ms), and NO IsFormatSupported pre-check (drivers lie there;
    // Mumble just attempts Initialize).
    for channels in 1u16..=2 {
        let client3: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
        let (mut def3, mut min3) = (0i64, 0i64);
        client3.GetDevicePeriod(Some(&mut def3), Some(&mut min3))?;
        let want3 = min3.max(100_000);
        let block = channels * 2;
        let wfe = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_PCM as u16,
            nChannels: channels,
            nSamplesPerSec: 48_000,
            wBitsPerSample: 16,
            nBlockAlign: block,
            nAvgBytesPerSec: 48_000 * u32::from(block),
            cbSize: 0,
        };
        match client3.Initialize(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            want3,
            want3,
            &wfe,
            None,
        ) {
            Ok(()) => {
                let ev = windows::Win32::System::Threading::CreateEventW(
                    None, false, false, PCWSTR::null(),
                )?;
                let _ = client3.SetEventHandle(HANDLE(ev.0));
                let started = client3.Start();
                println!(
                    "MUMBLE-EXACT EXCLUSIVE 48000Hz/{channels}ch/16bit (period {want3}): OK (start: {started:?})"
                );
                let _ = client3.Stop();
                break;
            }
            Err(e) => println!(
                "MUMBLE-EXACT EXCLUSIVE 48000Hz/{channels}ch/16bit (period {want3}): FAILED hr=0x{:08X}",
                e.code().0,
            ),
        }
    }

    println!("\nInterpretation:");
    println!("  SHARED failing 'in use' + EXCLUSIVE OK -> add exclusive-mode capture (like Mumble).");
    println!("  Both failing 'in use' -> device is held EXCLUSIVE by another process.");
    Ok(())
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
