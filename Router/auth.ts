import { Router } from "express";
import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Joi from "joi";

import { User } from "../Models/User";
import { Workshop } from "../Models/Workshop";
import { EmailVerification } from "../Models/EmailVerification";
import { Notification } from "../Models/Notification";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/emailService";
import { AppConfig } from "../config/app.config";
import { validate, validationSchemas } from "../middleware/validation.middleware";
import { 
  authRateLimiter, 
  progressiveAuthRateLimiter,
  emailVerificationRateLimiter,
  resendVerificationRateLimiter,
  passwordResetRateLimiter,
  sanitizeInput 
} from "../middleware/enhancedSecurity.middleware";
import { authenticateToken } from "../middleware/auth.middleware";
import { logUserAction, logSecurityEvent } from "../utils/logger";
import { sendPushNotification } from "../services/pushNotificationService";

const router = Router();

// Generate 6-digit code
const generateCode = (): string => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  // Ensure it's exactly 6 digits and trim any whitespace
  return code.trim().padStart(6, '0').slice(0, 6);
};

const PASSWORD_RESET_JWT_SECRET = `${AppConfig.JwtSecret}_password_reset`;

// Helper function to notify all admins
// Creates a Notification record per admin and emits Socket.IO to each admin room.
const notifyAllAdmins = async (senderId: string, message: string, type: string = 'new_register') => {
  try {
    // Get all admins
    const admins = await User.find({ role: 'admin', status: true }).select('_id').lean();
    
    if (admins.length === 0) {
      console.log('No active admins to notify');
      return;
    }

    // Get Socket.IO instance
    const io = (global as any).io;
    
    // Create notifications for all admins
    const notifications = await Promise.all(
      admins.map(async (admin: any) => {
        const notification = await Notification.create({
          id_sender: senderId,
          id_receiver: admin._id,
          message,
          type,
          is_read: false,
        });

        // Send notification via Socket.IO to admin room
        if (io) {
          io.to(`admin_${admin._id.toString()}`).emit('new_notification', {
            id: notification._id.toString(),
            id_sender: senderId,
            message,
            type,
            is_read: false,
            createdAt: notification.createdAt,
          });
        }

        // Push when admin app is in background or killed (same as chat / RDV flows)
        const pushTitle =
          type === "new_register" ? "Nouvelle inscription" : "CarSure";
        await sendPushNotification(admin._id, pushTitle, message, {
          notificationId: notification._id.toString(),
          type,
          senderId: senderId,
        });

        return notification;
      })
    );

    // Also broadcast a lightweight event to all connected admins.
    // Each admin dashboard can refetch unread notifications (including those created for other admins).
    if (io) {
      io.to('admins').emit('admin_notifications_updated', {
        type,
        message,
        createdAt: new Date().toISOString(),
      });
    }

    console.log(`✅ Notified ${notifications.length} admins about: ${message}`);
  } catch (error: any) {
    console.error('Error notifying admins:', error);
  }
};

router.post("/register/user", authRateLimiter, validate(validationSchemas.registerUser), async (req: Request, res: Response) => {
  try {
    // Body is already validated and sanitized by Joi middleware
    const { firstName, lastName, email, phone, password } = req.body;

    // Check if email already exists in User table
    const normalizedEmail = email.toLowerCase().trim();
    console.log(`🔍 Checking email for user registration: ${normalizedEmail}`);
    
    const existingEmailUser = await User.findOne({ email: normalizedEmail }).lean();
    if (existingEmailUser) {
      console.log(`❌ Email already exists in User table: ${normalizedEmail}`);
      return res.status(409).json({ 
        ok: false, 
        message: "Cet email est déjà utilisé par un compte client. Veuillez utiliser un autre email ou vous connecter." 
      });
    }

    // Check if email already exists in Workshop table
    const existingEmailWorkshop = await Workshop.findOne({ email: normalizedEmail }).lean();
    if (existingEmailWorkshop) {
      console.log(`❌ Email already exists in Workshop table: ${normalizedEmail}`);
      return res.status(409).json({ 
        ok: false, 
        message: "Cet email est déjà utilisé par un compte atelier. Veuillez utiliser un autre email ou vous connecter." 
      });
    }
    
    console.log(`✅ Email is available: ${normalizedEmail}`);

    // Check if phone already exists in User table
    const existingPhoneUser = await User.findOne({ phone: phone.trim() }).lean();
    if (existingPhoneUser) {
      return res.status(409).json({ 
        ok: false, 
        message: "Ce numéro de téléphone est déjà utilisé. Veuillez utiliser un autre numéro." 
      });
    }

    // Check if phone already exists in Workshop table
    const existingPhoneWorkshop = await Workshop.findOne({ phone: phone.trim() }).lean();
    if (existingPhoneWorkshop) {
      return res.status(409).json({ 
        ok: false, 
        message: "Ce numéro de téléphone est déjà utilisé. Veuillez utiliser un autre numéro." 
      });
    }

    const hashed = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone,
      password: hashed,
      role: 'client', // Set role to 'client' for regular user registration
      // status/verfie default false
    });

    // Generate and send verification code
    const code = generateCode();
    // Ensure code is exactly 6 digits, no spaces, no other characters
    const cleanCode = String(code).replace(/\D/g, '').trim().padStart(6, '0').slice(0, 6);
    
    console.log(`📧 Generated verification code for ${email.toLowerCase()}: "${cleanCode}" (type: ${typeof cleanCode}, length: ${cleanCode.length})`);
    
    const verificationDoc = await EmailVerification.create({
      email: email.toLowerCase().trim(),
      code: cleanCode, // Store exactly as generated (6 digits only)
      type: "user",
      purpose: "email_verification",
    });
    
    const savedCode = String(verificationDoc.code || '').replace(/\D/g, '').trim();
    console.log(`💾 Code saved to database: "${savedCode}" (type: ${typeof savedCode}, length: ${savedCode.length})`);
    
    // Verify the saved code matches what we're sending
    if (savedCode !== cleanCode) {
      console.error(`⚠️  WARNING: Code mismatch! Generated: "${cleanCode}" vs Saved: "${savedCode}"`);
    } else {
      console.log(`✅ Code saved correctly: "${cleanCode}"`);
    }

    // Run side-effects in background so registration response is never blocked.
    void (async () => {
      try {
        console.log(`📨 [register/user] Sending verification email to ${email}...`);
        const emailSent = await sendVerificationEmail(email, cleanCode);
        if (!emailSent) {
          console.error("Failed to send verification email to:", email);
          console.log("⚠️  Verification code (for testing):", cleanCode);
        } else {
          console.log(`✅ Verification email sent to: ${email} with code: ${cleanCode}`);
        }
      } catch (e) {
        console.error("Background sendVerificationEmail failed:", e);
      }
    })();

    void notifyAllAdmins(
      user._id.toString(),
      `Un nouveau client s'est inscrit: ${firstName} ${lastName} (${email})`
    ).catch((e) => {
      console.error("Background notifyAllAdmins failed:", e);
    });

    return res.status(201).json({
      ok: true,
      user: user.toJSON(),
      message: "Compte créé. Vérifiez votre email pour le code de confirmation.",
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message ?? "Server error" });
  }
});

router.post("/register/workshop", authRateLimiter, validate(validationSchemas.registerWorkshop), async (req: Request, res: Response) => {
  try {
    // Body is already validated and sanitized by Joi middleware
    const {
      name,
      email,
      adr,
      phone,
      type,
      password,
      locationLat,
      locationLng,
      locationFormattedAddress,
      googlePlaceId,
      locationCity,
      locationRegion,
      locationPostalCode,
      locationCountry,
      locationNeighborhood,
      locationStreetLine,
    } = req.body;

    if (!name || !email || !adr || !phone || !password) {
      return res.status(400).json({
        ok: false,
        message: "Missing fields: name, email, adr, phone, password",
      });
    }

    // Check if email already exists in Workshop table
    const normalizedEmail = email.toLowerCase().trim();
    console.log(`🔍 Checking email for workshop registration: ${normalizedEmail}`);
    
    const existingEmailWorkshop = await Workshop.findOne({ email: normalizedEmail }).lean();
    if (existingEmailWorkshop) {
      console.log(`❌ Email already exists in Workshop table: ${normalizedEmail}`);
      return res.status(409).json({ 
        ok: false, 
        message: "Cet email est déjà utilisé par un compte atelier. Veuillez utiliser un autre email ou vous connecter." 
      });
    }

    // Check if email already exists in User table
    const existingEmailUser = await User.findOne({ email: normalizedEmail }).lean();
    if (existingEmailUser) {
      console.log(`❌ Email already exists in User table: ${normalizedEmail}`);
      return res.status(409).json({ 
        ok: false, 
        message: "Cet email est déjà utilisé par un compte client. Veuillez utiliser un autre email ou vous connecter." 
      });
    }
    
    console.log(`✅ Email is available: ${normalizedEmail}`);

    // Check if phone already exists in Workshop table
    const existingPhoneWorkshop = await Workshop.findOne({ phone: phone.trim() }).lean();
    if (existingPhoneWorkshop) {
      return res.status(409).json({ 
        ok: false, 
        message: "Ce numéro de téléphone est déjà utilisé. Veuillez utiliser un autre numéro." 
      });
    }

    // Check if phone already exists in User table
    const existingPhoneUser = await User.findOne({ phone: phone.trim() }).lean();
    if (existingPhoneUser) {
      return res.status(409).json({ 
        ok: false, 
        message: "Ce numéro de téléphone est déjà utilisé. Veuillez utiliser un autre numéro." 
      });
    }

    const hashed = await bcrypt.hash(String(password), 10);
    const workshop = await Workshop.create({
      name,
      email: email.toLowerCase(),
      adr,
      phone,
      type,
      password: hashed,
      locationLat,
      locationLng,
      locationFormattedAddress: locationFormattedAddress ?? null,
      googlePlaceId: googlePlaceId ?? null,
      locationCity: locationCity ?? null,
      locationRegion: locationRegion ?? null,
      locationPostalCode: locationPostalCode ?? null,
      locationCountry: locationCountry ?? null,
      locationNeighborhood: locationNeighborhood ?? null,
      locationStreetLine: locationStreetLine ?? null,
      // status/verfie default false
    });

    // Generate and send verification code
    const code = generateCode();
    // Ensure code is exactly 6 digits, no spaces, no other characters
    const cleanCode = String(code).replace(/\D/g, '').trim().padStart(6, '0').slice(0, 6);
    
    console.log(`📧 Generated verification code for ${email.toLowerCase()}: "${cleanCode}" (type: ${typeof cleanCode}, length: ${cleanCode.length})`);
    
    const verificationDoc = await EmailVerification.create({
      email: email.toLowerCase().trim(),
      code: cleanCode, // Store exactly as generated (6 digits only)
      type: "workshop",
      purpose: "email_verification",
    });
    
    const savedCode = String(verificationDoc.code || '').replace(/\D/g, '').trim();
    console.log(`💾 Code saved to database: "${savedCode}" (type: ${typeof savedCode}, length: ${savedCode.length})`);
    
    // Verify the saved code matches what we're sending
    if (savedCode !== cleanCode) {
      console.error(`⚠️  WARNING: Code mismatch! Generated: "${cleanCode}" vs Saved: "${savedCode}"`);
    } else {
      console.log(`✅ Code saved correctly: "${cleanCode}"`);
    }

    // Run side-effects in background so registration response is never blocked.
    void (async () => {
      try {
        console.log(`📨 [register/workshop] Sending verification email to ${email}...`);
        const emailSent = await sendVerificationEmail(email, cleanCode);
        if (!emailSent) {
          console.error("Failed to send verification email to:", email);
          console.log("⚠️  Verification code (for testing):", cleanCode);
        } else {
          console.log(`✅ Verification email sent to: ${email} with code: ${cleanCode}`);
        }
      } catch (e) {
        console.error("Background sendVerificationEmail failed:", e);
      }
    })();

    void notifyAllAdmins(
      workshop._id.toString(),
      `Un nouvel atelier s'est inscrit: ${name} (${email})`
    ).catch((e) => {
      console.error("Background notifyAllAdmins failed:", e);
    });

    return res.status(201).json({
      ok: true,
      workshop: workshop.toJSON(),
      message: "Compte créé. Vérifiez votre email pour le code de confirmation.",
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message ?? "Server error" });
  }
});

// Verify email endpoint
router.post("/verify-email", emailVerificationRateLimiter, validate(validationSchemas.verifyEmail), async (req: Request, res: Response) => {
  try {
    // Body is already validated and sanitized by Joi middleware
    const { email, code, type } = req.body;

    if (!email || !code || !type) {
      return res.status(400).json({
        ok: false,
        message: "Missing fields: email, code, type",
      });
    }

    // Normalize type: map "client" to "user" for backward compatibility
    const normalizedType = type === "client" ? "user" : type;

    // Normalize the code: remove all non-digits and ensure it's exactly 6 digits
    const normalizedCode = String(code).replace(/\D/g, '').trim().padStart(6, '0').slice(0, 6);
    
    if (normalizedCode.length !== 6) {
      return res.status(400).json({
        ok: false,
        message: "Le code doit contenir exactement 6 chiffres.",
      });
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Debug: log what we're looking for
    console.log(`🔍 Verifying code for ${normalizedEmail}, type: ${type} (normalized: ${normalizedType})`);
    console.log(`   Looking for code: "${normalizedCode}" (length: ${normalizedCode.length}, type: ${typeof normalizedCode})`);

    // Find all verification codes for this email and type
    const verifications = await EmailVerification.find({
      email: normalizedEmail,
      type: normalizedType,
      purpose: "email_verification",
    });
    
    console.log(`   Found ${verifications.length} verification(s) in database with type: ${normalizedType}`);
    console.log(`   Input code to verify: "${normalizedCode}" (length: ${normalizedCode.length})`);

    // Find matching code by comparing normalized values
    let verification = null;
    
    if (verifications.length > 0) {
      console.log(`   📋 Comparing with stored codes:`);
      for (const v of verifications) {
        // Get the raw code from database and normalize it exactly like input
        const storedCodeRaw = v.code ? String(v.code) : '';
        const storedCodeNormalized = storedCodeRaw.replace(/\D/g, '').trim().padStart(6, '0').slice(0, 6);
        
        console.log(`      Code ID: ${v._id}`);
        console.log(`      - Raw from DB: "${storedCodeRaw}"`);
        console.log(`      - Normalized: "${storedCodeNormalized}" (length: ${storedCodeNormalized.length})`);
        console.log(`      - Input normalized: "${normalizedCode}" (length: ${normalizedCode.length})`);
        console.log(`      - Are they equal? ${storedCodeNormalized === normalizedCode ? '✅ YES' : '❌ NO'}`);
        
        // Compare normalized codes (strict equality)
        if (storedCodeNormalized === normalizedCode) {
          verification = v;
          console.log(`   ✅✅✅ MATCH FOUND! Verification ID: ${v._id}`);
          break;
        }
      }
    }

    // If still not found, try direct MongoDB query (in case code is stored exactly as normalized)
    if (!verification) {
      console.log(`   🔍 Trying direct MongoDB query with normalized code: "${normalizedCode}"`);
      verification = await EmailVerification.findOne({
        email: normalizedEmail,
        code: normalizedCode,
        type: normalizedType,
        purpose: "email_verification",
      });
      if (verification) {
        console.log(`   ✅ Direct MongoDB query match found!`);
      }
    }

    if (!verification) {
      console.log(`   ❌ No matching code found`);
      return res.status(400).json({ 
        ok: false, 
        message: "Code invalide. Vérifiez que vous avez entré le bon code." 
      });
    }

    // Check if code is expired
    const now = new Date();
    if (verification.expiresAt < now) {
      await EmailVerification.deleteOne({ _id: verification._id });
      return res.status(400).json({ 
        ok: false, 
        message: "Code expiré. Le code est valide pendant 15 minutes. Veuillez vous réinscrire." 
      });
    }

    // Update user/workshop verfie status
    if (type === "user") {
      await User.updateOne({ email: email.toLowerCase() }, { verfie: true });
    } else if (type === "workshop") {
      await Workshop.updateOne({ email: email.toLowerCase() }, { verfie: true });
    }

    // Delete used verification code
    await EmailVerification.deleteOne({ _id: verification._id });
    console.log(`✅ Email verified successfully for ${email.toLowerCase()}`);

    return res.status(200).json({ ok: true, message: "Email vérifié avec succès!" });
  } catch (err: any) {
    console.error("❌ Error verifying email:", err);
    return res.status(500).json({ ok: false, message: err?.message ?? "Server error" });
  }
});

// Resend email verification code (unverified accounts only)
router.post(
  "/resend-verification",
  sanitizeInput,
  resendVerificationRateLimiter,
  validate(validationSchemas.resendVerification),
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      let account = await User.findOne({ email: normalizedEmail }).lean();
      let accType: "user" | "workshop" = "user";

      if (!account) {
        const w = await Workshop.findOne({ email: normalizedEmail }).lean();
        if (!w) {
          return res.status(200).json({ ok: true, sent: false });
        }
        account = w;
        accType = "workshop";
      }

      if (account.verfie) {
        return res.status(400).json({
          ok: false,
          alreadyVerified: true,
          message: "Cet email est déjà vérifié.",
        });
      }

      await EmailVerification.deleteMany({
        email: normalizedEmail,
        type: accType,
        purpose: "email_verification",
      });

      const code = generateCode();
      const cleanCode = String(code)
        .replace(/\D/g, "")
        .trim()
        .padStart(6, "0")
        .slice(0, 6);

      await EmailVerification.create({
        email: normalizedEmail,
        code: cleanCode,
        type: accType,
        purpose: "email_verification",
      });

      const emailSent = await sendVerificationEmail(normalizedEmail, cleanCode);

      return res.status(200).json({
        ok: true,
        sent: emailSent,
        ...(process.env.NODE_ENV !== "production" && !emailSent
          ? { verificationCode: cleanCode }
          : {}),
      });
    } catch (err: any) {
      console.error("Resend verification error:", err);
      return res
        .status(500)
        .json({ ok: false, message: err?.message ?? "Server error" });
    }
  }
);

router.post(
  "/forgot-password/request",
  sanitizeInput,
  passwordResetRateLimiter,
  validate(validationSchemas.forgotPasswordRequest),
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      const userAccount = await User.findOne({ email: normalizedEmail }).lean();
      const workshopAccount = !userAccount
        ? await Workshop.findOne({ email: normalizedEmail }).lean()
        : null;

      if (!userAccount && !workshopAccount) {
        return res.status(404).json({
          ok: false,
          message: "Aucun compte trouvé avec cet email.",
        });
      }

      const accountType: "user" | "workshop" = userAccount ? "user" : "workshop";
      const code = generateCode();
      const cleanCode = String(code).replace(/\D/g, "").trim().padStart(6, "0").slice(0, 6);

      await EmailVerification.deleteMany({
        email: normalizedEmail,
        type: accountType,
        purpose: "password_reset",
      });

      await EmailVerification.create({
        email: normalizedEmail,
        code: cleanCode,
        type: accountType,
        purpose: "password_reset",
      });

      const sent = await sendPasswordResetEmail(normalizedEmail, cleanCode);
      if (!sent) {
        return res.status(500).json({
          ok: false,
          message: "Impossible d'envoyer le code de réinitialisation.",
        });
      }

      return res.status(200).json({
        ok: true,
        message: "Code de réinitialisation envoyé par email.",
        accountType,
      });
    } catch (err: any) {
      console.error("Forgot password request error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Server error",
      });
    }
  }
);

router.post(
  "/forgot-password/verify-code",
  sanitizeInput,
  passwordResetRateLimiter,
  validate(validationSchemas.forgotPasswordVerifyCode),
  async (req: Request, res: Response) => {
    try {
      const { email, code, type } = req.body;
      const normalizedEmail = email.toLowerCase().trim();
      const normalizedCode = String(code).replace(/\D/g, "").trim().padStart(6, "0").slice(0, 6);

      const verification = await EmailVerification.findOne({
        email: normalizedEmail,
        type,
        code: normalizedCode,
        purpose: "password_reset",
      }).sort({ createdAt: -1 });

      if (!verification) {
        return res.status(400).json({
          ok: false,
          message: "Code invalide.",
        });
      }

      if (verification.expiresAt < new Date()) {
        await EmailVerification.deleteOne({ _id: verification._id });
        return res.status(400).json({
          ok: false,
          message: "Code expiré.",
        });
      }

      const resetToken = jwt.sign(
        {
          email: normalizedEmail,
          type,
          purpose: "password_reset",
        },
        PASSWORD_RESET_JWT_SECRET,
        { expiresIn: "15m" }
      );

      await EmailVerification.deleteOne({ _id: verification._id });

      return res.status(200).json({
        ok: true,
        resetToken,
        message: "Code vérifié avec succès.",
      });
    } catch (err: any) {
      console.error("Forgot password verify code error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Server error",
      });
    }
  }
);

router.post(
  "/forgot-password/reset",
  sanitizeInput,
  passwordResetRateLimiter,
  validate(validationSchemas.forgotPasswordReset),
  async (req: Request, res: Response) => {
    try {
      const { resetToken, newPassword } = req.body;

      const payload = jwt.verify(resetToken, PASSWORD_RESET_JWT_SECRET) as {
        email?: string;
        type?: "user" | "workshop";
        purpose?: string;
      };

      if (!payload?.email || !payload?.type || payload.purpose !== "password_reset") {
        return res.status(401).json({
          ok: false,
          message: "Token de réinitialisation invalide.",
        });
      }

      const hashedPassword = await bcrypt.hash(String(newPassword), 10);

      if (payload.type === "user") {
        const updated = await User.updateOne(
          { email: payload.email.toLowerCase().trim() },
          { password: hashedPassword }
        );
        if (!updated.matchedCount) {
          return res.status(404).json({ ok: false, message: "Compte introuvable." });
        }
      } else {
        const updated = await Workshop.updateOne(
          { email: payload.email.toLowerCase().trim() },
          { password: hashedPassword }
        );
        if (!updated.matchedCount) {
          return res.status(404).json({ ok: false, message: "Compte introuvable." });
        }
      }

      await EmailVerification.deleteMany({
        email: payload.email.toLowerCase().trim(),
        type: payload.type,
        purpose: "password_reset",
      });

      return res.status(200).json({
        ok: true,
        message: "Mot de passe réinitialisé avec succès.",
      });
    } catch (err: any) {
      if (err?.name === "TokenExpiredError" || err?.name === "JsonWebTokenError") {
        return res.status(401).json({
          ok: false,
          message: "Session expirée. Recommencez la réinitialisation.",
        });
      }
      console.error("Forgot password reset error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Server error",
      });
    }
  }
);

// Login endpoint
router.post("/login", 
  sanitizeInput,
  authRateLimiter,
  progressiveAuthRateLimiter,
  validate(validationSchemas.login), 
  async (req: Request, res: Response) => {
  try {
    // Body is already validated and sanitized by Joi middleware
    const { email, password } = req.body;
    
    // Log login attempt
    logUserAction(
      email,
      'login_attempt',
      'authentication',
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
      req.logger
    );

    // Try to find user first
    let user = await User.findOne({ email: email.toLowerCase().trim() }).lean();
    let userType = "user";

    // If not found, try workshop
    if (!user) {
      user = await Workshop.findOne({ email: email.toLowerCase().trim() }).lean();
      userType = "workshop";
    }

    if (!user) {
      // Log failed login attempt
      logSecurityEvent(
        'login_failed_user_not_found',
        undefined,
        req.ip,
        req.headers['user-agent'] as string,
        {
          email,
          reason: 'user_not_found',
        },
        req.logger
      );
      
      return res.status(401).json({
        ok: false,
        message: "Email ou mot de passe incorrect",
      });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(String(password), user.password);
    if (!passwordMatch) {
      // Log failed login attempt
      logSecurityEvent(
        'login_failed_wrong_password',
        (user as any)._id?.toString(),
        req.ip,
        req.headers['user-agent'] as string,
        {
          email,
          reason: 'wrong_password',
        },
        req.logger
      );
      
      return res.status(401).json({
        ok: false,
        message: "Email ou mot de passe incorrect",
      });
    }

    // If email is not verified yet, send a fresh verification code and require confirmation.
    // We return needsVerification so frontend can open confirmation modal.
    if (!user.verfie) {
      let verificationEmailSent = false;
      let cleanLoginCodeForDev: string | undefined;
      try {
        const normalizedEmail = user.email.toLowerCase().trim();
        const verificationType = userType === "workshop" ? "workshop" : "user";
        await EmailVerification.deleteMany({
          email: normalizedEmail,
          type: verificationType,
          purpose: "email_verification",
        });
        const loginCode = generateCode();
        const cleanLoginCode = String(loginCode)
          .replace(/\D/g, "")
          .trim()
          .padStart(6, "0")
          .slice(0, 6);
        cleanLoginCodeForDev = cleanLoginCode;
        await EmailVerification.create({
          email: normalizedEmail,
          code: cleanLoginCode,
          type: verificationType,
          purpose: "email_verification",
        });
        verificationEmailSent = await sendVerificationEmail(normalizedEmail, cleanLoginCode);
        if (!verificationEmailSent) {
          console.error(`Failed to send login verification email to: ${normalizedEmail}`);
        }
      } catch (verificationEmailErr: any) {
        console.error("Error while resending login verification code:", verificationEmailErr);
      }

      return res.status(403).json({
        ok: false,
        needsVerification: true,
        verificationEmailSent,
        accountType: userType,
        email: user.email,
        message: verificationEmailSent
          ? "Votre email n'est pas encore vérifié. Un code de confirmation a été envoyé."
          : "Votre email n'est pas encore vérifié. L'envoi du code a échoué — vérifiez la configuration email du serveur ou réessayez.",
        ...(process.env.NODE_ENV !== "production" && !verificationEmailSent && cleanLoginCodeForDev
          ? { verificationCode: cleanLoginCodeForDev }
          : {}),
      });
    }

    // Check if account is activated by admin (status)
    // For admin role, status check might be different, but we still check it
    if (!user.status) {
      return res.status(403).json({
        ok: false,
        message: "Votre email est confirmé, mais vous n'avez pas d'abonnement actif. Veuillez contacter l'administrateur.",
        needsActivation: true,
        status: false,
      });
    }

    // Get user role (for User table) or default to null for Workshop
    const userRole = userType === "user" ? (user as any).role || "client" : null;

    // Generate JWT token
    // When using .lean(), virtuals are not available, so use _id directly
    const userId = (user as any)._id?.toString();
    
    if (!userId) {
      console.error("❌ Login - No user ID found");
      return res.status(500).json({
        ok: false,
        message: "Erreur lors de la génération du token",
      });
    }
    
    const token = jwt.sign(
      {
        id: userId,
        email: user.email,
        type: userType,
        role: userRole, // Include role in token
      },
      AppConfig.JwtSecret,
      { expiresIn: "7d" }
    );

    // Log successful login
    logUserAction(
      userId,
      'login_success',
      'authentication',
      {
        userType,
        role: userRole,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
      req.logger
    );

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    // For workshops, add workshopType field and set type to "workshop"
    let userResponse = userWithoutPassword;
    if (userType === "workshop") {
      userResponse = {
        ...userWithoutPassword,
        type: "workshop",
        workshopType: (userWithoutPassword as any).type, // The workshop type (mechanic, paint_vehicle, etc.)
        price_visit_mec: (userWithoutPassword as any).price_visit_mec,
        price_visit_paint: (userWithoutPassword as any).price_visit_paint,
      };
    }

    return res.status(200).json({
      ok: true,
      message: "Connexion réussie",
      token,
      user: userResponse,
      type: userType,
      role: userRole, // Include role in response
    });
  } catch (err: any) {
    console.error("Login error:", err);
    return res.status(500).json({ ok: false, message: err?.message ?? "Erreur serveur" });
  }
});

// Logout endpoint
// Get current user endpoint
// Get user by ID (public endpoint)
router.get("/user/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId).select('-password').lean();

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Utilisateur non trouvé",
      });
    }

    return res.status(200).json({
      ok: true,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        status: user.status,
        role: user.role,
        certifie: user.certifie,
      },
    });
  } catch (err: any) {
    console.error("Get user by ID error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

router.get("/me", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userType = req.user?.type;

    if (!userId || !userType) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    // Fetch user data based on type
    if (userType === "user") {
      const user = await User.findById(userId).select("-password").lean();
      if (!user) {
        return res.status(404).json({
          ok: false,
          message: "Utilisateur non trouvé",
        });
      }
      return res.status(200).json({
        ok: true,
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          status: user.status,
          role: user.role,
          certifie: user.certifie,
          type: "user",
          locationLat: (user as any).locationLat ?? null,
          locationLng: (user as any).locationLng ?? null,
          locationFormattedAddress: (user as any).locationFormattedAddress ?? null,
          locationRegion: (user as any).locationRegion ?? null,
          locationCity: (user as any).locationCity ?? null,
          locationCountry: (user as any).locationCountry ?? null,
          createdAt: user.createdAt ?? null,
        },
      });
    } else if (userType === "workshop") {
      const workshop = await Workshop.findById(userId).select("-password").lean();
      if (!workshop) {
        return res.status(404).json({
          ok: false,
          message: "Atelier non trouvé",
        });
      }
      return res.status(200).json({
        ok: true,
        user: {
          _id: workshop._id,
          name: workshop.name,
          email: workshop.email,
          adr: workshop.adr,
          phone: workshop.phone,
          status: workshop.status,
          type: "workshop",
          workshopType: workshop.type, // Include workshop type (mechanic, paint_vehicle, or mechanic_paint_inspector)
          verfie: workshop.verfie,
          certifie: workshop.certifie,
          price_visit_mec: workshop.price_visit_mec,
          price_visit_paint: workshop.price_visit_paint,
          locationLat: workshop.locationLat ?? null,
          locationLng: workshop.locationLng ?? null,
          locationFormattedAddress: workshop.locationFormattedAddress ?? null,
          googlePlaceId: workshop.googlePlaceId ?? null,
          locationCity: workshop.locationCity ?? null,
          locationRegion: workshop.locationRegion ?? null,
          locationPostalCode: workshop.locationPostalCode ?? null,
          locationCountry: workshop.locationCountry ?? null,
          locationNeighborhood: workshop.locationNeighborhood ?? null,
          locationStreetLine: workshop.locationStreetLine ?? null,
          createdAt: workshop.createdAt ?? null,
        },
      });
    }

    return res.status(400).json({
      ok: false,
      message: "Type d'utilisateur invalide",
    });
  } catch (err: any) {
    console.error("Get user error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Update user profile endpoint
const updateProfileSchema = Joi.object({
  firstName: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    .optional()
    .messages({
      "string.min": "Le prénom doit contenir au moins 2 caractères",
      "string.max": "Le prénom ne peut pas dépasser 50 caractères",
      "string.pattern.base": "Le prénom ne peut contenir que des lettres",
    }),
  lastName: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    .optional()
    .messages({
      "string.min": "Le nom doit contenir au moins 2 caractères",
      "string.max": "Le nom ne peut pas dépasser 50 caractères",
      "string.pattern.base": "Le nom ne peut contenir que des lettres",
    }),
  phone: Joi.string()
    .trim()
    .pattern(/^[0-9+\s()-]{8,20}$/)
    .optional()
    .messages({
      "string.pattern.base": "Format de téléphone invalide",
    }),
  // Workshop fields
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .messages({
      "string.min": "Le nom doit contenir au moins 2 caractères",
      "string.max": "Le nom ne peut pas dépasser 100 caractères",
    }),
  adr: Joi.string()
    .trim()
    .max(200)
    .optional()
    .messages({
      "string.max": "L'adresse ne peut pas dépasser 200 caractères",
    }),
  price_visit_mec: Joi.number()
    .min(0)
    .optional()
    .allow(null)
    .messages({
      "number.min": "Le prix de visite mécanique doit être positif ou nul",
      "number.base": "Le prix de visite mécanique doit être un nombre",
    }),
  price_visit_paint: Joi.number()
    .min(0)
    .optional()
    .allow(null)
    .messages({
      "number.min": "Le prix de visite peinture doit être positif ou nul",
      "number.base": "Le prix de visite peinture doit être un nombre",
    }),
  locationLat: Joi.number().min(-90).max(90).optional().allow(null),
  locationLng: Joi.number().min(-180).max(180).optional().allow(null),
  locationFormattedAddress: Joi.string().trim().max(500).optional().allow(null, ""),
  googlePlaceId: Joi.string().trim().max(255).optional().allow(null, ""),
  locationCity: Joi.string().trim().max(120).optional().allow(null, ""),
  locationRegion: Joi.string().trim().max(120).optional().allow(null, ""),
  locationPostalCode: Joi.string().trim().max(32).optional().allow(null, ""),
  locationCountry: Joi.string().trim().max(120).optional().allow(null, ""),
  locationNeighborhood: Joi.string().trim().max(200).optional().allow(null, ""),
  locationStreetLine: Joi.string().trim().max(300).optional().allow(null, ""),
  // Email cannot be changed
});

router.put(
  "/profile",
  authenticateToken,
  validate(updateProfileSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;

      if (!userId || !userType) {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      if (userType === "user") {
        const user = await User.findById(userId);
        if (!user) {
          return res.status(404).json({
            ok: false,
            message: "Utilisateur non trouvé",
          });
        }

        // Update allowed fields
        if (req.body.firstName) user.firstName = req.body.firstName;
        if (req.body.lastName) user.lastName = req.body.lastName;
        if (req.body.phone) user.phone = req.body.phone;
        if (req.body.locationLat !== undefined) {
          (user as any).locationLat =
            req.body.locationLat === null || req.body.locationLat === ""
              ? null
              : Number(req.body.locationLat);
        }
        if (req.body.locationLng !== undefined) {
          (user as any).locationLng =
            req.body.locationLng === null || req.body.locationLng === ""
              ? null
              : Number(req.body.locationLng);
        }
        if (req.body.locationFormattedAddress !== undefined) {
          (user as any).locationFormattedAddress =
            req.body.locationFormattedAddress === null || req.body.locationFormattedAddress === ""
              ? null
              : String(req.body.locationFormattedAddress).trim();
        }
        if (req.body.locationRegion !== undefined) {
          (user as any).locationRegion =
            req.body.locationRegion === null || req.body.locationRegion === ""
              ? null
              : String(req.body.locationRegion).trim();
        }
        if (req.body.locationCity !== undefined) {
          (user as any).locationCity =
            req.body.locationCity === null || req.body.locationCity === ""
              ? null
              : String(req.body.locationCity).trim();
        }
        if (req.body.locationCountry !== undefined) {
          (user as any).locationCountry =
            req.body.locationCountry === null || req.body.locationCountry === ""
              ? null
              : String(req.body.locationCountry).trim();
        }

        await user.save();

        return res.status(200).json({
          ok: true,
          message: "Profil mis à jour avec succès",
          user: {
            _id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            status: user.status,
            role: user.role,
            certifie: user.certifie,
            type: "user",
            locationLat: (user as any).locationLat ?? null,
            locationLng: (user as any).locationLng ?? null,
            locationFormattedAddress: (user as any).locationFormattedAddress ?? null,
            locationRegion: (user as any).locationRegion ?? null,
            locationCity: (user as any).locationCity ?? null,
            locationCountry: (user as any).locationCountry ?? null,
          },
        });
      } else if (userType === "workshop") {
        const workshop = await Workshop.findById(userId);
        if (!workshop) {
          return res.status(404).json({
            ok: false,
            message: "Atelier non trouvé",
          });
        }

        // Update allowed fields for workshop
        if (req.body.name) workshop.name = req.body.name;
        if (req.body.phone) workshop.phone = req.body.phone;
        if (req.body.adr) workshop.adr = req.body.adr;
        if (req.body.price_visit_mec !== undefined) {
          workshop.price_visit_mec = req.body.price_visit_mec === null || req.body.price_visit_mec === '' ? null : Number(req.body.price_visit_mec);
        }
        if (req.body.price_visit_paint !== undefined) {
          workshop.price_visit_paint = req.body.price_visit_paint === null || req.body.price_visit_paint === '' ? null : Number(req.body.price_visit_paint);
        }
        if (req.body.locationLat !== undefined) {
          workshop.locationLat =
            req.body.locationLat === null || req.body.locationLat === "" ? null : Number(req.body.locationLat);
        }
        if (req.body.locationLng !== undefined) {
          workshop.locationLng =
            req.body.locationLng === null || req.body.locationLng === "" ? null : Number(req.body.locationLng);
        }
        if (req.body.locationFormattedAddress !== undefined) {
          workshop.locationFormattedAddress =
            req.body.locationFormattedAddress === null || req.body.locationFormattedAddress === ""
              ? null
              : String(req.body.locationFormattedAddress).trim();
        }
        if (req.body.googlePlaceId !== undefined) {
          workshop.googlePlaceId =
            req.body.googlePlaceId === null || req.body.googlePlaceId === ""
              ? null
              : String(req.body.googlePlaceId).trim();
        }
        if (req.body.locationCity !== undefined) {
          workshop.locationCity =
            req.body.locationCity === null || req.body.locationCity === ""
              ? null
              : String(req.body.locationCity).trim();
        }
        if (req.body.locationRegion !== undefined) {
          workshop.locationRegion =
            req.body.locationRegion === null || req.body.locationRegion === ""
              ? null
              : String(req.body.locationRegion).trim();
        }
        if (req.body.locationPostalCode !== undefined) {
          workshop.locationPostalCode =
            req.body.locationPostalCode === null || req.body.locationPostalCode === ""
              ? null
              : String(req.body.locationPostalCode).trim();
        }
        if (req.body.locationCountry !== undefined) {
          workshop.locationCountry =
            req.body.locationCountry === null || req.body.locationCountry === ""
              ? null
              : String(req.body.locationCountry).trim();
        }
        if (req.body.locationNeighborhood !== undefined) {
          workshop.locationNeighborhood =
            req.body.locationNeighborhood === null || req.body.locationNeighborhood === ""
              ? null
              : String(req.body.locationNeighborhood).trim();
        }
        if (req.body.locationStreetLine !== undefined) {
          workshop.locationStreetLine =
            req.body.locationStreetLine === null || req.body.locationStreetLine === ""
              ? null
              : String(req.body.locationStreetLine).trim();
        }

        await workshop.save();

        return res.status(200).json({
          ok: true,
          message: "Profil mis à jour avec succès",
          user: {
            _id: workshop._id,
            name: workshop.name,
            email: workshop.email,
            adr: workshop.adr,
            phone: workshop.phone,
            status: workshop.status,
            price_visit_mec: workshop.price_visit_mec,
            price_visit_paint: workshop.price_visit_paint,
            locationLat: workshop.locationLat ?? null,
            locationLng: workshop.locationLng ?? null,
            locationFormattedAddress: workshop.locationFormattedAddress ?? null,
            googlePlaceId: workshop.googlePlaceId ?? null,
            locationCity: workshop.locationCity ?? null,
            locationRegion: workshop.locationRegion ?? null,
            locationPostalCode: workshop.locationPostalCode ?? null,
            locationCountry: workshop.locationCountry ?? null,
            locationNeighborhood: workshop.locationNeighborhood ?? null,
            locationStreetLine: workshop.locationStreetLine ?? null,
            certifie: workshop.certifie,
            type: "workshop",
            workshopType: workshop.type,
          },
        });
      }

      return res.status(400).json({
        ok: false,
        message: "Type d'utilisateur invalide",
      });
    } catch (err: any) {
      console.error("Update profile error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

// Change password endpoint
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().messages({
    "any.required": "Le mot de passe actuel est requis",
  }),
  newPassword: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      "string.min": "Le nouveau mot de passe doit contenir au moins 8 caractères",
      "string.max": "Le nouveau mot de passe ne peut pas dépasser 128 caractères",
      "string.pattern.base":
        "Le nouveau mot de passe doit contenir au moins une majuscule, une minuscule, un chiffre et un caractère spécial",
      "any.required": "Le nouveau mot de passe est requis",
    }),
});

router.put(
  "/password",
  authenticateToken,
  validate(changePasswordSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const userType = req.user?.type;
      const { currentPassword, newPassword } = req.body;

      if (!userId || !userType) {
        return res.status(401).json({
          ok: false,
          message: "Utilisateur non authentifié",
        });
      }

      if (userType === "user") {
        const user = await User.findById(userId);
        if (!user) {
          return res.status(404).json({
            ok: false,
            message: "Utilisateur non trouvé",
          });
        }

        // Verify current password
        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
          return res.status(401).json({
            ok: false,
            message: "Mot de passe actuel incorrect",
          });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await user.save();

        return res.status(200).json({
          ok: true,
          message: "Mot de passe modifié avec succès",
        });
      } else if (userType === "workshop") {
        const workshop = await Workshop.findById(userId);
        if (!workshop) {
          return res.status(404).json({
            ok: false,
            message: "Atelier non trouvé",
          });
        }

        // Verify current password
        const isPasswordValid = await bcrypt.compare(currentPassword, workshop.password);
        if (!isPasswordValid) {
          return res.status(401).json({
            ok: false,
            message: "Mot de passe actuel incorrect",
          });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        workshop.password = hashedPassword;
        await workshop.save();

        return res.status(200).json({
          ok: true,
          message: "Mot de passe modifié avec succès",
        });
      }

      return res.status(400).json({
        ok: false,
        message: "Type d'utilisateur invalide",
      });
    } catch (err: any) {
      console.error("Change password error:", err);
      return res.status(500).json({
        ok: false,
        message: err?.message ?? "Erreur serveur",
      });
    }
  }
);

router.post("/logout", authenticateToken, async (req: Request, res: Response) => {
  try {
    // For JWT tokens, logout is mainly handled client-side by removing the token
    // This endpoint can be used for logging purposes or future token blacklisting
    return res.status(200).json({
      ok: true,
      message: "Déconnexion réussie",
    });
  } catch (err: any) {
    console.error("Logout error:", err);
    return res.status(500).json({ ok: false, message: err?.message ?? "Erreur serveur" });
  }
});

export default router;

