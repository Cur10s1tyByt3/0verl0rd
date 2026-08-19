//! Redirect configuration read from environment variables on attach.

use crate::abi::GetEnvironmentVariableW;

const ENV_BUFFER_WCHARS: u32 = 2048;

#[derive(Default, Clone)]
pub struct HookConfig {
    pub search: Vec<u16>,
    pub replace: Vec<u16>,
}

const RDI_SEARCH_PATH: &str = "RDI_SEARCH_PATH";
const RDI_REPLACE_PATH: &str = "RDI_REPLACE_PATH";

pub fn load() -> HookConfig {
    HookConfig {
        search: read_env(RDI_SEARCH_PATH),
        replace: read_env(RDI_REPLACE_PATH),
    }
}

fn read_env(name: &str) -> Vec<u16> {
    let name = name.encode_utf16().chain(core::iter::once(0)).collect::<Vec<u16>>();
    let mut buf = [0u16; ENV_BUFFER_WCHARS as usize];
    unsafe {
        let len = GetEnvironmentVariableW(name.as_ptr(), buf.as_mut_ptr(), ENV_BUFFER_WCHARS);
        if len == 0 || len >= ENV_BUFFER_WCHARS {
            return Vec::new();
        }
        buf[..len as usize].to_vec()
    }
}