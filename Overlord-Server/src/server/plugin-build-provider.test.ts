import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { installProviderArtifacts, providerStagingDirectory } from "./plugin-build-provider";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "overlord-provider-test-"));
  roots.push(root);
  const buildId = "12345678-1234-1234-1234-123456789abc";
  const stagingDir = providerStagingDirectory(root, buildId);
  const outputDir = join(root, "dist-clients");
  await mkdir(stagingDir, { recursive: true });
  return { root, buildId, stagingDir, outputDir };
}

describe("plugin build provider artifacts", () => {
  test("installs validated artifacts with a unique build suffix", async () => {
    const dirs = await fixture();
    await writeFile(join(dirs.stagingDir, "lite.exe"), "rust-lite");

    const files = installProviderArtifacts({
      result: { artifacts: [{ filename: "lite.exe", platform: "windows-amd64", version: "0.1.0" }] },
      stagingDir: dirs.stagingDir,
      outputDir: dirs.outputDir,
      buildId: dirs.buildId,
      requestedPlatforms: ["windows-amd64"],
      sanitizeOutputName: (name) => name.replace(/[^A-Za-z0-9._-]/g, ""),
    });

    expect(files).toEqual([{
      name: "lite.exe",
      filename: "lite-12345678.exe",
      platform: "windows-amd64",
      version: "0.1.0",
      size: 9,
    }]);
  });

  test("rejects traversal and unrequested platforms", async () => {
    const dirs = await fixture();
    await writeFile(join(dirs.root, "outside.exe"), "outside");
    expect(() => installProviderArtifacts({
      result: { artifacts: [{ path: "../../../outside.exe", filename: "outside.exe", platform: "windows-amd64" }] },
      stagingDir: dirs.stagingDir,
      outputDir: dirs.outputDir,
      buildId: dirs.buildId,
      requestedPlatforms: ["windows-amd64"],
      sanitizeOutputName: (name) => name,
    })).toThrow("escaped");

    await writeFile(join(dirs.stagingDir, "lite"), "lite");
    expect(() => installProviderArtifacts({
      result: { artifacts: [{ filename: "lite", platform: "linux-arm64" }] },
      stagingDir: dirs.stagingDir,
      outputDir: dirs.outputDir,
      buildId: dirs.buildId,
      requestedPlatforms: ["linux-amd64"],
      sanitizeOutputName: (name) => name,
    })).toThrow("unrequested platform");
  });
});
