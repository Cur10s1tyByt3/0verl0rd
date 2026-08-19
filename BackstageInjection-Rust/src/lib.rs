//! BackstageInjection.x64.dll — Rust-port of the C hooking payload.
//!
//! On DLL_PROCESS_ATTACH the DLL:
//!   - reads the RDI_SEARCH_PATH / RDI_REPLACE_PATH environment configuration;
//!   - opens the RDI_DLL_SECTION / RDI_DLL_SIZE page-file section passed by the
//!     agent so child processes can be injected in-memory (reflective path);
//!   - installs MinHook trampolines over ntdll path-resolution APIs and
//!     kernel32!CreateProcessW;
//!   - on CreateProcessW success for a child, reflectively injects this DLL
//!     from the shared-section bytes, or falls back to Injecting the module's
//!     own on-disk path via LoadLibraryW when no section is present.
//!
//! The cdylib also exports a randomly named loader thunk (generated per-build
//! by `build.rs` into `loader_entry.rs`) so the initial injection itself can
//! be reflective; the implementation lives in `reflective.rs`.
//!
//! On DLL_PROCESS_DETACH all hooks are disabled best-effort.

#![allow(clippy::missing_safety_doc)]
#![allow(non_snake_case)]

mod obf;
mod abi;
mod config;
mod hooks;
mod inject;
mod loader_entry {
    include!(concat!(env!("OUT_DIR"), "/loader_entry.rs"));
}
mod log;
mod reflective;
mod util;

use core::ffi::c_void;

const DLL_PROCESS_ATTACH: u32 = 1;
const DLL_PROCESS_DETACH: u32 = 0;

#[unsafe(no_mangle)]
pub extern "system" fn DllMain(
    h_instance: *mut c_void,
    reason: u32,
    _reserved: *mut c_void,
) -> i32 {
    if reason == DLL_PROCESS_ATTACH {
        unsafe {
            let _ = abi::DisableThreadLibraryCalls(h_instance as usize);
            inject::set_our_path(h_instance as usize);
        }
        log::init_from_env();
        let cfg = config::load();
        if let Some(bytes) = unsafe { inject::load_dll_bytes_from_section() } {
            inject::set_dll_bytes(bytes);
        }
        dbg_log!(
            "DllMain attach pid={} search={} replace={} have_section_bytes={} our_path='{}'",
            unsafe { abi::GetCurrentProcessId() },
            crate::log::display_wide(&cfg.search),
            crate::log::display_wide(&cfg.replace),
            inject::dll_bytes().is_some(),
            crate::log::display_wide(inject::our_path().unwrap_or(&Vec::new())),
        );
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            hooks::install(cfg);
        }));
        dbg_log!("DllMain attach: install returned (hooks existed prior -> no detach log)");
    } else if reason == DLL_PROCESS_DETACH {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            hooks::remove();
        }));
        dbg_log!("DllMain detach done");
    }

    1
}