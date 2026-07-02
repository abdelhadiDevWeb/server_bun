import { Router } from "express";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import Joi from "joi";
import { Sponsor } from "../Models/Sponsor";
import { Car } from "../Models/Car";
import { AbonnementSponsor } from "../Models/AbonnementSponsor";
import { authenticateToken } from "../middleware/auth.middleware";
import {
  createChargilyCheckout,
  getChargilyCheckout,
  getChargilyCheckoutPaymentStatus,
  getBackendPublicUrl,
  getFrontendBaseUrl,
  verifyChargilyWebhookSignature,
} from "../services/chargilyPay";

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

async function activateSponsorAfterPayment(
  sponsorId: string,
  checkoutId?: string
): Promise<{ ok: true; alreadyPaid: boolean } | { ok: false; message: string }> {
  if (!mongoose.Types.ObjectId.isValid(sponsorId)) {
    return { ok: false, message: "Sponsor invalide" };
  }

  const sponsor = await Sponsor.findById(sponsorId);
  if (!sponsor) {
    return { ok: false, message: "Sponsor non trouvé" };
  }

  if (sponsor.payment_status === "paid" && sponsor.status === true) {
    return { ok: true, alreadyPaid: true };
  }

  const now = new Date();
  sponsor.start_date = now;
  sponsor.end_date = new Date(now.getTime() + sponsor.duration * DAY_MS);
  sponsor.status = true;
  sponsor.payment_status = "paid";
  sponsor.paid_at = now;
  if (checkoutId) {
    sponsor.chargily_checkout_id = checkoutId;
  }
  await sponsor.save();

  return { ok: true, alreadyPaid: false };
}

/** Confirm payment with Chargily API, then activate only if checkout is paid. */
async function syncSponsorPaymentFromChargily(
  sponsorId: string
): Promise<{ synced: boolean; paid: boolean }> {
  const sponsor = await Sponsor.findById(sponsorId);
  if (!sponsor || sponsor.price <= 0) {
    return { synced: false, paid: sponsor?.payment_status === "paid" };
  }
  if (sponsor.payment_status === "paid" && sponsor.status === true) {
    return { synced: true, paid: true };
  }

  const checkoutId = sponsor.chargily_checkout_id?.trim();
  if (!checkoutId) {
    return { synced: false, paid: false };
  }

  const checkout = await getChargilyCheckoutPaymentStatus(checkoutId);
  if (!checkout) {
    return { synced: false, paid: false };
  }

  const status = String(checkout.status || "").toLowerCase();
  if (status === "paid") {
    const result = await activateSponsorAfterPayment(sponsorId, checkout.id);
    return { synced: true, paid: result.ok };
  }

  if (["failed", "canceled", "cancelled", "expired"].includes(status)) {
    await Sponsor.findOneAndUpdate(
      { _id: sponsorId, payment_status: { $ne: "paid" } },
      {
        $set: {
          payment_status: status === "failed" ? "failed" : "cancelled",
          status: false,
        },
      }
    );
    return { synced: true, paid: false };
  }

  return { synced: true, paid: false };
}

async function findBlockingSponsorForCar(carId: string) {
  const now = new Date();
  return Sponsor.findOne({
    id_car: carId,
    $or: [
      { status: true, payment_status: "paid", end_date: { $gt: now } },
      { payment_status: "pending" },
    ],
  }).lean();
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
        const hasActive = (sponsors as (SponsorLean & { payment_status?: string })[]).some(
          (s) =>
            s.id_car.toString() === carIdStr &&
            s.status === true &&
            s.payment_status === "paid" &&
            s.end_date &&
            new Date(s.end_date).getTime() > now
        );
        const hasPendingPayment = (sponsors as (SponsorLean & { payment_status?: string })[]).some(
          (s) =>
            s.id_car.toString() === carIdStr &&
            s.payment_status === "pending"
        );
        return !hasActive && !hasPendingPayment;
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

    // 3. Block double-sponsoring: refuse if this car already has an active or pending sponsor.
    const existingBlocking = await findBlockingSponsorForCar(id_car);
    if (existingBlocking) {
      const isPending = (existingBlocking as any).payment_status === "pending";
      return res.status(409).json({
        ok: false,
        message: isPending
          ? "Un sponsor en attente de paiement existe déjà pour cette voiture"
          : "Cette voiture a déjà un sponsor actif",
      });
    }

    const now = new Date();
    const requiresPayment = price > 0;

    const sponsor = new Sponsor({
      id_car,
      id_owner: userId,
      // Dates are set when payment is confirmed (or immediately for free sponsors).
      start_date: requiresPayment ? now : start_date ? new Date(start_date) : now,
      end_date: requiresPayment
        ? now
        : new Date((start_date ? new Date(start_date) : now).getTime() + duration * DAY_MS),
      duration,
      price,
      status: false,
      payment_status: requiresPayment ? "pending" : "paid",
      paid_at: requiresPayment ? null : now,
    });

    if (!requiresPayment) {
      sponsor.status = true;
      sponsor.start_date = start_date ? new Date(start_date) : now;
      sponsor.end_date = new Date(sponsor.start_date.getTime() + duration * DAY_MS);
    }

    await sponsor.save();

    const populated = await Sponsor.findById(sponsor._id)
      .populate("id_car", "brand model year images price status")
      .lean();

    return res.status(201).json({
      ok: true,
      message:
        price > 0
          ? "Sponsor créé — procédez au paiement pour l'activer"
          : "Sponsor créé avec succès",
      sponsor: populated
        ? { ...populated, id: (populated as any)._id.toString() }
        : sponsor.toJSON(),
      requires_payment: price > 0,
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
// POST /sponsor/payment/create-checkout
// Creates a Chargily Pay V2 checkout and returns the payment URL.
// ---------------------------------------------------------------------------

router.post("/payment/create-checkout", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const userType = req.user?.type;

    if (!userId || userType !== "user") {
      return res.status(401).json({
        ok: false,
        message: "Utilisateur non authentifié ou type invalide",
      });
    }

    const sponsorId = String(req.body?.sponsor_id || req.body?.sponsorId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(sponsorId)) {
      return res.status(400).json({ ok: false, message: "sponsor_id invalide" });
    }

    const sponsor = await Sponsor.findById(sponsorId);
    if (!sponsor) {
      return res.status(404).json({ ok: false, message: "Sponsor non trouvé" });
    }
    if (sponsor.id_owner.toString() !== userId) {
      return res.status(403).json({
        ok: false,
        message: "Vous n'avez pas le droit de payer ce sponsor",
      });
    }
    if (sponsor.payment_status === "paid" && sponsor.status === true) {
      return res.status(200).json({
        ok: true,
        already_paid: true,
        message: "Ce sponsor est déjà payé et actif",
      });
    }
    if (sponsor.price <= 0) {
      const activated = await activateSponsorAfterPayment(sponsorId);
      if (!activated.ok) {
        return res.status(400).json({ ok: false, message: activated.message });
      }
      return res.status(200).json({
        ok: true,
        already_paid: true,
        message: "Sponsor activé",
      });
    }

    const frontendBase = getFrontendBaseUrl();
    const backendBase = getBackendPublicUrl();
    const returnPathRaw = String(req.body?.return_path || "").trim();

    const buildReturnUrls = (path: string) => {
      const sep = path.includes("?") ? "&" : "?";
      return {
        success: `${frontendBase}${path}${sep}sponsor_payment=success&sponsor_id=${sponsorId}`,
        failure: `${frontendBase}${path}${sep}sponsor_payment=failed&sponsor_id=${sponsorId}`,
      };
    };

    const defaultPath = "/dashboard-seller/my-cars?filter=sponsor";
    let successUrl: string;
    let failureUrl: string;

    if (
      returnPathRaw.startsWith("/") &&
      !returnPathRaw.includes("://") &&
      !returnPathRaw.includes("..")
    ) {
      const urls = buildReturnUrls(returnPathRaw);
      successUrl = urls.success;
      failureUrl = urls.failure;
    } else {
      const urls = buildReturnUrls(defaultPath);
      successUrl = urls.success;
      failureUrl = urls.failure;
    }

    // Fast path: return cached payment URL only for default my-cars return (same redirect target).
    const cachedUrl = sponsor.chargily_checkout_url?.trim();
    if (!returnPathRaw && cachedUrl && sponsor.payment_status === "pending") {
      return res.status(200).json({
        ok: true,
        checkout_id: sponsor.chargily_checkout_id ?? undefined,
        checkout_url: cachedUrl,
        amount: Math.round(sponsor.price),
        currency: "dzd",
        reused: true,
      });
    }

    // Reuse existing Chargily session when user taps Pay again (default return path only).
    if (!returnPathRaw && sponsor.chargily_checkout_id && sponsor.payment_status === "pending") {
      try {
        const existing = await getChargilyCheckout(sponsor.chargily_checkout_id);
        if (existing?.checkout_url) {
          sponsor.chargily_checkout_url = existing.checkout_url;
          await sponsor.save();
          return res.status(200).json({
            ok: true,
            checkout_id: existing.id,
            checkout_url: existing.checkout_url,
            amount: existing.amount ?? Math.round(sponsor.price),
            currency: existing.currency ?? "dzd",
            reused: true,
          });
        }
      } catch (reuseErr) {
        console.warn("Could not reuse Chargily checkout, creating new one:", reuseErr);
      }
    }

    const car = await Car.findById(sponsor.id_car).select("brand model").lean();
    const carLabel = car
      ? `${(car as { brand?: string }).brand || ""} ${(car as { model?: string }).model || ""}`.trim()
      : "Voiture";

    const checkout = await createChargilyCheckout({
      amount: Math.round(sponsor.price),
      currency: "dzd",
      success_url: successUrl,
      failure_url: failureUrl,
      webhook_endpoint: `${backendBase}/api/sponsor/webhook/chargily`,
      locale: "fr",
      description: `Sponsor CarSure DZ — ${carLabel} (${sponsor.duration} jours)`,
      metadata: {
        sponsor_id: sponsorId,
        user_id: userId,
        car_id: sponsor.id_car.toString(),
      },
    });

    sponsor.chargily_checkout_id = checkout.id;
    sponsor.chargily_checkout_url = checkout.checkout_url;
    sponsor.payment_status = "pending";
    sponsor.status = false;
    await sponsor.save();

    return res.status(200).json({
      ok: true,
      checkout_id: checkout.id,
      checkout_url: checkout.checkout_url,
      amount: checkout.amount,
      currency: checkout.currency,
    });
  } catch (err: any) {
    console.error("Create sponsor checkout error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur lors de la création du paiement",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /sponsor/payment/status/:id
// Poll payment status after redirect from Chargily (webhook may be delayed).
// ---------------------------------------------------------------------------

router.get("/payment/status/:id", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Non authentifié" });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "id invalide" });
    }

    let sponsor = await Sponsor.findById(id);
    if (!sponsor) {
      return res.status(404).json({ ok: false, message: "Sponsor non trouvé" });
    }
    if (sponsor.id_owner.toString() !== userId) {
      return res.status(403).json({ ok: false, message: "Accès refusé" });
    }

    if (
      sponsor.price > 0 &&
      sponsor.payment_status === "pending" &&
      sponsor.chargily_checkout_id
    ) {
      await syncSponsorPaymentFromChargily(id);
      sponsor = await Sponsor.findById(id);
    }

    if (!sponsor) {
      return res.status(404).json({ ok: false, message: "Sponsor non trouvé" });
    }

    return res.status(200).json({
      ok: true,
      payment_status: sponsor.payment_status ?? "pending",
      status: sponsor.status === true,
      paid_at: sponsor.paid_at ?? null,
    });
  } catch (err: any) {
    console.error("Sponsor payment status error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message ?? "Erreur serveur",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /sponsor/webhook/chargily
// Chargily Pay V2 webhook (raw body — mounted in index.ts).
// ---------------------------------------------------------------------------

export async function handleChargilySponsorWebhook(req: Request, res: Response) {
  try {
    const signature = req.get("signature") || req.get("Signature");
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

    if (!rawBody) {
      return res.status(400).json({ ok: false, message: "Missing raw body" });
    }

    if (!verifyChargilyWebhookSignature(rawBody, signature)) {
      return res.status(403).json({ ok: false, message: "Invalid signature" });
    }

    const event = JSON.parse(rawBody.toString("utf8")) as {
      type?: string;
      data?: { id?: string; metadata?: Record<string, string> | null };
    };

    const checkoutId = event.data?.id;
    const sponsorId =
      event.data?.metadata?.sponsor_id ||
      event.data?.metadata?.sponsorId ||
      null;

    if (event.type === "checkout.paid") {
      if (sponsorId) {
        await activateSponsorAfterPayment(sponsorId, checkoutId);
      } else if (checkoutId) {
        const sponsor = await Sponsor.findOne({ chargily_checkout_id: checkoutId });
        if (sponsor) {
          await activateSponsorAfterPayment(sponsor._id.toString(), checkoutId);
        }
      }
    } else if (
      event.type === "checkout.failed" ||
      event.type === "checkout.canceled" ||
      event.type === "checkout.expired"
    ) {
      const targetId = sponsorId
        ? sponsorId
        : checkoutId
          ? (await Sponsor.findOne({ chargily_checkout_id: checkoutId }))?._id?.toString()
          : null;

      if (targetId && mongoose.Types.ObjectId.isValid(targetId)) {
        await Sponsor.findOneAndUpdate(
          { _id: targetId, payment_status: { $ne: "paid" } },
          {
            $set: {
              payment_status:
                event.type === "checkout.failed" ? "failed" : "cancelled",
              status: false,
            },
          }
        );
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("Chargily webhook error:", err);
    return res.status(500).json({ ok: false, message: "Webhook error" });
  }
}

// Webhook is mounted in index.ts (before express.json) — handler exported above.

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
