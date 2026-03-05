import winston from "winston";
import { ensureDataDir } from "./paths";

const NODE_ENV = process.env.NODE_ENV || "development";
const rawLogLevel = (process.env.LOG_LEVEL || "").trim().toLowerCase();
const validLevels = new Set(["error", "warn", "info", "http", "verbose", "debug", "silly"]);
const LOG_LEVEL = validLevels.has(rawLogLevel)
  ? rawLogLevel
  : NODE_ENV === "production"
    ? "info"
    : "debug";

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
  winston.format.printf((info: any) => {
    const { level, message, timestamp, ...meta } = info;
    let msg = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  }),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: NODE_ENV === "production" ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console({
      level: LOG_LEVEL,
      stderrLevels: ["error"],
    }),
  ],

  exitOnError: false,
});

if (NODE_ENV === "production") {
  const dataDir = ensureDataDir();

  logger.add(
    new winston.transports.File({
      filename: `${dataDir}/error.log`,
      level: "error",
      maxsize: 10485760,
      maxFiles: 5,
    }),
  );

  logger.add(
    new winston.transports.File({
      filename: `${dataDir}/combined.log`,
      maxsize: 10485760,
      maxFiles: 5,
    }),
  );
}

if (rawLogLevel && !validLevels.has(rawLogLevel)) {
  // eslint-disable-next-line no-console
  console.warn(`Invalid LOG_LEVEL='${rawLogLevel}', defaulting to ${LOG_LEVEL}`);
}

logger.info(`Logger initialized (level: ${LOG_LEVEL}, env: ${NODE_ENV})`);

export default logger;
