//! Build script for the `mumble-tauri` crate.
//!
//! Invokes `tauri-build` and configures platform-specific linker flags.
//! On desktop, also builds the AGPL-isolated `signal-bridge` cdylib from
//! its separate workspace and copies the resulting library next to the
//! executable so `load_signal_bridge` finds it at runtime.
//!
//! Also regenerates `ui/src/utils/permissions.ts` from the canonical
//! Rust permission table in `crates/fancy-utils/src/permissions.rs` so
//! the React frontend stays in lock-step with the backend.

// `include!` the canonical permission table directly (instead of taking a
// build-dependency on `fancy-utils`) to avoid double-compiling that crate
// for both the build script and the host crate.  Pulled in at file scope
// so the source file's `//!` module docs remain valid.
include!("../fancy-utils/src/permissions.rs");

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    // Semantic cfg alias for the platforms whose builds carry the native
    // (Rust-peer) stream viewer (`fancy_screenshare::viewer`): gates in
    // commands/stream_view.rs and the signal handler say WHAT they need
    // (`#[cfg(native_stream_viewer)]`) instead of repeating the platform
    // list. There is no shorter built-in form - bare `linux` does not
    // exist as a cfg, and `unix` would drag in macOS/Android/BSD.
    println!("cargo:rustc-check-cfg=cfg(native_stream_viewer)");
    if matches!(target_os.as_str(), "linux" | "windows") {
        println!("cargo:rustc-cfg=native_stream_viewer");
    }

    generate_permissions_ts();
    generate_shared_constants();

    // Build signal-bridge BEFORE tauri_build::build() so that the
    // library file exists when Tauri validates bundle resource globs
    // (TAURI_CONFIG -> bundle.resources -> "signal-bridge/*.dll" etc.).
    if target_os != "android" && std::env::var("SKIP_SIGNAL_BRIDGE").is_err() {
        build_signal_bridge();
    }

    // Keep the minimal qt6ui client in lock-step: it is workspace-excluded
    // (GNU toolchain + MinGW Qt kit), so `cargo tauri dev` / `cargo build`
    // would otherwise never rebuild it and minimal mode would hand off to a
    // stale binary. Skips with a warning when the kit/toolchain is absent.
    if target_os != "android" && std::env::var("SKIP_QT6UI").is_err() {
        build_qt6ui();
    }

    build_tauri();

    // Oboe (Android audio) is a C++ library whose pure-virtual functions
    // need the C++ runtime (`__cxa_pure_virtual` etc.).  The Rust linker
    // uses NDK clang (C mode) which does NOT auto-link libc++.
    //
    // We link against libc++_shared.so (the NDK's dynamic C++ runtime)
    // rather than libc++_static.a because static linking pulls in CRT
    // builtins whose static constructors (init_have_lse_atomics ->
    // getauxval) crash with SIGSEGV on some ARM64 devices during dlopen.
    //
    // The Tauri CLI automatically detects libc++_shared.so as a NEEDED
    // dependency and symlinks it into the jniLibs dir for APK bundling.
    if target_os == "android" {
        let ndk_home = std::env::var("NDK_HOME")
            .or_else(|_| std::env::var("ANDROID_NDK_HOME"))
            .unwrap_or_else(|_| {
                panic!("NDK_HOME or ANDROID_NDK_HOME must be set for Android builds");
            });

        let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
        let ndk_triple = match target_arch.as_str() {
            "aarch64" => "aarch64-linux-android",
            "arm" => "arm-linux-androideabi",
            "x86_64" => "x86_64-linux-android",
            "x86" => "i686-linux-android",
            other => panic!("unsupported Android arch: {other}"),
        };

        let host = if cfg!(target_os = "linux") {
            "linux-x86_64"
        } else if cfg!(target_os = "windows") {
            "windows-x86_64"
        } else {
            "darwin-x86_64"
        };

        let sysroot_lib =
            format!("{ndk_home}/toolchains/llvm/prebuilt/{host}/sysroot/usr/lib/{ndk_triple}");

        // Copy libc++_shared.so into OUT_DIR so we can add a clean search
        // path.  Adding {sysroot_lib} directly would also expose libc.a
        // (static bionic) which the linker picks up INSTEAD of the dynamic
        // libc.so (located in the API-level subdirectory).  That pulls in
        // pthread_create, __init_tcb and other internals whose static
        // versions crash with SEGV_ACCERR when loaded via dlopen.
        let out_dir = std::env::var("OUT_DIR").unwrap_or_else(|_| {
            panic!("OUT_DIR must be set in build scripts");
        });
        let src = format!("{sysroot_lib}/libc++_shared.so");
        let dst = format!("{out_dir}/libc++_shared.so");
        let _bytes = std::fs::copy(&src, &dst).unwrap_or_else(|e| {
            panic!("failed to copy libc++_shared.so from {src} to {dst}: {e}");
        });
        println!("cargo:rustc-link-search=native={out_dir}");
        println!("cargo:rustc-link-lib=c++_shared");

        // The NDK's libclang_rt.builtins contains outlined-atomics
        // helpers whose constructor (init_have_lse_atomics) calls a
        // statically-linked getauxval that crashes with SIGSEGV on
        // dlopen (null ELF auxiliary vector pointer).  Compile a safe
        // getauxval that reads /proc/self/auxv directly: because our
        // object is linked before the builtins archive, the linker
        // resolves init_have_lse_atomics' reference to our version.
        if target_arch == "aarch64" {
            cc::Build::new()
                .file("src/getauxval_fix.c")
                .flag("-mno-outline-atomics")
                .compile("getauxval_fix");
        }
    }

    // tauri_build embeds a Common Controls v6 manifest into binaries via
    // `cargo:rustc-link-arg-bins`.  The lib-test binary is NOT a "bin"
    // target, so it gets comctl32 v5.82 at runtime which is missing
    // `TaskDialogIndirect` → STATUS_ENTRYPOINT_NOT_FOUND on startup.
    //
    // Fix: delay-load comctl32.dll so the import is resolved lazily
    // instead of at process start.  The real binary's manifest activates
    // comctl32 v6 before any call.  The test binary never calls comctl32
    // functions, so the lazy load never fires and startup succeeds.
    #[cfg(windows)]
    if target_os == "windows" {
        println!("cargo:rustc-link-lib=delayimp");
        println!("cargo:rustc-link-arg=/DELAYLOAD:comctl32.dll");
    }
}

/// Run `tauri-build`, choosing which capability files it may see.
///
/// The capability that grants the `updater:` and `process:` permissions lives
/// in `capabilities/self-updater/` rather than next to the others, because the
/// ACL is resolved at build time against the plugins actually in the dependency
/// graph: with the `self-updater` feature off those two plugins are gone, and a
/// capability still asking for their permissions is a hard build error.
///
/// So the glob is narrowed to the top level in that case. `**/*` (the
/// tauri-build default) picks the subdirectory up again when the feature is on.
///
/// `cfg!(feature = ...)` would be wrong here - inside a build script that reads
/// the build script's *own* features, not the crate's - hence `CARGO_FEATURE_*`.
fn build_tauri() {
    println!("cargo:rerun-if-changed=capabilities");

    // `tauri.linux.conf.json` declares `bundle.resources: ["signal-bridge/*.so"]`,
    // and tauri-build fails outright when a resource glob matches nothing:
    //
    //   glob pattern signal-bridge/*.so path not found or didn't match any files
    //
    // With SKIP_SIGNAL_BRIDGE set, `build_signal_bridge()` above never runs, so
    // nothing ever produces that file and the build cannot succeed from a clean
    // checkout. It only appears to work in a tree where an earlier unskipped
    // build happened to leave the .so behind.
    //
    // Every packaging path that skips the bridge hits this - the AUR
    // `fancy-mumble` package and the Flatpak both build with SKIP_SIGNAL_BRIDGE=1
    // and ship the bridge separately, for the AGPL boundary. So clear the list:
    // TAURI_CONFIG is a JSON document deep-merged over the config files, and an
    // empty `resources` leaves nothing to glob.
    if std::env::var_os("SKIP_SIGNAL_BRIDGE").is_some() {
        println!("cargo:rerun-if-env-changed=SKIP_SIGNAL_BRIDGE");
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"resources":[]}}"#);
    }

    let self_updater = std::env::var_os("CARGO_FEATURE_SELF_UPDATER").is_some();
    let pattern = if self_updater {
        "./capabilities/**/*"
    } else {
        "./capabilities/*.json"
    };

    if let Err(e) =
        tauri_build::try_build(tauri_build::Attributes::new().capabilities_path_pattern(pattern))
    {
        panic!("tauri-build failed: {e}");
    }
}

/// Probe the qt6ui build prerequisites: the Qt MinGW kit, the matching
/// MinGW g++, and the GNU Rust toolchain (same defaults + env overrides as
/// `qt6ui/build.ps1`). Returns `(qt_dir, mingw_dir, qmake_path)`, or `None`
/// after emitting a `cargo:warning` describing what is missing.
fn qt6ui_prerequisites() -> Option<(String, String, std::path::PathBuf)> {
    let qt =
        std::env::var("QT6_MINGW_DIR").unwrap_or_else(|_| "C:\\Qt\\6.11.1\\mingw_64".to_owned());
    let mingw =
        std::env::var("QT6_MINGW_GCC").unwrap_or_else(|_| "C:\\Qt\\Tools\\mingw1310_64".to_owned());
    let qmake = std::path::Path::new(&qt).join("bin").join("qmake.exe");
    if !qmake.is_file() {
        println!("cargo:warning=qt6ui skipped: Qt MinGW kit not found at {qt} (set QT6_MINGW_DIR)");
        return None;
    }
    if !std::path::Path::new(&mingw)
        .join("bin")
        .join("g++.exe")
        .is_file()
    {
        println!("cargo:warning=qt6ui skipped: MinGW g++ not found at {mingw} (set QT6_MINGW_GCC)");
        return None;
    }
    let has_gnu = std::process::Command::new("rustup")
        .args(["run", "stable-x86_64-pc-windows-gnu", "rustc", "--version"])
        .output()
        .is_ok_and(|o| o.status.success());
    if !has_gnu {
        println!("cargo:warning=qt6ui skipped: stable-x86_64-pc-windows-gnu toolchain not installed (rustup toolchain install stable-x86_64-pc-windows-gnu)");
        return None;
    }
    Some((qt, mingw, qmake))
}

/// Copy `src` to `dest` only when the contents differ.
///
/// Build scripts run on every fingerprint change; blind `fs::copy` bumps the
/// destination mtime each time, and destinations inside the crate directory
/// (e.g. `signal-bridge/`) are watched by `cargo tauri dev` - which then
/// restarts the build, killing it mid-run and re-triggering the copy in an
/// endless rebuild loop.
fn copy_if_changed(src: &std::path::Path, dest: &std::path::Path) -> std::io::Result<bool> {
    let src_bytes = std::fs::read(src)?;
    if let Ok(existing) = std::fs::read(dest) {
        if existing == src_bytes {
            return Ok(false);
        }
    }
    std::fs::write(dest, src_bytes)?;
    Ok(true)
}

/// Build the signal-bridge cdylib from its separate workspace and copy
/// the output library next to the mumble-tauri executable.
fn build_signal_bridge() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| {
        panic!("CARGO_MANIFEST_DIR must be set in build scripts");
    });
    let bridge_dir = std::path::Path::new(&manifest_dir).join("../signal-bridge");

    // If the signal-bridge crate is not present (e.g. shallow checkout),
    // skip silently.
    if !bridge_dir.join("Cargo.toml").exists() {
        println!(
            "cargo:warning=signal-bridge crate not found at {}, skipping",
            bridge_dir.display()
        );
        return;
    }

    // Re-run this build script when signal-bridge sources change.
    println!("cargo:rerun-if-changed=../signal-bridge/src");
    println!("cargo:rerun-if-changed=../signal-bridge/Cargo.toml");
    println!("cargo:rerun-if-env-changed=SKIP_SIGNAL_BRIDGE");

    // Match the current profile: use --release when we are building in
    // release mode, otherwise default (debug).
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let mut cmd = std::process::Command::new("cargo");
    let _ = cmd.arg("build").current_dir(&bridge_dir);
    // The bridge builds into its own `target/` (the copy below reads it from
    // there). A `CARGO_TARGET_DIR` in the environment would send it into the
    // parent's directory instead, where a debug-profile parent already holds
    // the lock the nested build then waits for - a deadlock, and the copy
    // would not find the library even if it finished. Same scrub as qt6ui.
    let _ = cmd.env_remove("CARGO_TARGET_DIR");
    if profile == "release" {
        let _ = cmd.arg("--release");
    }

    eprintln!("building signal-bridge ({profile})...");
    let status = cmd.status().unwrap_or_else(|e| {
        panic!("failed to run `cargo build` for signal-bridge: {e}");
    });
    if !status.success() {
        panic!("signal-bridge build failed (exit code: {status})");
    }

    // Determine library filename and source path.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let lib_name = match target_os.as_str() {
        "windows" => "signal_bridge.dll",
        "macos" => "libsignal_bridge.dylib",
        _ => "libsignal_bridge.so",
    };

    // signal-bridge has its own target/ directory because it is workspace-excluded.
    let bridge_lib = bridge_dir.join("target").join(&profile).join(lib_name);
    if !bridge_lib.exists() {
        panic!(
            "signal-bridge library not found at {} after build",
            bridge_lib.display()
        );
    }

    // Copy next to the mumble-tauri executable (workspace target/{profile}/).
    // OUT_DIR is inside target/{profile}/build/mumble-tauri-*/out/ -- walk
    // up to reach target/{profile}/.
    let out_dir = std::env::var("OUT_DIR").unwrap_or_else(|_| {
        panic!("OUT_DIR must be set in build scripts");
    });
    let out_path = std::path::Path::new(&out_dir);
    // OUT_DIR is target/<profile>/build/<crate-hash>/out. The profile dir is
    // the parent of the `build/` component. Resolving it this way (rather than
    // matching the literal names "debug"/"release") supports custom profiles
    // such as `release-debug`, whose dir is `target/release-debug/`.
    let target_profile_dir = out_path
        .ancestors()
        .find(|p| p.file_name().is_some_and(|n| n == "build"))
        .and_then(std::path::Path::parent)
        .unwrap_or_else(|| {
            panic!("could not locate the profile dir from OUT_DIR={out_dir}");
        });

    let dest = target_profile_dir.join(lib_name);
    let copied = copy_if_changed(&bridge_lib, &dest).unwrap_or_else(|e| {
        panic!(
            "failed to copy {} -> {}: {e}",
            bridge_lib.display(),
            dest.display()
        );
    });
    if copied {
        eprintln!("copied signal-bridge to {}", dest.display());
    }

    // Also copy into the signal-bridge/ subdirectory next to the crate
    // root so that `cargo tauri build` can include it as a bundled
    // resource (bundle.resources: ["signal-bridge/*.dll"]). Content-compared:
    // this path is inside the tauri-dev watch root, so a blind copy would
    // restart the dev loop on every build-script run.
    let bundle_dir = std::path::Path::new(&manifest_dir).join("signal-bridge");
    let _ = std::fs::create_dir_all(&bundle_dir);
    let bundle_dest = bundle_dir.join(lib_name);
    let copied = copy_if_changed(&bridge_lib, &bundle_dest).unwrap_or_else(|e| {
        panic!(
            "failed to copy {} -> {}: {e}",
            bridge_lib.display(),
            bundle_dest.display()
        );
    });
    if copied {
        eprintln!("copied signal-bridge to {}", bundle_dest.display());
    }
}

/// Build the minimal qt6ui client (same pattern as [`build_signal_bridge`]:
/// the crate is workspace-excluded because it must be compiled with the
/// `x86_64-pc-windows-gnu` toolchain against the MinGW Qt kit) and copy the
/// binary next to the mumble-tauri executable so the minimal-mode launcher's
/// sibling lookup finds a fresh build.
///
/// Prerequisites are probed, not assumed: when the Qt kit, MinGW g++ or the
/// GNU toolchain is missing (CI, contributor machines), the step is skipped
/// with a `cargo:warning` instead of failing the full-client build. A real
/// qt6ui compile error, however, fails the build so it cannot go stale
/// silently. Set `SKIP_QT6UI=1` to opt out entirely.
fn build_qt6ui() {
    // Host-only: the MinGW Qt kit layout probed below is Windows-specific.
    if !cfg!(windows) {
        return;
    }

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| {
        panic!("CARGO_MANIFEST_DIR must be set in build scripts");
    });
    let qt6ui_dir = std::path::Path::new(&manifest_dir).join("../qt6ui");
    if !qt6ui_dir.join("Cargo.toml").exists() {
        println!(
            "cargo:warning=qt6ui crate not found at {}, skipping",
            qt6ui_dir.display()
        );
        return;
    }

    println!("cargo:rerun-if-changed=../qt6ui/src");
    println!("cargo:rerun-if-changed=../qt6ui/qml");
    println!("cargo:rerun-if-changed=../qt6ui/cpp");
    println!("cargo:rerun-if-changed=../qt6ui/Cargo.toml");
    println!("cargo:rerun-if-env-changed=SKIP_QT6UI");
    println!("cargo:rerun-if-env-changed=FORCE_QT6UI_BUILD");
    println!("cargo:rerun-if-env-changed=QT6_MINGW_DIR");
    println!("cargo:rerun-if-env-changed=QT6_MINGW_GCC");

    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_owned());
    if qt6ui_dev_prebuilt_skips(&qt6ui_dir, &profile) {
        return;
    }
    let Some((qt, mingw, qmake)) = qt6ui_prerequisites() else {
        return; // warnings already emitted
    };
    run_nested_qt6ui_build(&qt6ui_dir, &qt, &mingw, &qmake, &profile);
    install_qt6ui_binary(&qt6ui_dir, &profile);
}

/// In dev builds, skip the (minutes-long) nested qt6ui build when a binary
/// already exists in its own target dir - the launcher's dev-layout fallback
/// (`ui_mode::find_qt6ui_binary`) picks it up, and qt6ui devs rebuild it
/// themselves. First runs and release builds always build. `FORCE_QT6UI_BUILD`
/// opts back in.
fn qt6ui_dev_prebuilt_skips(qt6ui_dir: &std::path::Path, profile: &str) -> bool {
    if profile == "release" || std::env::var("FORCE_QT6UI_BUILD").is_ok() {
        return false;
    }
    let exe_name = if cfg!(windows) { "qt6ui.exe" } else { "qt6ui" };
    let prebuilt = ["release", "debug"]
        .iter()
        .map(|p| qt6ui_dir.join("target").join(p).join(exe_name))
        .find(|p| p.is_file());
    if let Some(prebuilt) = prebuilt {
        eprintln!(
            "skipping nested qt6ui build (dev profile; launcher will use {})",
            prebuilt.display()
        );
        return true;
    }
    false
}

/// Run the `+gnu` nested `cargo build` for qt6ui with a scrubbed environment
/// (so the parent MSVC toolchain does not leak in) and Qt/MinGW/Ninja on PATH.
/// Panics on failure - a stale qt6ui must not build silently.
fn run_nested_qt6ui_build(
    qt6ui_dir: &std::path::Path,
    qt: &str,
    mingw: &str,
    qmake: &std::path::Path,
    profile: &str,
) {
    let mut path = format!("{mingw}\\bin;{qt}\\bin");
    // CMake-based -sys crates (audiopus_sys) must not pick up a stray
    // `make`/`sh` from the ambient PATH; prefer Qt Tools' Ninja (see
    // qt6ui/build.ps1 for the full story).
    let ninja = std::path::Path::new("C:\\Qt\\Tools\\Ninja");
    let mut cmd = std::process::Command::new("cargo");
    let _ = cmd
        .args(["+stable-x86_64-pc-windows-gnu", "build"])
        .current_dir(qt6ui_dir)
        .env("QMAKE", qmake);
    // The parent (MSVC) cargo exports its own toolchain to build scripts
    // (RUSTC, RUSTUP_TOOLCHAIN, ...), which would override the `+gnu`
    // selection above and link MinGW Qt with the MSVC linker. Scrub them
    // so the nested build resolves the GNU toolchain cleanly.
    for var in [
        "CARGO",
        "RUSTC",
        "RUSTDOC",
        "RUSTC_WRAPPER",
        "RUSTC_WORKSPACE_WRAPPER",
        "RUSTUP_TOOLCHAIN",
        "RUSTFLAGS",
        "CARGO_ENCODED_RUSTFLAGS",
        "CARGO_TARGET_DIR",
        "CARGO_BUILD_TARGET",
    ] {
        let _ = cmd.env_remove(var);
    }
    if ninja.join("ninja.exe").is_file() {
        path = format!("{};{path}", ninja.display());
        let _ = cmd.env("CMAKE_GENERATOR", "Ninja");
    }
    if let Some(existing) = std::env::var_os("PATH") {
        let mut full = std::ffi::OsString::from(format!("{path};"));
        full.push(existing);
        let _ = cmd.env("PATH", full);
    } else {
        let _ = cmd.env("PATH", &path);
    }
    if profile == "release" {
        let _ = cmd.arg("--release");
    }

    eprintln!("building qt6ui ({profile})...");
    let status = cmd.status().unwrap_or_else(|e| {
        panic!("failed to run `cargo build` for qt6ui: {e}");
    });
    if !status.success() {
        panic!("qt6ui build failed (exit code: {status}); set SKIP_QT6UI=1 to bypass");
    }
}

/// Copy the freshly built qt6ui exe next to the mumble-tauri executable so
/// the launcher's sibling lookup sees it (qt6ui has its own target dir
/// because it is workspace-excluded).
fn install_qt6ui_binary(qt6ui_dir: &std::path::Path, profile: &str) {
    let built = qt6ui_dir.join("target").join(profile).join("qt6ui.exe");
    if !built.is_file() {
        panic!("qt6ui binary not found at {} after build", built.display());
    }
    let out_dir = std::env::var("OUT_DIR").unwrap_or_else(|_| {
        panic!("OUT_DIR must be set in build scripts");
    });
    let target_profile_dir = std::path::Path::new(&out_dir)
        .ancestors()
        .find(|p| p.file_name().is_some_and(|n| n == "build"))
        .and_then(std::path::Path::parent)
        .unwrap_or_else(|| {
            panic!("could not locate the profile dir from OUT_DIR={out_dir}");
        })
        .to_path_buf();
    let dest = target_profile_dir.join("qt6ui.exe");
    match copy_if_changed(&built, &dest) {
        Ok(true) => eprintln!("copied qt6ui to {}", dest.display()),
        Ok(false) => {}
        // A running qt6ui instance locks the destination; the dev-layout
        // fallback in the launcher still finds the fresh build, so warn
        // instead of failing.
        Err(e) => println!("cargo:warning=could not copy qt6ui.exe next to the app ({e})"),
    }
}

/// Parse `config/constants.json` (single source of truth for
/// cross-client integration constants) and emit:
///
/// 1. `$OUT_DIR/fancy_constants.rs` - `pub const` items included by
///    `src/constants.rs`, so the values are baked in at compile time with
///    zero runtime overhead;
/// 2. `ui/src/utils/appConstants.ts` - the same values for the React UI
///    (same generate-and-commit flow as `permissions.ts` above).
///
/// The minimal `qt6ui` client runs the same codegen from its own build.rs
/// (it is workspace-excluded, so the logic is mirrored there).
fn generate_shared_constants() {
    println!("cargo:rerun-if-changed=../../config/constants.json");

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| {
        panic!("CARGO_MANIFEST_DIR must be set in build scripts");
    });
    let json_path = std::path::Path::new(&manifest_dir).join("../../config/constants.json");
    let raw = std::fs::read_to_string(&json_path).unwrap_or_else(|e| {
        panic!("failed to read {}: {e}", json_path.display());
    });
    let c: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|e| {
        panic!("invalid JSON in {}: {e}", json_path.display());
    });

    // Rust constants: included by src/constants.rs, always rewritten (OUT_DIR).
    let out_dir = std::env::var("OUT_DIR").unwrap_or_else(|_| {
        panic!("OUT_DIR must be set in build scripts");
    });
    std::fs::write(
        std::path::Path::new(&out_dir).join("fancy_constants.rs"),
        build_rust_constants(&c),
    )
    .unwrap_or_else(|e| panic!("failed to write fancy_constants.rs: {e}"));

    // TypeScript constants: write-if-changed so incremental rebuilds don't
    // bump the mtime (which would trigger Vite HMR loops).
    let ts = build_ts_constants(&c);
    let ts_path = std::path::Path::new(&manifest_dir)
        .join("ui")
        .join("src")
        .join("utils")
        .join("appConstants.ts");
    let up_to_date = std::fs::read_to_string(&ts_path).is_ok_and(|existing| existing == ts);
    if !up_to_date {
        std::fs::write(&ts_path, ts).unwrap_or_else(|e| {
            panic!("failed to write {}: {e}", ts_path.display());
        });
        eprintln!("regenerated {}", ts_path.display());
    }
}

/// A required string field of `constants.json`.
fn json_str(c: &serde_json::Value, key: &str) -> String {
    c[key]
        .as_str()
        .unwrap_or_else(|| panic!("constants.json: '{key}' must be a string"))
        .to_owned()
}

/// A required numeric field of `constants.json`.
fn json_num(c: &serde_json::Value, key: &str) -> u64 {
    c[key]
        .as_u64()
        .unwrap_or_else(|| panic!("constants.json: '{key}' must be a number"))
}

/// A required string-array field of `constants.json`.
fn json_list(c: &serde_json::Value, key: &str) -> Vec<String> {
    c[key]
        .as_array()
        .unwrap_or_else(|| panic!("constants.json: '{key}' must be an array"))
        .iter()
        .map(|v| {
            v.as_str()
                .unwrap_or_else(|| panic!("constants.json: '{key}' must contain only strings"))
                .to_owned()
        })
        .collect()
}

/// The `pub const` items included by `src/constants.rs`.
fn build_rust_constants(c: &serde_json::Value) -> String {
    use std::fmt::Write as _;
    let mut rs = String::new();
    rs.push_str("// AUTO-GENERATED by build.rs from config/constants.json - DO NOT EDIT.\n");
    let _ = writeln!(
        rs,
        "pub const APP_IDENTIFIER: &str = {:?};",
        json_str(c, "appIdentifier")
    );
    let _ = writeln!(
        rs,
        "pub const UI_MODE_MARKER_FILE: &str = {:?};",
        json_str(c, "uiModeMarkerFile")
    );
    let _ = writeln!(
        rs,
        "pub const ENV_E2E_DATA_DIR: &str = {:?};",
        json_str(c, "envE2eDataDir")
    );
    let _ = writeln!(
        rs,
        "pub const ENV_QT6UI_BIN: &str = {:?};",
        json_str(c, "envQt6uiBin")
    );
    let _ = writeln!(
        rs,
        "pub const ENV_FULL_CLIENT_BIN: &str = {:?};",
        json_str(c, "envFullClientBin")
    );
    let _ = writeln!(
        rs,
        "pub const QT6UI_BINARY_NAME: &str = {:?};",
        json_str(c, "qt6uiBinaryName")
    );
    let _ = writeln!(
        rs,
        "pub const FULL_CLIENT_BINARY_NAMES: &[&str] = &{:?};",
        json_list(c, "fullClientBinaryNames")
    );
    let _ = writeln!(
        rs,
        "pub const WEAK_PC_MAX_MEMORY_MB: u64 = {};",
        json_num(c, "weakPcMaxMemoryMb")
    );
    let _ = writeln!(
        rs,
        "pub const WEAK_PC_MAX_CPU_CORES: u32 = {};",
        json_num(c, "weakPcMaxCpuCores")
    );
    let _ = writeln!(
        rs,
        "pub const DEFAULT_SERVER_PORT: u16 = {};",
        json_num(c, "defaultServerPort")
    );
    let _ = writeln!(
        rs,
        "pub const DM_CHANNEL_PREFIX: &str = {:?};",
        json_str(c, "dmChannelPrefix")
    );
    let _ = writeln!(
        rs,
        "pub const LOCALES: &[&str] = &{:?};",
        json_list(c, "locales")
    );
    let _ = writeln!(
        rs,
        "pub const DEFAULT_LOCALE: &str = {:?};",
        json_str(c, "defaultLocale")
    );
    rs
}

/// The `export const` items for `ui/src/utils/appConstants.ts`.
fn build_ts_constants(c: &serde_json::Value) -> String {
    use std::fmt::Write as _;
    let mut ts = String::new();
    ts.push_str("/* AUTO-GENERATED by mumble-tauri/build.rs from config/constants.json\n");
    ts.push_str(" * DO NOT EDIT BY HAND. Change config/constants.json and\n");
    ts.push_str(" * rebuild; this file will be regenerated automatically.\n */\n\n");
    let _ = writeln!(
        ts,
        "export const APP_IDENTIFIER = {:?} as const;",
        json_str(c, "appIdentifier")
    );
    let _ = writeln!(
        ts,
        "export const UI_MODE_MARKER_FILE = {:?} as const;",
        json_str(c, "uiModeMarkerFile")
    );
    let _ = writeln!(
        ts,
        "export const WEAK_PC_MAX_MEMORY_MB = {};",
        json_num(c, "weakPcMaxMemoryMb")
    );
    let _ = writeln!(
        ts,
        "export const WEAK_PC_MAX_CPU_CORES = {};",
        json_num(c, "weakPcMaxCpuCores")
    );
    let _ = writeln!(
        ts,
        "export const DEFAULT_SERVER_PORT = {};",
        json_num(c, "defaultServerPort")
    );
    let _ = writeln!(
        ts,
        "export const DM_CHANNEL_PREFIX = {:?} as const;",
        json_str(c, "dmChannelPrefix")
    );
    let _ = writeln!(
        ts,
        "export const LOCALES = {:?} as const;",
        json_list(c, "locales")
    );
    let _ = writeln!(
        ts,
        "export const DEFAULT_LOCALE = {:?} as const;",
        json_str(c, "defaultLocale")
    );
    ts
}

/// Regenerate `ui/src/utils/permissions.ts` from the canonical Rust table.
///
/// Only writes the file when its content actually changes, so incremental
/// rebuilds don't bump the mtime (which would trigger Vite HMR loops).
fn generate_permissions_ts() {
    use std::fmt::Write as _;

    println!("cargo:rerun-if-changed=../fancy-utils/src/permissions.rs");

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| {
        panic!("CARGO_MANIFEST_DIR must be set in build scripts");
    });
    let out_path = std::path::Path::new(&manifest_dir)
        .join("ui")
        .join("src")
        .join("utils")
        .join("permissions.ts");

    let entries = ENTRIES;

    let mut out = String::new();
    out.push_str("/* AUTO-GENERATED by mumble-tauri/build.rs from\n");
    out.push_str(" * crates/fancy-utils/src/permissions.rs - DO NOT EDIT BY HAND.\n");
    out.push_str(" *\n");
    out.push_str(" * To add or change a Mumble permission flag, edit the Rust file and\n");
    out.push_str(" * rebuild; this file will be regenerated automatically.\n");
    out.push_str(" */\n\n");

    out.push_str("/** One Mumble ACL permission flag. */\n");
    out.push_str("export interface PermissionDef {\n");
    out.push_str("  /** Bitmask value (single bit). */\n");
    out.push_str("  readonly bit: number;\n");
    out.push_str("  /** Stable identifier matching the Rust constant name. */\n");
    out.push_str("  readonly ident: string;\n");
    out.push_str("  /** Human-readable label shown in the UI. */\n");
    out.push_str("  readonly label: string;\n");
    out.push_str("  /** True for permissions that only apply on the root channel. */\n");
    out.push_str("  readonly rootOnly: boolean;\n");
    out.push_str("}\n\n");

    out.push_str("// Named bit constants - one per Mumble ACL permission.\n");
    for e in entries {
        let _ = writeln!(out, "export const PERM_{} = 0x{:X};", e.ident, e.bit);
    }
    out.push('\n');

    out.push_str("/** Complete ordered list of Mumble permission bits. */\n");
    out.push_str("export const PERMISSIONS: readonly PermissionDef[] = [\n");
    for e in entries {
        let _ = writeln!(
            out,
            "  {{ bit: PERM_{}, ident: {:?}, label: {:?}, rootOnly: {} }},",
            e.ident, e.ident, e.label, e.root_only
        );
    }
    out.push_str("] as const;\n\n");

    out.push_str("/** Subset of permissions that apply to non-root channels. */\n");
    out.push_str("export const CHANNEL_PERMISSIONS: readonly PermissionDef[] =\n");
    out.push_str("  PERMISSIONS.filter((p) => !p.rootOnly);\n\n");

    out.push_str("/** Subset of permissions that only apply to the root channel. */\n");
    out.push_str("export const ROOT_PERMISSIONS: readonly PermissionDef[] =\n");
    out.push_str("  PERMISSIONS.filter((p) => p.rootOnly);\n");

    let needs_write = match std::fs::read_to_string(&out_path) {
        Ok(existing) => existing != out,
        Err(_) => true,
    };
    if needs_write {
        if let Some(parent) = out_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(&out_path, out).unwrap_or_else(|e| {
            panic!(
                "failed to write generated permissions.ts to {}: {e}",
                out_path.display()
            );
        });
        eprintln!("regenerated {}", out_path.display());
    }
}
