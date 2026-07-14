//! System-wide sine "microphone" feeder + verifier.
//!
//! Plays an endless sine tone into a chosen OUTPUT device. Pointed at a
//! virtual cable's playback side (e.g. VB-CABLE's "CABLE Input"), the tone
//! appears system-wide on the cable's recording side ("CABLE Output") -
//! a globally visible test microphone for ANY application, at whatever
//! endpoint sample rate is configured in Windows sound settings.
//!
//! ```text
//! cargo run -p fancy-audio-device --example sine_mic -- --list
//! cargo run -p fancy-audio-device --example sine_mic -- --device CABLE --freq 440
//! cargo run -p fancy-audio-device --example sine_mic -- --verify CABLE
//! ```
//!
//! `--verify <substr>` records ~1 s from the matching INPUT device and
//! reports the measured Goertzel power ratio at the probe frequency, so a
//! full cable loop (player -> driver -> capture) can be proven from one
//! terminal.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
// Examples inherit the crate's dependencies; acknowledge the ones this
// standalone tool doesn't use directly (else `unused_crate_dependencies` fires).
use fancy_audio_device as _;
use mumble_protocol as _;
use tracing as _;
use windows as _;

struct Args {
    list: bool,
    device: Option<String>,
    verify: Option<String>,
    freq: f64,
    amp: f32,
}

fn parse_args() -> Args {
    let mut args = Args { list: false, device: None, verify: None, freq: 440.0, amp: 0.4 };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--list" => args.list = true,
            "--device" => args.device = it.next(),
            "--verify" => args.verify = it.next(),
            "--freq" => args.freq = it.next().and_then(|v| v.parse().ok()).unwrap_or(440.0),
            "--amp" => args.amp = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.4),
            other => {
                eprintln!("unknown argument: {other}");
                std::process::exit(2);
            }
        }
    }
    args
}

fn device_name(d: &cpal::Device) -> String {
    d.description().map(|x| x.name().to_string()).unwrap_or_else(|_| "<unnamed>".into())
}

fn main() -> Result<(), String> {
    let args = parse_args();
    let host = cpal::default_host();

    if args.list {
        println!("output devices:");
        for d in host.output_devices().into_iter().flatten() {
            println!("  {}", device_name(&d));
        }
        println!("input devices:");
        for d in host.input_devices().into_iter().flatten() {
            println!("  {}", device_name(&d));
        }
        return Ok(());
    }

    if let Some(pattern) = args.verify {
        return verify(&host, &pattern, args.freq);
    }

    play(&host, args.device.as_deref(), args.freq, args.amp)
}

/// Play an endless sine at `freq` into the selected output device.
fn play(host: &cpal::Host, pattern: Option<&str>, freq: f64, amp: f32) -> Result<(), String> {
    let device = match pattern {
        Some(p) => host
            .output_devices()
            .map_err(|e| format!("enumerate outputs: {e}"))?
            .find(|d| device_name(d).to_lowercase().contains(&p.to_lowercase()))
            .ok_or_else(|| format!("no output device matching '{p}' (try --list)"))?,
        None => host.default_output_device().ok_or("no default output device")?,
    };
    let cfg = device.default_output_config().map_err(|e| format!("output config: {e}"))?;
    let rate = cfg.sample_rate();
    let channels = cfg.channels() as usize;
    println!(
        "playing {freq} Hz sine (amp {amp}) into '{}' at {rate} Hz, {channels} ch - Ctrl+C to stop",
        device_name(&device),
    );

    let stream_config = cpal::StreamConfig {
        channels: cfg.channels(),
        sample_rate: rate,
        buffer_size: cpal::BufferSize::Default,
    };
    let step = 2.0 * std::f64::consts::PI * freq / f64::from(rate);
    let mut phase = 0.0f64;
    let stream = device
        .build_output_stream(
            &stream_config,
            move |data: &mut [f32], _| {
                for frame in data.chunks_mut(channels) {
                    let s = (phase.sin() as f32) * amp;
                    phase += step;
                    if phase > 2.0 * std::f64::consts::PI {
                        phase -= 2.0 * std::f64::consts::PI;
                    }
                    for out in frame {
                        *out = s;
                    }
                }
            },
            |e| eprintln!("output stream error: {e}"),
            None,
        )
        .map_err(|e| format!("build output stream: {e}"))?;
    stream.play().map_err(|e| format!("start output stream: {e}"))?;

    // Park forever; Ctrl+C exits.
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}

/// Record ~1 s from the matching input device and measure the tone.
fn verify(host: &cpal::Host, pattern: &str, freq: f64) -> Result<(), String> {
    let device = host
        .input_devices()
        .map_err(|e| format!("enumerate inputs: {e}"))?
        .find(|d| device_name(d).to_lowercase().contains(&pattern.to_lowercase()))
        .ok_or_else(|| format!("no input device matching '{pattern}' (try --list)"))?;
    let cfg = device.default_input_config().map_err(|e| format!("input config: {e}"))?;
    let rate = cfg.sample_rate();
    let channels = cfg.channels() as usize;
    println!("recording 1 s from '{}' at {rate} Hz...", device_name(&device));

    let stream_config = cpal::StreamConfig {
        channels: cfg.channels(),
        sample_rate: rate,
        buffer_size: cpal::BufferSize::Default,
    };
    let samples: Arc<std::sync::Mutex<Vec<f32>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let writer = Arc::clone(&samples);
    let dropped = Arc::new(AtomicU64::new(0));
    let stream = device
        .build_input_stream(
            &stream_config,
            move |data: &[f32], _| {
                if let Ok(mut buf) = writer.lock() {
                    // Mono downmix by averaging.
                    for frame in data.chunks(channels) {
                        buf.push(frame.iter().sum::<f32>() / channels as f32);
                    }
                }
            },
            {
                let dropped = Arc::clone(&dropped);
                move |e| {
                    let _ = dropped.fetch_add(1, Ordering::Relaxed);
                    eprintln!("input stream error: {e}");
                }
            },
            None,
        )
        .map_err(|e| format!("build input stream (is another app holding the device?): {e}"))?;
    stream.play().map_err(|e| format!("start input stream: {e}"))?;
    std::thread::sleep(std::time::Duration::from_millis(1100));
    drop(stream);

    let buf = samples.lock().map_err(|e| format!("samples lock: {e}"))?;
    let n = buf.len();
    if n < rate as usize / 4 {
        return Err(format!("captured only {n} samples in 1 s - device delivered almost nothing"));
    }
    let (ratio, rms) = tone_ratio(&buf, freq, f64::from(rate));
    println!(
        "captured {n} samples: RMS {rms:.4}, Goertzel({freq} Hz) ratio {ratio:.3} {}",
        if ratio > 0.5 { "- TONE PRESENT" } else { "- tone NOT detected" },
    );
    Ok(())
}

/// Normalised Goertzel power ratio + RMS (1.0 = pure tone at `freq`).
fn tone_ratio(samples: &[f32], freq: f64, rate: f64) -> (f64, f64) {
    let n = samples.len();
    let w = 2.0 * std::f64::consts::PI * freq / rate;
    let coeff = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    let mut energy = 0.0f64;
    for &x in samples {
        let x = f64::from(x);
        energy += x * x;
        let s0 = x + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    let mean_square = energy / n as f64;
    let denom = (n as f64 / 2.0).powi(2) * 2.0 * mean_square + f64::EPSILON;
    ((power / denom).clamp(0.0, 1.0), mean_square.sqrt())
}
