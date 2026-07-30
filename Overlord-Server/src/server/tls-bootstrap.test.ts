import { afterEach, describe, expect, test } from "bun:test";
import { createHash, X509Certificate } from "crypto";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  computeCertificateSpkiPin,
  getActiveTlsSpkiPins,
  prepareTlsOptions,
} from "./tls-bootstrap";

const originalPins = process.env.OVERLORD_TLS_SPKI_PINS;
const tempRoots: string[] = [];

afterEach(() => {
  if (originalPins === undefined) delete process.env.OVERLORD_TLS_SPKI_PINS;
  else process.env.OVERLORD_TLS_SPKI_PINS = originalPins;
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("TLS identity pin bootstrap", () => {
  test("creates a self-signed certificate and publishes its SPKI pin", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "overlord-tls-pin-"));
    tempRoots.push(root);
    const certPath = path.join(root, "server.crt");
    const keyPath = path.join(root, "server.key");
    const rotationPin = Buffer.alloc(32, 0x42).toString("base64");
    process.env.OVERLORD_TLS_SPKI_PINS =
      `sha256/${rotationPin},invalid,${rotationPin}`;

    const result = await prepareTlsOptions({ certPath, keyPath });
    const certificatePem = readFileSync(certPath, "utf8");
    const certificate = new X509Certificate(certificatePem);
    const expectedPin = createHash("sha256")
      .update(certificate.publicKey.export({ type: "spki", format: "der" }))
      .digest("base64");

    expect(result.source).toBe("self-signed");
    expect(result.tlsOptions.cert).toBe(certificatePem);
    expect(computeCertificateSpkiPin(certificatePem)).toBe(expectedPin);
    expect(getActiveTlsSpkiPins()).toEqual([expectedPin, rotationPin]);
  });
});
