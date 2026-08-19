import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createPluginRuntime } from "./runtime";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("plugin build providers", () => {
  test("streams provider output and returns its artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "overlord-plugin-runtime-test-"));
    roots.push(root);
    const pluginDir = join(root, "provider");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "server.js"), `
      export default {
        onBuild(ctx, payload) {
          ctx.build.status("Compiling test provider", 35, 42);
          ctx.build.output("cargo output", "success");
          return { artifacts: [{ filename: payload.filename, platform: "windows-amd64" }] };
        }
      };
    `);

    const errors: string[] = [];
    const runtime = createPluginRuntime({
      pluginRoot: root,
      workerHostUrl: new URL("./worker-host.ts", import.meta.url).href,
      setLastError: (_pluginId, error) => errors.push(error),
    });
    try {
      await runtime.startPlugin("provider");
      const output: any[] = [];
      const result = await runtime.runBuildProvider(
        "provider",
        { filename: "lite.exe" },
        (event) => output.push(event),
      );

      expect(result).toEqual({
        artifacts: [{ filename: "lite.exe", platform: "windows-amd64" }],
      });
      expect(output).toEqual([
        { event: "status", text: "Compiling test provider", level: undefined, progress: 35, etaSeconds: 42 },
        { event: "output", text: "cargo output", level: "success" },
      ]);
      expect(errors).toEqual([]);
    } finally {
      await runtime.shutdownAll();
    }
  });

  test("rejects immediately when a stale worker lacks build-provider support", async () => {
    const root = await mkdtemp(join(tmpdir(), "overlord-plugin-runtime-stale-test-"));
    roots.push(root);
    const pluginDir = join(root, "provider");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "server.js"), "export default {};\n");
    const staleWorker = join(root, "stale-worker.js");
    await writeFile(staleWorker, `
      self.onmessage = (event) => {
        if (event.data?.type === "boot") self.postMessage({ type: "ready" });
      };
    `);

    const runtime = createPluginRuntime({
      pluginRoot: root,
      workerHostUrl: staleWorker,
      setLastError: () => {},
    });
    try {
      await runtime.startPlugin("provider");
      await expect(runtime.runBuildProvider("provider", {}, () => {})).rejects.toThrow(
        "does not support build providers",
      );
    } finally {
      await runtime.shutdownAll();
    }
  });
});
