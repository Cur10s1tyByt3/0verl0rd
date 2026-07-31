# Bundle Format

Plugin bundles are zip files named after the plugin ID. `config.json` must be at the zip root.

## Plugin 2.0 Layout

```text
<pluginId>.zip
  config.json
  <pluginId>.html
  <pluginId>.css
  <pluginId>.js              optional when src/ui.ts exists
  <pluginId>.wasm            optional agent-side WASM module
  server.js                  optional server runtime
  src/
    ui.ts                    compiled to assets/<pluginId>.js
    server.ts                compiled to server.js
    shared.ts                optional local module
```

After extraction the server stores assets under `Overlord-Server/plugins/<pluginId>/assets/`, generated metadata in `manifest.json`, optional source in `src/`, and persistent plugin files in `data/`.

## Runtime Selection

```json
{
  "apiVersion": 2,
  "runtime": "wasm",
  "wasm": "sample-wasm.wasm"
}
```

Use:

| Runtime | Use case |
|---------|----------|
| `server` | Server-only extension, build plugin, dashboard plugin, RPC-backed plugin. |
| `wasm` | Sandboxed agent-side Plugin 2.0 module. |
| `native` or omitted v1 fields | Legacy shared-library agent plugin. |

Server-only plugins are not sent to clients and do not use auto-load.

Native plugins can choose the Windows loader mode and exported ABI names:

```json
{
  "runtime": "native",
  "nativeLoader": "os",
  "nativeEntrypoints": {
    "onLoad": "MyLoad",
    "onEvent": "MyEvent",
    "onUnload": "MyUnload",
    "setCallback": "MySetCallback",
    "getRuntime": "MyRuntime"
  }
}
```

`nativeLoader` accepts `memory` for the in-memory PE loader or `os` for the platform loader. On Windows, `os` stages the DLL in the agent cache and loads it with `LoadLibraryExW`, which is more compatible with runtimes that expect normal loader initialization. Omit `nativeEntrypoints` to use the standard `PluginOnLoad`, `PluginOnEvent`, `PluginOnUnload`, `PluginSetCallback`, and `PluginGetRuntime` exports.

## Manifest Fields

`config.json` is merged into the generated `manifest.json`.

```json
{
  "id": "sample",
  "name": "Sample Plugin",
  "apiVersion": 2,
  "runtime": "server",
  "version": "1.0.0",
  "description": "An example plugin",
  "entry": "sample.html",
  "assets": {
    "html": "sample.html",
    "css": "sample.css",
    "js": "sample.js"
  },
  "navbar": {
    "label": "Sample",
    "icon": "fa-cube"
  }
}
```

`navbar.icon` accepts a Font Awesome 6 solid icon class such as `fa-cube`, `fa-key`, or `fa-network-wired`. If the plugin is enabled, navbar plugins appear in the Plugin Apps group and open at `/plugins/<id>`.

Client-side bundles can set `autoLoadByDefault: true`. The default is applied only
after a trusted plugin is enabled automatically or an administrator explicitly
confirms and enables an untrusted plugin. An existing administrator auto-load
choice is preserved across reinstalls.
When the default is applied, compatible connected clients are loaded immediately;
future clients receive the plugin as they connect.

## Dashboard Badges

Plugins can contribute compact badges to client cards on the main dashboard. Declare the dashboard integration in `config.json`:

```json
{
  "dashboard": {
    "clientBadges": [
      {
        "id": "phone-link",
        "label": "Phone Link",
        "title": "Phone Link detected",
        "icon": "fa-solid fa-mobile-screen-button",
        "imageUrl": "/plugins/example/assets/phone-link.png",
        "tone": "good",
        "priority": 90
      }
    ]
  }
}
```

Badge fields:

| Field | Description |
|-------|-------------|
| `id` | Stable badge id within the plugin. |
| `label` | Short text shown beside the icon when space allows. |
| `title` | Hover text. Defaults to `label`. |
| `icon` | Font Awesome class, used when `imageUrl` is omitted. |
| `imageUrl` | Optional image URL or data URL. Rendered as a small dashboard icon. |
| `href` | Optional link. `{clientId}` and `{pluginId}` are URL-encoded before rendering. Defaults to `/plugins/<id>?clientId=<clientId>`. |
| `tone` | Visual tone: `info`, `good`, `warn`, or `danger`. |
| `priority` | Higher numbers render first when multiple plugin badges exist. |

For per-client state, implement a server plugin RPC named `dashboardContributions`. The dashboard calls it with the visible client IDs:

```ts
export default {
  rpc: {
    async dashboardContributions(ctx, params: { clientIds: string[] }) {
      return {
        contributions: params.clientIds.map((clientId) => ({
          clientId,
          badges: [{
            id: "phone-link",
            label: "Phone Link",
            title: "Phone Link detected",
            icon: "fa-solid fa-mobile-screen-button",
            tone: "good",
            href: "/plugins/example?clientId={clientId}",
            priority: 90
          }]
        }))
      };
    }
  }
};
```

Return no contribution for clients that should not show a badge. Server plugins usually update their own plugin database from `onEvent` and have `dashboardContributions` read that state.

## TypeScript UI And Server Logic

Plugin bundles can ship source-oriented browser and server logic. The server compiles these during extraction:

```json
{
  "apiVersion": 2,
  "uiEntry": "src/browser/main.ts",
  "serverEntry": "src/backend/index.ts"
}
```

Defaults:

| Source file | Output |
|-------------|--------|
| `src/ui.ts` | `assets/<pluginId>.js` |
| `src/server.ts` | `server.js` |

Only files under `src/` are copied for compilation. Extraction does not run `npm install`, download packages, or execute build scripts. Use relative imports and APIs already available in the browser or server plugin runtime.
