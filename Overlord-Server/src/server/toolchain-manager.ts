import path from "path";
import fs from "fs";
import { $ } from "bun";
import { ensureDataDir } from "../paths";
import { logger } from "../logger";

type SendToStream = (data: any) => void;

export type ToolchainKey =
  | "mingw-w64-x64"
  | "mingw-w64-x86"
  | "linux-musl-x64"
  | "linux-musl-arm64"
  | "linux-musl-armv7"
  | "android-ndk"
  | "ldid"
  | "upx"
  | "rust";

export type EnsuredToolchain = {
  key: ToolchainKey;
  binDir: string;
  ccPath?: string;
  cxxPath?: string;
  arPath?: string;
  rootDir: string;
};

type ArchiveFormat = "tar.gz" | "tar.xz" | "zip" | "binary" | "rustup";

type Manifest = {
  displayName: string;
  url: string;
  approxSizeMB: number;
  archive: ArchiveFormat;
  binSubdir: string;
  ccBasename?: string;
  cxxBasename?: string;
  arBasename?: string;
  binaryFilename?: string;
  pathBasename?: string;
};

const ANDROID_NDK_VERSION = "r27c";

function ndkHostTriple(): string {
  return process.arch === "arm64" ? "linux-aarch64" : "linux-x86_64";
}

function ldidArch(): string {
  return process.arch === "arm64" ? "aarch64" : "x86_64";
}

// Rust toolchain pinned to the same version the Docker builder installs.
const RUST_VERSION = "1.85.0";

// The windows-gnu std is fetched from the rustup dist server regardless of host
// triple via `--target x86_64-pc-windows-gnu`; only the rustup-init binary is
// host-specific.
const RUST_TARGET = "x86_64-pc-windows-gnu";

function rustupInitUrl(): string {
  const platform = process.platform;
  const arch = process.arch;
  let triple: string;
  if (platform === "win32") {
    triple = arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  } else if (platform === "darwin") {
    triple = arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  } else {
    triple = arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  return `https://static.rust-lang.org/rustup/dist/${triple}/rustup-init${platform === "win32" ? ".exe" : ""}`;
}

const MANIFESTS: Record<ToolchainKey, Manifest> = {
  "mingw-w64-x64": {
    displayName: "mingw-w64 x86_64 cross-compiler",
    url: "https://musl.cc/x86_64-w64-mingw32-cross.tgz",
    approxSizeMB: 70,
    archive: "tar.gz",
    binSubdir: "x86_64-w64-mingw32-cross/bin",
    ccBasename: "x86_64-w64-mingw32-gcc",
    cxxBasename: "x86_64-w64-mingw32-g++",
    arBasename: "x86_64-w64-mingw32-ar",
  },
  "mingw-w64-x86": {
    displayName: "mingw-w64 i686 cross-compiler",
    url: "https://musl.cc/i686-w64-mingw32-cross.tgz",
    approxSizeMB: 65,
    archive: "tar.gz",
    binSubdir: "i686-w64-mingw32-cross/bin",
    ccBasename: "i686-w64-mingw32-gcc",
    cxxBasename: "i686-w64-mingw32-g++",
    arBasename: "i686-w64-mingw32-ar",
  },
  "linux-musl-x64": {
    displayName: "musl x86_64 Linux cross-compiler",
    url: "https://musl.cc/x86_64-linux-musl-cross.tgz",
    approxSizeMB: 60,
    archive: "tar.gz",
    binSubdir: "x86_64-linux-musl-cross/bin",
    ccBasename: "x86_64-linux-musl-gcc",
    cxxBasename: "x86_64-linux-musl-g++",
    arBasename: "x86_64-linux-musl-ar",
  },
  "linux-musl-arm64": {
    displayName: "musl aarch64 Linux cross-compiler",
    url: "https://musl.cc/aarch64-linux-musl-cross.tgz",
    approxSizeMB: 60,
    archive: "tar.gz",
    binSubdir: "aarch64-linux-musl-cross/bin",
    ccBasename: "aarch64-linux-musl-gcc",
    cxxBasename: "aarch64-linux-musl-g++",
    arBasename: "aarch64-linux-musl-ar",
  },
  "linux-musl-armv7": {
    displayName: "musl armv7l Linux cross-compiler",
    url: "https://musl.cc/armv7l-linux-musleabihf-cross.tgz",
    approxSizeMB: 60,
    archive: "tar.gz",
    binSubdir: "armv7l-linux-musleabihf-cross/bin",
    ccBasename: "armv7l-linux-musleabihf-gcc",
    cxxBasename: "armv7l-linux-musleabihf-g++",
    arBasename: "armv7l-linux-musleabihf-ar",
  },
  "android-ndk": {
    displayName: `Android NDK ${ANDROID_NDK_VERSION}`,
    url: `https://dl.google.com/android/repository/android-ndk-${ANDROID_NDK_VERSION}-linux.zip`,
    approxSizeMB: 1500,
    archive: "zip",
    binSubdir: `android-ndk-${ANDROID_NDK_VERSION}/toolchains/llvm/prebuilt/${ndkHostTriple()}/bin`,
    arBasename: "llvm-ar",
  },
  ldid: {
    displayName: "ldid (iOS pseudo-signing)",
    url: `https://github.com/ProcursusTeam/ldid/releases/download/v2.1.5-procursus7/ldid_linux_${ldidArch()}`,
    approxSizeMB: 2,
    archive: "binary",
    binSubdir: "bin",
    binaryFilename: "ldid",
  },
  upx: {
    displayName: "UPX 4.2.4",
    url: "https://github.com/upx/upx/releases/download/v4.2.4/upx-4.2.4-amd64_linux.tar.xz",
    approxSizeMB: 1,
    archive: "tar.xz",
    binSubdir: "upx-4.2.4-amd64_linux",
    binaryFilename: "upx",
  },
  rust: {
    displayName: `Rust toolchain ${RUST_VERSION} (rustup minimal, ${RUST_TARGET} target)`,
    url: rustupInitUrl(),
    approxSizeMB: 260,
    archive: "rustup",
    binSubdir: "cargo/bin",
    pathBasename: "cargo",
  },
};

const inFlight = new Map<ToolchainKey, Promise<EnsuredToolchain>>();

export function getToolchainRoot(): string {
  const explicit = process.env.OVERLORD_TOOLCHAIN_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(ensureDataDir(), "toolchains");
}

function toolchainDir(key: ToolchainKey): string {
  return path.join(getToolchainRoot(), key);
}

function sentinelPath(key: ToolchainKey): string {
  return path.join(toolchainDir(key), ".installed");
}

function isInstalled(key: ToolchainKey): boolean {
  try {
    return fs.existsSync(sentinelPath(key));
  } catch {
    return false;
  }
}

function resolveEnsured(key: ToolchainKey): EnsuredToolchain {
  const m = MANIFESTS[key];
  const rootDir = toolchainDir(key);
  const binDir = path.join(rootDir, m.binSubdir);
  return {
    key,
    rootDir,
    binDir,
    ccPath: m.ccBasename ? path.join(binDir, m.ccBasename) : undefined,
    cxxPath: m.cxxBasename ? path.join(binDir, m.cxxBasename) : undefined,
    arPath: m.arBasename ? path.join(binDir, m.arBasename) : undefined,
  };
}

async function downloadAndExtract(
  key: ToolchainKey,
  send: SendToStream,
): Promise<void> {
  const m = MANIFESTS[key];
  const rootDir = toolchainDir(key);
  const tmpDir = `${rootDir}.tmp-${process.pid}-${Date.now()}`;

  fs.mkdirSync(getToolchainRoot(), { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const archiveName =
    m.archive === "binary"
      ? m.binaryFilename || "download"
      : path.basename(new URL(m.url).pathname);
  const archivePath = path.join(tmpDir, archiveName);

  send({
    type: "output",
    text: `[toolchain] Downloading ${m.displayName} (~${m.approxSizeMB}MB) from ${m.url}\n`,
    level: "info",
  });
  logger.info(`[toolchain] downloading ${key} from ${m.url}`);

  const dl = await $`wget --tries=2 --timeout=60 -q -O ${archivePath} ${m.url}`
    .nothrow();
  if (dl.exitCode !== 0) {
    const stderr = dl.stderr.toString().trim();
    throw new Error(
      `Failed to download ${m.displayName} (wget exit ${dl.exitCode}): ${stderr || "no stderr"}`,
    );
  }

  send({
    type: "output",
    text: `[toolchain] Extracting ${m.displayName}...\n`,
    level: "info",
  });

  switch (m.archive) {
    case "tar.gz": {
      const r = await $`tar -xzf ${archivePath} -C ${tmpDir}`.nothrow();
      if (r.exitCode !== 0) {
        throw new Error(`tar -xzf failed for ${key}: ${r.stderr.toString()}`);
      }
      fs.unlinkSync(archivePath);
      break;
    }
    case "tar.xz": {
      const r = await $`tar -xJf ${archivePath} -C ${tmpDir}`.nothrow();
      if (r.exitCode !== 0) {
        throw new Error(`tar -xJf failed for ${key}: ${r.stderr.toString()}`);
      }
      fs.unlinkSync(archivePath);
      break;
    }
    case "zip": {
      const r = await $`unzip -q ${archivePath} -d ${tmpDir}`.nothrow();
      if (r.exitCode !== 0) {
        throw new Error(`unzip failed for ${key}: ${r.stderr.toString()}`);
      }
      fs.unlinkSync(archivePath);
      break;
    }
    case "binary": {
      // Move single-binary download into a bin/ subdir so binSubdir resolves.
      const binDir = path.join(tmpDir, m.binSubdir);
      fs.mkdirSync(binDir, { recursive: true });
      const finalBin = path.join(binDir, m.binaryFilename || "download");
      fs.renameSync(archivePath, finalBin);
      fs.chmodSync(finalBin, 0o755);
      break;
    }
    case "rustup": {
      // rustup-init is an installer, not an archive. Rename the download to its
      // canonical name and run it with RUSTUP_HOME/CARGO_HOME pointing inside
      // tmpDir, so the whole toolchain tree is atomically published into the
      // data dir afterwards by the standard rename below.
      const exeName = process.platform === "win32" ? "rustup-init.exe" : "rustup-init";
      const initPath = path.join(tmpDir, exeName);
      fs.renameSync(archivePath, initPath);
      if (process.platform !== "win32") fs.chmodSync(initPath, 0o755);
      const rustupHome = path.join(tmpDir, "rustup");
      const cargoHome = path.join(tmpDir, "cargo");
      fs.mkdirSync(rustupHome, { recursive: true });
      fs.mkdirSync(cargoHome, { recursive: true });
      fs.mkdirSync(path.join(cargoHome, "bin"), { recursive: true });
      send({
        type: "output",
        text: `[toolchain] Installing ${m.displayName} (downloads Rust std + ${RUST_TARGET} target)...\n`,
        level: "info",
      });
      const r = await $`${initPath} -y --no-modify-path --default-toolchain ${RUST_VERSION} --profile minimal --target ${RUST_TARGET}`
        .env({ RUSTUP_HOME: rustupHome, CARGO_HOME: cargoHome })
        .nothrow();
      if (r.exitCode !== 0) {
        const detail =
          r.stderr.toString().trim() || r.stdout.toString().trim() || "no output";
        throw new Error(`rustup-init install failed for ${key} (exit ${r.exitCode}): ${detail}`);
      }
      break;
    }
  }

  // Atomic publish: rename tmpDir → rootDir. If another process already
  // created rootDir (race), fall back to checking the sentinel.
  try {
    fs.renameSync(tmpDir, rootDir);
  } catch (err: any) {
    // If another worker won the race and rootDir already exists, accept it.
    if (err.code === "ENOTEMPTY" || err.code === "EEXIST" || err.code === "EPERM") {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
      if (isInstalled(key)) return;
    }
    throw err;
  }

  fs.writeFileSync(sentinelPath(key), `${m.url}\n${new Date().toISOString()}\n`);
  send({
    type: "output",
    text: `[toolchain] ${m.displayName} ready at ${rootDir}\n`,
    level: "info",
  });
  logger.info(`[toolchain] installed ${key} at ${rootDir}`);
}

function tryResolveFromPath(key: ToolchainKey): EnsuredToolchain | null {
  const m = MANIFESTS[key];
  const primaryBin = m.pathBasename || m.ccBasename || m.binaryFilename;
  if (!primaryBin) return null;

  const found = Bun.which(primaryBin);
  if (!found) return null;

  const binDir = path.dirname(found);
  return {
    key,
    rootDir: path.dirname(binDir),
    binDir,
    ccPath: m.ccBasename ? found : undefined,
    cxxPath: m.cxxBasename ? (Bun.which(m.cxxBasename) ?? path.join(binDir, m.cxxBasename)) : undefined,
    arPath: m.arBasename ? (Bun.which(m.arBasename) ?? path.join(binDir, m.arBasename)) : undefined,
  };
}

export async function ensureToolchain(
  key: ToolchainKey,
  send: SendToStream,
): Promise<EnsuredToolchain> {
  const fromPath = tryResolveFromPath(key);
  if (fromPath) {
    logger.info(`[toolchain] using ${key} from PATH: ${fromPath.binDir}`);
    send({ type: "output", text: `[toolchain] Using system ${MANIFESTS[key].displayName} from PATH\n`, level: "info" });
    return fromPath;
  }

  if (isInstalled(key)) {
    return resolveEnsured(key);
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      await downloadAndExtract(key, send);
      return resolveEnsured(key);
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

const TARGET_TO_TOOLCHAIN: Record<string, ToolchainKey> = {
  "linux/amd64": "linux-musl-x64",
  "linux/arm64": "linux-musl-arm64",
  "linux/arm/v7": "linux-musl-armv7",
  "windows/amd64": "mingw-w64-x64",
  "windows/386": "mingw-w64-x86",
};

export function toolchainKeyForTarget(targetKey: string): ToolchainKey | null {
  return TARGET_TO_TOOLCHAIN[targetKey] || null;
}
