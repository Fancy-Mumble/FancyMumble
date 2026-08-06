//! Generated protobuf message types for the Mumble protocol.
//!
//! Populated by `prost-build` at build time. [`mumble_tcp`] and [`mumble_udp`]
//! come from the frozen upstream surface; [`fancy`] from the epoch-1 client
//! wire mirrored out of Starling.

/// Re-exports for generated Mumble TCP protocol messages.
#[allow(
    missing_docs,
    missing_debug_implementations,
    unused_results,
    unreachable_pub,
    clippy::unwrap_used,
    clippy::doc_markdown,
    reason = "generated code produced by prost-build - not hand-written"
)]
pub mod mumble_tcp {
    include!("mumble_proto.rs");
}

/// Re-exports for generated Mumble UDP protocol messages.
#[allow(
    missing_docs,
    missing_debug_implementations,
    unused_results,
    unreachable_pub,
    clippy::unwrap_used,
    clippy::doc_markdown,
    reason = "generated code produced by prost-build - not hand-written"
)]
pub mod mumble_udp {
    include!("mumble_udp.rs");
}

/// The epoch-1 client wire: one message set per Fancy service.
///
/// Mirrored from Starling's `crates/proto-fancy/proto/fancy/`, which owns
/// them. Nothing encodes these yet — the codec still frames the proto2
/// envelopes out of `Mumble.proto`, and swapping it over is step M2c of
/// Starling's `docs/PROTOCOL-REDESIGN.md`. They are compiled now so the
/// drift check has both halves to compare, because a copy nobody verifies is
/// how the two ends silently stopped agreeing in the first place.
#[allow(
    missing_docs,
    missing_debug_implementations,
    unused_results,
    unreachable_pub,
    dead_code,
    clippy::unwrap_used,
    clippy::doc_markdown,
    clippy::large_enum_variant,
    reason = "generated code produced by prost-build - not hand-written; \
              unused until the codec moves to the canon (M2c)"
)]
pub mod fancy {
    /// Primitives shared by more than one envelope; owns no outer type.
    pub mod wire {
        include!("starling.fancy.wire.v1.rs");
    }
    /// Outer type 1000 — session-lifecycle.
    pub mod session {
        include!("starling.fancy.session.v1.rs");
    }
    /// Outer types 1001, 1002, 1003 and 1013.
    pub mod domain {
        include!("starling.fancy.domain.v1.rs");
    }
    /// Outer types 1004, 1005, 1007, 1010, 1011, 1012, 1014, 1016 and 1017.
    pub mod feature {
        include!("starling.fancy.feature.v1.rs");
    }
    /// Outer type 1006 — persistent chat.
    pub mod pchat {
        include!("starling.fancy.pchat.v1.rs");
    }
    /// Outer type 1015 — reactions, typing, polls, watch-together, drawing.
    pub mod social {
        include!("starling.fancy.social.v1.rs");
    }
    /// Outer type 1008 — screen-share signalling.
    pub mod screenshare {
        include!("starling.fancy.screenshare.v1.rs");
    }
    /// Outer type 1009 — the control half of bulk transfer.
    pub mod files {
        include!("starling.fancy.files.v1.rs");
    }
}
