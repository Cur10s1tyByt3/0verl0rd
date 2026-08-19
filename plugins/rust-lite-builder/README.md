# Rust Lite Builder Plugin

This trusted server-only plugin registers Rust Lite as an agent build provider.
Select **Rust Lite** from the Builder's **Agent Type** field, choose targets, and
start the build normally. Output, history, downloads, expiration, rate limits,
RBAC, and artifact hooks remain owned by the Overlord server.

The resulting client supports authenticated enrollment, TLS identity pinning,
heartbeat, reconnect behavior, and interactive TTY console sessions. It
intentionally contains no plugin loader or other remote command handlers.

During compilation the Build page shows estimated overall/target percentages,
completed Cargo crates, elapsed time, the current compile or link/LTO phase,
and a rolling ETA. Cargo does not expose exact link progress, so percentages
and ETA are estimates. Completed target durations are retained in plugin data
to improve later estimates, and the persistent Cargo target directory makes
subsequent builds substantially faster.

The **Cargo Jobs** setting defaults to `0`, which leaves parallelism at Cargo's
host-CPU default. Set a positive number only when the server needs an explicit
resource cap. The plugin cache is separate from `Overlord-Lite/target`, so the
first plugin build does not reuse artifacts from a manual source-tree build.

The server host needs Rust 1.88 or newer. Native-host builds work with the
standard Rust installation. Cross-target builds additionally require the target
from `rustup target add <triple>` and a compatible linker/toolchain.

The plugin locates `Overlord-Lite` beside the server runtime or under its
`dist/` directory. Production package scripts copy that source automatically.

Builder releases compile in the selected server URL, agent token, and signed
build tag. Runtime `OVERLORD_SERVER`, `OVERLORD_AGENT_TOKEN`, and
`OVERLORD_BUILD_TAG` variables can still override those defaults.

Builds also embed the server's active TLS SPKI pins. This lets Lite clients
trust the server's generated self-signed certificate without disabling
certificate verification and protects later HTTPS plugin downloads too.

All provider builds use Cargo's `--release` profile. That profile uses
`opt-level = "z"`, full LTO, one codegen unit, symbol stripping, and
`panic = "abort"`.
