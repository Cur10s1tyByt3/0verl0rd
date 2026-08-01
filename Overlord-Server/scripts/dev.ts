/**
 * Development supervisor.
 *
 * Keeps the backend and generated Tailwind stylesheet up to date while
 * preserving a single foreground process for the repository launchers.
 */

const cwd = import.meta.dir.replace(/[\\/]scripts$/, "");
const env = {
  ...process.env,
  NODE_ENV: "development",
};

function runPreparation(command: string): void {
  const result = Bun.spawnSync(["bun", "run", command], {
    cwd,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  if (!result.success) {
    process.exit(result.exitCode || 1);
  }
}

runPreparation("build:css");
runPreparation("build:web");
runPreparation("vendor");

const backend = Bun.spawn(["bun", "--watch", "src/index.ts"], {
  cwd,
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const styles = Bun.spawn(["bun", "run", "watch:css"], {
  cwd,
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const web = Bun.spawn(["bun", "run", "watch:web"], {
  cwd,
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

let stopping = false;

function stop(exitCode = 0): void {
  if (stopping) return;
  stopping = true;
  backend.kill();
  styles.kill();
  web.kill();
  process.exitCode = exitCode;
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

const result = await Promise.race([
  backend.exited.then((exitCode) => ({ process: "backend", exitCode })),
  styles.exited.then((exitCode) => ({ process: "Tailwind watcher", exitCode })),
  web.exited.then((exitCode) => ({ process: "browser TypeScript watcher", exitCode })),
]);

if (!stopping) {
  console.error(`[dev] ${result.process} exited with code ${result.exitCode}`);
  stop(result.exitCode || 1);
}

await Promise.allSettled([backend.exited, styles.exited, web.exited]);
