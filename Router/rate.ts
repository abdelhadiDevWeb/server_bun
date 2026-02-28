import { Router } from "express";
import type { Request, Response } from "express";
import { Rate } from "../Models/Rate";
import { RendezVousWorkshop } from "../Models/RendezVousWorkshop";
import { Car } from "../Models/Car";
import { authenticateToken, requireSeller } from "../middleware/auth.middleware";
import mongoose from "mongoose";
import Joi from "joi";

const router = Router();

// Validation schema for creating a rate
const createRateSchema = Joi.object({
  target: Joi.string().required().messages({
    "any.required": "L'ID de la cible est requis",
  }),
  targetType: Joi.string().valid('Workshop', 'User').required().messages({
    "any.required": "Le type de cible est requis",
    "any.only": "Le type de cible doit être 'Workshop' ou 'User'",
  }),
  message: Joi.string().trim().max(500).optional().allow(null, '').messages({
    "string.max": "Le message ne peut pas dépasser 500 caractères",
  }),
  star: Joi.number().integer().min(1).max(5).required().messages({
    "any.required": "La note est requise",
    "number.min": "La note doit être entre 1 et 5",
    "number.max": "La note doit être entre 1 et 5",
    "number.base": "La note doit être un nombre",
  }),
});

// Create a rate (for workshop: only if user has finished an appointment; for user: if user has bought a car from this seller)
router.post("/", authenticateToken, requireSeller, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    const { error, value } = createRateSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        ok: false,
        message: "Erreur de validation",
        errors,
      });
    }

    const { target, targetType, message, star } = value;

    if (!mongoose.Types.ObjectId.isValid(target)) {
      return res.status(400).json({
        ok: false,
        message: "ID invalide",
      });
    }

    // Don't allow rating yourself
    if (targetType === 'User' && target === userId) {
      return res.status(403).json({
        ok: false,
        message: "Vous ne pouvez pas vous noter vous-même",
      });
    }

    // Check permissions based on target type
    if (targetType === 'Workshop') {
      // Check if user has a finished appointment with this workshop
      const finishedAppointment = await RendezVousWorkshop.findOne({
        id_owner_car: userId,
        id_workshop: target,
        status: 'finish',
      });

      if (!finishedAppointment) {
        return res.status(403).json({
          ok: false,
          message: "Vous ne pouvez noter que les ateliers avec lesquels vous avez terminé un rendez-vous",
        });
      }
    } else if (targetType === 'User') {
      // Check if user has bought a car from this seller (car status is 'sold' and owner is the target)
      // For now, we'll allow any authenticated user to rate a seller
      // You can add more specific logic here if needed (e.g., check if they interacted)
    }

    // Check if user has already rated this target
    const existingRate = await Rate.findOne({
      id_rater: userId,
      target: target,
      targetType: targetType,
    });

    if (existingRate) {
      // Update existing rate
      existingRate.star = star;
      existingRate.message = message || null;
      await existingRate.save();

      return res.status(200).json({
        ok: true,
        message: "Note mise à jour avec succès",
        rate: existingRate.toJSON(),
      });
    }

    // Create new rate
    const rate = new Rate({
      id_rater: userId,
      target: target,
      targetType: targetType,
      message: message || null,
      star: star,
    });

    await rate.save();

    return res.status(201).json({
      ok: true,
      message: "Note créée avec succès",
      rate: rate.toJSON(),
    });
  } catch (err: any) {
    console.error("Error creating/updating rate:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Get rates for a specific workshop
router.get("/workshop/:id", async (req: Request, res: Response) => {
  try {
    const workshopId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(workshopId)) {
      return res.status(400).json({
        ok: false,
        message: "ID d'atelier invalide",
      });
    }

    const rates = await Rate.find({ target: workshopId, targetType: 'Workshop' })
      .populate('id_rater', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    // Calculate average rating
    const totalStars = rates.reduce((sum, rate) => sum + (rate.star || 0), 0);
    const averageRating = rates.length > 0 ? totalStars / rates.length : 0;

    // Map _id to id
    const ratesWithId = rates.map((rate: any) => ({
      ...rate,
      id: rate._id?.toString() || rate.id,
      id_rater: rate.id_rater ? {
        ...rate.id_rater,
        id: (rate.id_rater as any)._id?.toString() || (rate.id_rater as any).id,
      } : null,
    }));

    return res.status(200).json({
      ok: true,
      rates: ratesWithId,
      averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
      totalRatings: rates.length,
    });
  } catch (err: any) {
    console.error("Error fetching rates:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Get rates for a specific user (seller)
router.get("/user/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        ok: false,
        message: "ID d'utilisateur invalide",
      });
    }

    const rates = await Rate.find({ target: userId, targetType: 'User' })
      .populate('id_rater', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    // Calculate average rating
    const totalStars = rates.reduce((sum, rate) => sum + (rate.star || 0), 0);
    const averageRating = rates.length > 0 ? totalStars / rates.length : 0;

    // Map _id to id
    const ratesWithId = rates.map((rate: any) => ({
      ...rate,
      id: rate._id?.toString() || rate.id,
      id_rater: rate.id_rater ? {
        ...rate.id_rater,
        id: (rate.id_rater as any)._id?.toString() || (rate.id_rater as any).id,
      } : null,
    }));

    return res.status(200).json({
      ok: true,
      rates: ratesWithId,
      averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
      totalRatings: rates.length,
    });
  } catch (err: any) {
    console.error("Error fetching rates:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Get user's rate for a specific workshop (if exists)
router.get("/workshop/:id/my-rate", authenticateToken, requireSeller, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const workshopId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(workshopId)) {
      return res.status(400).json({
        ok: false,
        message: "ID d'atelier invalide",
      });
    }

    const rate = await Rate.findOne({
      id_rater: userId,
      target: workshopId,
      targetType: 'Workshop',
    }).lean();

    if (!rate) {
      return res.status(200).json({
        ok: true,
        rate: null,
        canRate: true, // User can rate if they have finished appointment
      });
    }

    return res.status(200).json({
      ok: true,
      rate: {
        ...rate,
        id: rate._id?.toString() || rate.id,
      },
      canRate: true,
    });
  } catch (err: any) {
    console.error("Error fetching user rate:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Check if user can rate a workshop (has finished appointment)
router.get("/workshop/:id/can-rate", authenticateToken, requireSeller, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const workshopId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(workshopId)) {
      return res.status(400).json({
        ok: false,
        message: "ID d'atelier invalide",
      });
    }

    // Check if user has a finished appointment with this workshop
    const finishedAppointment = await RendezVousWorkshop.findOne({
      id_owner_car: userId,
      id_workshop: workshopId,
      status: 'finish',
    });

    return res.status(200).json({
      ok: true,
      canRate: !!finishedAppointment,
    });
  } catch (err: any) {
    console.error("Error checking if user can rate:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Get user's rate for a specific user (seller) (if exists)
router.get("/user/:id/my-rate", authenticateToken, requireSeller, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const targetUserId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        ok: false,
        message: "ID d'utilisateur invalide",
      });
    }

    const rate = await Rate.findOne({
      id_rater: userId,
      target: targetUserId,
      targetType: 'User',
    }).lean();

    if (!rate) {
      return res.status(200).json({
        ok: true,
        rate: null,
        canRate: true,
      });
    }

    return res.status(200).json({
      ok: true,
      rate: {
        ...rate,
        id: rate._id?.toString() || rate.id,
      },
      canRate: true,
    });
  } catch (err: any) {
    console.error("Error fetching user rate:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// Check if user can rate a seller
router.get("/user/:id/can-rate", authenticateToken, requireSeller, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const targetUserId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        ok: false,
        message: "ID d'utilisateur invalide",
      });
    }

    // Don't allow rating yourself
    if (targetUserId === userId) {
      return res.status(200).json({
        ok: true,
        canRate: false,
      });
    }

    // For now, allow any authenticated user to rate a seller
    // You can add more specific logic here (e.g., check if they bought a car from this seller)
    return res.status(200).json({
      ok: true,
      canRate: true,
    });
  } catch (err: any) {
    console.error("Error checking if user can rate:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

export default router;
