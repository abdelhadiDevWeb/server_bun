import rateLimit from "express-rate-limit";

/**
 * Rate limiter for authentication routes (login, register)
 * Stricter limits to prevent brute force attacks
 */
export const authRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // 5 requests per window
  message: {
    ok: false,
    message: "Trop de tentatives. Veuillez réessayer dans 5 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
});

/**
 * Rate limiter for email verification
 */
export const emailVerificationRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // 3 verification attempts per window
  message: {
    ok: false,
    message: "Trop de tentatives de vérification. Veuillez réessayer dans 5 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for general API routes
 */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    ok: false,
    message: "Trop de requêtes. Veuillez ralentir.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
