//! Cross-client integration constants, generated at build time from the
//! repo-root `constants.json` (single source of truth shared with the
//! minimal `qt6ui` client and the React UI). See `build.rs`
//! (`generate_shared_constants`) - edit `constants.json`, not this module.
#![allow(
    dead_code,
    reason = "the generated module carries every shared constant; each client consumes its own subset"
)]

include!(concat!(env!("OUT_DIR"), "/fancy_constants.rs"));
