#![allow(non_snake_case)]
#![allow(non_camel_case_types)]
#![allow(dead_code)]

use core::ffi::c_void;

// ---- NTSTATUS ----
pub const STATUS_UNSUCCESSFUL: i32 = 0xC000_0001u32 as i32;

// ---- Memory allocation constants ----
pub const MEM_COMMIT: u32 = 0x1000;
pub const MEM_RESERVE: u32 = 0x2000;
pub const MEM_RELEASE: u32 = 0x8000;
pub const PAGE_READWRITE: u32 = 0x04;
pub const PAGE_EXECUTE_READWRITE: u32 = 0x40;

// ---- File mapping (RDI DLL section) constants ----
pub const FILE_MAP_READ: u32 = 0x0004;

// ---- CreateProcess flags ----
pub const CREATE_SUSPENDED: u32 = 0x0000_0004;

// ---- CompareStringOrdinal results ----
pub const CSTR_LESS_THAN: i32 = 1;
pub const CSTR_EQUAL: i32 = 2;
pub const CSTR_GREATER_THAN: i32 = 3;

// ---- Log-file API constants ----
pub const FILE_APPEND_DATA: u32 = 0x0000_0004;
pub const FILE_SHARE_READ: u32 = 0x1;
pub const FILE_SHARE_WRITE: u32 = 0x2;
pub const FILE_SHARE_DELETE: u32 = 0x4;
pub const OPEN_ALWAYS: u32 = 4;
pub const INVALID_HANDLE_VALUE: usize = usize::MAX;

// ---- WaitForSingleObject ----
pub const WAIT_OBJECT_0: u32 = 0;
pub const WAIT_TIMEOUT: u32 = 0x0000_0102;
pub const WAIT_FAILED: u32 = 0xFFFF_FFFF;
pub const INFINITE: u32 = 0xFFFF_FFFF;

// ---- FILE_INFORMATION_CLASS values used by the hook logic ----
pub const FILE_RENAME_INFORMATION: u32 = 10;
pub const FILE_RENAME_INFORMATION_EX: u32 = 65;

// ---- Rename info header size (BOOLEAN/ULONG + padding + HANDLE + ULONG) ----
pub const RENAME_INFO_HEADER_WCHARS: usize = 10;
pub const RENAME_INFO_HEADER_BYTES: usize = 20;

// ---- NT structures (x64 layout, matching the C reference) ----

#[repr(C)]
#[derive(Clone, Copy)]
pub struct UnicodeString {
    pub Length: u16,
    pub MaximumLength: u16,
    pub Buffer: *mut u16,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ObjectAttributes {
    pub Length: u32,
    pub RootDirectory: usize,
    pub ObjectName: *mut UnicodeString,
    pub Attributes: u32,
    pub SecurityDescriptor: *mut c_void,
    pub SecurityQualityOfService: *mut c_void,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct IoStatusBlock {
    pub Status: usize,
    pub Information: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct StartupInfoW {
    pub cb: u32,
    pub lpReserved: *mut u16,
    pub lpDesktop: *mut u16,
    pub lpTitle: *mut u16,
    pub dwX: u32,
    pub dwY: u32,
    pub dwXSize: u32,
    pub dwYSize: u32,
    pub dwXCountChars: u32,
    pub dwYCountChars: u32,
    pub dwFillAttribute: u32,
    pub dwFlags: u32,
    pub wShowWindow: u16,
    pub cbReserved2: u16,
    pub lpReserved2: *mut u8,
    pub hStdInput: usize,
    pub hStdOutput: usize,
    pub hStdError: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ProcessInformation {
    pub hProcess: usize,
    pub hThread: usize,
    pub dwProcessId: u32,
    pub dwThreadId: u32,
}

// ---- NT API function pointer types ----
pub type NtCreateFileFn = extern "system" fn(
    *mut usize,           // PHANDLE FileHandle
    u32,                  // ULONG DesiredAccess
    *mut ObjectAttributes,
    *mut IoStatusBlock,
    *mut i64,             // PLARGE_INTEGER AllocationSize
    u32,                  // ULONG FileAttributes
    u32,                  // ULONG ShareAccess
    u32,                  // ULONG CreateDisposition
    u32,                  // ULONG CreateOptions
    *mut c_void,          // PVOID EaBuffer
    u32,                  // ULONG EaLength
) -> i32;

pub type NtOpenFileFn = extern "system" fn(
    *mut usize,
    u32,
    *mut ObjectAttributes,
    *mut IoStatusBlock,
    u32,
    u32,
) -> i32;

pub type NtDeleteFileFn = extern "system" fn(*mut ObjectAttributes) -> i32;

pub type NtSetInformationFileFn = extern "system" fn(
    usize,                // HANDLE FileHandle
    *mut IoStatusBlock,
    *mut c_void,          // PVOID FileInformation
    u32,                  // ULONG Length
    u32,                  // FILE_INFORMATION_CLASS
) -> i32;

pub type NtQueryAttributesFileFn = extern "system" fn(*mut ObjectAttributes, *mut c_void) -> i32;

pub type NtQueryFullAttributesFileFn = extern "system" fn(*mut ObjectAttributes, *mut c_void) -> i32;

pub type CreateProcessWFn = extern "system" fn(
    *const u16,           // LPCWSTR lpApplicationName
    *mut u16,             // LPWSTR lpCommandLine
    *mut c_void,          // LPSECURITY_ATTRIBUTES lpProcessAttributes
    *mut c_void,          // LPSECURITY_ATTRIBUTES lpThreadAttributes
    i32,                  // BOOL bInheritHandles
    u32,                  // DWORD dwCreationFlags
    *mut c_void,          // LPVOID lpEnvironment
    *const u16,           // LPCWSTR lpCurrentDirectory
    *mut StartupInfoW,    // LPSTARTUPINFOW lpStartupInfo
    *mut ProcessInformation,
) -> i32;

// ---- kernel32 / ntdll imports ----

#[link(name = "kernel32")]
extern "system" {
    pub fn GetModuleHandleW(lpModuleName: *const u16) -> usize;
    pub fn GetModuleFileNameW(hModule: usize, lpFilename: *mut u16, nSize: u32) -> u32;
    pub fn GetProcAddress(hModule: usize, lpProcName: *const u8) -> usize;
    pub fn GetEnvironmentVariableW(
        lpName: *const u16,
        lpBuffer: *mut u16,
        nSize: u32,
    ) -> u32;
    pub fn DisableThreadLibraryCalls(hLibModule: usize) -> i32;
    pub fn CompareStringOrdinal(
        lpString1: *const u16,
        cchCount1: i32,
        lpString2: *const u16,
        cchCount2: i32,
        bIgnoreCase: i32,
    ) -> i32;
    pub fn VirtualAllocEx(
        hProcess: usize,
        lpAddress: usize,
        dwSize: usize,
        flAllocationType: u32,
        flProtect: u32,
    ) -> usize;
    pub fn VirtualFreeEx(
        hProcess: usize,
        lpAddress: usize,
        dwSize: usize,
        dwFreeType: u32,
    ) -> i32;
    pub fn OpenFileMappingW(
        dwDesiredAccess: u32,
        bInheritHandle: i32,
        lpName: *const u16,
    ) -> usize;
    pub fn MapViewOfFile(
        hFileMappingObject: usize,
        dwDesiredAccess: u32,
        dwFileOffsetHigh: u32,
        dwFileOffsetLow: u32,
        dwNumberOfBytesToMap: usize,
    ) -> usize;
    pub fn UnmapViewOfFile(lpBaseAddress: usize) -> i32;
    pub fn WriteProcessMemory(
        hProcess: usize,
        lpBaseAddress: usize,
        lpBuffer: *const c_void,
        nSize: usize,
        lpNumberOfBytesWritten: *mut usize,
    ) -> i32;
    pub fn CreateRemoteThread(
        hProcess: usize,
        lpThreadAttributes: *mut c_void,
        dwStackSize: usize,
        lpStartAddress: usize,
        lpParameter: usize,
        dwCreationFlags: u32,
        lpThreadId: *mut u32,
    ) -> usize;
    pub fn WaitForSingleObject(hHandle: usize, dwMilliseconds: u32) -> u32;
    pub fn GetExitCodeThread(hThread: usize, lpExitCode: *mut u32) -> i32;
    pub fn CloseHandle(hObject: usize) -> i32;
    pub fn ResumeThread(hThread: usize) -> u32;
    pub fn Sleep(dwMilliseconds: u32);
    pub fn GetCurrentProcessId() -> u32;
    pub fn CreateDirectoryW(lpPathName: *const u16, lpSecurityAttributes: *mut c_void) -> i32;
    pub fn CreateFileW(
        lpFileName: *const u16,
        dwDesiredAccess: u32,
        dwShareMode: u32,
        lpSecurityAttributes: *mut c_void,
        dwCreationDisposition: u32,
        dwFlagsAndAttributes: u32,
        hTemplateFile: usize,
    ) -> usize;
    pub fn WriteFile(
        hFile: usize,
        lpBuffer: *const c_void,
        nNumberOfBytesToWrite: u32,
        lpNumberOfBytesWritten: *mut u32,
        lpOverlapped: *mut c_void,
    ) -> i32;
}