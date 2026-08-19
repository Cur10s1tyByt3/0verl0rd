import fs from "fs";
import path from "path";

const MAX_PROVIDER_ARTIFACTS = 32;
const MAX_PROVIDER_ARTIFACT_BYTES = 512 * 1024 * 1024;

export type ProviderArtifact = {
  name: string;
  filename: string;
  platform: string;
  version?: string;
  size: number;
};

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isInside(root: string, target: string): boolean {
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return target === root || target.startsWith(prefix);
}

function withBuildSlug(filename: string, slug: string): string {
  const extension = path.extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  return stem.endsWith(`-${slug}`) ? filename : `${stem}-${slug}${extension}`;
}

export function providerStagingDirectory(runtimeRoot: string, buildId: string): string {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(buildId)) {
    throw new Error("Invalid provider build id");
  }
  return path.join(runtimeRoot, "dist-clients", ".plugin-builds", buildId);
}

export function installProviderArtifacts(args: {
  result: unknown;
  stagingDir: string;
  outputDir: string;
  buildId: string;
  requestedPlatforms: string[];
  sanitizeOutputName: (name: string) => string;
}): ProviderArtifact[] {
  if (!isRecord(args.result) || !Array.isArray(args.result.artifacts)) {
    throw new Error("Build provider must return an artifacts array");
  }
  if (args.result.artifacts.length === 0) {
    throw new Error("Build provider returned no artifacts");
  }
  if (args.result.artifacts.length > MAX_PROVIDER_ARTIFACTS) {
    throw new Error(`Build provider returned more than ${MAX_PROVIDER_ARTIFACTS} artifacts`);
  }

  const realStagingDir = fs.realpathSync(args.stagingDir);
  const requestedPlatforms = new Set(args.requestedPlatforms);
  const buildSlug = args.buildId.substring(0, 8);
  const installed: ProviderArtifact[] = [];
  const installedPaths: string[] = [];
  const names = new Set<string>();

  try {
    for (const raw of args.result.artifacts) {
      if (!isRecord(raw)) throw new Error("Build provider returned an invalid artifact");
      const relativePath = typeof raw.path === "string" && raw.path.trim()
        ? raw.path.trim()
        : typeof raw.filename === "string"
          ? raw.filename.trim()
          : "";
      if (!relativePath || path.isAbsolute(relativePath)) {
        throw new Error("Provider artifact paths must be relative to the build output directory");
      }

      const sourcePath = path.resolve(args.stagingDir, relativePath);
      if (!isInside(path.resolve(args.stagingDir), sourcePath)) {
        throw new Error("Provider artifact escaped the build output directory");
      }
      const sourceStat = fs.lstatSync(sourcePath);
      if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
        throw new Error("Provider artifacts must be regular files");
      }
      const realSourcePath = fs.realpathSync(sourcePath);
      if (!isInside(realStagingDir, realSourcePath)) {
        throw new Error("Provider artifact resolved outside the build output directory");
      }
      if (sourceStat.size <= 0 || sourceStat.size > MAX_PROVIDER_ARTIFACT_BYTES) {
        throw new Error("Provider artifact has an invalid size");
      }

      const platform = typeof raw.platform === "string" ? raw.platform.trim() : "";
      if (!requestedPlatforms.has(platform)) {
        throw new Error(`Provider returned an artifact for unrequested platform ${platform || "<empty>"}`);
      }
      const suggestedName = typeof raw.filename === "string" && raw.filename.trim()
        ? path.basename(raw.filename.trim())
        : path.basename(relativePath);
      const sanitizedName = args.sanitizeOutputName(suggestedName);
      if (!sanitizedName) throw new Error("Provider returned an invalid artifact filename");
      const filename = withBuildSlug(sanitizedName, buildSlug);
      if (names.has(filename)) throw new Error(`Provider returned duplicate artifact ${filename}`);
      names.add(filename);

      fs.mkdirSync(args.outputDir, { recursive: true });
      const destinationPath = path.join(args.outputDir, filename);
      fs.copyFileSync(realSourcePath, destinationPath);
      installedPaths.push(destinationPath);
      const size = fs.statSync(destinationPath).size;
      installed.push({
        name: typeof raw.name === "string" && raw.name.trim()
          ? raw.name.trim().slice(0, 128)
          : suggestedName,
        filename,
        platform,
        ...(typeof raw.version === "string" && raw.version.trim() && { version: raw.version.trim().slice(0, 64) }),
        size,
      });
    }
    return installed;
  } catch (error) {
    for (const installedPath of installedPaths) {
      try { fs.unlinkSync(installedPath); } catch {}
    }
    throw error;
  }
}
