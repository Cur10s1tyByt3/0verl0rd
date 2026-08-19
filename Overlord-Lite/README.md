# Overlord Lite

Overlord Lite is a deliberately small Rust agent that proves the Overlord wire
protocol works independently of the full Go agent. It supports authenticated
server sessions, TLS identity pinning, heartbeats, and reconnection. It does
not advertise or execute remote commands beyond its interactive TTY console.

## Supported

- Agent-token authentication through `x-agent-token`
- TLS 1.3-only encrypted transport, with public-root or pinned self-signed identities
- Persistent Ed25519 identity and enrollment challenge signing
- MessagePack protocol negotiation
- Ping/pong heartbeat and reconnect/server rotation
- Interactive TTY console sessions with resize support

Plugins, desktop, file-manager, audio, webcam, persistence, update,
and other full-agent commands are intentionally omitted.

## Build

Rust 1.88 or newer is required.

```text
cd Overlord-Lite
cargo build --release
```

The output is `target/release/overlord-lite` (`overlord-lite.exe` on Windows).
The release profile enables size optimization, LTO, symbol stripping, and
abort-on-panic.

String literals that should not appear in plaintext in the executable can use
the local `obfstr!` procedural macro:

```rust
let header = overlord_lite::obfstr!("x-agent-token");
```

The macro encrypts the literal while compiling and returns a decrypted
`String` only when the expression runs. Builder-embedded server URLs, agent
tokens, build tags, TLS pins, and advertised Lite command names use it
automatically. This is binary obfuscation rather than secret storage: because
the executable must decrypt its own values, a determined analyst can still
recover them at runtime.

For Build-page integration, install `plugins/rust-lite-builder/rust-lite-builder.zip`
through the Plugin Manager. The Agent Type selector will then offer **Rust
Lite** and route selected targets through Cargo while retaining normal build
permissions, history, downloads, hooks, and file-share upload behavior. Cargo
and the requested Rust targets/linkers must be installed on the server host.

## Run

Configure the agent with the same token used by the server:

```powershell
$env:OVERLORD_SERVER = "wss://overlord.example.com:5173"
$env:OVERLORD_AGENT_TOKEN = "your-agent-token"
cargo run --release
```

Multiple servers may be comma-separated. Bare hosts default to `wss://`.

For a local development server using a self-signed certificate:

```powershell
$env:OVERLORD_SERVER = "wss://localhost:5173"
$env:OVERLORD_TLS_INSECURE_SKIP_VERIFY = "true"
cargo run
```

Disabling certificate verification also permits plaintext `ws://`. Do not
enable it for production deployments.

Builder-produced binaries automatically embed the server's active TLS SPKI
pin, so they securely accept its generated self-signed certificate without the
development bypass. For manual builds, `OVERLORD_TLS_SPKI_PINS` accepts one or
more comma-separated `sha256/<base64>` public-key pins.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OVERLORD_SERVER` | `wss://127.0.0.1:5173` | One server, or a comma-separated rotation list |
| `OVERLORD_AGENT_TOKEN` | empty | Shared server agent token |
| `OVERLORD_BUILD_TAG` | compiled build tag | Runtime override for server build attribution |
| `OVERLORD_TLS_SPKI_PINS` | compiled server pins | Comma-separated trusted server public-key pins |
| `OVERLORD_TLS_INSECURE_SKIP_VERIFY` | `false` | Development-only TLS bypass |
| `OVERLORD_LITE_STATE_DIR` | platform state directory | Persistent client ID and Ed25519 seed |
| `OVERLORD_RECONNECT_DELAY_MS` | `5000` | Delay between connection attempts |
| `OVERLORD_PING_INTERVAL_MS` | `30000` | Application heartbeat interval |

The identity file is created once as `identity.json`. Keep it private: deleting
it creates a new identity that must enroll again.

The builder compiles `OVERLORD_LITE_DEFAULT_SERVER`,
`OVERLORD_LITE_DEFAULT_AGENT_TOKEN`, and `OVERLORD_LITE_DEFAULT_BUILD_TAG` into
the binary along with the server's TLS SPKI pins. Their corresponding runtime
variables take precedence, so one binary can still be redirected deliberately
after deployment.

## Protocol compatibility

`build.rs` reads `../protocol/wire-contract.json` during every build and
generates the Lite client's protocol version from the canonical contract. The
client advertises only the four version 1 console commands it implements.
