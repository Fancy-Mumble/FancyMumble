//! Cross-client integration constants, generated at build time from the
//! repo-root `constants.json` (single source of truth shared with the full
//! Tauri client and the React UI). Edit `constants.json`, not this module.

include!(concat!(env!("OUT_DIR"), "/fancy_constants.rs"));
