import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

type Contract = {
  schemaVersion: number;
  protocolVersion: number;
  encoding: "messagepack";
  compatibility: "additive";
  commandVersioning: {
    defaultVersion: 1;
    overrides: Record<string, {
      latestVersion: number;
      changes: Record<string, {
        breaking: true;
        summary: string;
        migration: string;
      }>;
    }>;
  };
  serverToAgentMessageTypes: string[];
  agentToServerMessageTypes: string[];
  commands: string[];
};

const root = resolve(import.meta.dir, "..");
const contractPath = resolve(root, "protocol", "wire-contract.json");
const tsOutputPath = resolve(root, "Overlord-Server", "src", "generated", "wire-contract.ts");
const goOutputPath = resolve(root, "Overlord-Client", "cmd", "agent", "wire", "wire_contract_generated.go");
const checkOnly = process.argv.includes("--check");

const contract = await Bun.file(contractPath).json() as Contract;

function validateNames(label: string, values: string[]): void {
  const pattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
  const seen = new Set<string>();
  for (const value of values) {
    if (!pattern.test(value)) throw new Error(`${label} contains invalid wire name: ${value}`);
    if (seen.has(value)) throw new Error(`${label} contains duplicate wire name: ${value}`);
    seen.add(value);
  }
}

if (!Number.isInteger(contract.schemaVersion) || contract.schemaVersion < 1) {
  throw new Error("schemaVersion must be a positive integer");
}
if (!Number.isInteger(contract.protocolVersion) || contract.protocolVersion < 1) {
  throw new Error("protocolVersion must be a positive integer");
}
if (contract.encoding !== "messagepack" || contract.compatibility !== "additive") {
  throw new Error("unsupported encoding or compatibility policy");
}
validateNames("serverToAgentMessageTypes", contract.serverToAgentMessageTypes);
validateNames("agentToServerMessageTypes", contract.agentToServerMessageTypes);
validateNames("commands", contract.commands);
if (contract.commandVersioning?.defaultVersion !== 1) {
  throw new Error("commandVersioning.defaultVersion must be 1");
}
for (const [command, override] of Object.entries(contract.commandVersioning.overrides)) {
  if (!contract.commands.includes(command)) {
    throw new Error(`command version override references unknown command: ${command}`);
  }
  if (!Number.isInteger(override.latestVersion) || override.latestVersion < 2) {
    throw new Error(`latestVersion for ${command} must be at least 2`);
  }
  for (let version = 2; version <= override.latestVersion; version += 1) {
    const change = override.changes[String(version)];
    if (
      !change ||
      change.breaking !== true ||
      !change.summary?.trim() ||
      !change.migration?.trim()
    ) {
      throw new Error(`${command} v${version} requires breaking-change summary and migration text`);
    }
  }
  const unexpected = Object.keys(override.changes)
    .filter((value) => !Number.isInteger(Number(value)) || Number(value) < 2 || Number(value) > override.latestVersion);
  if (unexpected.length > 0) {
    throw new Error(`${command} has invalid change versions: ${unexpected.join(", ")}`);
  }
}

const handlerPath = resolve(root, "Overlord-Client", "cmd", "agent", "handlers", "command.go");
const handlerSource = await Bun.file(handlerPath).text();
const handlerCommands = [...handlerSource.matchAll(/^\tcase "([a-z][a-z0-9]*(?:_[a-z0-9]+)*)":/gm)]
  .map((match) => match[1])
  .filter((value, index, values) => values.indexOf(value) === index)
  .sort();
const declaredCommands = [...contract.commands].sort();
const missingFromContract = handlerCommands.filter((value) => !declaredCommands.includes(value));
const missingFromHandler = declaredCommands.filter((value) => !handlerCommands.includes(value));
if (missingFromContract.length > 0 || missingFromHandler.length > 0) {
  throw new Error([
    "wire command catalog and agent dispatcher have drifted",
    missingFromContract.length > 0
      ? `missing from contract: ${missingFromContract.join(", ")}`
      : "",
    missingFromHandler.length > 0
      ? `missing from handler: ${missingFromHandler.join(", ")}`
      : "",
  ].filter(Boolean).join("; "));
}

const allMessageTypes = [...new Set([
  ...contract.serverToAgentMessageTypes,
  ...contract.agentToServerMessageTypes,
])].sort();
const serverMessages = [...contract.serverToAgentMessageTypes].sort();
const agentMessages = [...contract.agentToServerMessageTypes].sort();
const commands = [...contract.commands].sort();
const commandVersionSupport = Object.fromEntries(
  commands.map((command) => [
    command,
    {
      min: 1,
      max: contract.commandVersioning.overrides[command]?.latestVersion ?? 1,
    },
  ]),
) as Record<string, { min: number; max: number }>;

function tsArray(name: string, values: string[]): string {
  return `export const ${name} = ${JSON.stringify(values, null, 2)} as const;\n`;
}

const ts = `// Code generated by scripts/generate-wire-protocol.ts; DO NOT EDIT.

export const WIRE_SCHEMA_VERSION = ${contract.schemaVersion} as const;
export const WIRE_PROTOCOL_VERSION = ${contract.protocolVersion} as const;

${tsArray("WIRE_MESSAGE_TYPES", allMessageTypes)}
export type MessageKind = (typeof WIRE_MESSAGE_TYPES)[number];

${tsArray("SERVER_TO_AGENT_MESSAGE_TYPES", serverMessages)}
export type ServerToAgentMessageType = (typeof SERVER_TO_AGENT_MESSAGE_TYPES)[number];

${tsArray("AGENT_TO_SERVER_MESSAGE_TYPES", agentMessages)}
export type AgentToServerMessageType = (typeof AGENT_TO_SERVER_MESSAGE_TYPES)[number];

${tsArray("COMMAND_TYPES", commands)}
export type CommandType = (typeof COMMAND_TYPES)[number];

export type CommandVersionRange = Readonly<{ min: number; max: number }>;
export const COMMAND_VERSION_SUPPORT = ${JSON.stringify(commandVersionSupport, null, 2)} as const satisfies
  Record<CommandType, CommandVersionRange>;

const commandTypeSet: ReadonlySet<string> = new Set(COMMAND_TYPES);
const agentMessageTypeSet: ReadonlySet<string> = new Set(AGENT_TO_SERVER_MESSAGE_TYPES);

export function isCommandType(value: string): value is CommandType {
  return commandTypeSet.has(value);
}

export function getCommandVersionRange(command: CommandType): CommandVersionRange {
  return COMMAND_VERSION_SUPPORT[command];
}

export function isSupportedCommandVersion(command: CommandType, version: number): boolean {
  const range = getCommandVersionRange(command);
  return Number.isInteger(version) && version >= range.min && version <= range.max;
}

export function getImplicitCommandVersion(command: CommandType): number {
  const range = getCommandVersionRange(command);
  if (range.min !== range.max) {
    throw new Error(
      \`Command \${command} supports versions \${range.min}-\${range.max}; negotiate an explicit commandVersion\`,
    );
  }
  return range.min;
}

export function isAgentToServerMessageType(value: string): value is AgentToServerMessageType {
  return agentMessageTypeSet.has(value);
}
`;

function goName(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

function goConstants(prefix: string, typeName: string, values: string[]): string {
  return values.map((value) => `\t${prefix}${goName(value)} ${typeName} = "${value}"`).join("\n");
}

function goSlice(name: string, typeName: string, prefix: string, values: string[]): string {
  return `var ${name} = [...]${typeName}{\n${values.map((value) => `\t${prefix}${goName(value)},`).join("\n")}\n}`;
}

function goVersionMap(values: string[]): string {
  return values
    .map((value) => {
      const range = commandVersionSupport[value];
      return `\tCommand${goName(value)}: {Min: ${range.min}, Max: ${range.max}},`;
    })
    .join("\n");
}

const go = `// Code generated by scripts/generate-wire-protocol.ts; DO NOT EDIT.

package wire

const (
\tWireSchemaVersion = ${contract.schemaVersion}
\tWireProtocolVersion = ${contract.protocolVersion}
)

type MessageType string

const (
${goConstants("Message", "MessageType", allMessageTypes)}
)

type CommandType string

const (
${goConstants("Command", "CommandType", commands)}
)

${goSlice("AgentToServerMessageTypes", "MessageType", "Message", agentMessages)}

${goSlice("ServerToAgentMessageTypes", "MessageType", "Message", serverMessages)}

${goSlice("CommandTypes", "CommandType", "Command", commands)}

type CommandVersionRange struct {
\tMin int \`msgpack:"min" json:"min"\`
\tMax int \`msgpack:"max" json:"max"\`
}

var CommandVersionSupport = map[CommandType]CommandVersionRange{
${goVersionMap(commands)}
}

var commandTypeSet = func() map[CommandType]struct{} {
\tvalues := make(map[CommandType]struct{}, len(CommandTypes))
\tfor _, value := range CommandTypes {
\t\tvalues[value] = struct{}{}
\t}
\treturn values
}()

var serverToAgentMessageTypeSet = func() map[MessageType]struct{} {
\tvalues := make(map[MessageType]struct{}, len(ServerToAgentMessageTypes))
\tfor _, value := range ServerToAgentMessageTypes {
\t\tvalues[value] = struct{}{}
\t}
\treturn values
}()

func IsCommandType(value string) bool {
\t_, ok := commandTypeSet[CommandType(value)]
\treturn ok
}

func IsSupportedCommandVersion(command string, version int) bool {
\trangeValue, ok := CommandVersionSupport[CommandType(command)]
\treturn ok && version >= rangeValue.Min && version <= rangeValue.Max
}

func SupportedCommandVersionRanges() map[string]CommandVersionRange {
\tvalues := make(map[string]CommandVersionRange, len(CommandVersionSupport))
\tfor command, rangeValue := range CommandVersionSupport {
\t\tvalues[string(command)] = rangeValue
\t}
\treturn values
}

func IsServerToAgentMessageType(value string) bool {
\t_, ok := serverToAgentMessageTypeSet[MessageType(value)]
\treturn ok
}
`;

async function emit(path: string, content: string): Promise<void> {
  if (checkOnly) {
    const current = await Bun.file(path).text().catch(() => "");
    const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, "\n");
    if (normalizeLineEndings(current) !== normalizeLineEndings(content)) {
      console.error(`Generated artifact is stale: ${path}`);
      process.exitCode = 1;
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
  console.log(`Generated ${path}`);
}

await Promise.all([
  emit(tsOutputPath, ts),
  emit(goOutputPath, go),
]);
