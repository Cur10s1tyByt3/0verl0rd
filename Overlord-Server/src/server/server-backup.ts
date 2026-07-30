import AdmZip from "adm-zip";
import Database from "bun:sqlite";
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { ensureDataDir } from "../paths";
import { resolveRuntimeRoot } from "./runtime-paths";

const BACKUP_SCHEMA = "overlord-server-backup";
const BACKUP_FORMAT_VERSION = 1;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRY_COUNT = 20_000;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const PENDING_MARKER = ".pending-server-restore.json";

type BackupEntry = {
  path: string;
  size: number;
  sha256: string;
  required: boolean;
};

type BackupManifest = {
  schema: typeof BACKUP_SCHEMA;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  serverVersion: string;
  exportedAt: string;
  entries: BackupEntry[];
};

export type ServerBackupPaths = {
  dataDir: string;
  pluginRoot: string;
  tlsCertPath: string;
  tlsKeyPath: string;
  tlsCaPath?: string;
};

const DATA_FILES = ["config.json", "save.json", "vapid-keys.json"] as const;
const DATA_DIRECTORIES = ["file-share", "deploy", "winre", "rd-recordings", "macos-sdk-uploads"] as const;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe backup entry path: ${value}`);
  }
  return normalized;
}

function isAllowedArchivePath(entryPath: string): boolean {
  if (entryPath === "data/overlord.db") return true;
  if (DATA_FILES.some((name) => entryPath === `data/${name}`)) return true;
  if (entryPath === "tls/server.crt" || entryPath === "tls/server.key" || entryPath === "tls/ca.crt") return true;
  if (entryPath.startsWith("plugins/")) return true;
  return DATA_DIRECTORIES.some((name) => entryPath.startsWith(`data/${name}/`));
}

function addArchiveFile(
  zip: AdmZip,
  manifestEntries: BackupEntry[],
  entryPath: string,
  bytes: Buffer,
  required: boolean,
): void {
  const safePath = normalizeArchivePath(entryPath);
  if (!isAllowedArchivePath(safePath)) {
    throw new Error(`Backup entry is outside the portable server allowlist: ${safePath}`);
  }
  if (bytes.length > MAX_ENTRY_BYTES) {
    throw new Error(`Backup entry exceeds the ${MAX_ENTRY_BYTES} byte limit: ${safePath}`);
  }
  zip.addFile(safePath, bytes);
  manifestEntries.push({
    path: safePath,
    size: bytes.length,
    sha256: sha256(bytes),
    required,
  });
}

function addDirectory(
  zip: AdmZip,
  manifestEntries: BackupEntry[],
  sourceRoot: string,
  archiveRoot: string,
): void {
  if (!existsSync(sourceRoot)) return;
  const walk = (current: string, relative: string): void => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const sourcePath = path.join(current, item.name);
      const relativePath = relative ? `${relative}/${item.name}` : item.name;
      const archivePath = `${archiveRoot}/${relativePath}`;
      const stat = lstatSync(sourcePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to back up symbolic link: ${sourcePath}`);
      }
      if (stat.isDirectory()) {
        walk(sourcePath, relativePath);
      } else if (stat.isFile()) {
        addArchiveFile(zip, manifestEntries, archivePath, readFileSync(sourcePath), false);
      }
    }
  };
  walk(sourceRoot, "");
}

function validateTlsIdentity(certPem: Buffer, keyPem: Buffer): void {
  const certificate = new X509Certificate(certPem);
  const certificateSpki = certificate.publicKey.export({ type: "spki", format: "der" });
  const keySpki = createPublicKey(createPrivateKey(keyPem)).export({ type: "spki", format: "der" });
  if (!Buffer.from(certificateSpki).equals(Buffer.from(keySpki))) {
    throw new Error("TLS certificate and private key do not match");
  }
}

export function resolveServerBackupPaths(overrides: Partial<ServerBackupPaths> = {}): ServerBackupPaths {
  const dataDir = path.resolve(overrides.dataDir || ensureDataDir());
  const runtimeRoot = resolveRuntimeRoot();
  return {
    dataDir,
    pluginRoot: path.resolve(
      overrides.pluginRoot ||
      process.env.OVERLORD_PLUGIN_ROOT?.trim() ||
      path.join(runtimeRoot, "plugins"),
    ),
    tlsCertPath: path.resolve(
      overrides.tlsCertPath ||
      process.env.OVERLORD_TLS_CERT?.trim() ||
      "./certs/server.crt",
    ),
    tlsKeyPath: path.resolve(
      overrides.tlsKeyPath ||
      process.env.OVERLORD_TLS_KEY?.trim() ||
      "./certs/server.key",
    ),
    tlsCaPath: path.resolve(
      overrides.tlsCaPath ||
      process.env.OVERLORD_TLS_CA?.trim() ||
      "./certs/ca.crt",
    ),
  };
}

export function createDatabaseSnapshot(database: { exec: (sql: string) => unknown }): Buffer {
  const root = mkdtempSync(path.join(tmpdir(), "overlord-db-backup-"));
  const snapshotPath = path.join(root, "overlord.db");
  try {
    database.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
    return readFileSync(snapshotPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function createPortableServerBackup(
  paths: ServerBackupPaths,
  serverVersion: string,
  databaseSnapshot: Buffer,
  configSnapshot?: Buffer,
): Buffer {
  if (!existsSync(paths.tlsCertPath) || !existsSync(paths.tlsKeyPath)) {
    throw new Error("TLS certificate and private key are required for a portable server backup");
  }

  const cert = readFileSync(paths.tlsCertPath);
  const key = readFileSync(paths.tlsKeyPath);
  validateTlsIdentity(cert, key);

  const zip = new AdmZip();
  const entries: BackupEntry[] = [];
  addArchiveFile(zip, entries, "data/overlord.db", databaseSnapshot, true);
  addArchiveFile(zip, entries, "tls/server.crt", cert, true);
  addArchiveFile(zip, entries, "tls/server.key", key, true);

  if (paths.tlsCaPath && existsSync(paths.tlsCaPath)) {
    addArchiveFile(zip, entries, "tls/ca.crt", readFileSync(paths.tlsCaPath), false);
  }
  for (const name of DATA_FILES) {
    const filePath = path.join(paths.dataDir, name);
    if (name === "config.json" && configSnapshot) {
      JSON.parse(configSnapshot.toString("utf8"));
      addArchiveFile(zip, entries, "data/config.json", configSnapshot, true);
    } else if (existsSync(filePath)) {
      addArchiveFile(zip, entries, `data/${name}`, readFileSync(filePath), name !== "vapid-keys.json");
    } else if (name !== "vapid-keys.json") {
      throw new Error(`Required server state file is missing: ${filePath}`);
    }
  }
  for (const name of DATA_DIRECTORIES) {
    addDirectory(zip, entries, path.join(paths.dataDir, name), `data/${name}`);
  }
  addDirectory(zip, entries, paths.pluginRoot, "plugins");

  if (entries.length > MAX_ENTRY_COUNT) {
    throw new Error(`Backup contains too many files (${entries.length}; max ${MAX_ENTRY_COUNT})`);
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`Backup contents exceed the ${MAX_TOTAL_BYTES} byte limit`);
  }

  const manifest: BackupManifest = {
    schema: BACKUP_SCHEMA,
    formatVersion: BACKUP_FORMAT_VERSION,
    serverVersion,
    exportedAt: new Date().toISOString(),
    entries,
  };
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  const archive = zip.toBuffer();
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error(`Compressed backup exceeds the ${MAX_ARCHIVE_BYTES} byte limit`);
  }
  return archive;
}

function parseAndValidateArchive(archive: Buffer): {
  manifest: BackupManifest;
  files: Map<string, Buffer>;
} {
  if (archive.length === 0 || archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error("Backup archive is empty or exceeds the maximum size");
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(archive);
  } catch {
    throw new Error("Backup is not a valid ZIP archive");
  }
  const zipEntries = zip.getEntries().filter((entry) => !entry.isDirectory);
  if (zipEntries.length > MAX_ENTRY_COUNT + 1) {
    throw new Error("Backup contains too many entries");
  }
  let declaredUncompressedBytes = 0;
  for (const entry of zipEntries) {
    const declaredSize = Number(entry.header?.size);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > MAX_ENTRY_BYTES) {
      throw new Error(`Backup entry has an invalid or excessive declared size: ${entry.entryName}`);
    }
    declaredUncompressedBytes += declaredSize;
    if (declaredUncompressedBytes > MAX_TOTAL_BYTES + 1024 * 1024) {
      throw new Error("Backup declares excessive uncompressed content");
    }
  }

  const entryMap = new Map<string, Buffer>();
  for (const entry of zipEntries) {
    const safePath = normalizeArchivePath(entry.entryName);
    if (entryMap.has(safePath)) throw new Error(`Duplicate backup entry: ${safePath}`);
    const bytes = entry.getData();
    if (bytes.length > MAX_ENTRY_BYTES) throw new Error(`Backup entry is too large: ${safePath}`);
    entryMap.set(safePath, bytes);
  }

  const manifestBytes = entryMap.get("manifest.json");
  if (!manifestBytes || manifestBytes.length > 1024 * 1024) {
    throw new Error("Backup manifest is missing or too large");
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Backup manifest is invalid JSON");
  }
  if (manifest.schema !== BACKUP_SCHEMA || manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("Unsupported server backup format");
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length > MAX_ENTRY_COUNT) {
    throw new Error("Backup manifest entries are invalid");
  }

  const files = new Map<string, Buffer>();
  let totalBytes = 0;
  const declared = new Set<string>();
  for (const item of manifest.entries) {
    if (!item || typeof item !== "object") throw new Error("Invalid backup manifest entry");
    const safePath = normalizeArchivePath(String(item.path || ""));
    if (!isAllowedArchivePath(safePath) || declared.has(safePath)) {
      throw new Error(`Invalid or duplicate manifest path: ${safePath}`);
    }
    declared.add(safePath);
    const bytes = entryMap.get(safePath);
    if (!bytes) throw new Error(`Backup entry is missing: ${safePath}`);
    if (bytes.length !== item.size || sha256(bytes) !== item.sha256) {
      throw new Error(`Backup checksum validation failed: ${safePath}`);
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Uncompressed backup exceeds the maximum size");
    files.set(safePath, bytes);
  }
  for (const entryPath of entryMap.keys()) {
    if (entryPath !== "manifest.json" && !declared.has(entryPath)) {
      throw new Error(`Undeclared backup entry: ${entryPath}`);
    }
  }
  for (const required of ["data/overlord.db", "data/config.json", "data/save.json", "tls/server.crt", "tls/server.key"]) {
    if (!files.has(required)) throw new Error(`Required backup entry is missing: ${required}`);
  }

  validateTlsIdentity(files.get("tls/server.crt")!, files.get("tls/server.key")!);
  JSON.parse(files.get("data/config.json")!.toString("utf8"));
  JSON.parse(files.get("data/save.json")!.toString("utf8"));
  return { manifest, files };
}

function validateDatabase(bytes: Buffer): void {
  const root = mkdtempSync(path.join(tmpdir(), "overlord-db-validate-"));
  const databasePath = path.join(root, "overlord.db");
  try {
    writeFileSync(databasePath, bytes, { mode: 0o600 });
    const database = new Database(databasePath, { readonly: true });
    try {
      const result = database.query("PRAGMA quick_check").get() as Record<string, unknown> | null;
      if (!result || !Object.values(result).includes("ok")) {
        throw new Error("SQLite integrity check did not return ok");
      }
      const tables = database
        .query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const names = new Set(tables.map((row) => row.name));
      if (!names.has("users") || !names.has("clients")) {
        throw new Error("Backup database does not contain the required Overlord schema");
      }
    } finally {
      database.close();
    }
  } catch (error) {
    throw new Error(`Backup database validation failed: ${(error as Error).message}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeStagedFiles(stageRoot: string, files: Map<string, Buffer>): void {
  for (const [entryPath, bytes] of files) {
    const destination = path.join(stageRoot, ...entryPath.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { mode: entryPath.endsWith(".key") || entryPath === "data/save.json" ? 0o600 : 0o644 });
  }
}

export function stagePortableServerRestore(
  archive: Buffer,
  paths: ServerBackupPaths,
  currentServerVersion?: string,
): { restartRequired: true; serverVersion: string; files: number; warnings: string[] } {
  const { manifest, files } = parseAndValidateArchive(archive);
  if (currentServerVersion && compareVersions(manifest.serverVersion, currentServerVersion) > 0) {
    throw new Error(
      `Backup was created by newer server ${manifest.serverVersion}; upgrade this server (${currentServerVersion}) before restoring`,
    );
  }
  validateDatabase(files.get("data/overlord.db")!);

  const restoredConfig = JSON.parse(files.get("data/config.json")!.toString("utf8"));
  restoredConfig.tls = {
    ...(restoredConfig.tls && typeof restoredConfig.tls === "object" ? restoredConfig.tls : {}),
    certPath: paths.tlsCertPath,
    keyPath: paths.tlsKeyPath,
    caPath: files.has("tls/ca.crt") ? paths.tlsCaPath : "",
    certbot: {
      ...(restoredConfig.tls?.certbot && typeof restoredConfig.tls.certbot === "object"
        ? restoredConfig.tls.certbot
        : {}),
      enabled: false,
    },
  };
  const portableConfig = Buffer.from(JSON.stringify(restoredConfig, null, 2));
  files.set("data/config.json", portableConfig);
  const configEntry = manifest.entries.find((entry) => entry.path === "data/config.json")!;
  configEntry.size = portableConfig.length;
  configEntry.sha256 = sha256(portableConfig);

  mkdirSync(paths.dataDir, { recursive: true });
  const markerPath = path.join(paths.dataDir, PENDING_MARKER);
  if (existsSync(markerPath)) {
    throw new Error("A server restore is already pending; restart the server before importing another backup");
  }
  const stageRoot = mkdtempSync(path.join(paths.dataDir, ".server-restore-stage-"));
  try {
    writeStagedFiles(stageRoot, files);
    writeFileSync(path.join(stageRoot, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const markerTemp = `${markerPath}.tmp`;
    writeFileSync(markerTemp, JSON.stringify({
      schema: BACKUP_SCHEMA,
      formatVersion: BACKUP_FORMAT_VERSION,
      stageDirectory: path.basename(stageRoot),
      stagedAt: new Date().toISOString(),
    }), { mode: 0o600 });
    renameSync(markerTemp, markerPath);
  } catch (error) {
    rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }

  const warnings: string[] = [];
  if (String(process.env.JWT_SECRET || "").trim() || String(process.env.OVERLORD_AGENT_TOKEN || "").trim()) {
    warnings.push("JWT_SECRET or OVERLORD_AGENT_TOKEN environment overrides will take priority over restored identity secrets.");
  }
  return {
    restartRequired: true,
    serverVersion: manifest.serverVersion,
    files: files.size,
    warnings,
  };
}

function replaceFile(source: string, destination: string, rollbackRoot: string, label: string): void {
  mkdirSync(path.dirname(destination), { recursive: true });
  const rollback = path.join(rollbackRoot, label);
  mkdirSync(path.dirname(rollback), { recursive: true });
  const incoming = `${destination}.restore-incoming`;
  const hadDestination = existsSync(destination);
  if (hadDestination) renameSync(destination, rollback);
  try {
    copyFileSync(source, incoming);
    chmodSync(incoming, destination.endsWith(".key") || destination.endsWith("save.json") ? 0o600 : 0o644);
    renameSync(incoming, destination);
  } catch (error) {
    rmSync(incoming, { force: true });
    if (hadDestination && existsSync(rollback) && !existsSync(destination)) {
      renameSync(rollback, destination);
    }
    throw error;
  }
}

function replaceDirectory(source: string, destination: string, rollbackRoot: string, label: string): void {
  const rollback = path.join(rollbackRoot, label);
  mkdirSync(path.dirname(destination), { recursive: true });
  mkdirSync(path.dirname(rollback), { recursive: true });
  const incoming = `${destination}.restore-incoming`;
  const hadDestination = existsSync(destination);
  if (hadDestination) renameSync(destination, rollback);
  try {
    if (existsSync(source)) {
      cpSync(source, incoming, { recursive: true, errorOnExist: true });
      renameSync(incoming, destination);
    } else {
      mkdirSync(destination, { recursive: true });
    }
  } catch (error) {
    rmSync(incoming, { recursive: true, force: true });
    if (hadDestination && existsSync(rollback) && !existsSync(destination)) {
      renameSync(rollback, destination);
    }
    throw error;
  }
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] | null => {
    const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function applyPendingServerRestore(overrides: Partial<ServerBackupPaths> = {}): boolean {
  const paths = resolveServerBackupPaths(overrides);
  const markerPath = path.join(paths.dataDir, PENDING_MARKER);
  if (!existsSync(markerPath)) return false;

  const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
    schema?: string;
    formatVersion?: number;
    stageDirectory?: string;
  };
  if (
    marker.schema !== BACKUP_SCHEMA ||
    marker.formatVersion !== BACKUP_FORMAT_VERSION ||
    !marker.stageDirectory ||
    path.basename(marker.stageDirectory) !== marker.stageDirectory ||
    !marker.stageDirectory.startsWith(".server-restore-stage-")
  ) {
    throw new Error("Pending server restore marker is invalid");
  }
  const stageRoot = path.join(paths.dataDir, marker.stageDirectory);
  const manifestPath = path.join(stageRoot, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("Pending server restore staging directory is incomplete");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  const stagedZip = new AdmZip();
  for (const entry of manifest.entries) {
    const source = path.join(stageRoot, ...normalizeArchivePath(entry.path).split("/"));
    if (!existsSync(source)) throw new Error(`Pending restore entry is missing: ${entry.path}`);
    const bytes = readFileSync(source);
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
      throw new Error(`Pending restore checksum failed: ${entry.path}`);
    }
    stagedZip.addFile(entry.path, bytes);
  }
  stagedZip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest)));
  parseAndValidateArchive(stagedZip.toBuffer());

  const rollbackRoot = mkdtempSync(path.join(paths.dataDir, ".server-restore-rollback-"));
  const completed: Array<{ destination: string; rollback: string; directory: boolean }> = [];
  const replaceTracked = (source: string, destination: string, label: string, directory: boolean) => {
    const rollback = path.join(rollbackRoot, label);
    if (directory) replaceDirectory(source, destination, rollbackRoot, label);
    else replaceFile(source, destination, rollbackRoot, label);
    completed.push({ destination, rollback, directory });
  };

  try {
    replaceTracked(path.join(stageRoot, "data", "overlord.db"), path.join(paths.dataDir, "overlord.db"), "data/overlord.db", false);
    for (const name of DATA_FILES) {
      const source = path.join(stageRoot, "data", name);
      if (existsSync(source)) replaceTracked(source, path.join(paths.dataDir, name), `data/${name}`, false);
    }
    for (const name of DATA_DIRECTORIES) {
      replaceTracked(path.join(stageRoot, "data", name), path.join(paths.dataDir, name), `data/${name}`, true);
    }
    replaceTracked(path.join(stageRoot, "plugins"), paths.pluginRoot, "plugins", true);
    replaceTracked(path.join(stageRoot, "tls", "server.crt"), paths.tlsCertPath, "tls/server.crt", false);
    replaceTracked(path.join(stageRoot, "tls", "server.key"), paths.tlsKeyPath, "tls/server.key", false);
    const stagedCa = path.join(stageRoot, "tls", "ca.crt");
    if (paths.tlsCaPath && existsSync(stagedCa)) {
      replaceTracked(stagedCa, paths.tlsCaPath, "tls/ca.crt", false);
    }
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = path.join(paths.dataDir, `overlord.db${suffix}`);
      if (existsSync(sidecar)) rmSync(sidecar, { force: true });
    }
    rmSync(markerPath, { force: true });
    rmSync(stageRoot, { recursive: true, force: true });
    rmSync(rollbackRoot, { recursive: true, force: true });
    return true;
  } catch (error) {
    for (const item of completed.reverse()) {
      try {
        rmSync(item.destination, { recursive: item.directory, force: true });
        if (existsSync(item.rollback)) {
          mkdirSync(path.dirname(item.destination), { recursive: true });
          renameSync(item.rollback, item.destination);
        }
      } catch {}
    }
    throw new Error(`Server restore failed and was rolled back: ${(error as Error).message}`);
  }
}
