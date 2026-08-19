import fs from "fs";
import path from "path";

const TARGETS = {
  "windows-amd64": { windows: "x86_64-pc-windows-msvc", other: "x86_64-pc-windows-gnu", extension: ".exe" },
  "windows-arm64": { windows: "aarch64-pc-windows-msvc", other: "aarch64-pc-windows-gnullvm", extension: ".exe" },
  "linux-amd64": { all: "x86_64-unknown-linux-gnu", extension: "" },
  "linux-arm64": { all: "aarch64-unknown-linux-gnu", extension: "" },
  "darwin-amd64": { all: "x86_64-apple-darwin", extension: "" },
  "darwin-arm64": { all: "aarch64-apple-darwin", extension: "" },
};

function rustTarget(platform) {
  const target = TARGETS[platform];
  if (!target) throw new Error(`Unsupported Rust Lite platform: ${platform}`);
  return process.platform === "win32" ? (target.windows || target.all) : (target.other || target.all);
}

function findSource(runtimeRoot) {
  const candidates = [
    path.join(runtimeRoot, "Overlord-Lite"),
    path.join(runtimeRoot, "dist", "Overlord-Lite"),
    path.join(runtimeRoot, "..", "Overlord-Lite"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "Cargo.toml"))) return candidate;
  }
  throw new Error(`Overlord-Lite source not found. Checked: ${candidates.join(", ")}`);
}

async function capture(command, cwd) {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || `${command[0]} exited with ${exitCode}`);
  return stdout.trim();
}

async function streamPipe(stream, onLine) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) if (line.trim()) onLine(line);
    if (done) break;
  }
  if (pending.trim()) onLine(pending);
}

function packageVersion(sourceDir) {
  const cargo = fs.readFileSync(path.join(sourceDir, "Cargo.toml"), "utf8");
  return cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || "unknown";
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

async function estimatePackageCount(sourceDir, target, locked) {
  const args = [
    "cargo",
    "tree",
    "--target",
    target,
    "--prefix",
    "none",
    "--format",
    "{p}",
  ];
  if (locked) args.push("--locked");
  const output = await capture(args, sourceDir);
  const packages = new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.replace(/ \(\*\)$/, "").replace(/ \(proc-macro\)$/, "").trim())
      .filter(Boolean),
  );
  return packages.size;
}

function readBuildHistory(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, "build-history.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function recordBuildDuration(dataDir, target, durationMs) {
  const historyPath = path.join(dataDir, "build-history.json");
  const history = readBuildHistory(dataDir);
  const previous = Number(history[target]?.durationMs);
  const samples = Math.max(0, Number(history[target]?.samples) || 0) + 1;
  history[target] = {
    durationMs: Number.isFinite(previous)
      ? Math.round(previous * 0.6 + durationMs * 0.4)
      : Math.round(durationMs),
    samples,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  } catch {
    // Progress history is optional; a read-only data directory must not fail the build.
  }
}

function createTargetProgress(ctx, options) {
  const DEFAULT_LINK_BUDGET_MS = 35_000;
  const startedAt = Date.now();
  const packageStates = new Map();
  let linking = false;
  let linkingStartedAt = null;
  let finalizing = false;
  let finished = false;
  let lastStatusAt = 0;
  let lastLoggedBucket = -1;

  function snapshot() {
    const elapsedMs = Date.now() - startedAt;
    const completedPackages = packageStates.size;
    const freshPackages = Array.from(packageStates.values()).filter(Boolean).length;
    const packageRatio = options.estimatedPackages > 0
      ? Math.min(1, completedPackages / options.estimatedPackages)
      : 0;
    const historicalDurationMs = Number.isFinite(options.historicalDurationMs)
      ? options.historicalDurationMs
      : null;
    const linkBudgetMs = historicalDurationMs === null
      ? DEFAULT_LINK_BUDGET_MS
      : Math.max(10_000, historicalDurationMs * 0.4);
    const linkingElapsedMs = linkingStartedAt === null ? 0 : Date.now() - linkingStartedAt;
    let targetRatio = Math.min(0.7, packageRatio * 0.7);
    if (linking) {
      const estimatedLinkRatio = Math.min(0.95, linkingElapsedMs / linkBudgetMs);
      targetRatio = Math.max(targetRatio, 0.7 + estimatedLinkRatio * 0.28);
    }
    if (finalizing) targetRatio = Math.max(targetRatio, 0.98);
    if (finished) targetRatio = 1;
    const overallRatio = (options.targetIndex + targetRatio) / options.targetCount;

    let predictedTargetMs = null;
    if (historicalDurationMs !== null && historicalDurationMs > 0) {
      predictedTargetMs = Math.max(elapsedMs, historicalDurationMs);
    }
    if (linking && historicalDurationMs === null) {
      predictedTargetMs = elapsedMs + Math.max(5_000, linkBudgetMs - linkingElapsedMs);
    } else if (!linking && elapsedMs >= 5_000 && packageRatio >= 0.05) {
      const rollingPrediction = elapsedMs / packageRatio + linkBudgetMs;
      predictedTargetMs = predictedTargetMs === null
        ? rollingPrediction
        : predictedTargetMs * 0.65 + rollingPrediction * 0.35;
    }
    const etaMs = predictedTargetMs === null || finished
      ? null
      : Math.max(
          0,
          predictedTargetMs - elapsedMs +
            (options.targetCount - options.targetIndex - 1) * predictedTargetMs,
        );

    return {
      elapsedMs,
      completedPackages,
      freshPackages,
      targetRatio,
      overallRatio,
      etaMs,
    };
  }

  function emit(force = false) {
    const now = Date.now();
    if (!force && now - lastStatusAt < 1_500) return;
    lastStatusAt = now;
    const state = snapshot();
    const targetPercent = Math.round(state.targetRatio * 100);
    const overallPercent = Math.round(state.overallRatio * 100);
    const phase = finalizing
      ? "finalizing artifact"
      : linking
        ? "linking + LTO"
        : "compiling";
    const pieces = [
      `Rust Lite ${options.platform} (${options.targetIndex + 1}/${options.targetCount})`,
      `${overallPercent}% overall`,
      `${targetPercent}% target`,
      phase,
    ];
    if (options.estimatedPackages > 0) {
      pieces.push(`${state.completedPackages}/${options.estimatedPackages} crates`);
    }
    pieces.push(`${formatDuration(state.elapsedMs)} elapsed`);
    if (state.etaMs !== null && state.etaMs >= 1_000) {
      pieces.push(`ETA ~${formatDuration(state.etaMs)}`);
    }
    const text = pieces.join(" • ");
    ctx.build.status(
      text,
      Math.min(100, state.overallRatio * 100),
      state.etaMs === null ? undefined : Math.ceil(state.etaMs / 1000),
    );

    const bucket = Math.floor(overallPercent / 10);
    if (bucket > lastLoggedBucket && overallPercent > 0) {
      lastLoggedBucket = bucket;
      ctx.build.output(`Progress: ${text}`);
    }
  }

  return {
    startedAt,
    noteArtifact(packageId, fresh) {
      const previous = packageStates.get(packageId);
      packageStates.set(packageId, previous === false ? false : fresh === true);
      emit();
    },
    markLinking() {
      linking = true;
      linkingStartedAt ??= Date.now();
      emit(true);
    },
    markFinalizing() {
      finalizing = true;
      emit(true);
    },
    markFinished() {
      finished = true;
      emit(true);
      return snapshot();
    },
    emit,
  };
}

export default {
  setup(ctx) {
    ctx.log.info("Rust Lite build provider ready");
  },

  async onBuild(ctx, payload) {
    const sourceDir = findSource(String(payload.runtimeRoot || ""));
    const outputDir = path.resolve(String(payload.outputDir || ""));
    const targetDir = path.join(ctx.dataDir, "cargo-target");
    const platforms = Array.isArray(payload.platforms) ? payload.platforms : [];
    if (platforms.length === 0) throw new Error("No Rust Lite platforms were requested");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    const cargoVersion = await capture(["cargo", "--version"], sourceDir);
    ctx.build.output(`Using ${cargoVersion}`);
    ctx.build.output(`Rust Lite source: ${sourceDir}`);
    const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
    const tlsSpkiPins = Array.isArray(payload.tlsSpkiPins)
      ? payload.tlsSpkiPins.map(String).filter(Boolean)
      : [];
    if (tlsSpkiPins.length > 0) {
      ctx.build.output(
        `TLS identity pinning: enabled (${tlsSpkiPins.length} trusted key${tlsSpkiPins.length === 1 ? "" : "s"})`,
      );
    } else {
      ctx.build.output("WARNING: No TLS SPKI pin is available for this build", "warn");
    }
    const requestedJobs = Math.trunc(Number(settings.jobs));
    const jobs = Number.isFinite(requestedJobs) && requestedJobs > 0
      ? Math.max(1, Math.min(32, requestedJobs))
      : null;
    const version = packageVersion(sourceDir);
    const artifacts = [];

    const history = readBuildHistory(ctx.dataDir);
    for (const [targetIndex, platform] of platforms.entries()) {
      const target = rustTarget(platform);
      const locked = settings.locked !== false;
      let estimatedPackages = 0;
      try {
        estimatedPackages = await estimatePackageCount(sourceDir, target, locked);
      } catch (error) {
        ctx.build.output(`Package-count estimate unavailable: ${error?.message || error}`, "warn");
      }
      const progress = createTargetProgress(ctx, {
        platform,
        targetIndex,
        targetCount: platforms.length,
        estimatedPackages,
        historicalDurationMs: Number(history[target]?.durationMs) || null,
      });
      progress.emit(true);
      ctx.build.output(`\n=== Rust Lite ${platform} (${target}) ===`);
      ctx.build.output(
        `Release profile: opt-level=z, LTO, 1 codegen unit, stripped symbols, panic=abort`,
      );
      ctx.build.output(`Cargo jobs: ${jobs === null ? "automatic (host CPU count)" : jobs}`);
      if (estimatedPackages > 0) ctx.build.output(`Estimated dependency graph: ${estimatedPackages} crates`);
      const args = [
        "cargo",
        "build",
        "--release",
        "--target",
        target,
        "--message-format=json-render-diagnostics",
      ];
      if (jobs !== null) args.push("--jobs", String(jobs));
      if (locked) args.push("--locked");
      const env = {
        ...process.env,
        CARGO_TARGET_DIR: targetDir,
        OVERLORD_LITE_DEFAULT_SERVER: String(payload.serverUrl || ""),
        OVERLORD_LITE_DEFAULT_AGENT_TOKEN: String(payload.agentToken || ""),
        OVERLORD_LITE_DEFAULT_BUILD_TAG: String(payload.buildTag || ""),
        OVERLORD_LITE_DEFAULT_TLS_SPKI_PINS: tlsSpkiPins.join(","),
      };
      const proc = Bun.spawn(args, {
        cwd: sourceDir,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const progressTimer = setInterval(() => progress.emit(), 2_000);
      let exitCode;
      try {
        await Promise.all([
          streamPipe(proc.stdout, (line) => {
            let message;
            try {
              message = JSON.parse(line);
            } catch {
              ctx.build.output(line, "info");
              return;
            }
            if (message.reason === "compiler-artifact" && typeof message.package_id === "string") {
              progress.noteArtifact(message.package_id, message.fresh === true);
            } else if (message.reason === "compiler-message" && message.message?.rendered) {
              const level = message.message.level === "error"
                ? "error"
                : message.message.level === "warning"
                  ? "warn"
                  : "info";
              ctx.build.output(String(message.message.rendered).trimEnd(), level);
            }
          }),
          streamPipe(proc.stderr, (line) => {
            if (/^\s*Compiling\s+overlord-lite\b/i.test(line)) progress.markLinking();
            ctx.build.output(line, /^\s*error(?:\[|:)/i.test(line) ? "error" : "info");
          }),
        ]);
        exitCode = await proc.exited;
      } finally {
        clearInterval(progressTimer);
      }
      if (exitCode !== 0) {
        throw new Error(
          `Cargo failed for ${platform} (exit ${exitCode}). Install the ${target} Rust target and its required cross-linker.`,
        );
      }

      progress.markFinalizing();
      const extension = TARGETS[platform].extension;
      const builtPath = path.join(targetDir, target, "release", `overlord-lite${extension}`);
      if (!fs.existsSync(builtPath)) throw new Error(`Cargo did not create ${builtPath}`);
      const baseName = String(payload.outputName || "overlord-lite").replace(/[^A-Za-z0-9._-]/g, "") || "overlord-lite";
      const filename = `${baseName}-${platform}${extension}`;
      fs.copyFileSync(builtPath, path.join(outputDir, filename));
      artifacts.push({
        name: `Overlord Lite ${platform}`,
        filename,
        platform,
        version,
      });
      const completed = progress.markFinished();
      recordBuildDuration(ctx.dataDir, target, completed.elapsedMs);
      const compiledPackages = Math.max(0, completed.completedPackages - completed.freshPackages);
      ctx.build.output(
        `Completed ${platform} in ${formatDuration(completed.elapsedMs)} ` +
          `(${completed.freshPackages} cached, ${compiledPackages} compiled crates)`,
        "success",
      );
      ctx.build.output(`Artifact ready: ${filename}`, "success");
    }

    return { artifacts };
  },

  rpc: {
    async status(_ctx, _params) {
      let cargo = null;
      try {
        cargo = await capture(["cargo", "--version"], process.cwd());
      } catch (error) {
        cargo = `Unavailable: ${error?.message || error}`;
      }
      return {
        cargo,
        host: `${process.platform}-${process.arch}`,
        note: "Cross-target builds require the corresponding rustup target and linker.",
      };
    },
  },
};
