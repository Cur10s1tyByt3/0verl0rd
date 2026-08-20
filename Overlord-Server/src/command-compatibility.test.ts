import { describe, expect, test } from "bun:test";
import {
  getCommandCompatibility,
  getNegotiatedCommandVersions,
  requireCommandVersion,
  sanitizeCommandVersionRanges,
  versionCommandForClient,
} from "./command-compatibility";

describe("command version negotiation", () => {
  test("sanitizes advertised ranges and ignores unknown commands", () => {
    expect(sanitizeCommandVersionRanges({
      process_list: { min: 1, max: 3 },
      desktop_start: { min: 3, max: 2 },
      not_a_command: { min: 1, max: 1 },
    })).toEqual({
      process_list: { min: 1, max: 3 },
    });
  });

  test("treats pre-3.0 agents as v1 for backward compatibility", () => {
    expect(getCommandCompatibility({}, "process_list")).toEqual({
      supported: true,
      version: 1,
      server: { min: 1, max: 1 },
      agent: { min: 1, max: 1 },
      legacyAssumption: true,
    });
  });

  test("selects the highest shared version", () => {
    const client = {
      commandVersions: {
        process_list: { min: 1, max: 3 },
      },
    };
    expect(requireCommandVersion(client, "process_list")).toBe(1);
    expect(getNegotiatedCommandVersions(client)).toEqual({ process_list: 1 });
    expect(versionCommandForClient(client, {
      type: "command",
      commandType: "process_list",
      id: "command-123",
    })).toMatchObject({
      commandType: "process_list",
      commandVersion: 1,
    });
  });

  test("rejects legacy (v1-only) Backstage agents and negotiates v2/v3 with newer agents", () => {
    const command = "backstage_start_browser_injected" as const;
    const payload = { browser: "chrome", dll: new Uint8Array([1, 2, 3]) };

    // Pre-3.0 agents assume v1, which the server no longer supports.
    expect(getCommandCompatibility({}, command)).toMatchObject({
      supported: false,
      reason: "no_common_version",
    });
    expect(() => requireCommandVersion({}, command)).toThrow("no shared version");

    expect(versionCommandForClient({
      commandVersions: { [command]: { min: 1, max: 2 } },
    }, {
      type: "command",
      commandType: command,
      id: "v2-backstage",
      payload,
    })).toMatchObject({ commandVersion: 2, payload });

    expect(versionCommandForClient({
      commandVersions: { [command]: { min: 2, max: 3 } },
    }, {
      type: "command",
      commandType: command,
      id: "v3-backstage",
      payload,
    })).toMatchObject({ commandVersion: 3, payload });
  });

  test("strictly reports missing commands and non-overlapping versions", () => {
    expect(getCommandCompatibility(
      { commandVersions: {} },
      "process_list",
    )).toMatchObject({
      supported: false,
      reason: "agent_missing_command",
    });

    const incompatible = {
      commandVersions: {
        process_list: { min: 2, max: 3 },
      },
    };
    expect(getCommandCompatibility(incompatible, "process_list")).toMatchObject({
      supported: false,
      reason: "no_common_version",
    });
    expect(() => requireCommandVersion(incompatible, "process_list")).toThrow(
      "no shared version",
    );
  });
});
