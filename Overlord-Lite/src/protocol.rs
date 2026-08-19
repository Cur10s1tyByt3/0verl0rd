use std::collections::BTreeMap;

use anyhow::{Context, Result, anyhow};
use rmpv::Value;
use serde::Serialize;

include!(concat!(env!("OUT_DIR"), "/wire_contract.rs"));

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandVersionRange {
    pub min: u16,
    pub max: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello<'a> {
    #[serde(rename = "type")]
    pub message_type: &'static str,
    pub id: &'a str,
    pub hwid: &'a str,
    pub host: String,
    pub os: &'static str,
    pub arch: &'static str,
    pub version: &'static str,
    pub user: String,
    pub monitors: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_tag: Option<&'a str>,
    pub public_key: &'a str,
    pub signature: &'a str,
    pub protocol_version: u16,
    pub command_versions: BTreeMap<String, CommandVersionRange>,
}

#[derive(Debug, Serialize)]
pub struct Ping {
    #[serde(rename = "type")]
    pub message_type: &'static str,
    pub ts: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult<'a> {
    #[serde(rename = "type")]
    pub message_type: &'static str,
    pub command_id: &'a str,
    pub command_type: &'a str,
    pub command_version: u16,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<&'a str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleOutput<'a> {
    #[serde(rename = "type")]
    pub message_type: &'static str,
    pub session_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<&'a serde_bytes::Bytes>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<&'a str>,
}

pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    rmp_serde::to_vec_named(value).context("encode MessagePack")
}

pub fn decode(bytes: &[u8]) -> Result<Value> {
    rmp_serde::from_slice(bytes).context("decode MessagePack")
}

pub fn field<'a>(value: &'a Value, name: &str) -> Option<&'a Value> {
    value
        .as_map()?
        .iter()
        .find_map(|(key, value)| (key.as_str() == Some(name)).then_some(value))
}

pub fn string_field<'a>(value: &'a Value, name: &str) -> Option<&'a str> {
    field(value, name)?.as_str()
}

pub fn required_string<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    string_field(value, name).ok_or_else(|| anyhow!("missing or invalid {name}"))
}

pub fn integer_field(value: &Value, name: &str) -> Option<i64> {
    let value = field(value, name)?;
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
}

pub fn command_versions() -> BTreeMap<String, CommandVersionRange> {
    lite_command_version_support()
        .into_iter()
        .map(|(command, min, max)| (command, CommandVersionRange { min, max }))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertises_only_console_commands() {
        let commands = command_versions();
        assert_eq!(commands.len(), 4);
        for command in [
            "console_input",
            "console_resize",
            "console_start",
            "console_stop",
        ] {
            let versions = commands.get(command).unwrap();
            assert_eq!(versions.min, 1);
            assert_eq!(versions.max, 1);
        }
    }

    #[test]
    fn messagepack_uses_wire_field_names() {
        let ping = Ping {
            message_type: "ping",
            ts: 123,
        };
        let decoded = decode(&encode(&ping).unwrap()).unwrap();
        assert_eq!(string_field(&decoded, "type"), Some("ping"));
        assert_eq!(integer_field(&decoded, "ts"), Some(123));
    }
}
