import { describe, expect, test } from "bun:test";
import {
  AGENT_TO_SERVER_MESSAGE_TYPES,
  COMMAND_TYPES,
  COMMAND_VERSION_SUPPORT,
  WIRE_PROTOCOL_VERSION,
  getImplicitCommandVersion,
  isAgentToServerMessageType,
  isCommandType,
  isSupportedCommandVersion,
} from "./generated/wire-contract";
import {
  ALLOWED_CLIENT_MESSAGE_TYPES,
  isAllowedClientMessageType,
} from "./wsValidation";

describe("generated wire protocol contract", () => {
  test("publishes the complete command catalog", () => {
    expect(WIRE_PROTOCOL_VERSION).toBe(1);
    expect(COMMAND_TYPES.length).toBe(142);
    expect(new Set(COMMAND_TYPES).size).toBe(COMMAND_TYPES.length);
    expect(isCommandType("desktop_start")).toBe(true);
    expect(isCommandType("virtual_window_list")).toBe(true);
    expect(isCommandType("not_a_command")).toBe(false);
  });

  test("publishes a version range for every command", () => {
    expect(Object.keys(COMMAND_VERSION_SUPPORT).length).toBe(COMMAND_TYPES.length);
    for (const command of COMMAND_TYPES) {
      expect(COMMAND_VERSION_SUPPORT[command]).toEqual({ min: 1, max: 1 });
      expect(isSupportedCommandVersion(command, 1)).toBe(true);
      expect(isSupportedCommandVersion(command, 2)).toBe(false);
      expect(getImplicitCommandVersion(command)).toBe(1);
    }
  });

  test("drives the inbound client allowlist", () => {
    expect([...ALLOWED_CLIENT_MESSAGE_TYPES].sort()).toEqual(
      [...AGENT_TO_SERVER_MESSAGE_TYPES].sort(),
    );
    expect(isAgentToServerMessageType("hello")).toBe(true);
    expect(isAllowedClientMessageType("hello")).toBe(true);
    expect(isAllowedClientMessageType("hello_ack")).toBe(false);
  });
});
