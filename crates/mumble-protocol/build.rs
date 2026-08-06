//! Build script for the `mumble-protocol` crate.
//!
//! Invokes `prost-build` to compile the protobuf definitions into Rust source
//! files that are written to `src/proto/`.
//!
//! Two contracts are compiled, and keeping them apart is the compatibility
//! guarantee:
//!
//! * **`proto/Mumble.proto`, `proto/MumbleUDP.proto`** — the frozen upstream
//!   Mumble surface, shared byte-for-byte with `vendor/server` and Starling.
//! * **`proto/fancy/*.proto`** — the epoch-1 client wire, mirrored from
//!   Starling's `crates/proto-fancy/proto/fancy/`. Starling owns those; this
//!   copy exists so the client can encode them, and
//!   `scripts/check-proto-drift.sh` over there asserts the two stay identical.
//!   Editing this copy alone is how the two ends stop agreeing, which is the
//!   bug recorded as D1 in Starling's `docs/PROTOCOL-REDESIGN.md`.
use std::io::Result;

/// The epoch-1 envelopes, one message set per service.
///
/// `wire.proto` is absent on purpose: it is compiled separately below.
const FANCY: &[&str] = &[
    "proto/fancy/session.proto",
    "proto/fancy/domain.proto",
    "proto/fancy/feature.proto",
    "proto/fancy/pchat.proto",
    "proto/fancy/social.proto",
    "proto/fancy/screenshare.proto",
    "proto/fancy/files.proto",
];

fn main() -> Result<()> {
    println!("cargo:rerun-if-changed=proto/Mumble.proto");
    println!("cargo:rerun-if-changed=proto/MumbleUDP.proto");
    println!("cargo:rerun-if-changed=proto/fancy/wire.proto");
    for file in FANCY {
        println!("cargo:rerun-if-changed={file}");
    }

    prost_build::Config::new()
        .out_dir("src/proto")
        .compile_protos(&["proto/Mumble.proto", "proto/MumbleUDP.proto"], &["proto/"])?;

    // Two passes, for the reason Starling's build script hits as well: the
    // generated modules are `include!`d flat rather than nested, so without
    // `extern_path` prost emits a `super::super::wire::v1` path at a module
    // depth that does not exist here — and *with* it prost treats wire as
    // somebody else's crate and generates nothing for it at all. So it is
    // compiled once on its own, and once declared external for its importers.
    prost_build::Config::new()
        .out_dir("src/proto")
        .compile_protos(&["proto/fancy/wire.proto"], &["proto/"])?;

    prost_build::Config::new()
        .out_dir("src/proto")
        .extern_path(".starling.fancy.wire.v1", "crate::proto::fancy::wire")
        .compile_protos(FANCY, &["proto/"])?;

    Ok(())
}
