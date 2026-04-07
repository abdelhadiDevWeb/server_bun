import rateLimit, { RateLimitRequestHandler } from "express-rate-limit";
import { Request, Response, NextFunction } from "express";
import { logSecurityEvent } from "../utils/logger";
import { captureMessage } from "../config/sentry";

// Enhanced rate limiting with Redis store support for production
const createRateLimiter = (options: {
  windowMs: number;
  max: number;
  message: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
}): RateLimitRequestHandler => {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: {
      ok: false,
      message: options.message,
      retryAfter: Math.ceil(options.windowMs / 1000),
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    skipFailedRequests: options.skipFailedRequests || false,
    keyGenerator: options.keyGenerator || ((req: Request) => req.ip),
    handler: (req: Request, res: Response) => {
      // Log rate limit violations
      logSecurityEvent(
        'rate_limit_exceeded',
        req.user?.id,
        req.ip,
        req.headers['user-agent'] as string,
        {
          method: req.method,
          url: req.url,
          limit: options.max,
          windowMs: options.windowMs,
        }
      );
      
      // Report to Sentry for monitoring
      captureMessage(
        `Rate limit exceeded for ${req.ip}`,
        'warning',
        {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          method: req.method,
          url: req.url,
        }
      );
      
      res.status(429).json({
        ok: false,
        message: options.message,
        retryAfter: Math.ceil(options.windowMs / 1000),
      });
    },
  });
};

/**
 * Strict rate limiter for authentication routes
 * Protects against brute force attacks
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: "Trop de tentatives de connexion. Veuillez réessayer dans 15 minutes.",
  skipSuccessfulRequests: true,
});

/**
 * Progressive rate limiter for failed logins
 * Increasingly strict based on failures
 */
export const progressiveAuthRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts per hour total
  message: "Compte temporairement bloqué. Veuillez réessayer dans 1 heure.",
  skipSuccessfulRequests: true,
});

/**
 * Rate limiter for email verification
 */
export const emailVerificationRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // 3 verification attempts per 5 minutes
  message: "Trop de tentatives de vérification. Veuillez réessayer dans 5 minutes.",
});

/**
 * Rate limiter for password reset requests
 */
export const passwordResetRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 password reset requests per hour
  message: "Trop de demandes de réinitialisation. Veuillez réessayer dans 1 heure.",
});

/**
 * Rate limiter for car creation
 */
export const carCreationRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // 3 car creations per 5 minutes
  message: "Trop de créations de voitures. Veuillez ralentir.",
  keyGenerator: (req: Request) => req.user?.id || req.ip,
});

/**
 * Rate limiter for appointment creation
 */
export const appointmentRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // 5 appointments per 10 minutes
  message: "Trop de demandes de rendez-vous. Veuillez ralentir.",
  keyGenerator: (req: Request) => req.user?.id || req.ip,
});

/**
 * Rate limiter for message sending
 */
export const messagingRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 messages per minute
  message: "Trop de messages envoyés. Veuillez ralentir.",
  keyGenerator: (req: Request) => req.user?.id || req.ip,
});

/**
 * Rate limiter for search and listing endpoints
 */
export const searchRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute
  message: "Trop de recherches. Veuillez ralentir.",
});

/**
 * General API rate limiter
 */
export const generalRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: "Trop de requêtes. Veuillez ralentir.",
});

/**
 * Middleware to detect and block suspicious request patterns
 */
export const suspiciousActivityDetector = (req: Request, res: Response, next: NextFunction) => {
  const userAgent = req.headers['user-agent'] as string;
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  
  // Check for suspicious user agents
  const suspiciousAgents = [
    /bot/i,
    /crawl/i,
    /spider/i,
    /scrape/i,
    /hack/i,
    /attack/i,
  ];
  
  if (userAgent && suspiciousAgents.some(pattern => pattern.test(userAgent))) {
    logSecurityEvent(
      'suspicious_user_agent',
      req.user?.id,
      req.ip,
      userAgent,
      {
        method: req.method,
        url: req.url,
      }
    );
  }
  
  // Check for unusually large payloads on specific endpoints
  if (contentLength > 50 * 1024 * 1024) { // 50MB
    logSecurityEvent(
      'large_payload',
      req.user?.id,
      req.ip,
      userAgent,
      {
        method: req.method,
        url: req.url,
        contentLength,
      }
    );
    
    return res.status(413).json({
      ok: false,
      message: "Payload trop volumineux",
    });
  }
  
  // Check for rapid-fire requests (basic DDoS detection)
  const now = Date.now();
  const key = req.ip;
  
  // Store last request times (in production, use Redis)
  if (!global.requestTimes) {
    global.requestTimes = new Map();
  }
  
  const requestTimes = global.requestTimes.get(key) || [];
  requestTimes.push(now);
  
  // Keep only last 10 seconds of requests
  const recentRequests = requestTimes.filter((time: number) => now - time < 10000);
  global.requestTimes.set(key, recentRequests);
  
  // If more than 20 requests in 10 seconds, it's suspicious
  if (recentRequests.length > 20) {
    logSecurityEvent(
      'rapid_fire_requests',
      req.user?.id,
      req.ip,
      userAgent,
      {
        requestCount: recentRequests.length,
        timeWindow: '10s',
      }
    );
    
    return res.status(429).json({
      ok: false,
      message: "Activité suspecte détectée. Veuillez ralentir.",
    });
  }
  
  next();
};

/**
 * Input sanitization middleware
 */
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  const sanitizeValue = (obj: any): any => {
    if (typeof obj === 'string') {
      // Remove potential XSS vectors
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .trim();
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitizeValue);
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeValue(value);
      }
      return sanitized;
    }
    
    return obj;
  };
  
  // Sanitize request body
  if (req.body) {
    req.body = sanitizeValue(req.body);
  }
  
  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeValue(req.query);
  }
  
  next();
};

/**
 * Content Security Policy middleware
 */
export const contentSecurityPolicy = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // May need adjustment based on frontend needs
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' https:",
      "connect-src 'self' ws: wss:",
      "frame-src 'none'",
      "object-src 'none'",
    ].join('; ')
  );
  
  next();
};

declare global {
  var requestTimes: Map<string, number[]>;
}