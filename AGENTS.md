# Repository instructions for AI agents

These instructions apply to the entire repository.

## Wire protocol changes

The server and client share a versioned MessagePack contract. Treat
`protocol/wire-contract.json` as the canonical source of truth. Do not manually
edit either generated artifact:

- `Overlord-Server/src/generated/wire-contract.ts`
- `Overlord-Client/cmd/agent/wire/wire_contract_generated.go`

When adding a command or message type, update the appropriate array in
`protocol/wire-contract.json` in the same change as its implementation.

### Breaking changes to a specific command

A breaking change to an existing command must receive a new command version.
Never silently change the version 1 payload or semantics.

Changes that require a new command version include:

- removing or renaming a field;
- changing a field's type, units, default, valid range, or meaning;
- making a previously optional field required;
- changing command result or failure semantics.

For the affected command, update `commandVersioning.overrides` in
`protocol/wire-contract.json`:

1. If the command has no override, add one with `latestVersion: 2`.
2. If it already has an override, increment `latestVersion` by exactly one.
3. Add a `changes` entry whose key is the new version.
4. Set `breaking` to `true` and provide non-empty `summary` and `migration`
   text describing the wire change and how an older payload maps to the new
   one.
5. Keep versions contiguous. Do not delete or rewrite documentation for an
   already released version.

Example for a command moving from version 1 to version 2:

```json
"desktop_start": {
  "latestVersion": 2,
  "changes": {
    "2": {
      "breaking": true,
      "summary": "Replace numeric quality with a named profile",
      "migration": "Map quality 1-40 to low, 41-80 to balanced, and 81-100 to high"
    }
  }
}
```

Implement and retain handlers for every supported version. At target-aware
server send sites, use `versionCommandForClient` so the server selects the
highest mutually supported version. Once a command supports multiple versions,
it must not be encoded without an explicit negotiated `commandVersion`.

Add compatibility tests covering at least:

- the old command version and payload;
- the new command version and payload;
- version negotiation with old and new clients;
- migration or rejection behavior at the compatibility boundary.

Update tests that intentionally assert version ranges, including
`Overlord-Server/src/protocol-contract.test.ts`,
`Overlord-Server/src/command-compatibility.test.ts`, and
`Overlord-Client/cmd/agent/wire/wire_contract_test.go`, when applicable.

### Additive and protocol-wide changes

Adding an optional field without changing existing behavior is additive and
does not require a command-version bump.

Removing or redefining a non-command wire value, changing message framing or
encoding, or otherwise breaking the overall wire contract requires incrementing
`protocolVersion` in `protocol/wire-contract.json`. Preserve compatibility with
older protocol versions or add an explicit rejection path and tests. Increment
`schemaVersion` only when the structure of `wire-contract.json` itself changes;
update `protocol/wire-contract.schema.json` in the same change.

## Generate and verify protocol artifacts

After every edit to `protocol/wire-contract.json`, run these commands from the
repository root:

```text
bun scripts/generate-wire-protocol.ts
bun scripts/generate-wire-protocol.ts --check
```

Commit the JSON contract and both regenerated artifacts together. Before
finishing, also run:

```text
cd Overlord-Server
bun run typecheck
bun test src/protocol-contract.test.ts src/command-compatibility.test.ts

cd ../Overlord-Client
go test ./cmd/agent/wire
```

Run additional focused tests for every server sender, client handler, and
payload migration changed by the new command version. Consult
`protocol/README.md` for the complete compatibility policy.
