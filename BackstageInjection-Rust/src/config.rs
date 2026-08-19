//! Redirect configuration read from environment variables on attach.

use crate::abi::GetEnvironmentVariableW;
use crate::{obf16};

const ENV_BUFFER_WCHARS: u32 = 2048;

#[derive(Default, Clone)]
pub struct HookConfig {
    pub search: Vec<u16>,
    pub replace: Vec<u16>,
}

pub fn load() -> HookConfig {
    HookConfig {
        search: read_env(&obf16!(b"RDI_SEARCH_PATH")),
        replace: read_env(&obf16!(b"RDI_REPLACE_PATH")),
    }
}

pub fn read_env(name: &[u16]) -> Vec<u16> {
    let mut buf = [0u16; ENV_BUFFER_WCHARS as usize];
    unsafe {
        let len = GetEnvironmentVariableW(name.as_ptr(), buf.as_mut_ptr(), ENV_BUFFER_WCHARS);
        if len == 0 || len >= ENV_BUFFER_WCHARS {
            return Vec::new();
        }
        buf[..len as usize].to_vec()
    }
}