import { Router } from "express";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import Joi from "joi";
import { Sponsor } from "../Models/Sponsor";
import { Car } from "../Models/Car";
import { AbonnementSponsor } from "../Models/AbonnementSponsor";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/**
 * Body accepts either:
 *   { id_car, id_abonnement }                 (preferred — duration & price come from the plan)
 *   { id_car, duration, price? }              (legacy / direct — kept for backwards compat)
 * `start_date` is optional; defaults to "now" on the server.
 */
const createSponsorSchema = Joi.object({
  id_car: Joi.string()
    .required()
    .messages({
      "any.required": "La voiture est requise",
      "string.base": "id_car invalide",
    }),
  id_abonnement: Joi.string().optional(),
  duration: Joi.number().integer().min(1).max(365).optional().messages({
    "number.min": "La durée doit être d'au moins 1 jour",
    "number.max": "La durée ne peut pas dépasser 365 jours",
  }),
  price: Joi.number().min(0).optional(),
  start_date: Joi.date().optional().messages({
    "date.base": "Date de début invalide",
  }),
})
  .or("id_abonnement", "duration")
  .messages({
    "object.missing": "Veuillez fournir id_abonnement ou duration",
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Auto-flip `status` to `false` for any sponsor whose `end_date` is in the
 * past but is still flagged active. Returns the (possibly mutated) array of
 * lean sponsor documents.
 */
async function expireOverdueSponsors<T extends { _id: mongoose.Types.ObjectId; status: boolean; end_date: Date }>(
  sponsors: T[]
): Promise<T[]> {
  const now = new Date();
  const overdueIds = sponsors
    .filter((s) => s.status === true && s.end_date && s.end_date.getTime() <= now.getTime())
    .map((s) => s._id);

  if (overdueIds.length > 0) {
    await Sponsor.updateMany(
      { _id: { $in: overdueIds } },
      { $set: { status: false } }
    );
    for (const s of sponsors) {
      if (overdueIds.some((oid) => oid.toString() === s._id.toString())) {
        s.status = false;
      }
    }
  }
  return sponsors;
}

// ---------------------------------------------------------------------------
// GET /sponsor/plans  (public)
// Returns every available sponsorship plan (abonnement_sponsor rows) sorted by
// duration ascending. Used by the mobile app to populate the create-sponsor
// modal.
// ---------------------------------------------------------------------------

router.get("/plans", async (_req: Request, res: Response) => {
  try {
    const plans = await AbonnementSponsor.find().sort({ duration: 1, price: 1 }).lean();
    return res.status(200).json({
      ok: true,
      plans: plans.map((p: any) => ({
        id: p._id?.toString(),
        duration: p.duration,
        price: p.price,
      })),
    });
  } catch (err: any) {
    console.error("Get sponsor plans error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /sponsor/sponsorable-cars  (auth)
// Returns the user's `actif` cars that don't currently have an active sponsor.
// Cars that previously had a sponsor (now expired/cancelled) are still eligible
// and include `previous_sponsor_end_date` so the UI can hint at the history.
// ---------------------------------------------------------------------------

router.get("/sponsorable-cars", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Utilisateur non authentifié" });
    }

    const ownerId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;

    // 1. Pull the user's currently-actif cars.
    const cars = await Car.find({ owner: ownerId, status: "actif" })
      .select("brand model year images price status")
      .sort({ createdAt: -1 })
      .lean();

    if (cars.length === 0) {
      return res.status(200).json({ ok: true, cars: [] });
    }

    // 2. Pull every sponsor for these cars in one go.
    const carIds = cars.map((c: any) => c._id);
    const sponsors = await Sponsor.find({ id_car: { $in: carIds } })
      .sort({ end_date: -1 })
      .lean();

    // 3. Side-effect: mark any active-but-overdue sponsors as inactive so the
    //    "active sponsor" check below is correct.
    await expireOverdueSponsors(sponsors as any[]);

    const now = Date.now();
    type SponsorLean = { id_car: mongoose.Types.ObjectId; status: boolean; end_date: Date };

    const eligible = cars
      .filter((car: any) => {
        const carIdStr = car._id.toString();
        // Active sponsor = status:true AND end_date in the future.
        const hasActive = (sponsors as SponsorLean[]).some(
          (s) =>
            s.id_car.toString() === carIdStr &&
            s.status === true &&
            s.end_date &&
            new Date(s.end_date).getTime() > now
        );
        return !hasActive;
      })
      .map((car: any) => {
        const carIdStr = car._id.toString();
        // Most recent (already sorted desc) sponsor for this car, if any —
        // exposed as "previous_sponsor_end_date" so the UI can render a hint.
        const previous = (sponsors as SponsorLean[]).find(
          (s) => s.id_car.toString() === carIdStr
        );
        return {
          ...car,
          id: carIdStr,
          previous_sponsor_end_date: previous?.end_date ?? null,
          had_previous_sponsor: !!previous,
        };
      });

    return res.status(200).json({ ok: true, cars: eligible });
  } catch (err: any) {
    console.error("Get sponsorable cars error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /sponsor/create
// Body: { id_car, id_abonnement?, duration?, price?, start_date? }
// Creates a sponsorship for a car owned by the authenticated user.
// If `id_abonnement` is provided, duration & price are derived from the plan
// (and any client-supplied duration/price are ignored as the source of truth).
// ---------------------------------------------------------------------------

router.post("/create", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userType = req.user?.type;

    if (!userId || userType !== "user") {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié ou type invalide",
      });
    }

    const { error, value } = createSponsorSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        message: "Erreur de validation",
        errors: error.details.map((d) => d.message),
      });
    }

    const { id_car, id_abonnement, start_date } = value as {
      id_car: string;
      id_abonnement?: string;
      duration?: number;
      price?: number;
      start_date?: Date;
    };
    let { duration, price } = value as { duration?: number; price?: number };

    if (!mongoose.Types.ObjectId.isValid(id_car)) {
      return res.status(400).json({ ok: false, message: "id_car invalide" });
    }

    // 1. If a plan is supplied, it's the source of truth for duration + price.
    if (id_abonnement) {
      if (!mongoose.Types.ObjectId.isValid(id_abonnement)) {
        return res.status(400).json({ ok: false, message: "id_abonnement invalide" });
      }
      const plan = await AbonnementSponsor.findById(id_abonnement).lean();
      if (!plan) {
        return res.status(404).json({ ok: false, message: "Plan d'abonnement introuvable" });
      }
      duration = (plan as any).duration;
      price = (plan as any).price;
    }

    if (typeof duration !== "number" || duration < 1) {
      return res.status(400).json({
        ok: false,
        message: "Durée invalide ou manquante",
      });
    }
    if (typeof price !== "number" || price < 0) {
      // Legacy callers may not send price — default to 0 silently.
      price = 0;
    }

    // 2. Verify the car exists and belongs to the requesting user.
    const car = await Car.findById(id_car);
    if (!car) {
      return res.status(404).json({ ok: false, message: "Voiture non trouvée" });
    }
    if (car.owner.toString() !== userId) {
      return res.status(403).json({
        ok: false,
        message: "Vous n'avez pas le droit de sponsoriser cette voiture",
      });
    }

    // 3. Block double-sponsoring: refuse if this car already has an active sponsor.
    const existingActive = await Sponsor.findOne({
      id_car,
      status: true,
      end_date: { $gt: new Date() },
    }).lean();
    if (existingActive) {
      return res.status(409).json({
        ok: false,
        message: "Cette voiture a déjà un sponsor actif",
      });
    }

    const startDate = start_date ? new Date(start_date) : new Date();
    const endDate = new Date(startDate.getTime() + duration * DAY_MS);

    const sponsor = new Sponsor({
      id_car,
      id_owner: userId,
      start_date: startDate,
      end_date: endDate,
      duration,
      price,
      status: true,
    });

    await sponsor.save();

    const populated = await Sponsor.findById(sponsor._id)
      .populate("id_car", "brand model year images price status")
      .lean();

    return res.status(201).json({
      ok: true,
      message: "Sponsor créé avec succès",
      sponsor: populated
        ? { ...populated, id: (populated as any)._id.toString() }
        : sponsor.toJSON(),
    });
  } catch (err: any) {
    console.error("Create sponsor error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /sponsor/my-sponsors
// Returns every sponsor owned by the authenticated user, with the linked car
// populated. Sponsors whose end_date has passed are auto-flipped to status:false
// before being returned.
// ---------------------------------------------------------------------------

router.get("/my-sponsors", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié",
      });
    }

    const ownerId = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;

    const sponsors = await Sponsor.find({ id_owner: ownerId })
      .populate("id_car", "brand model year images price status")
      .sort({ end_date: -1, createdAt: -1 })
      .lean();

    const refreshed = await expireOverdueSponsors(sponsors as any[]);

    return res.status(200).json({
      ok: true,
      sponsors: refreshed.map((s: any) => ({
        ...s,
        id: s._id?.toString(),
      })),
    });
  } catch (err: any) {
    console.error("Get my sponsors error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// ---------------------------------------------------------------------------
// PATCH /sponsor/:id/cancel
// Soft-cancels a sponsor (status:false). Only the owner may cancel.
// ---------------------------------------------------------------------------

router.patch("/:id/cancel", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Utilisateur non authentifié" });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "id invalide" });
    }

    const sponsor = await Sponsor.findById(id);
    if (!sponsor) {
      return res.status(404).json({ ok: false, message: "Sponsor non trouvé" });
    }
    if (sponsor.id_owner.toString() !== userId) {
      return res.status(403).json({
        ok: false,
        message: "Vous n'avez pas le droit d'annuler ce sponsor",
      });
    }

    sponsor.status = false;
    await sponsor.save();

    return res.status(200).json({
      ok: true,
      message: "Sponsor annulé",
      sponsor: sponsor.toJSON(),
    });
  } catch (err: any) {
    console.error("Cancel sponsor error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

export default router;
