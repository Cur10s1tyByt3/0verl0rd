//! BackstageInjection.x64.dll — Rust-port of the C hooking payload.
//!
//! On DLL_PROCESS_ATTACH the DLL:
//!   - reads the RDI_SEARCH_PATH / RDI_REPLACE_PATH environment configuration;
//!   - installs MinHook trampolines over ntdll path-resolution APIs and
//!     kernel32!CreateProcessW;
//!   - on CreateProcessW success for a child, injects this same DLL from its
//!     on-disk path via LoadLibraryW.
//!
//! On DLL_PROCESS_DETACH all hooks are disabled best-effort.

#![allow(clippy::missing_safety_doc)]
#![allow(non_snake_case)]

mod abi;
mod config;
mod hooks;
mod inject;
mod log;
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
        dbg_log!(
            "DllMain attach pid={} search={} replace={}",
            unsafe { abi::GetCurrentProcessId() },
            crate::log::display_wide(&cfg.search),
            crate::log::display_wide(&cfg.replace),
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