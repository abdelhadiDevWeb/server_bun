import pino from 'pino';
import { randomUUID } from 'crypto';
import os from 'node:os';
import type { Request, Response, NextFunction } from 'express';

/** Only explicit `NODE_ENV=development` enables pretty logs (cPanel often leaves NODE_ENV unset). */
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';
const usePrettyTransport =
  isDevelopment &&
  process.env.LOG_PRETTY !== 'false' &&
  process.env.DISABLE_PINO_PRETTY !== 'true';

const logLevel =
  process.env.LOG_LEVEL ?? (isProduction || !isDevelopment ? 'info' : 'debug');

// Create base logger instance
export const logger = pino({
  level: logLevel,

  // Pretty print only in local dev (pino-pretty is devDependency; not on cPanel prod)
  transport: usePrettyTransport
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,

  // Base fields for all logs
  base: {
    pid: process.pid,
    hostname: process.env.HOSTNAME || os.hostname(),
    service: 'cars-backend',
    version: process.env.npm_package_version || '1.0.0',
  },
  
  // Format timestamps consistently
  timestamp: pino.stdTimeFunctions.isoTime,
  
  // Redact sensitive information
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'secret',
      'key',
    ],
    censor: '[REDACTED]',
  },
});

// Extend Request interface to include correlation ID
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      logger?: pino.Logger;
    }
  }
}

/**
 * Middleware to add correlation ID and request-scoped logger
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  // Generate or extract correlation ID
  const correlationId = 
    req.headers['x-correlation-id'] as string ||
    req.headers['x-request-id'] as string ||
    randomUUID();
  
  // Add to request object
  req.correlationId = correlationId;
  
  // Create request-scoped logger
  req.logger = logger.child({
    correlationId,
    requestId: correlationId,
  });
  
  // Add correlation ID to response headers for tracing
  res.setHeader('x-correlation-id', correlationId);
  
  next();
}

/**
 * HTTP request logging middleware
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const requestLogger = req.logger || logger;
  
  // Log incoming request
  requestLogger.info({
    req: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      ips: req.ips,
    },
    msg: 'Incoming request',
  });

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    requestLogger.info({
      req: {
        method: req.method,
        url: req.url,
      },
      res: {
        statusCode: res.statusCode,
        headers: res.getHeaders(),
      },
      duration,
      msg: "Request completed",
    });
  });

  next();
}

/**
 * Error logging middleware
 */
export function errorLoggingMiddleware(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestLogger = req.logger || logger;
  
  requestLogger.error({
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    req: {
      method: req.method,
      url: req.url,
      headers: req.headers,
    },
    msg: 'Request error',
  });
  
  next(error);
}

/**
 * Create operation-specific logger with additional context
 */
export function createOperationLogger(
  operation: string,
  context: Record<string, any> = {},
  parentLogger: pino.Logger = logger
) {
  return parentLogger.child({
    operation,
    ...context,
  });
}

/**
 * Log user action with context
 */
export function logUserAction(
  userId: string,
  action: string,
  resource?: string,
  details?: Record<string, any>,
  parentLogger: pino.Logger = logger
) {
  parentLogger.info({
    userId,
    action,
    resource,
    details,
    msg: 'User action',
  });
}

/**
 * Log database operation
 */
export function logDatabaseOperation(
  operation: string,
  collection: string,
  query?: Record<string, any>,
  duration?: number,
  resultCount?: number,
  parentLogger: pino.Logger = logger
) {
  parentLogger.debug({
    db: {
      operation,
      collection,
      query,
      duration,
      resultCount,
    },
    msg: 'Database operation',
  });
}

/**
 * Log external API call
 */
export function logExternalApiCall(
  service: string,
  endpoint: string,
  method: string,
  statusCode?: number,
  duration?: number,
  parentLogger: pino.Logger = logger
) {
  parentLogger.info({
    externalApi: {
      service,
      endpoint,
      method,
      statusCode,
      duration,
    },
    msg: 'External API call',
  });
}

/**
 * Log business event
 */
export function logBusinessEvent(
  event: string,
  entityType: string,
  entityId: string,
  details?: Record<string, any>,
  parentLogger: pino.Logger = logger
) {
  parentLogger.info({
    businessEvent: {
      event,
      entityType,
      entityId,
      details,
    },
    msg: 'Business event',
  });
}

/**
 * Log security event
 */
export function logSecurityEvent(
  event: string,
  userId?: string,
  ip?: string,
  userAgent?: string,
  details?: Record<string, any>,
  parentLogger: pino.Logger = logger
) {
  parentLogger.warn({
    security: {
      event,
      userId,
      ip,
      userAgent,
      details,
    },
    msg: 'Security event',
  });
}

export default logger;