import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppConfig } from "../config/app.config";

// Extend Express Request to include user data
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        type: string;
        role?: string;
      };
    }
  }
}

/**
 * Middleware to verify JWT token
 */
export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Get token from header or cookie
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : req.cookies?.token;

    console.log("🔐 Auth middleware - Authorization header:", authHeader ? "Present" : "Missing");
    console.log("🔐 Auth middleware - Token from cookie:", req.cookies?.token ? "Present" : "Missing");

    if (!token) {
      console.log("❌ Auth middleware - No token found");
      res.status(401).json({
        ok: false,
        message: "Token d'authentification manquant",
      });
      return;
    }

    // Verify token
    const decoded = jwt.verify(token, AppConfig.JwtSecret) as {
      id: string;
      email: string;
      type: string;
      role?: string;
    };

    console.log("✅ Auth middleware - Token verified, user:", decoded.email, "type:", decoded.type, "role:", decoded.role);

    // Attach user data to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      type: decoded.type,
      role: decoded.role,
    };

    next();
  } catch (error) {
    console.error("❌ Auth middleware error:", error);
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        ok: false,
        message: "Token invalide ou expiré",
      });
      return;
    }

    res.status(500).json({
      ok: false,
      message: "Erreur lors de la vérification du token",
    });
  }
};

/**
 * Middleware to check if user is admin
 */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      ok: false,
      message: "Authentification requise",
    });
    return;
  }

  if (req.user.type !== "user" || req.user.role !== "admin") {
    res.status(403).json({
      ok: false,
      message: "Accès refusé. Droits administrateur requis.",
    });
    return;
  }

  next();
};

/**
 * Middleware to check if user is seller (client)
 */
export const requireSeller = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      ok: false,
      message: "Authentification requise",
    });
    return;
  }

  if (req.user.type !== "user" || req.user.role === "admin") {
    res.status(403).json({
      ok: false,
      message: "Accès refusé. Compte vendeur requis.",
    });
    return;
  }

  next();
};

/**
 * Middleware to check if user is workshop
 */
export const requireWorkshop = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({
      ok: false,
      message: "Authentification requise",
    });
    return;
  }

  if (req.user.type !== "workshop") {
    res.status(403).json({
      ok: false,
      message: "Accès refusé. Compte atelier requis.",
    });
    return;
  }

  next();
};
