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
 * Mobile apps burst many parallel calls on startup — keep limits reasonable.
 */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // mobile apps load many assets on car details
  message: {
    ok: false,
    message: "Trop de requêtes. Veuillez ralentir.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return false;
    }
    const raw = String(req.originalUrl || req.url || req.path || "");
    const pathOnly = raw.split("?")[0] ?? raw;
    // Static files & image endpoints must not consume API quota.
    if (
      pathOnly.startsWith("/uploads/") ||
      pathOnly.startsWith("/api/media/") ||
      pathOnly.startsWith("/api/health") ||
      pathOnly.startsWith("/api/user-image/") ||
      pathOnly.startsWith("/api/geocode/")
    ) {
      return true;
    }
    // Public read-only car detail pages (mobile revisits same car often).
    const carDetailMatch = pathOnly.match(/^\/api\/car\/([^/]+)$/);
    if (carDetailMatch) {
      const segment = carDetailMatch[1];
      const reserved = new Set([
        "my-cars",
        "active",
        "create",
        "colors-reference",
        "verify-vin",
        "lookup-vin",
        "by-owner",
      ]);
      if (!reserved.has(segment) && /^[a-fA-F0-9]{24}$/.test(segment)) {
        return true;
      }
    }
    const rdvCarMatch = pathOnly.match(/^\/api\/rdv-workshop\/car\/([^/]+)$/);
    if (rdvCarMatch && /^[a-fA-F0-9]{24}$/.test(rdvCarMatch[1])) {
      return true;
    }
    return false;
  },
});
