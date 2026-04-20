import type { Request, Response, NextFunction } from "express";
import Joi from "joi";

/**
 * Middleware to validate request body using Joi schema
 */
export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      res.status(400).json({
        ok: false,
        message: "Erreur de validation",
        errors,
      });
      return;
    }

    // Replace req.body with sanitized value
    req.body = value;
    next();
  };
};

/**
 * Validation schemas
 */
export const validationSchemas = {
  registerUser: Joi.object({
    firstName: Joi.string()
      .trim()
      .min(2)
      .max(50)
      .pattern(/^[a-zA-ZÀ-ÿ\s'-]+$/)
      .required()
      .messages({
        "string.min": "Le prénom doit contenir au moins 2 caractères",
        "string.max": "Le prénom ne peut pas dépasser 50 caractères",
        "string.pattern.base": "Le prénom ne peut contenir que des lettres",
        "any.required": "Le prénom est requis",
      }),
    lastName: Joi.string()
      .trim()
      .min(2)
      .max(50)
      .pattern(/^[a-zA-ZÀ-ÿ\s'-]+$/)
      .required()
      .messages({
        "string.min": "Le nom doit contenir au moins 2 caractères",
        "string.max": "Le nom ne peut pas dépasser 50 caractères",
        "string.pattern.base": "Le nom ne peut contenir que des lettres",
        "any.required": "Le nom est requis",
      }),
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .max(100)
      .required()
      .messages({
        "string.email": "Format d'email invalide",
        "string.max": "L'email ne peut pas dépasser 100 caractères",
        "any.required": "L'email est requis",
      }),
    phone: Joi.string()
      .trim()
      .pattern(/^[0-9+\s()-]{8,20}$/)
      .required()
      .messages({
        "string.pattern.base": "Format de téléphone invalide",
        "any.required": "Le téléphone est requis",
      }),
    password: Joi.string()
      .min(8)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .messages({
        "string.min": "Le mot de passe doit contenir au moins 8 caractères",
        "string.max": "Le mot de passe ne peut pas dépasser 128 caractères",
        "string.pattern.base":
          "Le mot de passe doit contenir au moins une majuscule, une minuscule, un chiffre et un caractère spécial",
        "any.required": "Le mot de passe est requis",
      }),
  }),

  registerWorkshop: Joi.object({
    name: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .required()
      .messages({
        "string.min": "Le nom doit contenir au moins 2 caractères",
        "string.max": "Le nom ne peut pas dépasser 100 caractères",
        "any.required": "Le nom est requis",
      }),
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .max(100)
      .required()
      .messages({
        "string.email": "Format d'email invalide",
        "string.max": "L'email ne peut pas dépasser 100 caractères",
        "any.required": "L'email est requis",
      }),
    adr: Joi.string()
      .trim()
      .min(5)
      .max(200)
      .required()
      .messages({
        "string.min": "L'adresse doit contenir au moins 5 caractères",
        "string.max": "L'adresse ne peut pas dépasser 200 caractères",
        "any.required": "L'adresse est requise",
      }),
    phone: Joi.string()
      .trim()
      .pattern(/^[0-9+\s()-]{8,20}$/)
      .required()
      .messages({
        "string.pattern.base": "Format de téléphone invalide",
        "any.required": "Le téléphone est requis",
      }),
    type: Joi.string()
      .valid('paint_vehicle', 'mechanic', 'mechanic_paint_inspector')
      .required()
      .messages({
        "any.only": "Le type d'atelier doit être 'paint_vehicle', 'mechanic' ou 'mechanic_paint_inspector'",
        "any.required": "Le type d'atelier est requis",
      }),
    password: Joi.string()
      .min(8)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .messages({
        "string.min": "Le mot de passe doit contenir au moins 8 caractères",
        "string.max": "Le mot de passe ne peut pas dépasser 128 caractères",
        "string.pattern.base":
          "Le mot de passe doit contenir au moins une majuscule, une minuscule, un chiffre et un caractère spécial",
        "any.required": "Le mot de passe est requis",
      }),
  }),

  login: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required()
      .messages({
        "string.email": "Format d'email invalide",
        "any.required": "L'email est requis",
      }),
    password: Joi.string()
      .min(1)
      .required()
      .messages({
        "any.required": "Le mot de passe est requis",
      }),
  }),

  verifyEmail: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required()
      .messages({
        "string.email": "Format d'email invalide",
        "any.required": "L'email est requis",
      }),
    code: Joi.string()
      .trim()
      .pattern(/^\d{6}$/)
      .required()
      .messages({
        "string.pattern.base": "Le code doit contenir exactement 6 chiffres",
        "any.required": "Le code est requis",
      }),
    type: Joi.string()
      .valid("user", "workshop", "client")
      .required()
      .messages({
        "any.only": "Le type doit être 'user', 'workshop' ou 'client'",
        "any.required": "Le type est requis",
      }),
  }),

  resendVerification: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required()
      .messages({
        "string.email": "Format d'email invalide",
        "any.required": "L'email est requis",
      }),
  }),

  forgotPasswordRequest: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required()
      .messages({
        "string.email": "Format d'email invalide",
        "any.required": "L'email est requis",
      }),
  }),

  forgotPasswordVerifyCode: Joi.object({
    email: Joi.string()
      .trim()
      .lowercase()
      .email()
      .required()
      .messages({
        "string.email": "Format d'email invalide",
        "any.required": "L'email est requis",
      }),
    code: Joi.string()
      .trim()
      .pattern(/^\d{6}$/)
      .required()
      .messages({
        "string.pattern.base": "Le code doit contenir exactement 6 chiffres",
        "any.required": "Le code est requis",
      }),
    type: Joi.string()
      .valid("user", "workshop")
      .required()
      .messages({
        "any.only": "Le type doit être 'user' ou 'workshop'",
        "any.required": "Le type est requis",
      }),
  }),

  forgotPasswordReset: Joi.object({
    resetToken: Joi.string().trim().required().messages({
      "any.required": "Le token de réinitialisation est requis",
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
  }),
};
