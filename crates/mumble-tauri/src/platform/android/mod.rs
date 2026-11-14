//! Android-specific platform integrations.
//!
//! - [`connection_service`]: Foreground service bridge for background connectivity.
//! - [`fcm_service`]: Firebase Cloud Messaging device token retrieval.
//! - [`picked_files`]: A picked `content://` file copied into the cache.
//! - [`system_bars`]: Insets, keyboard and bar icons for an edge-to-edge window.

pub(crate) mod connection_service;
pub(crate) mod fcm_service;
pub(crate) mod picked_files;
pub(crate) mod system_bars;
