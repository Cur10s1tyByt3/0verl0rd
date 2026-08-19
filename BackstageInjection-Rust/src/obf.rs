//! Build-time string obfuscation.
//!
//! `obf!` and `obf16!` XOR-encode string literals at compile time so the
//! plaintext never appears as a contiguous byte sequence in the binary's
//! `.rodata`. The runtime expansion decrypts into a fresh, NUL-terminated
//! stack buffer allocated at each call site.
//!
//!   - `obf!` produces a `[u8; N]` buffer (N = length + trailing NUL). Use for
//!     ANSI strings handed to `GetProcAddress` and friends.
//!   - `obf16!` produces a `[u16; N]` buffer (wide). Use for module names, env
//!     var names, and paths handed to `GetModuleHandleW`,
//!     `GetEnvironmentVariableW`, and `CreateFileW`.
//!
//! Each decrypted byte is committed with a `write_volatile` store, and the XOR
//! key is passed through `core::hint::black_box` so LLVM cannot fold the
//! decrypt and promote the fully constant stack buffer back into `.rodata` as
//! a plaintext global string table.

pub const XOR_KEY8: u8 = 0x3C;
pub const XOR_KEY16: u16 = 0x4D7A;

pub const fn xor8<const N: usize>(src: &[u8], key: u8) -> [u8; N] {
    let mut out = [0u8; N];
    let n = if N < src.len() { N } else { src.len() };
    let mut i = 0;
    while i < n {
        out[i] = src[i] ^ key;
        i += 1;
    }
    out
}

pub const fn xor16<const N: usize>(src: &[u8], key: u16) -> [u16; N] {
    let mut out = [0u16; N];
    let n = if N < src.len() { N } else { src.len() };
    let mut i = 0;
    while i < n {
        out[i] = (src[i] as u16) ^ key;
        i += 1;
    }
    out
}

#[macro_export]
macro_rules! obf {
    ($lit:literal) => {{
        const SRC: &[u8] = $lit;
        const LEN: usize = SRC.len() + 1;
        const ENC: [u8; LEN] = $crate::obf::xor8(SRC, $crate::obf::XOR_KEY8);
        let k = core::hint::black_box($crate::obf::XOR_KEY8);
        let mut buf = [0u8; LEN];
        let mut i = 0;
        while i < LEN - 1 {
            unsafe {
                (buf.as_mut_ptr() as *mut u8)
                    .add(i)
                    .write_volatile(ENC[i] ^ k);
            }
            i += 1;
        }
        buf
    }};
}

#[macro_export]
macro_rules! obf16 {
    ($lit:literal) => {{
        const SRC: &[u8] = $lit;
        const LEN: usize = SRC.len() + 1;
        const ENC: [u16; LEN] = $crate::obf::xor16(SRC, $crate::obf::XOR_KEY16);
        let k = core::hint::black_box($crate::obf::XOR_KEY16);
        let mut buf = [0u16; LEN];
        let mut i = 0;
        while i < LEN - 1 {
            unsafe {
                (buf.as_mut_ptr() as *mut u16)
                    .add(i)
                    .write_volatile(ENC[i] ^ k);
            }
            i += 1;
        }
        buf
    }};
}

#[cfg(test)]
mod tests {
    use super::{xor8, xor16, XOR_KEY8, XOR_KEY16};

    #[test]
    fn byte_roundtrip_is_nul_terminated() {
        let s = obf!(b"ntdll.dll");
        assert_eq!(&s[..], b"ntdll.dll\0");
    }

    #[test]
    fn byte_encoded_bytes_are_not_plaintext() {
        const ENC: [u8; 10] = xor8(b"ntdll.dll", XOR_KEY8);
        assert_ne!(&ENC[..9], b"ntdll.dll");
    }

    #[test]
    fn wide_roundtrip_is_nul_terminated() {
        let s = obf16!(b"kernel32.dll");
        let mut expect: Vec<u16> = b"kernel32.dll".iter().map(|&c| c as u16).collect();
        expect.push(0);
        assert_eq!(&s[..], &expect[..]);
    }

    #[test]
    fn wide_encoded_bytes_are_not_plaintext() {
        const ENC: [u16; 12] = xor16(b"kernel32.dll", XOR_KEY16);
        let plain: Vec<u16> = b"kernel32.dll".iter().map(|&c| c as u16).collect();
        assert_ne!(&ENC[..11], &plain[..]);
    }
}