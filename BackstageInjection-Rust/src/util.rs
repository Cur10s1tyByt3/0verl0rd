//! Wide-string and path helpers ported from the C reference delivery.

use crate::abi::{CSTR_EQUAL, CompareStringOrdinal};

pub const UNICODE_STRING_MAX_WCHARS: usize = 32767;

pub fn wide_zstr(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(core::iter::once(0)).collect()
}

pub fn ci_eq(a: &[u16], b: &[u16]) -> bool {
    if a.is_empty() || b.is_empty() {
        return a.is_empty() && b.is_empty();
    }
    unsafe {
        CompareStringOrdinal(a.as_ptr(), a.len() as i32, b.as_ptr(), b.len() as i32, 1)
            == CSTR_EQUAL
    }
}

pub fn ci_find(haystack: &[u16], needle: &[u16]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    let hi = haystack.len() - needle.len();
    for i in 0..=hi {
        if ci_eq(&haystack[i..i + needle.len()], needle) {
            return Some(i);
        }
    }
    None
}

pub fn normalize_path(path: &[u16]) -> (&[u16], usize) {
    if path.len() >= 4 && path[0] == 0x005C && path[1] == 0x003F && path[2] == 0x003F && path[3] == 0x005C {
        return (&path[4..], 4);
    }
    const DEVICE_PREFIX: &[u16] = &[
        0x005C, 0x0044, 0x0065, 0x0076, 0x0069, 0x0063, 0x0065, 0x005C,
    ];
    if path.len() >= DEVICE_PREFIX.len() && ci_eq(&path[..DEVICE_PREFIX.len()], DEVICE_PREFIX) {
        return (path, 0);
    }
    (path, 0)
}

pub fn needs_redirection(path: &[u16], search: &[u16]) -> bool {
    if path.is_empty() || search.is_empty() || path.len() < search.len() {
        return false;
    }
    let (normalized, _) = normalize_path(path);
    if normalized.len() < search.len() {
        return false;
    }
    ci_find(normalized, search).is_some()
}

pub fn replace_path(original: &[u16], search: &[u16], replacement: &[u16]) -> Option<Vec<u16>> {
    if original.is_empty() || search.is_empty() || original.len() < search.len() {
        return None;
    }

    let (normalized, prefix_len) = normalize_path(original);
    if normalized.len() < search.len() {
        return None;
    }

    let mut occurrences = 0usize;
    let mut i = 0usize;
    while i + search.len() <= normalized.len() {
        if ci_eq(&normalized[i..i + search.len()], search) {
            occurrences += 1;
            i += search.len();
        } else {
            i += 1;
        }
    }
    if occurrences == 0 {
        return None;
    }

    let new_len = prefix_len
        + normalized.len()
        - occurrences * search.len()
        + occurrences * replacement.len();

    let mut out = Vec::with_capacity(new_len);
    out.extend_from_slice(&original[..prefix_len]);

    let mut src = 0usize;
    while src < normalized.len() {
        if src + search.len() <= normalized.len()
            && ci_eq(&normalized[src..src + search.len()], search)
        {
            out.extend_from_slice(replacement);
            src += search.len();
        } else {
            out.push(normalized[src]);
            src += 1;
        }
    }
    debug_assert_eq!(out.len(), new_len);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    #[test]
    fn normalize_strips_nt_prefix() {
        let p = w(r"\??\C:\Users\Shared");
        let (norm, prefix) = normalize_path(&p);
        assert_eq!(prefix, 4);
        assert_eq!(norm, w(r"C:\Users\Shared"));
    }

    #[test]
    fn normalize_leaves_device_paths() {
        let p = w(r"\Device\HarddiskVolume3\foo");
        let (norm, prefix) = normalize_path(&p);
        assert_eq!(prefix, 0);
        assert_eq!(norm, p);
    }

    #[test]
    fn no_redirect_without_search() {
        assert!(!needs_redirection(&w(r"\??\C:\x"), &[]));
    }

    #[test]
    fn redirect_detects_substring_case_insensitive() {
        assert!(needs_redirection(&w(r"\??\C:\Overlord\data\file"), &w(r"c:\overlord")));
        assert!(!needs_redirection(&w(r"\??\C:\Windows\System32"), &w(r"c:\overlord")));
    }

    #[test]
    fn replace_preserves_prefix_and_all_occurrences() {
        let out = replace_path(
            &w(r"\??\C:\Overlord\cfg\Overlord.ini"),
            &w(r"overlord"),
            &w(r"Work"),
        )
        .unwrap();
        assert_eq!(out, w(r"\??\C:\Work\cfg\Work.ini"));
    }

    #[test]
    fn replace_no_match_returns_none() {
        assert!(replace_path(&w(r"\??\C:\Other"), &w(r"overlord"), &w(r"Work")).is_none());
    }

    #[test]
    fn replace_win32_search_not_spurious_in_device_path() {
        // \Device\ paths are not rooted at a Win32 drive letter, so a Win32-style
        // search string must not match inside them (matches the C reference intent).
        let p = w(r"\Device\HarddiskVolume3\Windows\System32");
        assert!(replace_path(&p, &w(r"c:\windows"), &w(r"d:\windows")).is_none());
    }

    #[test]
    fn replace_empty_search_returns_none() {
        assert!(replace_path(&w("anything"), &[], &w("x")).is_none());
    }
}