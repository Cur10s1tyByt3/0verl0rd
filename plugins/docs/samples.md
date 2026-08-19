# Sample Plugins

The `plugins/` directory includes small examples that exercise each plugin style.

| Directory | Demonstrates |
|-----------|--------------|
| `sample-build-hooks` | Server-only build plugin, custom Build page action, build settings, and replacing the produced artifact with a `.txt` file. |
| `sample-ts-fullstack` | TypeScript UI and TypeScript server runtime with shared local modules. |
| `sample-c` | Native C plugin for the smallest unloadable ABI surface. |
| `sample-cpp` | Native C++ plugin using exported C ABI functions. |
| `sample-go` | Native Go plugin. Go plugins are intentionally not unloaded because the Go runtime cannot be safely unloaded from shared libraries. |
| `sample-rust` | Native Rust plugin with C ABI exports and unload-friendly runtime handling. |

Use `sample-build-hooks` as the starting point for uploaders, artifact publishers, or custom release buttons.
