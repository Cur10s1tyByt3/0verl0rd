/// Reconstructs a string emitted by `obfstr!`.
///
/// `black_box` plus the non-inlined boundary keeps release LTO from replacing
/// the call with a plaintext constant. This is binary obfuscation, not secret
/// storage: a determined analyst can still recover strings from a running
/// process or reverse the decoder.
#[inline(never)]
pub fn decrypt(encrypted: &[u8], seed: u64) -> String {
    let encrypted = std::hint::black_box(encrypted);
    let mut state = std::hint::black_box(seed | 1);
    let plaintext = encrypted
        .iter()
        .map(|byte| byte ^ next_key_byte(&mut state))
        .collect();
    String::from_utf8(plaintext).expect("obfstr generated invalid UTF-8")
}

fn next_key_byte(state: &mut u64) -> u8 {
    *state ^= *state >> 12;
    *state ^= *state << 25;
    *state ^= *state >> 27;
    (state.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 56) as u8
}

#[cfg(test)]
mod tests {
    use crate::obfstr;

    #[test]
    fn decrypts_compile_time_string() {
        assert_eq!(
            obfstr!("overlord-obfuscation-marker"),
            "overlord-obfuscation-marker"
        );
        assert_eq!(obfstr!("Unicode: ☃"), "Unicode: ☃");
        assert!(obfstr!("").is_empty());
    }
}
