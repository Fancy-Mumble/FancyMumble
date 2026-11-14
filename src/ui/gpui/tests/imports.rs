//! What the system loads before `main`.
//!
//! Every library the executable imports is loaded, and initialised, before
//! the first line of the program runs, on every start, whether or not the
//! feature that needs it is ever used. So the list is kept here: a library
//! that appears in it without being added below on purpose fails this test.
//! A library only one feature uses belongs in `build.rs`'s list of those
//! loaded at their first call instead (`STARTUP.md` says why).

#![cfg(windows)]

use std::collections::BTreeSet;

/// The libraries the executable may import, lower case.
const EXPECTED: &[&str] = &[
    "advapi32.dll",
    "api-ms-win-core-synch-l1-2-0.dll",
    "api-ms-win-core-winrt-error-l1-1-0.dll",
    "api-ms-win-core-winrt-l1-1-0.dll",
    "api-ms-win-crt-convert-l1-1-0.dll",
    "api-ms-win-crt-environment-l1-1-0.dll",
    "api-ms-win-crt-filesystem-l1-1-0.dll",
    "api-ms-win-crt-heap-l1-1-0.dll",
    "api-ms-win-crt-locale-l1-1-0.dll",
    "api-ms-win-crt-math-l1-1-0.dll",
    "api-ms-win-crt-runtime-l1-1-0.dll",
    "api-ms-win-crt-stdio-l1-1-0.dll",
    "api-ms-win-crt-string-l1-1-0.dll",
    "api-ms-win-crt-time-l1-1-0.dll",
    "api-ms-win-crt-utility-l1-1-0.dll",
    "api-ms-win-shcore-scaling-l1-1-1.dll",
    "bcrypt.dll",
    "bcryptprimitives.dll",
    "combase.dll",
    "comctl32.dll",
    "d3d11.dll",
    "dcomp.dll",
    "dwmapi.dll",
    "dwrite.dll",
    "dxgi.dll",
    "gdi32.dll",
    "icuuc.dll",
    "imm32.dll",
    "iphlpapi.dll",
    "kernel32.dll",
    "ntdll.dll",
    "ole32.dll",
    "oleaut32.dll",
    "propsys.dll",
    "shell32.dll",
    "shlwapi.dll",
    "user32.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
    "ws2_32.dll",
];

/// What a debug build imports besides: the debug C runtime, the shader
/// compiler GPUI runs at start in a debug build, and what the linker would
/// have dropped in a release one.
const DEBUG_ONLY: &[&str] = &[
    "d3dcompiler_47.dll",
    "secur32.dll",
    "ucrtbased.dll",
    "vcruntime140_1d.dll",
    "vcruntime140d.dll",
];

/// Libraries only one feature uses: never loaded before `main`.
const LOADED_WHEN_USED: &[&str] = &["mf.dll", "mfplat.dll", "mfreadwrite.dll"];

/// A Windows executable, read as bytes.
#[derive(Debug)]
struct Image {
    bytes: Vec<u8>,
}

impl Image {
    fn u16_at(&self, at: usize) -> Option<usize> {
        let field = self.bytes.get(at..at + 2)?;
        Some(usize::from(u16::from_le_bytes([field[0], field[1]])))
    }

    fn u32_at(&self, at: usize) -> Option<usize> {
        let field = self.bytes.get(at..at + 4)?;
        usize::try_from(u32::from_le_bytes([field[0], field[1], field[2], field[3]])).ok()
    }

    /// Where in the file the image's address `rva` is.
    fn offset_of(&self, rva: usize) -> Option<usize> {
        let pe = self.u32_at(0x3c)?;
        let sections = self.u16_at(pe + 6)?;
        let optional = pe + 24;
        let first = optional + self.u16_at(pe + 20)?;
        (0..sections).find_map(|index| {
            let section = first + index * 40;
            let start = self.u32_at(section + 12)?;
            let size = self.u32_at(section + 8)?.max(self.u32_at(section + 16)?);
            (start..start + size)
                .contains(&rva)
                .then(|| Some(rva - start + self.u32_at(section + 20)?))?
        })
    }

    /// The names of the libraries in the import table, lower case. Those
    /// loaded at their first call are in a table of their own, not here.
    fn imports(&self) -> Option<BTreeSet<String>> {
        let pe = self.u32_at(0x3c)?;
        let optional = pe + 24;
        // A 64-bit image keeps its data directories 112 bytes in; the
        // import table is the second.
        let table = self.offset_of(self.u32_at(optional + 112 + 8)?)?;
        let mut names = BTreeSet::new();
        for descriptor in (table..).step_by(20) {
            let name = self.u32_at(descriptor + 12)?;
            if name == 0 {
                break;
            }
            let start = self.offset_of(name)?;
            let end = start + self.bytes.get(start..)?.iter().position(|b| *b == 0)?;
            let _ = names.insert(String::from_utf8_lossy(&self.bytes[start..end]).to_lowercase());
        }
        Some(names)
    }
}

#[test]
fn only_the_expected_libraries_are_loaded_before_main() -> Result<(), String> {
    let path = env!("CARGO_BIN_EXE_fancy-gpui");
    let image = Image {
        bytes: std::fs::read(path).map_err(|error| format!("{path}: {error}"))?,
    };
    let imports = image
        .imports()
        .ok_or("the import table could not be read")?;
    assert!(imports.contains("kernel32.dll"), "{imports:?}");
    let early: Vec<_> = LOADED_WHEN_USED
        .iter()
        .filter(|library| imports.contains(**library))
        .collect();
    assert!(early.is_empty(), "loaded before main: {early:?}");
    let unexpected: Vec<_> = imports
        .iter()
        .filter(|library| {
            !EXPECTED.contains(&library.as_str())
                && !(cfg!(debug_assertions) && DEBUG_ONLY.contains(&library.as_str()))
        })
        .collect();
    assert!(
        unexpected.is_empty(),
        "new libraries loaded before main: {unexpected:?}; if one is needed at start, add it to EXPECTED, else to LOADED_WHEN_USED in build.rs"
    );
    Ok(())
}
