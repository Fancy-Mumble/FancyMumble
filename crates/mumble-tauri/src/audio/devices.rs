//! One device list for the whole desktop audio stack.
//!
//! The Settings page lists devices by display name and the backends look
//! the selection up by that same name, so both MUST derive the list from
//! one place - otherwise a name that is ambiguous in cpal's raw enumeration
//! (see the ALSA notes below) is shown once but resolves to a different
//! device than the user picked.
//!
//! On Linux cpal's ALSA host enumerates every PCM *hint* (`hw:`, `plughw:`,
//! `sysdefault:`, `front:`, `dsnoop:`/`dmix:` …) plus index-based
//! `hw:CARD=<n>` fallbacks, and describes them all by the first line of the
//! hint description - so a single card shows up 5-7 times under the same
//! name. This module collapses those into one entry per card (preferring
//! the variant that can actually be opened) and suffixes genuinely
//! identical devices with their ALSA card id so every name is unique.

use cpal::traits::{DeviceTrait, HostTrait};

/// A device as offered to the UI: unique display `name` + the cpal handle.
pub struct NamedDevice {
    pub name: String,
    pub device: cpal::Device,
    pub is_default: bool,
}

/// All input devices, deduplicated and uniquely named.
pub fn inputs() -> Vec<NamedDevice> {
    let host = cpal::default_host();
    let raw = host
        .input_devices()
        .map(|d| d.collect())
        .unwrap_or_default();
    build(raw, host.default_input_device().as_ref())
}

/// All output devices, deduplicated and uniquely named.
pub fn outputs() -> Vec<NamedDevice> {
    let host = cpal::default_host();
    let raw = host
        .output_devices()
        .map(|d| d.collect())
        .unwrap_or_default();
    build(raw, host.default_output_device().as_ref())
}

/// Resolve a display name from [`inputs`] back to its device.
pub fn find_input(name: &str) -> Option<cpal::Device> {
    inputs()
        .into_iter()
        .find(|d| d.name == name)
        .map(|d| d.device)
}

/// Resolve a display name from [`outputs`] back to its device.
pub fn find_output(name: &str) -> Option<cpal::Device> {
    outputs()
        .into_iter()
        .find(|d| d.name == name)
        .map(|d| d.device)
}

/// Resolve a display name to a rodio [`Input`](rodio::microphone::Input).
///
/// rodio has no public constructor for `Input`, only
/// [`available_inputs`](rodio::microphone::available_inputs), which is
/// cpal's `input_devices()` minus the ALSA `null` device, in order. So the
/// device is located by id in that same filtered cpal list and the rodio
/// entry at the same position is taken (both enumerations run back to
/// back; the display name is checked to guard against a hot-plug in
/// between).
pub fn rodio_input(name: &str) -> Option<rodio::microphone::Input> {
    let target = find_input(name)?;
    let target_id = target.id().ok()?;
    let filtered: Vec<cpal::Device> = cpal::default_host()
        .input_devices()
        .ok()?
        .filter(|d| !is_null_device(d))
        .collect();
    let idx = filtered
        .iter()
        .position(|d| d.id().ok().as_ref() == Some(&target_id))?;
    let mut list = rodio::microphone::available_inputs().ok()?;
    if idx >= list.len() {
        return None;
    }
    let input = list.swap_remove(idx);
    let expected = raw_name(&target)?;
    (input.to_string() == expected).then_some(input)
}

/// Explain why opening `device` failed, in terms a user can act on.
///
/// On Linux, when the PCM is held by another process (which cpal only
/// reports as "device no longer available"), the holder is named and
/// remembered for the capture-error banner (see [`take_busy_holders`]).
pub fn describe_open_failure(name: &str, device: &cpal::Device, err: &str) -> String {
    #[cfg(target_os = "linux")]
    if let Some(holders) = device
        .id()
        .ok()
        .and_then(|id| linux_alsa::capture_holders(&id.1))
        .filter(|h| !h.is_empty())
    {
        let by = holders.join(", ");
        remember_busy_holders(holders);
        return format!("Input '{name}' is in use by {by}: {err}");
    }
    #[cfg(not(target_os = "linux"))]
    let _ = device;
    format!("Open input '{name}': {err}")
}

/// Holders recorded by the last [`describe_open_failure`] that found the
/// device busy; consumed (cleared) by the capture-error reporter.
pub fn take_busy_holders() -> Vec<String> {
    busy_slot()
        .lock()
        .map(|mut s| std::mem::take(&mut *s))
        .unwrap_or_default()
}

fn remember_busy_holders(holders: Vec<String>) {
    if let Ok(mut s) = busy_slot().lock() {
        *s = holders;
    }
}

fn busy_slot() -> &'static std::sync::Mutex<Vec<String>> {
    static SLOT: std::sync::OnceLock<std::sync::Mutex<Vec<String>>> = std::sync::OnceLock::new();
    SLOT.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

// -- List construction ------------------------------------------------

fn raw_name(d: &cpal::Device) -> Option<String> {
    d.description().ok().map(|desc| desc.name().to_string())
}

fn driver(d: &cpal::Device) -> Option<String> {
    d.description()
        .ok()
        .and_then(|desc| desc.driver().map(str::to_owned))
}

fn is_null_device(d: &cpal::Device) -> bool {
    driver(d).as_deref() == Some("null")
}

struct Raw {
    name: String,
    driver: Option<String>,
    device: cpal::Device,
    is_default: bool,
}

fn build(devices: Vec<cpal::Device>, default: Option<&cpal::Device>) -> Vec<NamedDevice> {
    // Match the default by id where the host provides one, else by name.
    let default_id = default.and_then(|d| d.id().ok());
    let default_name = default.and_then(raw_name);
    let raw: Vec<Raw> = devices
        .into_iter()
        .filter(|d| !is_null_device(d))
        .filter_map(|device| {
            let name = raw_name(&device)?;
            let is_default = match (&default_id, device.id().ok()) {
                (Some(want), Some(have)) => *want == have,
                _ => default_name.as_deref() == Some(name.as_str()),
            };
            Some(Raw {
                name,
                driver: driver(&device),
                device,
                is_default,
            })
        })
        .collect();

    // Linux: collapse the ALSA plugin variants, then make any names that
    // still collide (two identical cards) unique with the card id. Other
    // hosts keep cpal's names untouched - the Windows exclusive-mode path
    // (`fancy_audio_device`) resolves the very same strings by itself.
    #[cfg(target_os = "linux")]
    let raw = linux_alsa::disambiguate(linux_alsa::collapse(raw));

    raw.into_iter()
        .map(|r| NamedDevice {
            name: r.name,
            device: r.device,
            is_default: r.is_default,
        })
        .collect()
}

// -- Linux / ALSA -----------------------------------------------------

#[cfg(target_os = "linux")]
mod linux_alsa {
    use super::Raw;

    /// PCM plugin prefixes cpal produces for one physical card, best first.
    /// `plughw` opens on any format (ALSA converts), `sysdefault`/`front`
    /// are card-level aliases, `hdmi`/`iec958` are digital-output aliases
    /// (a plug over the same endpoint, numbered differently), `hw` is the
    /// raw endpoint, `dsnoop`/`dmix` are ALSA's software share plugins.
    const PREFERENCE: [&str; 8] = [
        "plughw",
        "sysdefault",
        "front",
        "hdmi",
        "iec958",
        "hw",
        "dsnoop",
        "dmix",
    ];

    /// Split an ALSA pcm id like `plughw:CARD=K1,DEV=0` into
    /// (prefix, card, dev). Non-card ids (`default`, `pipewire`, `pulse`)
    /// return `None`.
    pub(super) fn parse(pcm_id: &str) -> Option<(&str, &str, u32)> {
        let (prefix, rest) = pcm_id.split_once(':')?;
        let mut card = None;
        let mut dev = 0;
        for kv in rest.split(',') {
            match kv.split_once('=') {
                Some(("CARD", c)) => card = Some(c),
                Some(("DEV", d)) => dev = d.parse().ok()?,
                _ => {}
            }
        }
        Some((prefix, card?, dev))
    }

    /// One entry per (name, card): drop index-based duplicates of a named
    /// card and keep only the preferred plugin variant. Keyed on the
    /// description rather than `DEV` because the digital aliases number
    /// the same endpoint differently (`hdmi:…,DEV=0` == `plughw:…,DEV=3`).
    pub(super) fn collapse(raw: Vec<Raw>) -> Vec<Raw> {
        // Cards that ALSA hints name symbolically (`CARD=K1`); cpal's
        // fallback loop re-adds them as `CARD=4`, describing the same
        // hardware.
        let named_cards: std::collections::HashSet<String> = raw
            .iter()
            .filter_map(|r| r.driver.as_deref().and_then(parse))
            .filter(|(_, card, _)| !card.chars().all(|c| c.is_ascii_digit()))
            .map(|(_, card, _)| card.to_owned())
            .collect();

        let mut out: Vec<Raw> = Vec::with_capacity(raw.len());
        // (name, card) -> index in `out` of the entry currently kept.
        let mut kept: std::collections::HashMap<(String, String), usize> =
            std::collections::HashMap::new();
        for r in raw {
            let Some((prefix, card, _)) = r.driver.as_deref().and_then(parse) else {
                out.push(r); // sound servers / non-card PCMs: keep as is
                continue;
            };
            // cpal's index-based fallbacks (`CARD=4`) only exist to cover
            // cards without hints; when hints name cards at all they
            // describe hardware already listed above.
            let index_based = card.chars().all(|c| c.is_ascii_digit());
            if index_based && !named_cards.is_empty() {
                continue;
            }
            let rank = |p: &str| {
                PREFERENCE
                    .iter()
                    .position(|x| *x == p)
                    .unwrap_or(usize::MAX)
            };
            let key = (r.name.clone(), card.to_owned());
            match kept.get(&key) {
                None => {
                    let _ = kept.insert(key, out.len());
                    out.push(r);
                }
                Some(&i) => {
                    let cur = out[i]
                        .driver
                        .as_deref()
                        .and_then(parse)
                        .map(|(p, _, _)| rank(p));
                    if Some(rank(prefix)) < cur {
                        out[i] = r;
                    }
                }
            }
        }
        out
    }

    /// Suffix names that still collide after [`collapse`] (two identical
    /// cards) with the ALSA card id, e.g. `USB Audio (K1_1)`.
    pub(super) fn disambiguate(raw: Vec<Raw>) -> Vec<Raw> {
        let mut counts = std::collections::HashMap::<String, usize>::new();
        for r in &raw {
            *counts.entry(r.name.clone()).or_default() += 1;
        }
        raw.into_iter()
            .map(|mut r| {
                if counts.get(&r.name).copied().unwrap_or(0) > 1 {
                    if let Some((_, card, _)) = r.driver.as_deref().and_then(parse) {
                        r.name = format!("{} ({card})", r.name);
                    }
                }
                r
            })
            .collect()
    }

    /// Names of other processes holding the capture side of `pcm_id`
    /// open, read from `/proc/asound/card<N>/pcm<D>c/sub*/status`
    /// (`owner_pid`). `None` when the id is not a card PCM.
    pub(super) fn capture_holders(pcm_id: &str) -> Option<Vec<String>> {
        let (_, card, dev) = parse(pcm_id)?;
        let card_dir = if card.chars().all(|c| c.is_ascii_digit()) {
            format!("card{card}")
        } else {
            std::fs::read_link(format!("/proc/asound/{card}"))
                .ok()?
                .file_name()?
                .to_str()?
                .to_owned()
        };
        let me = std::process::id();
        let mut holders = Vec::new();
        for sub in std::fs::read_dir(format!("/proc/asound/{card_dir}/pcm{dev}c")).ok()? {
            let Ok(sub) = sub else { continue };
            if !sub.file_name().to_string_lossy().starts_with("sub") {
                continue;
            }
            let Ok(status) = std::fs::read_to_string(sub.path().join("status")) else {
                continue;
            };
            let Some(pid) = status
                .lines()
                .find_map(|l| l.strip_prefix("owner_pid"))
                .and_then(|l| l.trim_start_matches([' ', ':']).trim().parse::<u32>().ok())
            else {
                continue;
            };
            if pid == me {
                continue;
            }
            let comm = std::fs::read_to_string(format!("/proc/{pid}/comm"))
                .map(|c| c.trim().to_owned())
                .unwrap_or_else(|_| format!("pid {pid}"));
            if !holders.contains(&comm) {
                holders.push(comm);
            }
        }
        Some(holders)
    }

    #[cfg(test)]
    mod tests {
        use super::parse;

        /// Hardware diagnostic - run manually:
        /// `cargo test -p mumble-tauri devices_hw -- --ignored --nocapture`
        ///
        /// Prints the list the Settings page would show, each entry's ALSA pcm
        /// id, and - for inputs - whether it actually opens, so a duplicate or
        /// an unopenable entry is visible without launching the app.
        #[test]
        #[ignore = "requires audio hardware; run manually with --ignored --nocapture"]
        fn devices_hw_probe() {
            use cpal::traits::DeviceTrait;
            for d in crate::audio::devices::inputs() {
                let id = d.device.id().map(|i| i.1).unwrap_or_default();
                println!(
                    "input  | {:45} | {id:32} | default={} | holders={:?}",
                    d.name,
                    d.is_default,
                    super::capture_holders(&id),
                );
                println!("       -> {}", probe_open(&d));
            }
            for d in crate::audio::devices::outputs() {
                let id = d.device.id().map(|i| i.1).unwrap_or_default();
                println!(
                    "output | {:45} | {id:32} | default={}",
                    d.name, d.is_default
                );
            }
        }

        /// Whether the rodio capture path can open `d`, or why it cannot.
        fn probe_open(d: &crate::audio::devices::NamedDevice) -> String {
            let Some(input) = crate::audio::devices::rodio_input(&d.name) else {
                return "rodio_input: not resolved".to_owned();
            };
            match rodio::microphone::MicrophoneBuilder::new().device(input) {
                Ok(_) => "opens".to_owned(),
                Err(e) => {
                    crate::audio::devices::describe_open_failure(&d.name, &d.device, &e.to_string())
                }
            }
        }

        #[test]
        fn parses_card_pcm_ids() {
            assert_eq!(parse("hw:CARD=K1,DEV=0"), Some(("hw", "K1", 0)));
            assert_eq!(parse("sysdefault:CARD=K1"), Some(("sysdefault", "K1", 0)));
            assert_eq!(parse("plughw:CARD=4,DEV=2"), Some(("plughw", "4", 2)));
            assert_eq!(parse("default"), None);
            assert_eq!(parse("pipewire"), None);
        }
    }
}
