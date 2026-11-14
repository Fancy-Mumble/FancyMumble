//! The clock the system reads times on, for a view whose "auto" time
//! setting follows it.
//!
//! On Windows the Region setting says it, and neither a web view (which
//! takes the hour cycle from the language) nor a portable library reads
//! it, so it is asked here; elsewhere there is no one answer to ask for,
//! and the view falls back to the language's own convention.

/// Whether the system's regional settings use a 24-hour clock; `None`
/// where that cannot be asked.
///
/// Reads `LOCALE_ITIME` ("0" = 12-hour, "1" = 24-hour) via
/// `GetLocaleInfoW` on Windows.
#[cfg(target_os = "windows")]
#[allow(
    unsafe_code,
    reason = "GetLocaleInfoW is a read-only locale query; the buffer and its length are passed together"
)]
#[must_use]
pub fn system_uses_24h() -> Option<bool> {
    use windows_sys::Win32::Globalization::{GetLocaleInfoW, LOCALE_ITIME, LOCALE_USER_DEFAULT};

    let mut buf = [0u16; 4];
    // SAFETY: `buf` is live for the call and its length is passed alongside
    // it in `u16`s, which is the unit GetLocaleInfoW counts in.
    let len = unsafe {
        GetLocaleInfoW(
            LOCALE_USER_DEFAULT,
            LOCALE_ITIME,
            buf.as_mut_ptr(),
            buf.len() as i32,
        )
    };
    if len <= 0 {
        return None;
    }
    Some(
        buf[..(len as usize).saturating_sub(1)]
            .first()
            .copied()
            .map(|c| c != b'0' as u16)
            .unwrap_or(false),
    )
}

/// Elsewhere the system has no one answer to ask for.
#[cfg(not(target_os = "windows"))]
#[must_use]
pub fn system_uses_24h() -> Option<bool> {
    None
}
