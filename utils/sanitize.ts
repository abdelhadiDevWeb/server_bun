/**
 * Utility functions for sanitizing user inputs
 */

/**
 * Sanitize string input - remove dangerous characters
 */
export const sanitizeString = (input: string): string => {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .trim()
    .replace(/[<>]/g, "") // Remove < and >
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/on\w+=/gi, ""); // Remove event handlers like onclick=
};

/**
 * Sanitize email - ensure it's a valid email format
 */
export const sanitizeEmail = (email: string): string => {
  if (typeof email !== "string") {
    return "";
  }

  return email.trim().toLowerCase().replace(/[<>]/g, "");
};

/**
 * Sanitize phone number - keep only digits and allowed characters
 */
export const sanitizePhone = (phone: string): string => {
  if (typeof phone !== "string") {
    return "";
  }

  return phone.trim().replace(/[^0-9+\s()-]/g, "");
};

/**
 * Sanitize object recursively
 */
export const sanitizeObject = <T extends Record<string, any>>(obj: T): T => {
  const sanitized = { ...obj };

  for (const key in sanitized) {
    if (typeof sanitized[key] === "string") {
      if (key === "email") {
        sanitized[key] = sanitizeEmail(sanitized[key]) as any;
      } else if (key === "phone") {
        sanitized[key] = sanitizePhone(sanitized[key]) as any;
      } else {
        sanitized[key] = sanitizeString(sanitized[key]) as any;
      }
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeObject(sanitized[key]) as any;
    }
  }

  return sanitized;
};
