//! Build script: register the QML module and its backing Rust bridge with
//! cxx-qt.  cxx-qt-build locates Qt through `qmake` (found on `PATH` or via
//! the `QMAKE` environment variable), runs `moc`/`rcc`, compiles the
//! generated C++ glue, and emits the link flags for the Qt libraries.
//!
//! See `README.md` for the required environment (MinGW Qt kit + the
//! `x86_64-pc-windows-gnu` toolchain).

use cxx_qt_build::{CxxQtBuilder, QmlModule};

/// Locale namespaces this client embeds from the full client's bundles
/// (`crates/mumble-tauri/ui/src/core/locales/{lang}/{ns}.json`). Kept to the
/// namespaces the QML actually uses so the binary stays small.
const LOCALE_NAMESPACES: &[&str] = &["common", "server", "sidebar", "chat", "settings"];

fn main() {
    generate_shared_constants_and_locales();

    CxxQtBuilder::new()
        .qml_module(QmlModule {
            uri: "com.fancymumble.qt6ui",
            rust_files: &["src/bridge.rs"],
            qml_files: &["qml/main.qml", "qml/MarkdownField.qml", "qml/NameCard.qml"],
            ..Default::default()
        })
        // Hand-written C++: the QSyntaxHighlighter that decorates the chat
        // input (parsing itself is in Rust via the bridge) and the image
        // codec leaves for image messages (fit strategy in src/media.rs).
        // QQuickTextDocument lives in the Quick module.
        .qt_module("Quick")
        .qobject_header("cpp/markdown_highlighter.h")
        .cc_builder(|cc| {
            cc.file("cpp/markdown_highlighter.cpp");
            cc.file("cpp/image_codec.cpp");
            cc.include("cpp");
            println!("cargo:rerun-if-changed=cpp/markdown_highlighter.cpp");
            println!("cargo:rerun-if-changed=cpp/image_codec.cpp");
            println!("cargo:rerun-if-changed=cpp/image_codec.h");
        })
        .build();

    // -- MinGW / GNU-ld link-ordering fix (Windows-GNU targets only) ------
    //
    // cxx-qt-build appends its generated objects and `-lqt6ui-cxxqt-generated`
    // to the very END of the link line, but emits the Qt import libraries
    // earlier (via `rustc-link-lib`).  GNU ld resolves symbols in a single
    // left-to-right pass, so the trailing cxx-qt objects' references into
    // Qt (and libstdc++) go unresolved -> hundreds of `undefined reference`
    // errors.  Re-append the libraries here as link-args so they land after
    // everything else and satisfy those references.  Harmless duplicates.
    //
    // On Linux this is unnecessary (and `-lmingwex`/`-lmsvcrt` would break
    // the link outright), so it is gated to the Windows target.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        if let Some(lib_dir) = qt_lib_dir() {
            println!("cargo:rustc-link-search=native={lib_dir}");
        }
        // Everything the trailing cxx-qt objects reference, in resolution order:
        // Qt, then the C++ runtime, then the C runtime.  `msvcrt`/`mingwex`
        // provide symbols the qmlcachegen-compiled QML pulls in (e.g. `memchr`,
        // which the optimiser inlines from Qt headers under LTO); `stdc++`
        // provides the C++ guard/RTTI symbols.  Duplicates are harmless.
        for lib in ["Qt6Quick", "Qt6Qml", "Qt6Gui", "Qt6Core", "stdc++", "mingwex", "msvcrt"] {
            println!("cargo:rustc-link-arg-bins=-l{lib}");
        }
    }
}

/// Parse `config/constants.json` (single source of truth for
/// cross-client integration constants, mirrored from
/// `mumble-tauri/build.rs` because this crate is workspace-excluded) and
/// emit `$OUT_DIR/fancy_constants.rs`. Also emits
/// `$OUT_DIR/fancy_locales.rs`, which `include_str!`s the full client's
/// locale JSON bundles so both clients share one set of translations.
fn generate_shared_constants_and_locales() {
    use std::fmt::Write as _;

    println!("cargo:rerun-if-changed=../../config/constants.json");

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let root = std::path::Path::new(&manifest_dir).join("../..");
    let raw = std::fs::read_to_string(root.join("config/constants.json"))
        .expect("failed to read config/constants.json");
    let c: serde_json::Value =
        serde_json::from_str(&raw).expect("invalid JSON in constants.json");

    let s = |key: &str| -> String {
        c[key]
            .as_str()
            .unwrap_or_else(|| panic!("constants.json: '{key}' must be a string"))
            .to_owned()
    };
    let n = |key: &str| -> u64 {
        c[key]
            .as_u64()
            .unwrap_or_else(|| panic!("constants.json: '{key}' must be a number"))
    };
    let list = |key: &str| -> Vec<String> {
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
    };

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR");

    // ---- constants -------------------------------------------------------
    let mut rs = String::new();
    rs.push_str("// AUTO-GENERATED by build.rs from constants.json - DO NOT EDIT.\n");
    let _ = writeln!(rs, "pub const APP_IDENTIFIER: &str = {:?};", s("appIdentifier"));
    let _ = writeln!(rs, "pub const UI_MODE_MARKER_FILE: &str = {:?};", s("uiModeMarkerFile"));
    let _ = writeln!(rs, "pub const ENV_E2E_DATA_DIR: &str = {:?};", s("envE2eDataDir"));
    let _ = writeln!(rs, "pub const ENV_FULL_CLIENT_BIN: &str = {:?};", s("envFullClientBin"));
    let _ = writeln!(
        rs,
        "pub const FULL_CLIENT_BINARY_NAMES: &[&str] = &{:?};",
        list("fullClientBinaryNames")
    );
    let _ = writeln!(rs, "pub const DEFAULT_SERVER_PORT: u16 = {};", n("defaultServerPort"));
    let _ = writeln!(rs, "pub const DM_CHANNEL_PREFIX: &str = {:?};", s("dmChannelPrefix"));
    let _ = writeln!(rs, "pub const DEFAULT_LOCALE: &str = {:?};", s("defaultLocale"));
    std::fs::write(std::path::Path::new(&out_dir).join("fancy_constants.rs"), rs)
        .expect("failed to write fancy_constants.rs");

    // ---- shared locale bundles -------------------------------------------
    // Embed the same JSON files the React UI loads, so translations are
    // maintained once. Namespaced flat keys ("server.fields.host") are
    // produced at runtime by src/i18n.rs from these raw strings.
    let locales_dir = root.join("crates/mumble-tauri/ui/src/core/locales");
    let mut lr = String::new();
    lr.push_str("// AUTO-GENERATED by build.rs - embedded shared locale bundles.\n");
    lr.push_str("pub static LOCALE_JSON: &[(&str, &[(&str, &str)])] = &[\n");
    for lang in list("locales") {
        let _ = writeln!(lr, "    ({lang:?}, &[");
        for ns in LOCALE_NAMESPACES {
            let path = locales_dir.join(&lang).join(format!("{ns}.json"));
            assert!(
                path.is_file(),
                "shared locale bundle missing: {}",
                path.display()
            );
            // rerun-if-changed wants a path relative to the crate root (or
            // absolute); use absolute to be safe.
            println!("cargo:rerun-if-changed={}", path.display());
            let _ = writeln!(lr, "        ({ns:?}, include_str!({:?})),", path.display());
        }
        lr.push_str("    ]),\n");
    }
    lr.push_str("];\n");
    std::fs::write(std::path::Path::new(&out_dir).join("fancy_locales.rs"), lr)
        .expect("failed to write fancy_locales.rs");
}

/// Best-effort discovery of the Qt library directory: ask qmake, then fall
/// back to `QT6_MINGW_DIR/lib` or the default kit path.
///
/// `qmake6` is tried as well as `qmake`, because Debian and Ubuntu ship the Qt6
/// binary under the versioned name and leave plain `qmake` to Qt5 (often absent
/// entirely). Looking only for `qmake` is why this fell back to a `C:/Qt/...`
/// path on Linux and the link then failed for a reason that named neither Qt
/// nor the platform.
fn qt_lib_dir() -> Option<String> {
    let explicit = std::env::var("QMAKE").ok();
    let candidates: Vec<String> = explicit
        .into_iter()
        .chain(["qmake6".to_owned(), "qmake".to_owned()])
        .collect();
    for qmake in &candidates {
        if let Ok(out) = std::process::Command::new(qmake)
            .args(["-query", "QT_INSTALL_LIBS"])
            .output()
        {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_owned();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
    }
    // The MinGW kit fallbacks are Windows-shaped; on any other platform a wrong
    // guess is worse than none, because it turns "Qt was not found" into a link
    // error against a path that cannot exist here.
    if !cfg!(windows) {
        return None;
    }
    std::env::var("QT6_MINGW_DIR")
        .map(|d| format!("{d}/lib"))
        .ok()
        .or_else(|| Some("C:/Qt/6.10.0/mingw_64/lib".to_owned()))
}
