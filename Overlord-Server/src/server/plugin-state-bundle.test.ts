import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  arePluginNeedsApproved,
  compilePluginTypeScript,
  computePluginNeedsHash,
  ensurePluginExtracted,
  loadPluginBundle,
  type PluginState,
} from "./plugin-state-bundle";

let tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "overlord-plugin-bundle-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

describe("loadPluginBundle", () => {
  test("matches plugin binaries when clients report a pretty Windows OS name", async () => {
    const root = await createTempRoot();
    const pluginDir = join(root, "sample-c");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "manifest.json"),
      JSON.stringify({
        id: "sample-c",
        name: "sample-c",
        binaries: { "windows-amd64": "sample-c-windows-amd64.dll" },
      }),
    );
    await writeFile(join(pluginDir, "sample-c-windows-amd64.dll"), "test-binary");

    const bundle = await loadPluginBundle(root, "sample-c", async () => {}, "Windows 11 Pro 24H2", "amd64");

    expect(bundle.binaryPath).toBe(join(pluginDir, "sample-c-windows-amd64.dll"));
    expect(bundle.size).toBe("test-binary".length);
  });

  test("rejects an extracted WASM manifest", async () => {
    const root = await createTempRoot();
    const pluginDir = join(root, "wasm-demo");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    await writeFile(
      join(pluginDir, "manifest.json"),
      JSON.stringify({
        id: "wasm-demo",
        name: "WASM Demo",
        apiVersion: 2,
        runtime: "wasm",
        wasm: "plugin.wasm",
        needs: { files: [{ bucket: "downloads", access: ["list", "read"], reason: "Import files" }] },
      }),
    );

    await expect(loadPluginBundle(root, "wasm-demo", async () => {}, "Windows 11", "amd64"))
      .rejects.toThrow("WASM plugins are not supported");
  });

  test("rejects a bundle containing a WASM module", async () => {
    const root = await createTempRoot();
    const AdmZip = require("adm-zip");
    const zip = new AdmZip();
    zip.addFile("config.json", Buffer.from(JSON.stringify({ name: "WASM Demo", runtime: "wasm" })));
    zip.addFile("wasm-demo.html", Buffer.from("<div></div>"));
    zip.addFile("wasm-demo.css", Buffer.from("body {}"));
    zip.addFile("wasm-demo.js", Buffer.from("console.log('demo')"));
    zip.addFile("wasm-demo.wasm", Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    zip.writeZip(join(root, "wasm-demo.zip"));

    await expect(ensurePluginExtracted(root, "wasm-demo", (name) => name))
      .rejects.toThrow("WASM plugins are not supported");
  });

  test("keeps helper DLLs out of the native platform binary map", async () => {
    const root = await createTempRoot();
    const AdmZip = require("adm-zip");
    const zip = new AdmZip();
    zip.addFile("config.json", Buffer.from(JSON.stringify({
      name: "Plink",
      apiVersion: 2,
      runtime: "native",
      uiEntry: "src/ui.ts",
    })));
    zip.addFile("plink.html", Buffer.from("<div id=\"plink-root\"></div>"));
    zip.addFile("plink.css", Buffer.from("#plink-root { display: block; }"));
    zip.addFile("src/ui.ts", Buffer.from("document.body.dataset.plugin = 'plink';"));
    zip.addFile("plink-windows-amd64.dll", Buffer.from("entry-dll"));
    zip.addFile("plink-payload.dll", Buffer.from("helper-dll"));
    zip.writeZip(join(root, "plink.zip"));

    await ensurePluginExtracted(root, "plink", (name) => name);
    const manifest = JSON.parse(await readFile(join(root, "plink", "manifest.json"), "utf-8"));
    expect(manifest.binaries["windows-amd64"]).toBe("plink-windows-amd64.dll");

    const bundle = await loadPluginBundle(root, "plink", async () => {}, "Windows 11", "amd64");
    expect(bundle.binaryPath).toBe(join(root, "plink", "plink-windows-amd64.dll"));
  });

  test("preserves native loader and custom entrypoint metadata from config", async () => {
    const root = await createTempRoot();
    const AdmZip = require("adm-zip");
    const zip = new AdmZip();
    zip.addFile("config.json", Buffer.from(JSON.stringify({
      name: "Native Loader Demo",
      apiVersion: 2,
      runtime: "native",
      nativeLoader: "loadlibraryex",
      autoLoadByDefault: true,
      nativeEntrypoints: {
        onLoad: "StartPlugin",
        onEvent: "HandlePluginEvent",
        onUnload: "StopPlugin",
        setCallback: "SetHostCallback",
        getRuntime: "RuntimeName",
      },
    })));
    zip.addFile("native-loader-demo.html", Buffer.from("<div id=\"native-loader-demo\"></div>"));
    zip.addFile("native-loader-demo.css", Buffer.from("#native-loader-demo { display: block; }"));
    zip.addFile("native-loader-demo.js", Buffer.from("document.body.dataset.nativeLoaderDemo = '1';"));
    zip.addFile("native-loader-demo-windows-amd64.dll", Buffer.from("native-dll"));
    zip.writeZip(join(root, "native-loader-demo.zip"));

    await ensurePluginExtracted(root, "native-loader-demo", (name) => name);
    const manifest = JSON.parse(await readFile(join(root, "native-loader-demo", "manifest.json"), "utf-8"));

    expect(manifest.nativeLoader).toBe("os");
    expect(manifest.autoLoadByDefault).toBe(true);
    expect(manifest.nativeEntrypoints.onLoad).toBe("StartPlugin");
    expect(manifest.nativeEntrypoints.onEvent).toBe("HandlePluginEvent");
    expect(manifest.nativeEntrypoints.onUnload).toBe("StopPlugin");
    expect(manifest.nativeEntrypoints.setCallback).toBe("SetHostCallback");
    expect(manifest.nativeEntrypoints.getRuntime).toBe("RuntimeName");
  });

  test("preserves dashboard badge metadata from config", async () => {
    const root = await createTempRoot();
    const AdmZip = require("adm-zip");
    const zip = new AdmZip();
    zip.addFile("config.json", Buffer.from(JSON.stringify({
      name: "Dashboard Demo",
      apiVersion: 2,
      runtime: "server",
      serverEntry: "src/server.ts",
      dashboard: {
        clientBadges: [{
          id: "phone-link",
          label: "Phone Link",
          icon: "fa-solid fa-mobile-screen-button",
          imageUrl: "/plugins/demo/assets/icon.png",
          tone: "good",
          priority: 90,
        }],
      },
    })));
    zip.addFile("dashboard-demo.html", Buffer.from("<main id=\"dashboard-demo\"></main>"));
    zip.addFile("dashboard-demo.css", Buffer.from("#dashboard-demo { display: block; }"));
    zip.addFile("src/ui.ts", Buffer.from("document.body.dataset.dashboardDemo = '1';"));
    zip.addFile("src/server.ts", Buffer.from("export default { rpc: {} };"));
    zip.writeZip(join(root, "dashboard-demo.zip"));

    await ensurePluginExtracted(root, "dashboard-demo", (name) => name);
    const manifest = JSON.parse(await readFile(join(root, "dashboard-demo", "manifest.json"), "utf-8"));

    expect(manifest.dashboard.clientBadges[0].id).toBe("phone-link");
    expect(manifest.dashboard.clientBadges[0].imageUrl).toBe("/plugins/demo/assets/icon.png");
  });

  test("computes stable need hashes and invalidates changed approvals", () => {
    const state: PluginState = {
      enabled: {},
      lastError: {},
      autoLoad: {},
      autoStartEvents: {},
      approvedNeeds: {},
    };
    const needs = { files: [{ bucket: "downloads", access: ["read", "list"] }] };
    const sameNeedsDifferentOrder = { files: [{ bucket: "downloads", access: ["list", "read"] }] };
    const changedNeeds = { files: [{ bucket: "downloads", access: ["read", "write"] }] };
    const hash = computePluginNeedsHash(needs);

    expect(hash).toBe(computePluginNeedsHash(sameNeedsDifferentOrder));
    expect(hash).not.toBe(computePluginNeedsHash(changedNeeds));
    expect(arePluginNeedsApproved(state, "demo", needs)).toBe(false);
    state.approvedNeeds.demo = hash;
    expect(arePluginNeedsApproved(state, "demo", sameNeedsDifferentOrder)).toBe(true);
    expect(arePluginNeedsApproved(state, "demo", changedNeeds)).toBe(false);
  });

  test("compiles TypeScript entrypoints with local imports", async () => {
    const root = await createTempRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "shared.ts"), "export const message = 'hello-ts';\n");
    await writeFile(join(root, "src", "ui.ts"), "import { message } from './shared'; document.body.dataset.sample = message;\n");
    await writeFile(join(root, "src", "server.ts"), "import { message } from './shared'; export default { rpc: { ping() { return { message }; } } };\n");
    await compilePluginTypeScript(join(root, "src", "ui.ts"), join(root, "assets", "sample-ts.js"), "browser", "sample-ts");
    await compilePluginTypeScript(join(root, "src", "server.ts"), join(root, "server.js"), "bun", "sample-ts");

    const uiJs = await readFile(join(root, "assets", "sample-ts.js"), "utf-8");
    const serverJs = await readFile(join(root, "server.js"), "utf-8");
    expect(uiJs).toContain("hello-ts");
    expect(serverJs).toContain("hello-ts");
  });
});
