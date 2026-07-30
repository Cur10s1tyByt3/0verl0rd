# Wire protocol contract

`wire-contract.json` is the canonical catalog for the MessagePack protocol
shared by the server and agent. Generated TypeScript and Go artifacts must not
be edited directly.

Generate artifacts from the repository root:

```text
bun scripts/generate-wire-protocol.ts
```

Verify that checked-in artifacts match the contract:

```text
bun scripts/generate-wire-protocol.ts --check
```

Protocol version 1 follows additive compatibility:

- Existing message and field meanings may not change.
- New optional fields, message types, and commands may be added.
- Fields may not become required for peers that advertise an older or absent
  protocol version.
- Removing or redefining a wire value requires a new protocol version.

Agents that predate protocol negotiation omit `protocolVersion`; the server
treats them as protocol version 1.

## Command versions

Every command supports version 1 by default. A breaking change must be added
under `commandVersioning.overrides`; an existing command version must never be
edited to introduce a breaking payload or semantic change.

An override declares the latest contiguous version and documents every
breaking transition:

```json
{
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
}
```

Rules:

- Adding an optional field with an unchanged meaning does not require a bump.
- Removing or renaming a field requires a new command version.
- Changing a field type, units, default, valid range, or meaning requires a
  new command version.
- Changing result semantics requires a new command version.
- Versions are contiguous and old handlers remain available while supported.
- A new version requires migration text and compatibility fixtures.
- A command with more than one version may not be encoded implicitly; the
  server must select a mutually supported version for the connected agent.

At target-aware server boundaries, construct envelopes with
`versionCommandForClient`. It selects the highest shared version and throws
before transmission when the agent omitted the command or has no overlapping
range. Generic legacy send sites remain safe while all declared commands have
exactly one version; the encoder refuses implicit encoding as soon as a command
becomes multi-version.
