//! Build script: register the QML module and its backing Rust bridge with
//! cxx-qt.  cxx-qt-build locates Qt through `qmake` (found on `PATH` or via
//! the `QMAKE` environment variable), runs `moc`/`rcc`, compiles the
//! generated C++ glue, and emits the link flags for the Qt libraries.
//!
//! See `README.md` for the required environment (MinGW Qt kit + the
//! `x86_64-pc-windows-gnu` toolchain).

use cxx_qt_build::{CxxQtBuilder, QmlModule};

fn main() {
    CxxQtBuilder::new()
        .qml_module(QmlModule {
            uri: "com.fancymumble.qt6ui",
            rust_files: &["src/bridge.rs"],
            qml_files: &["qml/main.qml", "qml/MarkdownField.qml", "qml/NameCard.qml"],
            ..Default::default()
        })
        // Hand-written C++: the QSyntaxHighlighter that decorates the chat
        // input (parsing itself is in Rust via the bridge). QQuickTextDocument
        // lives in the Quick module.
        .qt_module("Quick")
        .qobject_header("cpp/markdown_highlighter.h")
        .cc_builder(|cc| {
            cc.file("cpp/markdown_highlighter.cpp");
            cc.include("cpp");
            println!("cargo:rerun-if-changed=cpp/markdown_highlighter.cpp");
        })
        .build();

    // -- MinGW / GNU-ld link-ordering fix --------------------------------
    //
    // cxx-qt-build appends its generated objects and `-lqt6ui-cxxqt-generated`
    // to the very END of the link line, but emits the Qt import libraries
    // earlier (via `rustc-link-lib`).  GNU ld resolves symbols in a single
    // left-to-right pass, so the trailing cxx-qt objects' references into
    // Qt (and libstdc++) go unresolved -> hundreds of `undefined reference`
    // errors.  Re-append the libraries here as link-args so they land after
    // everything else and satisfy those references.  Harmless duplicates.
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

/// Best-effort discovery of the Qt library directory: ask `qmake`, then fall
/// back to `QT6_MINGW_DIR/lib` or the default kit path.
fn qt_lib_dir() -> Option<String> {
    let qmake = std::env::var("QMAKE").unwrap_or_else(|_| "qmake".to_owned());
    if let Ok(out) = std::process::Command::new(&qmake)
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
    std::env::var("QT6_MINGW_DIR")
        .map(|d| format!("{d}/lib"))
        .ok()
        .or_else(|| Some("C:/Qt/6.10.0/mingw_64/lib".to_owned()))
}
