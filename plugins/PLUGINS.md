# Overlord Plugins

This is the short entry point for plugin authors. The detailed docs are split by topic so server-only build extensions, native agent plugins, signing, and examples can evolve independently.

## Quick Start

A Plugin 2.0 bundle is a zip with a root `config.json`, browser assets, and optional server or agent code:

```text
<pluginId>.zip
  config.json
  <pluginId>.html
  <pluginId>.css
  <pluginId>.js              optional when src/ui.ts exists
  <pluginId>-<os>-<arch>.*   optional native agent library
  server.js                  optional server-side runtime
  src/                       optional TypeScript source
```

Upload the zip from the Plugins page, or place it under `Overlord-Server/plugins`.

## Read The Focused Docs

| Topic | Read this |
|-------|-----------|
| Bundle layout, `config.json`, TypeScript UI/server entries | [docs/bundle-format.md](docs/bundle-format.md) |
| Server-only plugins, plugin data, RPC/SSE, build hooks, build settings/buttons | [docs/server-side-plugins.md](docs/server-side-plugins.md) |
| Install/upload flow, Plugin Manager behavior, auto-load rules | [docs/install-and-manage.md](docs/install-and-manage.md) |
| Sample plugin directory guide | [docs/samples.md](docs/samples.md) |
| Native plugins: OS APIs, native ABI, build scripts, Linux static-agent shim | [docs/legacy-native-plugins.md](docs/legacy-native-plugins.md) |
| Plugin signing and trusted keys | [docs/signing.md](docs/signing.md) |

## Runtime Choices

Use `runtime: "server"` for server-side extensions. These can add server UI, store files, expose RPCs, subscribe to plugin events, and hook the build pipeline. Server-only plugins are shown as server extensions in the Plugin Manager, are not sent to clients, and do not use auto-load.

Use `runtime: "native"` for agent-side plugins that need direct OS APIs, native libraries, or platform-specific behavior. Native plugins run with the agent's privileges and require one binary per OS/architecture.

## Current Samples

| Directory | Purpose |
|-----------|---------|
| `sample-build-hooks` | Server-only build plugin with its own Build page button and artifact replacement example. |
| `sample-ts-fullstack` | TypeScript UI plus TypeScript server runtime. |
| `sample-c`, `sample-cpp`, `sample-go`, `sample-rust` | Native agent plugin examples. |

Start with [docs/server-side-plugins.md](docs/server-side-plugins.md) if you are building uploaders, custom build buttons, artifact post-processing, or internal release hooks.
