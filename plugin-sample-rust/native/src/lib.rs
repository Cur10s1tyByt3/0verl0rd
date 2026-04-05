/*
 * Sample Rust Plugin — fully unloadable, no GC runtime.
 *
 * Exports the standard Overlord plugin ABI:
 *   PluginOnLoad, PluginOnEvent, PluginOnUnload, PluginSetCallback,
 *   PluginGetRuntime  (returns "rust" — tells the host this DLL can be freed)
 *
 * Build:
 *   cargo build --release
 *   Output: target/release/sample_rust.dll (Windows) or libsample_rust.so (Linux)
 *
 * Note: Uses C-style globals instead of std::sync::Mutex because the DLL is
 * loaded via an in-memory PE loader, and Rust's std Mutex (SRWLOCK) may not
 * initialize correctly without OS-level LoadLibrary.  The Go host already
 * serializes all calls through its own mutex, so this is safe.
 */

use std::os::raw::{c_char, c_int};
use std::slice;
use std::ptr;

// ---------------------------------------------------------------------------
// Host callback types — platform-specific calling conventions
// ---------------------------------------------------------------------------

#[cfg(windows)]
type HostCallback = unsafe extern "stdcall" fn(
    event: *const u8,
    event_len: usize,
    payload: *const u8,
    payload_len: usize,
);

#[cfg(not(windows))]
type HostCallback = unsafe extern "C" fn(
    ctx: usize,
    event: *const u8,
    event_len: i32,
    payload: *const u8,
    payload_len: i32,
);

// ---------------------------------------------------------------------------
// Global state — C-style, no Mutex.
// The Go host serializes all calls via dllPlugin.mu / soPlugin.mu.
// ---------------------------------------------------------------------------

static mut G_CALLBACK: Option<HostCallback> = None;
#[cfg(not(windows))]
static mut G_CALLBACK_CTX: usize = 0;
static mut G_CLIENT_ID: [u8; 256] = [0u8; 256];
static mut G_CLIENT_ID_LEN: usize = 0;
static mut G_EVENT_COUNT: u64 = 0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

unsafe fn send_event(event: &[u8], payload: &[u8]) {
    if let Some(cb) = G_CALLBACK {
        #[cfg(windows)]
        cb(
            event.as_ptr(),
            event.len(),
            payload.as_ptr(),
            payload.len(),
        );
        #[cfg(not(windows))]
        cb(
            G_CALLBACK_CTX,
            event.as_ptr(),
            event.len() as i32,
            payload.as_ptr(),
            payload.len() as i32,
        );
    }
}

/// Minimal JSON string extraction by key — zero allocations.
unsafe fn json_extract_into(json: &[u8], key: &[u8], out: &mut [u8]) -> usize {
    // Search for "key":"  or "key": "
    let klen = key.len();
    if json.len() < klen + 4 {
        return 0;
    }
    let mut i = 0;
    while i + klen + 3 < json.len() {
        if json[i] == b'"'
            && json[i + 1..i + 1 + klen] == *key
            && json[i + 1 + klen] == b'"'
        {
            // Skip past "key"
            let mut j = i + 1 + klen + 1; // past closing quote
            // Skip : and optional space
            while j < json.len() && (json[j] == b':' || json[j] == b' ') {
                j += 1;
            }
            // Expect opening quote
            if j < json.len() && json[j] == b'"' {
                j += 1;
                let start = j;
                while j < json.len() && json[j] != b'"' {
                    j += 1;
                }
                let vlen = j - start;
                let copy_len = if vlen < out.len() { vlen } else { out.len() - 1 };
                ptr::copy_nonoverlapping(json[start..].as_ptr(), out.as_mut_ptr(), copy_len);
                return copy_len;
            }
        }
        i += 1;
    }
    0
}

unsafe fn bytes_to_slice<'a>(p: *const c_char, len: c_int) -> &'a [u8] {
    if p.is_null() || len <= 0 {
        return &[];
    }
    slice::from_raw_parts(p as *const u8, len as usize)
}

// ---------------------------------------------------------------------------
// Exported ABI
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn PluginGetRuntime() -> *const c_char {
    b"rust\0".as_ptr() as *const c_char
}

#[cfg(windows)]
#[no_mangle]
pub unsafe extern "C" fn PluginSetCallback(cb: u64) {
    G_CALLBACK = Some(std::mem::transmute(cb as usize));
}

#[cfg(windows)]
#[no_mangle]
pub unsafe extern "C" fn PluginOnLoad(
    host_info: *const c_char,
    host_info_len: c_int,
    cb: u64,
) -> c_int {
    G_CALLBACK = Some(std::mem::transmute(cb as usize));
    G_EVENT_COUNT = 0;

    let info = bytes_to_slice(host_info, host_info_len);
    G_CLIENT_ID_LEN = json_extract_into(info, b"clientId", &mut G_CLIENT_ID);

    // Build a small on-stack response and send
    send_event(
        b"ready",
        br#"{"message":"sample-rust plugin ready"}"#,
    );
    0
}

#[cfg(not(windows))]
#[no_mangle]
pub unsafe extern "C" fn PluginOnLoad(
    host_info: *const c_char,
    host_info_len: c_int,
    cb: usize,
    ctx: usize,
) -> c_int {
    G_CALLBACK = Some(std::mem::transmute(cb));
    G_CALLBACK_CTX = ctx;
    G_EVENT_COUNT = 0;

    let info = bytes_to_slice(host_info, host_info_len);
    G_CLIENT_ID_LEN = json_extract_into(info, b"clientId", &mut G_CLIENT_ID);

    send_event(
        b"ready",
        br#"{"message":"sample-rust plugin ready"}"#,
    );
    0
}

#[no_mangle]
pub unsafe extern "C" fn PluginOnEvent(
    event: *const c_char,
    event_len: c_int,
    payload: *const c_char,
    payload_len: c_int,
) -> c_int {
    let ev = bytes_to_slice(event, event_len);
    let pl = bytes_to_slice(payload, payload_len);

    G_EVENT_COUNT += 1;

    if ev == b"ping" {
        send_event(b"pong", &[]);
        return 0;
    }

    if ev == b"ui_message" {
        // Build echo response on the stack — limited to 512 bytes
        let prefix = br#"{"message":"echo from Rust: "#;
        let suffix = br#""}"#;
        let max_pl = 450;
        let pl_copy = if pl.len() < max_pl { pl.len() } else { max_pl };
        let total = prefix.len() + pl_copy + suffix.len();
        let mut buf = [0u8; 512];
        if total <= buf.len() {
            ptr::copy_nonoverlapping(prefix.as_ptr(), buf.as_mut_ptr(), prefix.len());
            ptr::copy_nonoverlapping(
                pl.as_ptr(),
                buf.as_mut_ptr().add(prefix.len()),
                pl_copy,
            );
            ptr::copy_nonoverlapping(
                suffix.as_ptr(),
                buf.as_mut_ptr().add(prefix.len() + pl_copy),
                suffix.len(),
            );
            send_event(b"echo", &buf[..total]);
        }
        return 0;
    }

    if ev == b"stats" {
        // Format event count into a stack buffer
        let mut buf = [0u8; 128];
        let prefix = br#"{"event_count":"#;
        let suffix = b"}";
        ptr::copy_nonoverlapping(prefix.as_ptr(), buf.as_mut_ptr(), prefix.len());
        let mut num_buf = [0u8; 20];
        let num_len = fmt_u64(G_EVENT_COUNT, &mut num_buf);
        ptr::copy_nonoverlapping(
            num_buf[20 - num_len..].as_ptr(),
            buf.as_mut_ptr().add(prefix.len()),
            num_len,
        );
        ptr::copy_nonoverlapping(
            suffix.as_ptr(),
            buf.as_mut_ptr().add(prefix.len() + num_len),
            suffix.len(),
        );
        let total = prefix.len() + num_len + suffix.len();
        send_event(b"stats_reply", &buf[..total]);
        return 0;
    }

    0
}

#[no_mangle]
pub unsafe extern "C" fn PluginOnUnload() {
    G_CALLBACK = None;
    #[cfg(not(windows))]
    {
        G_CALLBACK_CTX = 0;
    }
    G_CLIENT_ID_LEN = 0;
    G_EVENT_COUNT = 0;
}

// ---------------------------------------------------------------------------
// Tiny u64-to-decimal without std::fmt (avoids allocator)
// ---------------------------------------------------------------------------

fn fmt_u64(mut n: u64, buf: &mut [u8; 20]) -> usize {
    if n == 0 {
        buf[19] = b'0';
        return 1;
    }
    let mut i = 20;
    while n > 0 {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
    }
    20 - i
}
