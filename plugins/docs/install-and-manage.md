# Install And Manage Plugins

## Install Or Upload

Install a plugin by uploading its zip from the Plugins page or placing the zip under `Overlord-Server/plugins`. The server extracts the bundle, generates `manifest.json`, and copies browser assets into the plugin assets directory.

`config.json` must be in the root of the zip. It is merged into the generated manifest on extraction.

## Open Plugin UI

Plugin pages are served at:

```text
/plugins/<pluginId>
```

Per-client plugins can also receive a client context through:

```text
/plugins/<pluginId>?clientId=<clientId>
```

Navbar plugins appear in the Plugin Apps group when enabled and configured with:

```json
{
  "navbar": {
    "label": "My Plugin",
    "icon": "fa-cube"
  }
}
```

## Plugin Manager Behavior

| Plugin kind | Manager behavior |
|-------------|------------------|
| Server-only (`runtime: "server"`) | Shown as a server extension. Auto-load controls are hidden. It is not sent to clients. |
| Native (`runtime: "native"`) | Shows native binary/runtime compatibility. Requires a matching OS/architecture binary. |

## Auto-Load

Auto-load applies to client-side plugins only. It sends enabled client plugins to newly connected clients and can optionally dispatch startup events.

Server-only plugins do not use auto-load because their code runs on the server rather than inside an agent.

Auto-load notes:

| Rule | Detail |
|------|--------|
| Enabled flag | Disabled plugins are never auto-loaded. |
| Persistence | Auto-load state is saved in `.plugin-state.json`. |
| Platform matching | Native plugins require a matching binary. |
| Bundle default | `autoLoadByDefault: true` enables auto-load only after the plugin passes trusted enablement or an administrator explicitly confirms enablement. |

## Useful APIs

| Endpoint | Purpose |
|----------|---------|
| `GET /api/plugins` | List installed plugins, runtime, enabled state, server state, and auto-load state. |
| `POST /api/plugins/<id>/autoload` | Configure auto-load for client-side plugins. Server-only plugins reject this. |
| `POST /api/plugins/<id>/rpc` | Call a server-side plugin RPC method. |
| `GET /api/plugins/<id>/stream` | Subscribe to server-side plugin broadcasts. |
| `GET /api/build/plugins` | List enabled build plugins and their Build page settings/actions. |

## Per-User Plugin Access

Admins can limit which plugins a user can use from the Users page through Plugin Access. The policy supports no access, selected plugins, or all plugins.

That same policy applies to normal plugin pages, server-side plugin RPC/SSE, client-side plugin loading, and build-hook plugins. A user must also have the relevant base permission, such as `clients:build`, before plugin access matters.
