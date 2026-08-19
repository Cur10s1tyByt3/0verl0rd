//! Compiles the vendored Harmony Security reflective loader
//! (`reflective/ReflectiveLoader.c`, BSD-2-Clause, see file header) into the
//! cdylib so the DLL exports `ReflectiveLoader`. The position-independent
//! loader is intentionally kept in C: it is the exact loader the C reference
//! DLL uses and re-implementing it in Rust would be unnecessary risk.

use std::path::PathBuf;

fn main() {
    let dir = PathBuf::from("reflective");
    for f in [
        "reflective/ReflectiveLoader.c",
        "reflective/ReflectiveLoader.h",
        "reflective/ReflectiveDLLInjection.h",
        "reflective/obfstr.h",
    ] {
        println!("cargo:rerun-if-changed={f}");
    }

    // Matches BackstageInjection.vcxproj (Release|x64): VIA_LOADREMOTELIBRARYR
    // lets ReflectiveLoader accept a thread-routine parameter (the agent and
    // child injenter pass NULL), and CUSTOM_DLLMAIN avoids emitting a second
    // DllMain (the Rust cdylib exports its own).
    let mut build = cc::Build::new();
    build
        .file("reflective/ReflectiveLoader.c")
        .include(dir)
        .opt_level(2)
        .static_crt(true)
        .cargo_metadata(false)
        .define("WIN64", None)
        .define("NDEBUG", None)
        .define("_WINDOWS", None)
        .define("_USRDLL", None)
        .define("WIN_X64", None)
        .define("REFLECTIVEDLLINJECTION_VIA_LOADREMOTELIBRARYR", None)
        .define("REFLECTIVEDLLINJECTION_CUSTOM_DLLMAIN", None);
    build.compile("reflective_loader");

    // Force all members of the static lib into the DLL even though no Rust
    // symbol references them; `ReflectiveLoader` carries __declspec(dllexport)
    // and only becomes an export once its object file is actually linked.
    println!(
        "cargo:rustc-link-search=native={}",
        std::env::var("OUT_DIR").unwrap_or_default()
    );
    println!("cargo:rustc-link-lib=static:+whole-archive=reflective_loader");
}