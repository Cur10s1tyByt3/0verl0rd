use std::{env, fs, path::PathBuf};

use serde_json::Value;

fn main() {
    for name in [
        "OVERLORD_LITE_DEFAULT_SERVER",
        "OVERLORD_LITE_DEFAULT_AGENT_TOKEN",
        "OVERLORD_LITE_DEFAULT_BUILD_TAG",
        "OVERLORD_LITE_DEFAULT_TLS_SPKI_PINS",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let contract_path = PathBuf::from("../protocol/wire-contract.json");
    println!("cargo:rerun-if-changed={}", contract_path.display());
    let contract: Value = serde_json::from_slice(
        &fs::read(&contract_path).expect("read protocol/wire-contract.json"),
    )
    .expect("parse protocol/wire-contract.json");

    let protocol_version = contract["protocolVersion"]
        .as_u64()
        .expect("wire contract protocolVersion");
    let mut generated = format!("pub const WIRE_PROTOCOL_VERSION: u16 = {protocol_version};\n");
    for (name, env_name) in [
        ("built_default_server", "OVERLORD_LITE_DEFAULT_SERVER"),
        (
            "built_default_agent_token",
            "OVERLORD_LITE_DEFAULT_AGENT_TOKEN",
        ),
        ("built_default_build_tag", "OVERLORD_LITE_DEFAULT_BUILD_TAG"),
        (
            "built_default_tls_spki_pins",
            "OVERLORD_LITE_DEFAULT_TLS_SPKI_PINS",
        ),
    ] {
        let value = env::var(env_name).unwrap_or_default();
        generated.push_str(&format!(
            "pub fn {name}() -> String {{ crate::obfstr!({value:?}) }}\n"
        ));
    }
    let commands = contract["commands"]
        .as_array()
        .expect("wire contract commands");
    let default_version = contract["commandVersioning"]["defaultVersion"]
        .as_u64()
        .expect("wire contract default command version");
    let lite_commands = [
        "console_input",
        "console_resize",
        "console_start",
        "console_stop",
    ];
    for command in lite_commands {
        assert!(
            commands.iter().any(|value| value.as_str() == Some(command)),
            "Lite command {command} is missing from the wire contract"
        );
        assert_eq!(
            default_version, 1,
            "Lite console handlers implement command version 1"
        );
    }
    generated.push_str("pub fn lite_command_version_support() -> [(String, u16, u16); 4] { [\n");
    for command in lite_commands {
        generated.push_str(&format!("    (crate::obfstr!({command:?}), 1, 1),\n"));
    }
    generated.push_str("] }\n");

    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR")).join("wire_contract.rs");
    fs::write(output, generated).expect("write generated Rust wire constants");
}
