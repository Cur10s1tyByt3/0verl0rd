import {
  COMMAND_TYPES,
  COMMAND_VERSION_SUPPORT,
  isCommandType,
  type CommandType,
  type CommandVersionRange,
} from "./generated/wire-contract";
import type { ClientInfo } from "./types";
import type { Command } from "./protocol";

export type CommandCompatibility = {
  supported: boolean;
  version?: number;
  server: CommandVersionRange;
  agent?: CommandVersionRange;
  reason?: "agent_missing_command" | "no_common_version";
  legacyAssumption?: boolean;
};

function cleanPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const result = Math.floor(value);
  return result > 0 && result <= 65_535 ? result : undefined;
}

export function sanitizeCommandVersionRanges(
  value: unknown,
): Partial<Record<CommandType, CommandVersionRange>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Partial<Record<CommandType, CommandVersionRange>> = {};
  let count = 0;
  for (const [name, rawRange] of Object.entries(value as Record<string, unknown>)) {
    if (count >= COMMAND_TYPES.length || !isCommandType(name)) continue;
    if (!rawRange || typeof rawRange !== "object" || Array.isArray(rawRange)) continue;
    const min = cleanPositiveInt((rawRange as any).min);
    const max = cleanPositiveInt((rawRange as any).max);
    if (min === undefined || max === undefined || min > max) continue;
    result[name] = { min, max };
    count += 1;
  }
  return result;
}

export function getCommandCompatibility(
  client: Pick<ClientInfo, "protocolVersion" | "commandVersions">,
  command: CommandType,
): CommandCompatibility {
  const server = COMMAND_VERSION_SUPPORT[command];
  const advertised = client.commandVersions;

  // Pre-3.0 agents did not advertise a catalog. They remain v1 best-effort.
  if (!advertised) {
    const supported = server.min <= 1 && server.max >= 1;
    return supported
      ? { supported: true, version: 1, server, agent: { min: 1, max: 1 }, legacyAssumption: true }
      : { supported: false, server, agent: { min: 1, max: 1 }, reason: "no_common_version", legacyAssumption: true };
  }

  const agent = advertised[command];
  if (!agent) {
    return { supported: false, server, reason: "agent_missing_command" };
  }

  const min = Math.max(server.min, agent.min);
  const max = Math.min(server.max, agent.max);
  if (min > max) {
    return { supported: false, server, agent, reason: "no_common_version" };
  }
  return { supported: true, version: max, server, agent };
}

export function getCommandCompatibilityCatalog(
  client: Pick<ClientInfo, "protocolVersion" | "commandVersions">,
): Record<CommandType, CommandCompatibility> {
  return Object.fromEntries(
    COMMAND_TYPES.map((command) => [command, getCommandCompatibility(client, command)]),
  ) as Record<CommandType, CommandCompatibility>;
}

export function getNegotiatedCommandVersions(
  client: Pick<ClientInfo, "protocolVersion" | "commandVersions">,
): Partial<Record<CommandType, number>> {
  const result: Partial<Record<CommandType, number>> = {};
  for (const command of COMMAND_TYPES) {
    const compatibility = getCommandCompatibility(client, command);
    if (compatibility.supported && compatibility.version !== undefined) {
      result[command] = compatibility.version;
    }
  }
  return result;
}

export function requireCommandVersion(
  client: Pick<ClientInfo, "protocolVersion" | "commandVersions">,
  command: CommandType,
): number {
  const compatibility = getCommandCompatibility(client, command);
  if (!compatibility.supported || compatibility.version === undefined) {
    const reason = compatibility.reason === "agent_missing_command"
      ? "agent does not advertise this command"
      : `no shared version (server ${compatibility.server.min}-${compatibility.server.max}, agent ${compatibility.agent?.min ?? "none"}-${compatibility.agent?.max ?? "none"})`;
    throw new Error(`Command ${command} is unsupported: ${reason}`);
  }
  return compatibility.version;
}

/**
 * Use this at target-aware send boundaries. It fails before transmission when
 * the connected agent does not support the command and pins the negotiated
 * version into the envelope.
 */
export function versionCommandForClient(
  client: Pick<ClientInfo, "protocolVersion" | "commandVersions">,
  command: Command,
): Command {
  return {
    ...command,
    commandVersion: requireCommandVersion(client, command.commandType),
  };
}
