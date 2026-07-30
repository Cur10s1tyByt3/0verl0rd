import { afterAll, describe, expect, test } from "bun:test";
import AdmZip from "adm-zip";
import Database from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { generateSelfSignedCert } from "../certGenerator";
import {
  applyPendingServerRestore,
  createDatabaseSnapshot,
  createPortableServerBackup,
  stagePortableServerRestore,
  type ServerBackupPaths,
} from "./server-backup";

const roots: string[] = [];
const BACKUP_INTEGRATION_TIMEOUT_MS = 15_000;

function tempRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), label));
  roots.push(root);
  return root;
}

function pathsAt(root: string): ServerBackupPaths {
  return {
    dataDir: path.join(root, "data"),
    pluginRoot: path.join(root, "plugins"),
    tlsCertPath: path.join(root, "certs", "server.crt"),
    tlsKeyPath: path.join(root, "certs", "server.key"),
    tlsCaPath: path.join(root, "certs", "ca.crt"),
  };
}

function createSourceDatabase(databasePath: string): Database {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE clients (id TEXT PRIMARY KEY, nickname TEXT);
    INSERT INTO users (id, username) VALUES (7, 'portable-admin');
    INSERT INTO clients (id, nickname) VALUES ('agent-1', 'portable-agent');
  `);
  return database;
}

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("portable server backup", () => {
  test("round-trips database, identity, secrets, plugins, and persistent files", async () => {
    const source = pathsAt(tempRoot("overlord-backup-source-"));
    mkdirSync(source.dataDir, { recursive: true });
    mkdirSync(path.join(source.dataDir, "file-share"), { recursive: true });
    mkdirSync(path.join(source.pluginRoot, "example", "data"), { recursive: true });
    writeFileSync(path.join(source.dataDir, "save.json"), JSON.stringify({
      auth: { jwtSecret: "jwt-secret", agentToken: "agent-token" },
      buildSigning: { privateKey: "build-private", publicKey: "build-public" },
      clientLogs: { privateKey: "log-private", publicKey: "log-public" },
    }));
    writeFileSync(path.join(source.dataDir, "vapid-keys.json"), '{"publicKey":"vapid-public","privateKey":"vapid-private"}');
    writeFileSync(path.join(source.dataDir, "file-share", "payload.txt"), "portable file");
    writeFileSync(path.join(source.pluginRoot, ".plugin-state.json"), '{"example":{"enabled":true}}');
    writeFileSync(path.join(source.pluginRoot, "example", "data", "state.json"), '{"value":42}');
    await generateSelfSignedCert({
      certPath: source.tlsCertPath,
      keyPath: source.tlsKeyPath,
      commonName: "localhost",
      daysValid: 3650,
    });

    const sourceDatabase = createSourceDatabase(path.join(source.dataDir, "overlord.db"));
    const snapshot = createDatabaseSnapshot(sourceDatabase);
    sourceDatabase.close();
    const configSnapshot = Buffer.from(JSON.stringify({
      tls: {
        certPath: "/old-machine/certs/server.crt",
        keyPath: "/old-machine/certs/server.key",
        certbot: { enabled: true },
      },
      appearance: { customCSS: "body{}" },
    }));
    const archive = createPortableServerBackup(source, "3.0.0", snapshot, configSnapshot);

    const destination = pathsAt(tempRoot("overlord-backup-destination-"));
    mkdirSync(destination.dataDir, { recursive: true });
    writeFileSync(path.join(destination.dataDir, "save.json"), '{"old":true}');
    const staged = stagePortableServerRestore(archive, destination, "3.0.0");
    expect(staged.restartRequired).toBe(true);
    expect(staged.serverVersion).toBe("3.0.0");
    expect(existsSync(path.join(destination.dataDir, ".pending-server-restore.json"))).toBe(true);

    expect(applyPendingServerRestore(destination)).toBe(true);
    expect(readFileSync(destination.tlsCertPath)).toEqual(readFileSync(source.tlsCertPath));
    expect(readFileSync(destination.tlsKeyPath)).toEqual(readFileSync(source.tlsKeyPath));
    expect(readFileSync(path.join(destination.dataDir, "file-share", "payload.txt"), "utf8")).toBe("portable file");
    expect(readFileSync(path.join(destination.pluginRoot, "example", "data", "state.json"), "utf8")).toBe('{"value":42}');

    const restoredConfig = JSON.parse(readFileSync(path.join(destination.dataDir, "config.json"), "utf8"));
    expect(restoredConfig.tls.certPath).toBe(destination.tlsCertPath);
    expect(restoredConfig.tls.keyPath).toBe(destination.tlsKeyPath);
    expect(restoredConfig.tls.certbot.enabled).toBe(false);

    const restoredDatabase = new Database(path.join(destination.dataDir, "overlord.db"), { readonly: true });
    expect(restoredDatabase.query("SELECT username FROM users WHERE id = 7").get()).toEqual({
      username: "portable-admin",
    });
    expect(restoredDatabase.query("SELECT nickname FROM clients WHERE id = 'agent-1'").get()).toEqual({
      nickname: "portable-agent",
    });
    restoredDatabase.close();
    expect(applyPendingServerRestore(destination)).toBe(false);
  }, BACKUP_INTEGRATION_TIMEOUT_MS);

  test("rejects a modified archive before staging any restore", async () => {
    const source = pathsAt(tempRoot("overlord-backup-tamper-source-"));
    mkdirSync(source.dataDir, { recursive: true });
    writeFileSync(path.join(source.dataDir, "save.json"), '{"auth":{"jwtSecret":"a","agentToken":"b"}}');
    await generateSelfSignedCert({
      certPath: source.tlsCertPath,
      keyPath: source.tlsKeyPath,
      commonName: "localhost",
    });
    const database = createSourceDatabase(path.join(source.dataDir, "overlord.db"));
    const archive = createPortableServerBackup(
      source,
      "3.0.0",
      createDatabaseSnapshot(database),
      Buffer.from('{"tls":{}}'),
    );
    database.close();

    const originalZip = new AdmZip(archive);
    const tamperedZip = new AdmZip();
    for (const entry of originalZip.getEntries()) {
      if (entry.isDirectory) continue;
      tamperedZip.addFile(
        entry.entryName,
        entry.entryName === "data/save.json" ? Buffer.from('{"tampered":true}') : entry.getData(),
      );
    }

    const destination = pathsAt(tempRoot("overlord-backup-tamper-destination-"));
    mkdirSync(destination.dataDir, { recursive: true });
    writeFileSync(path.join(destination.dataDir, "save.json"), '{"keep":"current"}');
    expect(() => stagePortableServerRestore(tamperedZip.toBuffer(), destination)).toThrow(
      "checksum validation failed",
    );
    expect(existsSync(path.join(destination.dataDir, ".pending-server-restore.json"))).toBe(false);
    expect(readFileSync(path.join(destination.dataDir, "save.json"), "utf8")).toBe('{"keep":"current"}');

    const newerZip = new AdmZip();
    for (const entry of originalZip.getEntries()) {
      if (entry.isDirectory) continue;
      if (entry.entryName === "manifest.json") {
        const manifest = JSON.parse(entry.getData().toString("utf8"));
        manifest.serverVersion = "4.0.0";
        newerZip.addFile(entry.entryName, Buffer.from(JSON.stringify(manifest)));
      } else {
        newerZip.addFile(entry.entryName, entry.getData());
      }
    }
    expect(() => stagePortableServerRestore(newerZip.toBuffer(), destination, "3.0.0")).toThrow(
      "created by newer server 4.0.0",
    );
    expect(existsSync(path.join(destination.dataDir, ".pending-server-restore.json"))).toBe(false);

    const unsafeZip = new AdmZip(archive);
    unsafeZip.addFile("../outside.txt", Buffer.from("must not escape"));
    expect(() => stagePortableServerRestore(unsafeZip.toBuffer(), destination, "3.0.0")).toThrow();
    expect(existsSync(path.join(path.dirname(destination.dataDir), "outside.txt"))).toBe(false);
    expect(existsSync(path.join(destination.dataDir, ".pending-server-restore.json"))).toBe(false);
  }, BACKUP_INTEGRATION_TIMEOUT_MS);
});
