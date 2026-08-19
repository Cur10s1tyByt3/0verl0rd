use std::{
    hash::{Hash, Hasher},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use proc_macro::TokenStream;
use quote::quote;
use syn::{LitStr, parse_macro_input};

static INVOCATION: AtomicU64 = AtomicU64::new(1);

/// Encrypts one UTF-8 string literal while the crate is being compiled and
/// expands to an expression that decrypts it only when evaluated at runtime.
#[proc_macro]
pub fn obfstr(input: TokenStream) -> TokenStream {
    let literal = parse_macro_input!(input as LitStr);
    let plaintext = literal.value();
    let seed = invocation_seed(&plaintext);
    let encrypted = crypt(plaintext.as_bytes(), seed);
    let bytes = encrypted.iter();

    quote!({
        const ENCRYPTED: &[u8] = &[#(#bytes),*];
        ::overlord_lite::obfuscation::decrypt(ENCRYPTED, #seed)
    })
    .into()
}

fn invocation_seed(value: &str) -> u64 {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let invocation = INVOCATION.fetch_add(1, Ordering::Relaxed);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    timestamp.hash(&mut hasher);
    invocation.hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    normalize_seed(hasher.finish())
}

fn crypt(input: &[u8], seed: u64) -> Vec<u8> {
    let mut state = normalize_seed(seed);
    input
        .iter()
        .map(|byte| byte ^ next_key_byte(&mut state))
        .collect()
}

fn normalize_seed(seed: u64) -> u64 {
    seed | 1
}

fn next_key_byte(state: &mut u64) -> u8 {
    *state ^= *state >> 12;
    *state ^= *state << 25;
    *state ^= *state >> 27;
    (state.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 56) as u8
}
