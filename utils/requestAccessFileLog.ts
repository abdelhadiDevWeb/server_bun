import { appendFile, mkdir } from "fs/promises";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger";

const ENABLED =
  process.env.REQUEST_ACCESS_LOG_ENABLED !== "false" &&
  process.env.REQUEST_ACCESS_LOG_ENABLED !== "0";

const LOG_FILE = process.env.REQUEST_ACCESS_LOG_FILE?.trim()
  ? path.resolve(process.env.REQUEST_ACCESS_LOG_FILE.trim())
  : path.join(path.dirname(import.meta.dir), "logs", "access.log");

const UA_MAX = 400;

let dirEnsured = false;
let writeChain: Promise<void> = Promise.resolve();

function ensureDirOnce(): Promise<void> {
  if (dirEnsured) return Promise.resolve();
  return mkdir(path.dirname(LOG_FILE), { recursive: true }).then(
    () => {
      dirEnsured = true;
    },
    (err) => {
      logger.error({ err, msg: "request access log: could not create log directory" });
      throw err;
    }
  );
}

function enqueueLine(line: string): void {
  writeChain = writeChain
    .then(() => ensureDirOnce())
    .then(() => appendFile(LOG_FILE, line, { encoding: "utf8" }))
    .catch((err) => {
      logger.error({
        err,
        msg: "request access log: append failed",
        file: LOG_FILE,
      });
    });
}

function safeUa(ua: string | undefined): string {
  if (!ua) return "";
  return ua.length > UA_MAX ? `${ua.slice(0, UA_MAX)}…` : ua;
}

/**
 * Appends one line per HTTP request to a log file (JSON per line).
 * Configure with REQUEST_ACCESS_LOG_FILE (absolute or cwd-relative) or disable with REQUEST_ACCESS_LOG_ENABLED=false.
 */
export function requestAccessFileLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!ENABLED) {
    next();
    return;
  }

  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const userAgent = safeUa(req.headers["user-agent"] as string | undefined);
    const record = {
      ts: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip || (req.socket?.remoteAddress ?? ""),
      correlationId: req.correlationId ?? "",
      userAgent,
    };
    enqueueLine(`${JSON.stringify(record)}\n`);
  });

  next();
}

export function getAccessLogPathForDiagnostics(): { enabled: boolean; file: string } {
  return { enabled: ENABLED, file: LOG_FILE };
}
