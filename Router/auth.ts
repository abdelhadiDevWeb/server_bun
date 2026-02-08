import { Router } from "express";
import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Joi from "joi";

import { User } from "../Models/User";
import { Workshop } from "../Models/Workshop";
import { EmailVerification } from "../Models/EmailVerification";
import { sendVerificationEmail } from "../services/emailService";
import { AppConfig } from "../config/app.config";
import { validate, validationSchemas } from "../middleware/validation.middleware";
import { authRateLimiter, emailVerificationRateLimiter } from "../middleware/rateLimit.middleware";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();

// Generate 6-digit code
const generateCode = (): string => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  // Ensure it's exactly 6 digits and trim any whitespace
  return code.trim().padStart(6, '0').slice(0, 6);
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
    });
    
    const savedCode = String(verificationDoc.code || '').replace(/\D/g, '').trim();
    console.log(`💾 Code saved to database: "${savedCode}" (type: ${typeof savedCode}, length: ${savedCode.length})`);
    
    // Verify the saved code matches what we're sending
    if (savedCode !== cleanCode) {
      console.error(`⚠️  WARNING: Code mismatch! Generated: "${cleanCode}" vs Saved: "${savedCode}"`);
    } else {
      console.log(`✅ Code saved correctly: "${cleanCode}"`);
    }

    const emailSent = await sendVerificationEmail(email, cleanCode);
    if (!emailSent) {
      console.error("Failed to send verification email to:", email);
      console.log("⚠️  Verification code (for testing):", cleanCode);
    } else {
      console.log(`✅ Verification email sent to: ${email} with code: ${cleanCode}`);
    }

    return res.status(201).json({
      ok: true,
      user: user.toJSON(),
      message: emailSent 
        ? "Verification code sent to email" 
        : "Account created but email failed. Please check SMTP_PASSWORD in server .env",
      // In development, include code if email failed (remove in production)
      ...(process.env.NODE_ENV !== "production" && !emailSent ? { verificationCode: code } : {}),
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message ?? "Server error" });
  }
});

router.post("/register/workshop", authRateLimiter, validate(validationSchemas.registerWorkshop), async (req: Request, res: Response) => {
  try {
    // Body is already validated and sanitized by Joi middleware
    const { name, email, adr, phone, type, password } = req.body;

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
    });
    
    const savedCode = String(verificationDoc.code || '').replace(/\D/g, '').trim();
    console.log(`💾 Code saved to database: "${savedCode}" (type: ${typeof savedCode}, length: ${savedCode.length})`);
    
    // Verify the saved code matches what we're sending
    if (savedCode !== cleanCode) {
      console.error(`⚠️  WARNING: Code mismatch! Generated: "${cleanCode}" vs Saved: "${savedCode}"`);
    } else {
      console.log(`✅ Code saved correctly: "${cleanCode}"`);
    }

    const emailSent = await sendVerificationEmail(email, cleanCode);
    if (!emailSent) {
      console.error("Failed to send verification email to:", email);
      console.log("⚠️  Verification code (for testing):", cleanCode);
    } else {
      console.log(`✅ Verification email sent to: ${email} with code: ${cleanCode}`);
    }

    return res.status(201).json({
      ok: true,
      workshop: workshop.toJSON(),
      message: emailSent 
        ? "Verification code sent to email" 
        : "Account created but email failed. Please check SMTP_PASSWORD in server .env",
      // In development, include code if email failed (remove in production)
      ...(process.env.NODE_ENV !== "production" && !emailSent ? { verificationCode: code } : {}),
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

// Login endpoint
router.post("/login", authRateLimiter, validate(validationSchemas.login), async (req: Request, res: Response) => {
  try {
    // Body is already validated and sanitized by Joi middleware
    const { email, password } = req.body;

    // Try to find user first
    let user = await User.findOne({ email: email.toLowerCase().trim() }).lean();
    let userType = "user";

    // If not found, try workshop
    if (!user) {
      user = await Workshop.findOne({ email: email.toLowerCase().trim() }).lean();
      userType = "workshop";
    }

    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "Email ou mot de passe incorrect",
      });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(String(password), user.password);
    if (!passwordMatch) {
      return res.status(401).json({
        ok: false,
        message: "Email ou mot de passe incorrect",
      });
    }

    // Check if account is verified (verfie)
    if (!user.verfie) {
      return res.status(403).json({
        ok: false,
        message: "Votre email n'a pas été vérifié. Veuillez vérifier votre email.",
        needsVerification: true,
      });
    }

    // Check if account is activated by admin (status)
    // For admin role, status check might be different, but we still check it
    if (!user.status) {
      return res.status(403).json({
        ok: false,
        message: "Votre compte n'est pas encore activé par l'administrateur.",
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

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return res.status(200).json({
      ok: true,
      message: "Connexion réussie",
      token,
      user: userWithoutPassword,
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
          type: "user",
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
          type: workshop.type || "workshop", // Include workshop type (mechanic or car_cover)
          verfie: workshop.verfie,
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
            type: "user",
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
            type: "workshop",
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

