# Native Plugins

Native plugins run as shared libraries inside the agent.

Use native plugins when you need direct OS APIs, native libraries, custom process/thread behavior, or platform-specific integrations.

Native plugins run with the same privileges as the agent. They are not sandboxed.

## What Native Plugins Can Do

| Capability | Notes |
|------------|-------|
| Call native OS APIs | Win32, POSIX, Objective-C/C APIs, platform SDKs, and local native libraries. |
| Use language runtimes | C, C++, Go, Rust, and other languages that can export a C ABI. |
| Run platform-specific code | Package separate binaries per OS/architecture. |
| Emit plugin events | Send events back to the UI/server through the host callback. |
| Receive UI/server commands | Handle `PluginOnEvent` calls from plugin UI actions or server-side routing. |

## Bundle Layout

A native bundle is a zip with web assets plus one or more platform binaries:

```text
<pluginId>.zip
  <pluginId>.html
  <pluginId>.css
  <pluginId>.js
  <pluginId>-windows-amd64.dll
  <pluginId>-linux-amd64.so
  <pluginId>-darwin-arm64.dylib
```

The browser assets provide the plugin UI. The native binary is sent to a matching client when the plugin is loaded for that client.

## Binary Naming

Binary filenames must follow:

```text
<pluginId>-<os>-<arch>.<ext>
```

| OS | Arch | Example |
|----|------|---------|
| `windows` | `amd64` | `sample-windows-amd64.dll` |
| `windows` | `arm64` | `sample-windows-arm64.dll` |
| `linux` | `amd64` | `sample-linux-amd64.so` |
| `linux` | `arm64` | `sample-linux-arm64.so` |
| `darwin` | `amd64` | `sample-darwin-amd64.dylib` |
| `darwin` | `arm64` | `sample-darwin-arm64.dylib` |

The server never sends an x64 native binary to an ARM client, or the reverse. If no binary matches the target client, loading fails for that client.

## Required ABI

Every native plugin exports C-callable functions. The ABI differs slightly between Windows and Unix-like systems.

| Export | Windows signature | Linux/macOS signature | Required |
|--------|-------------------|-----------------------|----------|
| `PluginOnLoad` | `int PluginOnLoad(char* hostInfo, int hostInfoLen, uint64 callback)` | `int PluginOnLoad(char* hostInfo, int hostInfoLen, uintptr callback, uintptr ctx)` | Yes |
| `PluginOnEvent` | `int PluginOnEvent(char* event, int eventLen, char* payload, int payloadLen)` | Same | Yes |
| `PluginOnUnload` | `void PluginOnUnload()` | Same | Yes |
| `PluginSetCallback` | `void PluginSetCallback(uint64 callback)` | Not used | Windows only |
| `PluginGetRuntime` | `const char* PluginGetRuntime()` | Same | Recommended |

Return `0` from `PluginOnLoad` and `PluginOnEvent` for success. Return a non-zero value when the plugin cannot initialize or handle the event.

## HostInfo JSON

`PluginOnLoad` receives host metadata as a JSON byte buffer:

```json
{
  "clientId": "abc123",
  "os": "windows",
  "arch": "amd64",
  "version": "1.0.0"
}
```

Use this to branch by client OS, architecture, client ID, or agent version.

## Host Callback

The host callback lets a native plugin emit events back to the agent/server.

Windows uses `__stdcall`:

```c
void __stdcall callback(const char *event, uintptr_t eventLen,
                        const char *payload, uintptr_t payloadLen);
```

Linux/macOS use a normal C function plus the opaque context pointer received by `PluginOnLoad`:

```c
void callback(uintptr_t ctx,
              const char *event, int eventLen,
              const char *payload, int payloadLen);
```

The event name and payload are byte buffers. JSON payloads are conventional, but the ABI only requires bytes plus lengths.

## Minimal C Skeleton

```c
#include <stdint.h>

#ifdef _WIN32
#define EXPORT __declspec(dllexport)
typedef void (__stdcall *host_callback_t)(
  const char *event, uintptr_t eventLen,
  const char *payload, uintptr_t payloadLen);
static host_callback_t g_callback = 0;
#else
#define EXPORT __attribute__((visibility("default")))
typedef void (*host_callback_t)(
  uintptr_t ctx,
  const char *event, int eventLen,
  const char *payload, int payloadLen);
static host_callback_t g_callback = 0;
static uintptr_t g_ctx = 0;
#endif

EXPORT const char *PluginGetRuntime(void) {
  return "c";
}

#ifdef _WIN32
EXPORT void PluginSetCallback(uint64_t callback) {
  g_callback = (host_callback_t)(uintptr_t)callback;
}

EXPORT int PluginOnLoad(const char *hostInfo, int hostInfoLen, uint64_t callback) {
  g_callback = (host_callback_t)(uintptr_t)callback;
  if (g_callback) g_callback("ready", 5, "{\"ok\":true}", 11);
  return 0;
}
#else
EXPORT int PluginOnLoad(const char *hostInfo, int hostInfoLen, uintptr_t callback, uintptr_t ctx) {
  g_callback = (host_callback_t)callback;
  g_ctx = ctx;
  if (g_callback) g_callback(g_ctx, "ready", 5, "{\"ok\":true}", 11);
  return 0;
}
#endif

EXPORT int PluginOnEvent(const char *event, int eventLen, const char *payload, int payloadLen) {
  return 0;
}

EXPORT void PluginOnUnload(void) {
}
```

## Runtime Detection

`PluginGetRuntime` should return a pointer to a static, null-terminated string.

| Return value | Meaning |
|--------------|---------|
| `c` | C plugin; fully unloadable. |
| `cpp` | C++ plugin; fully unloadable. |
| `rust` | Rust plugin; fully unloadable when written without unload-hostile globals. |
| `go` or absent | Go runtime; intentionally not unloaded. |

Go shared libraries cannot be fully unloaded safely because the Go runtime owns threads and process-global state. The host treats Go plugins as non-freeable to avoid crashes.

## Loading Model

| Platform | Loading behavior |
|----------|------------------|
| Windows | DLLs default to the custom in-memory PE loader. Plugins can set `nativeLoader: "os"` to stage the DLL in the agent cache and load it with `LoadLibraryExW`. |
| Linux | Shared libraries are loaded through the static-agent subprocess shim when needed. |
| macOS | Dynamic libraries are loaded through the platform loader. |

Because Windows uses an in-memory PE loader, some runtime primitives that assume normal `LoadLibrary` initialization can be fragile. The Rust sample avoids `std::sync::Mutex` for this reason and uses C-style globals; the host serializes plugin calls.

### Windows Loader Selection

Set `nativeLoader` in `config.json`:

```json
{
  "runtime": "native",
  "nativeLoader": "memory"
}
```

| Value | Behavior |
|-------|----------|
| `memory` | Default. Loads the PE image from bytes without staging the plugin DLL on disk. |
| `os` | Writes a content-addressed copy to the agent cache and loads it with `LoadLibraryExW`. Prefer this for Go DLLs or other runtimes that rely on the normal Windows loader. |

The OS loader path reuses the cached DLL when the SHA-256 hash matches, so repeated loads do not rewrite the same plugin. Windows keeps loaded images locked; old cached plugin versions are left for later cleanup.

### Custom Export Names

Native plugins may override the exported ABI names in `config.json`:

```json
{
  "runtime": "native",
  "nativeEntrypoints": {
    "onLoad": "StartPlugin",
    "onEvent": "HandlePluginEvent",
    "onUnload": "StopPlugin",
    "setCallback": "SetHostCallback",
    "getRuntime": "RuntimeName"
  }
}
```

Omitted fields use the standard names. The signatures must stay ABI-compatible with `PluginOnLoad`, `PluginOnEvent`, `PluginOnUnload`, `PluginSetCallback`, and `PluginGetRuntime`; only the exported symbol names change. Custom names are honored by the Windows loader and direct `dlopen`/`dlsym` paths. The Linux static-agent subprocess shim still expects the standard names.

## Static Linux Agent Shim

Linux agents are compiled as static musl binaries for portability. Static binaries cannot directly call `dlopen`, so Linux native plugin support uses an embedded plugin-host shim.

When loading a Linux native plugin, the agent:

1. Writes the plugin `.so` to an anonymous in-memory file.
2. Writes the embedded shim to another in-memory file.
3. Creates a bidirectional socket.
4. Starts the shim and passes file descriptors to it.
5. The shim loads the `.so` and forwards events over the socket.

Plugin authors normally do not need shim-specific code. Export the normal v1 ABI and compile the `.so` for the target libc/architecture.

## IPC Protocol Notes

The agent and Linux shim use a length-prefixed binary protocol:

```text
[4-byte little-endian total payload length][1-byte message type][payload bytes]
```

Important message types:

| Direction | Type | Meaning |
|-----------|------|---------|
| agent to shim | `0x01` | Load plugin with HostInfo. |
| agent to shim | `0x02` | Deliver plugin event. |
| agent to shim | `0x03` | Unload plugin. |
| shim to agent | `0x10` | Plugin callback event. |
| shim to agent | `0x11` | Ready/runtime string. |
| shim to agent | `0x12` | Error string. |
| shim to agent | `0x13` | Load result. |

Most plugin authors can ignore this, but it is useful when debugging Linux native plugin load failures.

## Build Scripts

Native samples include `build.bat` and `build.sh`. They compile native binaries and zip them with web assets.

Default usage:

```bash
cd plugins/sample-c
./build.sh
```

Multiple targets:

```bash
BUILD_TARGETS="linux-amd64 linux-arm64 windows-amd64 darwin-arm64" ./build.sh
```

Windows:

```bat
cd plugins\sample-c
build.bat
```

The scripts support `BUILD_TARGETS` and usually accept an optional plugin directory argument.

## Cross-Compilation

Install the compiler matching the target platform, or set `CC` for C/C++ samples.

Common compiler names used by the sample scripts:

| Target | Compiler |
|--------|----------|
| `linux-amd64` | `x86_64-linux-gnu-gcc` |
| `linux-arm64` | `aarch64-linux-gnu-gcc` |
| `linux-arm` | `arm-linux-gnueabihf-gcc` |
| `windows-amd64` | `x86_64-w64-mingw32-gcc` |
| `windows-arm64` | `aarch64-w64-mingw32-gcc` |
| `darwin-amd64` | `x86_64-apple-darwin-gcc` |
| `darwin-arm64` | `aarch64-apple-darwin-gcc` |

Rust samples use Cargo targets. Go samples use `go build -buildmode=c-shared` with CGO enabled.

## Language Notes

| Sample | Notes |
|--------|-------|
| `sample-c` | Smallest ABI surface, no runtime, fully unloadable. |
| `sample-cpp` | C++ convenience with exported C ABI. Return `cpp` from `PluginGetRuntime`. |
| `sample-rust` | Exports a C ABI. Avoid assumptions that require normal OS loader initialization. |
| `sample-go` | Uses `-buildmode=c-shared`; treated as non-freeable because the Go runtime cannot be safely unloaded. |

## UI Event Flow

The browser UI sends events through the normal plugin event endpoint. The server forwards them to the client. The agent calls:

```text
PluginOnEvent(event, eventLen, payload, payloadLen)
```

The native plugin can reply by invoking the host callback. Those callback events are delivered back to the server/UI as plugin events.

## Security Notes

Native plugins are trusted executable code. They can call OS APIs, read/write files available to the agent process, spawn subprocesses, open sockets, and interact with native libraries. Use plugin signing, per-user plugin access, and code review before deploying third-party native plugins.
