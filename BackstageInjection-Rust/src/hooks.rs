//! MinHook installation/removal and every detour function.

use core::ffi::c_void;
use std::slice;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::OnceLock;

use minhook::MinHook;

use crate::abi::{
    self, CreateProcessWFn, IoStatusBlock, NtCreateFileFn, NtDeleteFileFn, NtOpenFileFn,
    NtQueryAttributesFileFn, NtQueryFullAttributesFileFn, NtSetInformationFileFn, ObjectAttributes,
    ProcessInformation, StartupInfoW, UnicodeString,
};
use crate::config::HookConfig;
use crate::inject;
use crate::util::{self, UNICODE_STRING_MAX_WCHARS};
use crate::dbg_log;

static HOOKS_CONFIG: OnceLock<HookConfig> = OnceLock::new();

static HOOKS_INITIALIZED: AtomicBool = AtomicBool::new(false);

static ORIG_NT_CREATE_FILE: AtomicUsize = AtomicUsize::new(0);
static ORIG_NT_OPEN_FILE: AtomicUsize = AtomicUsize::new(0);
static ORIG_NT_DELETE_FILE: AtomicUsize = AtomicUsize::new(0);
static ORIG_NT_SET_INFORMATION_FILE: AtomicUsize = AtomicUsize::new(0);
static ORIG_NT_QUERY_ATTRIBUTES_FILE: AtomicUsize = AtomicUsize::new(0);
static ORIG_NT_QUERY_FULL_ATTRIBUTES_FILE: AtomicUsize = AtomicUsize::new(0);
static ORIG_CREATE_PROCESS_W: AtomicUsize = AtomicUsize::new(0);

static CALL_SEQ: AtomicUsize = AtomicUsize::new(0);

unsafe fn read_oa_path(oa: *mut ObjectAttributes) -> Vec<u16> {
    if oa.is_null() {
        return Vec::new();
    }
    let name = unsafe { &*oa }.ObjectName;
    if name.is_null() {
        return Vec::new();
    }
    let name = unsafe { &*name };
    if name.Buffer.is_null() {
        return Vec::new();
    }
    let len = (name.Length as usize) / 2;
    if len == 0 {
        return Vec::new();
    }
    unsafe { slice::from_raw_parts(name.Buffer, len).to_vec() }
}

fn redirect_config() -> Option<&'static HookConfig> {
    let cfg = HOOKS_CONFIG.get()?;
    if cfg.search.is_empty() || cfg.replace.is_empty() {
        return None;
    }
    Some(cfg)
}

struct ObjectNameRedirect {
    oa: *mut ObjectAttributes,
    original: *mut UnicodeString,
    new_string: Box<UnicodeString>,
    _path: Vec<u16>,
}

impl Drop for ObjectNameRedirect {
    fn drop(&mut self) {
        unsafe {
            (*self.oa).ObjectName = self.original;
        }
    }
}

unsafe fn object_redirect(oa: *mut ObjectAttributes) -> Option<ObjectNameRedirect> {
    if oa.is_null() {
        return None;
    }
    let oa_ref = unsafe { &mut *oa };
    if oa_ref.ObjectName.is_null() {
        return None;
    }
    let name = unsafe { &*oa_ref.ObjectName };
    if name.Buffer.is_null() {
        return None;
    }

    let cfg = redirect_config()?;

    let path_len = (name.Length as usize) / 2;
    if path_len == 0 {
        return None;
    }
    let path = unsafe { slice::from_raw_parts(name.Buffer, path_len) };

    if !util::needs_redirection(path, &cfg.search) {
        return None;
    }
    let new_path = util::replace_path(path, &cfg.search, &cfg.replace)?;
    if new_path.len() > UNICODE_STRING_MAX_WCHARS {
        return None;
    }

    let mut new_string = Box::new(UnicodeString {
        Length: (new_path.len() * 2) as u16,
        MaximumLength: ((new_path.len() + 1) * 2) as u16,
        Buffer: core::ptr::null_mut(),
    });
    new_string.Buffer = new_path.as_ptr() as *mut u16;

    let guard = ObjectNameRedirect {
        oa,
        original: oa_ref.ObjectName,
        new_string,
        _path: new_path,
    };
    oa_ref.ObjectName = (&*guard.new_string) as *const UnicodeString as *mut UnicodeString;
    dbg_log!(
        "redirect: '{}' -> '{}'",
        crate::log::display_wide(path),
        crate::log::display_wide(&guard._path),
    );
    Some(guard)
}

fn rename_redirect(
    file_information: *mut c_void,
    class: u32,
    length: u32,
) -> Option<Vec<u8>> {
    if !(class == abi::FILE_RENAME_INFORMATION || class == abi::FILE_RENAME_INFORMATION_EX) {
        return None;
    }
    if file_information.is_null() || (length as usize) < abi::RENAME_INFO_HEADER_BYTES {
        return None;
    }
    let cfg = redirect_config()?;

    let p = file_information as *const u8;
    let header = unsafe { slice::from_raw_parts(p, abi::RENAME_INFO_HEADER_BYTES) };
    let name_len_bytes =
        u32::from_le_bytes([header[16], header[17], header[18], header[19]]);
    if name_len_bytes == 0 {
        return None;
    }
    let chars = (name_len_bytes as usize) / 2;
    if abi::RENAME_INFO_HEADER_BYTES + chars > length as usize {
        return None;
    }

    let path = unsafe {
        slice::from_raw_parts(p.add(abi::RENAME_INFO_HEADER_BYTES) as *const u16, chars)
    };
    if !util::needs_redirection(path, &cfg.search) {
        return None;
    }
    let new_path = util::replace_path(path, &cfg.search, &cfg.replace)?;

    let new_len_bytes = new_path.len() * 2;
    let mut buf = Vec::with_capacity(abi::RENAME_INFO_HEADER_BYTES + new_len_bytes);
    buf.extend_from_slice(header);
    buf[16..20].copy_from_slice(&(new_len_bytes as u32).to_le_bytes());
    for &unit in &new_path {
        buf.extend_from_slice(&unit.to_le_bytes());
    }
    dbg_log!(
        "rename redirect class={class}: '{}' -> '{}'",
        crate::log::display_wide(path),
        crate::log::display_wide(&new_path),
    );
    Some(buf)
}

pub extern "system" fn detour_nt_create_file(
    file_handle: *mut usize,
    desired_access: u32,
    object_attributes: *mut ObjectAttributes,
    io_status_block: *mut IoStatusBlock,
    allocation_size: *mut i64,
    file_attributes: u32,
    share_access: u32,
    create_disposition: u32,
    create_options: u32,
    ea_buffer: *mut c_void,
    ea_length: u32,
) -> i32 {
    let orig_addr = ORIG_NT_CREATE_FILE.load(Ordering::SeqCst);
    if orig_addr == 0 {
        return abi::STATUS_UNSUCCESSFUL;
    }
    let seq = CALL_SEQ.fetch_add(1, Ordering::Relaxed);
    let orig_path = unsafe { read_oa_path(object_attributes) };
    let _guard = if HOOKS_INITIALIZED.load(Ordering::SeqCst) {
        unsafe { object_redirect(object_attributes) }
    } else {
        None
    };
    let redirected = _guard.is_some();
    let orig: NtCreateFileFn = unsafe { core::mem::transmute(orig_addr) };
    let status = orig(
        file_handle,
        desired_access,
        object_attributes,
        io_status_block,
        allocation_size,
        file_attributes,
        share_access,
        create_disposition,
        create_options,
        ea_buffer,
        ea_length,
    );
    dbg_log!(
        "ntcreate[{seq}] in='{}' redirect={redirected} out=0x{status:x}",
        crate::log::display_wide(&orig_path),
    );
    status
}

pub extern "system" fn detour_nt_open_file(
    file_handle: *mut usize,
    desired_access: u32,
    object_attributes: *mut ObjectAttributes,
    io_status_block: *mut IoStatusBlock,
    share_access: u32,
    open_options: u32,
) -> i32 {
    let orig_addr = ORIG_NT_OPEN_FILE.load(Ordering::SeqCst);
    if orig_addr == 0 {
        return abi::STATUS_UNSUCCESSFUL;
    }
    let seq = CALL_SEQ.fetch_add(1, Ordering::Relaxed);
    let orig_path = unsafe { read_oa_path(object_attributes) };
    let _guard = if HOOKS_INITIALIZED.load(Ordering::SeqCst) {
        unsafe { object_redirect(object_attributes) }
    } else {
        None
    };
    let redirected = _guard.is_some();
    let orig: NtOpenFileFn = unsafe { core::mem::transmute(orig_addr) };
    let status = orig(
        file_handle,
        desired_access,
        object_attributes,
        io_status_block,
        share_access,
        open_options,
    );
    dbg_log!(
        "ntopen[{seq}] in='{}' redirect={redirected} out=0x{status:x}",
        crate::log::display_wide(&orig_path),
    );
    status
}

pub extern "system" fn detour_nt_delete_file(
    object_attributes: *mut ObjectAttributes,
) -> i32 {
    let orig_addr = ORIG_NT_DELETE_FILE.load(Ordering::SeqCst);
    if orig_addr == 0 {
        return abi::STATUS_UNSUCCESSFUL;
    }
    let _guard = if HOOKS_INITIALIZED.load(Ordering::SeqCst) {
        unsafe { object_redirect(object_attributes) }
    } else {
        None
    };
    let orig: NtDeleteFileFn = unsafe { core::mem::transmute(orig_addr) };
    orig(object_attributes)
}

pub extern "system" fn detour_nt_set_information_file(
    file_handle: usize,
    io_status_block: *mut IoStatusBlock,
    file_information: *mut c_void,
    length: u32,
    class: u32,
) -> i32 {
    let orig_addr = ORIG_NT_SET_INFORMATION_FILE.load(Ordering::SeqCst);
    if orig_addr == 0 {
        return abi::STATUS_UNSUCCESSFUL;
    }
    let orig: NtSetInformationFileFn = unsafe { core::mem::transmute(orig_addr) };

    if HOOKS_INITIALIZED.load(Ordering::SeqCst) {
        if let Some(redirect) = rename_redirect(file_information, class, length) {
            return orig(
                file_handle,
                io_status_block,
                redirect.as_ptr() as *mut c_void,
                redirect.len() as u32,
                class,
            );
        }
    }
    orig(
        file_handle,
        io_status_block,
        file_information,
        length,
        class,
    )
}

pub extern "system" fn detour_nt_query_attributes_file(
    object_attributes: *mut ObjectAttributes,
    file_information: *mut c_void,
) -> i32 {
    let orig_addr = ORIG_NT_QUERY_ATTRIBUTES_FILE.load(Ordering::SeqCst);
    if orig_addr == 0 {
        return abi::STATUS_UNSUCCESSFUL;
    }
    let _guard = if HOOKS_INITIALIZED.load(Ordering::SeqCst) {
        unsafe { object_redirect(object_attributes) }
    } else {
        None
    };
    let orig: NtQueryAttributesFileFn = unsafe { core::mem::transmute(orig_addr) };
    orig(object_attributes, file_information)
}
pub extern "system" fn detour_nt_query_full_attributes_file(
    object_attributes: *mut ObjectAttributes,
    file_information: *mut c_void,
) -> i32 {
    let orig_addr = ORIG_NT_QUERY_FULL_ATTRIBUTES_FILE.load(Ordering::SeqCst);
    if orig_addr == 0 {
        return abi::STATUS_UNSUCCESSFUL;
    }
    let _guard = if HOOKS_INITIALIZED.load(Ordering::SeqCst) {
        unsafe { object_redirect(object_attributes) }
    } else {
        None
    };
    let orig: NtQueryFullAttributesFileFn = unsafe { core::mem::transmute(orig_addr) };
    orig(object_attributes, file_information)
}

pub extern "system" fn detour_create_process_w(
    lp_application_name: *const u16,
    lp_command_line: *mut u16,
    lp_process_attributes: *mut c_void,
    lp_thread_attributes: *mut c_void,
    b_inherit_handles: i32,
    dw_creation_flags: u32,
    lp_environment: *mut c_void,
    lp_current_directory: *const u16,
    lp_startup_info: *mut StartupInfoW,
    lp_process_information: *mut ProcessInformation,
) -> i32 {
    let orig_addr = ORIG_CREATE_PROCESS_W.load(Ordering::SeqCst);
    if orig_addr == 0 {
        return 0;
    }
    let orig: CreateProcessWFn = unsafe { core::mem::transmute(orig_addr) };

    let was_suspended = (dw_creation_flags & abi::CREATE_SUSPENDED) != 0;
    let modified_flags = dw_creation_flags | abi::CREATE_SUSPENDED;

    let result = orig(
        lp_application_name,
        lp_command_line,
        lp_process_attributes,
        lp_thread_attributes,
        b_inherit_handles,
        modified_flags,
        lp_environment,
        lp_current_directory,
        lp_startup_info,
        lp_process_information,
    );

    if result != 0 && !lp_process_information.is_null() {
        let child_pid = unsafe { (*lp_process_information).dwProcessId };
        if !HOOKS_INITIALIZED.load(Ordering::SeqCst) {
            dbg_log!(
                "CreateProcessW child pid={child_pid} created but hooks NOT active — skipping injection"
            );
        } else if let Some(path) = inject::our_path() {
            if !path.is_empty() {
                let ok = unsafe { inject::inject_library((*lp_process_information).hProcess, path) };
                dbg_log!(
                    "CreateProcessW child pid={child_pid} app='{}' inject={ok} suspended_forced={}",
                    display_cmd(lp_application_name, lp_command_line),
                    !was_suspended,
                );
            } else {
                dbg_log!("CreateProcessW child pid={child_pid} injection skipped: our_path empty");
            }
        } else {
            dbg_log!("CreateProcessW child pid={child_pid} injection skipped: no dll path recorded");
        }
        if !was_suspended {
            unsafe {
                abi::ResumeThread((*lp_process_information).hThread);
            }
        }
    } else {
        dbg_log!(
            "CreateProcessW failed or no proc info (result={result}) — no injection"
        );
    }

    result
}

fn display_cmd(lp_application_name: *const u16, lp_command_line: *mut u16) -> String {
    let raw = if !lp_application_name.is_null() {
        unsafe { core::slice::from_raw_parts(lp_application_name, 512) }
    } else if !lp_command_line.is_null() {
        unsafe { core::slice::from_raw_parts(lp_command_line.cast_const(), 512) }
    } else {
        return String::new();
    };
    let end = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
    crate::log::display_wide(&raw[..end])
}

fn install_one(
    module: &[u16],
    proc_name: &[u8],
    detour: usize,
    store: &AtomicUsize,
) -> bool {
    let h_module = unsafe { abi::GetModuleHandleW(module.as_ptr()) };
    if h_module == 0 {
        dbg_log!(
            "hook target: module '{}' not loaded",
            crate::log::display_wide(module)
        );
        return false;
    }
    let target = unsafe { abi::GetProcAddress(h_module, proc_name.as_ptr()) };
    if target == 0 {
        dbg_log!(
            "hook target: export '{}' not found in '{}'",
            String::from_utf8_lossy(&proc_name[..proc_name.len().saturating_sub(1)]),
            crate::log::display_wide(module)
        );
        return false;
    }
    match unsafe { MinHook::create_hook(target as *mut c_void, detour as *mut c_void) } {
        Ok(orig) => match unsafe { MinHook::enable_hook(target as *mut c_void) } {
            Ok(()) => {
                store.store(orig as usize, Ordering::SeqCst);
                true
            }
            Err(why) => {
                let _ = unsafe { MinHook::remove_hook(target as *mut c_void) };
                dbg_log!(
                    "hook enable failed for '{}': {:?}",
                    String::from_utf8_lossy(&proc_name[..proc_name.len().saturating_sub(1)]),
                    why
                );
                false
            }
        },
        Err(why) => {
            dbg_log!(
                "hook create failed for '{}': {:?}",
                String::from_utf8_lossy(&proc_name[..proc_name.len().saturating_sub(1)]),
                why
            );
            false
        }
    }
}

pub fn install(cfg: HookConfig) {
    let redirect_on = !cfg.search.is_empty() && !cfg.replace.is_empty();
    dbg_log!(
        "install: config loaded search={} replace={} -> redirect_active={}",
        crate::log::display_wide(&cfg.search),
        crate::log::display_wide(&cfg.replace),
        redirect_on,
    );
    let _ = HOOKS_CONFIG.set(cfg);

    let ntdll = util::wide_zstr("ntdll.dll");
    let kernel32 = util::wide_zstr("kernel32.dll");

    let create = install_one(&ntdll, b"NtCreateFile\0", detour_nt_create_file as *const () as usize, &ORIG_NT_CREATE_FILE);
    let open = install_one(&ntdll, b"NtOpenFile\0", detour_nt_open_file as *const () as usize, &ORIG_NT_OPEN_FILE);
    let delete = install_one(&ntdll, b"NtDeleteFile\0", detour_nt_delete_file as *const () as usize, &ORIG_NT_DELETE_FILE);
    let set_info = install_one(&ntdll, b"NtSetInformationFile\0", detour_nt_set_information_file as *const () as usize, &ORIG_NT_SET_INFORMATION_FILE);
    let query_attrs = install_one(&ntdll, b"NtQueryAttributesFile\0", detour_nt_query_attributes_file as *const () as usize, &ORIG_NT_QUERY_ATTRIBUTES_FILE);
    let query_full = install_one(&ntdll, b"NtQueryFullAttributesFile\0", detour_nt_query_full_attributes_file as *const () as usize, &ORIG_NT_QUERY_FULL_ATTRIBUTES_FILE);
    let cpr = install_one(&kernel32, b"CreateProcessW\0", detour_create_process_w as *const () as usize, &ORIG_CREATE_PROCESS_W);

    let _ = (delete, set_info, query_attrs, query_full);

    dbg_log!(
        "install: NtCreateFile={} NtOpenFile={} NtDeleteFile={} NtSetInformationFile={} NtQueryAttributesFile={} NtQueryFullAttributesFile={} CreateProcessW={}",
        create, open, delete, set_info, query_attrs, query_full, cpr,
    );

    if create && open {
        HOOKS_INITIALIZED.store(true, Ordering::SeqCst);
        dbg_log!("install: hooks active (both NtCreateFile and NtOpenFile live)");
    } else {
        unsafe {
            let _ = MinHook::disable_all_hooks();
        }
        ORIG_NT_CREATE_FILE.store(0, Ordering::SeqCst);
        ORIG_NT_OPEN_FILE.store(0, Ordering::SeqCst);
        ORIG_NT_DELETE_FILE.store(0, Ordering::SeqCst);
        ORIG_NT_SET_INFORMATION_FILE.store(0, Ordering::SeqCst);
        ORIG_NT_QUERY_ATTRIBUTES_FILE.store(0, Ordering::SeqCst);
        ORIG_NT_QUERY_FULL_ATTRIBUTES_FILE.store(0, Ordering::SeqCst);
        ORIG_CREATE_PROCESS_W.store(0, Ordering::SeqCst);
        dbg_log!("install: rollback — hooks NOT active");
    }
}

pub fn remove() {
    unsafe {
        let _ = MinHook::disable_all_hooks();
    }
    unsafe {
        abi::Sleep(50);
    }

    ORIG_NT_CREATE_FILE.store(0, Ordering::SeqCst);
    ORIG_NT_OPEN_FILE.store(0, Ordering::SeqCst);
    ORIG_NT_DELETE_FILE.store(0, Ordering::SeqCst);
    ORIG_NT_SET_INFORMATION_FILE.store(0, Ordering::SeqCst);
    ORIG_NT_QUERY_ATTRIBUTES_FILE.store(0, Ordering::SeqCst);
    ORIG_NT_QUERY_FULL_ATTRIBUTES_FILE.store(0, Ordering::SeqCst);
    ORIG_CREATE_PROCESS_W.store(0, Ordering::SeqCst);
    HOOKS_INITIALIZED.store(false, Ordering::SeqCst);
}