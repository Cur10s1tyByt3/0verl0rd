# Browser TypeScript

Browser source lives here and is bundled into `public/assets/generated/` by
`bun run build:web`. Generated assets are ignored by Git and must not be edited
directly.

The development supervisor runs the browser build once and watches this folder.
Production and E2E preparation also run the build before serving assets.

Migrate existing `public/assets/*.js` modules incrementally:

1. Move one leaf/shared module into this directory and add it as a browser
   entrypoint in `package.json`.
2. Keep its public export names stable and update consumers to import from
   `/assets/generated/` (or the equivalent relative path).
3. Add runtime schemas for data crossing HTTP, WebSocket, storage, or plugin
   boundaries; TypeScript types alone do not validate external data.
4. Run `bun run typecheck`, `bun run build:web`, and the affected browser tests.

Do not duplicate or replace the generated wire-protocol types here. Wire changes
must continue through `protocol/wire-contract.json` and its generator.
