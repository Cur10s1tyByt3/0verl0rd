//! Child-process injection from disk: LoadLibraryW via CreateRemoteThread.
//!
//! The injected module path is exactly the path this DLL was loaded from, so a
//! child inherits the same staged copy the agent placed on disk.

use core::ffi::c_void;
use std::ptr::null_mut;
use std::sync::OnceLock;

use crate::abi::{self, GetModuleFileNameW};
use crate::dbg_log;

static OUR_PATH: OnceLock<Vec<u16>> = OnceLock::new();

/// Record the on-disk path of this DLL (called from DllMain on attach).
pub fn set_our_path(h_instance: usize) {
    let _ = OUR_PATH.set(dll_path_from_hinst(h_instance));
}

/// Current on-disk path, if recorded.
pub fn our_path() -> Option<&'static Vec<u16>> {
    OUR_PATH.get()
}

fn dll_path_from_hinst(h_instance: usize) -> Vec<u16> {
    let mut buf = vec![0u16; 1024];
    unsafe {
        let n = GetModuleFileNameW(h_instance, buf.as_mut_ptr(), buf.len() as u32);
        buf.truncate(n as usize);
    }
    buf
}

/// Inject `path` into `process` by writing the path into the target and running
/// LoadLibraryW on a remote thread. Returns false on any failure; callers treat
/// failure as fail-open (the child still runs, just without hooks).
pub unsafe fn inject_library(process: usize, path: &[u16]) -> bool {
    if path.is_empty() {
        dbg_log!("inject: empty path — abort");
        return false;
    }

    let kernel32 = crate::util::wide_zstr("kernel32.dll");
    let k32 = unsafe { abi::GetModuleHandleW(kernel32.as_ptr()) };
    if k32 == 0 {
        dbg_log!("inject: kernel32 not loaded — abort");
        return false;
    }
    let load_library_w = unsafe { abi::GetProcAddress(k32, c"LoadLibraryW".as_ptr().cast()) };
    if load_library_w == 0 {
        dbg_log!("inject: LoadLibraryW not found — abort");
        return false;
    }

    let mut remote_path = path.to_vec();
    remote_path.push(0);
    let bytes = remote_path.len() * 2;
    dbg_log!(
        "inject: target pid={} dll='{}' bytes={bytes}",
        unsafe { abi::GetCurrentProcessId() },
        crate::log::display_wide(path),
    );

    let base = unsafe {
        abi::VirtualAllocEx(
            process,
            0,
            bytes,
            abi::MEM_COMMIT | abi::MEM_RESERVE,
            abi::PAGE_READWRITE,
        )
    };
    if base == 0 {
        dbg_log!("inject: VirtualAllocEx failed — abort");
        return false;
    }

    let mut written = 0usize;
    let ok = unsafe {
        abi::WriteProcessMemory(
            process,
            base,
            remote_path.as_ptr() as *const c_void,
            bytes,
            &mut written,
        )
    };
    if ok == 0 || written != bytes {
        dbg_log!(
            "inject: WriteProcessMemory failed (ok={ok} written={written}/{bytes}) — abort"
        );
        return false;
    }

    let mut thread_id = 0u32;
    let h_thread = unsafe {
        abi::CreateRemoteThread(process, null_mut(), 0, load_library_w, base, 0, &mut thread_id)
    };
    if h_thread == 0 {
        dbg_log!("inject: CreateRemoteThread failed — abort");
        return false;
    }

    let wait = unsafe { abi::WaitForSingleObject(h_thread, 30000) };
    unsafe {
        abi::CloseHandle(h_thread);
    }
    let ok = wait != abi::WAIT_FAILED && wait != abi::WAIT_TIMEOUT;
    dbg_log!(
        "inject: remote thread wait=0x{wait:08X} thread_id={thread_id} -> {ok}"
    );
    ok
}